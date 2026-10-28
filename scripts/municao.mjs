/**
 * t20-hayd-itens | municao.mjs
 * Armas que usam munição (na ficha da arma, Consumível → Munição):
 *
 *  - na ficha (de personagem ou de ameaça), a arma ganha uma linha com a
 *    munição equipada e se a arma está carregada; vazia, mostra
 *    Recarregar. O nome da munição abre um menu com as do inventário, para
 *    trocar. A munição continua no inventário e é gasta nos disparos;
 *  - recarregar gasta ação: em combate, o chat registra a recarga. Atacar
 *    com a arma vazia recarrega sozinho (o registro sai antes do ataque).
 *    As mensagens de munição podem ser desligadas nas configurações;
 *  - a munição escolhida vira o alvo de consumo do sistema
 *    (system.consume.target): o sistema desconta o estoque e soma o bônus
 *    de ataque dela. O módulo conta quantos disparos cabem antes de
 *    recarregar. Sem munição no inventário o ataque sai do mesmo jeito,
 *    sem os efeitos dela e com um aviso no cartão;
 *  - os efeitos do pacote de munição (melhorias, encantos, efeitos de uso
 *    e os criados à mão) são copiados para a arma enquanto ele estiver
 *    escolhido, e entram no ataque como os da própria arma. A mesma
 *    entrada na arma e na munição vale uma vez só (T20 p.178: não
 *    acumulam); o resto o jogador escolhe na janela de uso;
 *  - o cartão do ataque diz quanto foi gasto e quanto resta.
 *
 * Estado na arma: flags[MODULO].municao = { item, carregadas, capacidade? }.
 * `item` é a munição que foi carregada: trocar o alvo de consumo pela
 * ficha da arma conta como arma vazia.
 */

import { MODULO, obterEntrada } from "./catalogo.mjs";
import { ehMunicao, registroAtivo, dadosDoItem, efeitoAmeacadora, LISTAS } from "./efeitos.mjs";
import { capacidadePadrao, disparosNaRecarga, impressao } from "./regras.mjs";
import { esc, cartaoHTML, postar } from "./mensagens.mjs";
import { ehV14, mudancasDe, paraOSistema } from "./versao.mjs";

/* ------------------------------------------------------------------ */
/* Configuração                                                       */
/* ------------------------------------------------------------------ */

export function registrarConfiguracao() {
  game.settings.register(MODULO, "municao", {
    name: "Munição nas armas",
    hint: "Armas com Consumível → Munição mostram a munição carregada na ficha (de personagens e ameaças), precisam ser recarregadas, gastam a munição a cada disparo e usam as melhorias e encantos dela no ataque.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => {
      for (const app of Object.values(ui.windows)) if (app.actor) app.render(false);
    }
  });
  // Lidas na hora de mostrar: desligar também esconde o que já está no chat.
  const redesenhar = () => {
    for (const m of game.messages.contents) if (m.flags?.[MODULO]?.municao) ui.chat?.updateMessage?.(m);
  };
  game.settings.register(MODULO, "municaoMensagens", {
    name: "Mensagens de munição no chat",
    hint: "Recargas em combate, munição gasta no cartão do ataque e o aviso de disparo sem munição. Desligue se poluir demais o chat; a automação continua funcionando.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: redesenhar
  });
  game.settings.register(MODULO, "municaoMensagensNPC", {
    name: "Mensagens de munição de ameaças e NPCs",
    hint: "Desligada, só os personagens dos jogadores mandam mensagens de munição; a munição das ameaças continua sendo controlada, sem aparecer no chat.",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: redesenhar
  });
}

function ligada() {
  try { return game.settings.get(MODULO, "municao"); }
  catch { return false; }
}

/**
 * As mensagens de munição deste ator aparecem no chat? Personagens seguem
 * só a opção geral; ameaças e NPCs também a opção própria deles.
 */
export function mensagensDeMunicao(ator) {
  const ler = (chave, padrao) => {
    try { return game.settings.get(MODULO, chave); }
    catch { return padrao; }
  };
  if (!ler("municaoMensagens", true)) return false;
  return ator?.type === "character" || ler("municaoMensagensNPC", true);
}

/* ------------------------------------------------------------------ */
/* Leitura                                                            */
/* ------------------------------------------------------------------ */

/** A arma usa munição (e a automação está ligada)? */
export function usaMunicao(item) {
  return ligada() && item?.type === "arma" && item.system?.consume?.type === "ammo";
}

/** A munição escolhida no alvo de consumo da arma, se ainda estiver no inventário. */
export function municaoDaArma(arma) {
  const m = arma?.actor?.items.get(arma.system?.consume?.target);
  return m && ehMunicao(m) ? m : null;
}

/** Disparos que cabem na arma (0 = não recarrega, como os arcos). */
export function capacidade(arma) {
  const c = arma.flags?.[MODULO]?.municao?.capacidade;
  return Number.isInteger(c) && c >= 0 ? c : capacidadePadrao(arma.name);
}

/**
 * Está em algum combate iniciado? `actor.inCombat` só olha o combate da
 * cena que o usuário está vendo, e o Mestre pode estar em outra.
 */
function emCombate(ator) {
  return ator.inCombat || game.combats.some(c => c.started && c.getCombatantsByActor(ator).length);
}

/** Personagens e ameaças recarregam do mesmo jeito. */
function precisaRecarregar(arma) {
  return !!arma.actor && capacidade(arma) > 0;
}

const estoque = municao => Math.max(0, Number(municao?.system?.qtd) || 0);
const porDisparo = arma => Math.max(1, Number(arma.system?.consume?.amount) || 1);

function carregadas(arma) {
  const f = arma.flags?.[MODULO]?.municao ?? {};
  if (!f.item || f.item !== arma.system?.consume?.target) return 0;
  return Math.max(0, Number(f.carregadas) || 0);
}

/**
 * O que a ficha mostra e o que o disparo confere. `falta` diz por que a
 * arma não dispara: "escolher" (sem munição escolhida), "estoque" (a
 * munição acabou) ou "descarregada".
 */
export function situacao(arma) {
  const municao = municaoDaArma(arma);
  const precisa = precisaRecarregar(arma);
  const cap = capacidade(arma);
  const carga = precisa ? Math.min(carregadas(arma), cap) : 0;
  const qtd = estoque(municao);
  const cada = porDisparo(arma);
  let falta = null;
  if (!municao) falta = "escolher";
  else if (qtd < cada) falta = "estoque";
  else if (precisa && carga <= 0) falta = "descarregada";
  return { municao, precisa, capacidade: cap, carregadas: carga, estoque: qtd, porDisparo: cada, falta };
}

/** Nomes das melhorias, encantos e materiais ligados num item. */
function resumoDoItem(item) {
  const d = dadosDoItem(item);
  return LISTAS.flatMap(lista => d[lista])
    .filter(e => !e.desativada)
    .map(e => obterEntrada(e.key)?.nome ?? e.key)
    .join(", ");
}

/* ------------------------------------------------------------------ */
/* Efeitos da munição na arma                                         */
/* ------------------------------------------------------------------ */

/**
 * Dados das cópias dos efeitos da munição, prontos para criar na arma.
 * Ficam de fora os efeitos de ator (valem na ficha de qualquer jeito) e
 * as entradas que a arma também tem — a da arma vale, a da munição não.
 */
function copiasDosEfeitos(arma, municao) {
  const sufixo = ` (${municao.name})`;
  const nomes = new Set(municao.effects.map(e => e.name));
  const saida = [];

  for (const ef of municao.effects) {
    const m = ef.flags?.[MODULO] ?? {};
    if (m.alvo === "ator" || m.daMunicao) continue;
    if (m.key && registroAtivo(arma, m.key)) continue;

    // Ameaçadora duplica a margem da ARMA, não a da munição.
    let dados = m.key === "ameacadora"
      ? paraOSistema(efeitoAmeacadora(arma, m.entradaId)[0])
      : ef.toObject();
    delete dados._id;
    delete dados._stats;
    dados.name = `${dados.name}${sufixo}`;
    // Mesmo origin dos efeitos da própria arma: é por ele que o motor de
    // rolagem acha a parte do dano onde aplicar passos (Fósforo).
    dados.origin = arma.uuid;
    dados.transfer = false;

    // O efeito de uso puxa o modelo pelo nome; os dois ganham o sufixo.
    for (const c of mudancasDe(dados)) {
      if (c.key === "efeito" && nomes.has(c.value)) c.value = `${c.value}${sufixo}`;
    }

    // Na arma, a cópia é um efeito do próprio ataque.
    if (ehV14()) {
      if (dados.system?.onuse) {
        const tipos = new Set(dados.system.abilityUse?.types ?? []);
        tipos.add("self");
        dados.system.abilityUse = { ...(dados.system.abilityUse ?? {}), types: [...tipos] };
      }
    } else if (dados.flags?.tormenta20?.onuse) {
      dados.flags.tormenta20.self = true;
    }

    dados.flags ??= {};
    dados.flags[MODULO] = { ...(dados.flags[MODULO] ?? {}), daMunicao: municao.id };
    saida.push(dados);
  }
  return saida;
}

const temCopias = arma => arma.effects.some(e => e.flags?.[MODULO]?.daMunicao);

/**
 * Deixa os efeitos da munição na arma iguais aos da munição escolhida
 * agora. Não escreve nada se já estiverem (compara uma impressão dos
 * dados). Em fila por arma: dois pedidos seguidos não duplicam cópias.
 */
const filas = new Map();

export function sincronizarEfeitos(arma) {
  const chave = arma.uuid;
  const atual = (filas.get(chave) ?? Promise.resolve()).then(() => sincronizarAgora(arma));
  const fim = atual.catch(() => {});
  filas.set(chave, fim);
  fim.then(() => { if (filas.get(chave) === fim) filas.delete(chave); });
  return atual;
}

async function sincronizarAgora(arma) {
  if (arma?.type !== "arma" || !arma.actor || !arma.isOwner) return;
  // Munição esgotada não empresta efeitos: o disparo sai sem ela.
  const municao = usaMunicao(arma) ? municaoDaArma(arma) : null;
  const disponivel = municao && estoque(municao) >= porDisparo(arma);
  const desejados = disponivel ? copiasDosEfeitos(arma, municao) : [];
  const marca = desejados.length ? impressao(JSON.stringify(desejados)) : "";
  const atuais = arma.effects.filter(e => e.flags?.[MODULO]?.daMunicao);
  if (atuais.length === desejados.length && atuais.every(e => e.flags[MODULO].impressao === marca)) return;

  for (const d of desejados) d.flags[MODULO].impressao = marca;
  if (atuais.length) await arma.deleteEmbeddedDocuments("ActiveEffect", atuais.map(e => e.id), { render: false });
  if (desejados.length) await arma.createEmbeddedDocuments("ActiveEffect", desejados, { render: false });
}

/* Mudanças na munição chegam às armas que a usam um instante depois:
 * editar uma munição costuma disparar várias atualizações seguidas. */
const agendadas = new Map();

function agendar(arma) {
  clearTimeout(agendadas.get(arma.uuid));
  agendadas.set(arma.uuid, setTimeout(() => {
    agendadas.delete(arma.uuid);
    sincronizarEfeitos(arma).catch(err =>
      console.error(`${MODULO} | Falha ao copiar os efeitos da munição`, err));
  }, 80));
}

function armasQueUsam(municao) {
  return municao.actor?.items.filter(i => i.type === "arma" && i.system?.consume?.target === municao.id) ?? [];
}

/** Efeito criado, alterado ou apagado: se for de uma munição, as armas acompanham. */
export function aoMudarEfeito(efeito, userId) {
  if (game.user.id !== userId) return;
  const dono = efeito?.parent;
  if (dono?.documentName !== "Item" || !ehMunicao(dono)) return;
  for (const arma of armasQueUsam(dono)) agendar(arma);
}

/** Item alterado: arma (munição, melhorias) ou munição (nome, entradas). */
export function aoAtualizarItem(item, userId) {
  if (game.user.id !== userId || !item.actor) return;
  if (item.type === "arma" && (usaMunicao(item) || temCopias(item))) agendar(item);
  else if (ehMunicao(item)) for (const arma of armasQueUsam(item)) agendar(arma);
}

/** Munição saiu da ficha: as armas que a usavam perdem as cópias. */
export function aoApagarItem(item, userId) {
  if (game.user.id !== userId || !ehMunicao(item)) return;
  for (const arma of armasQueUsam(item)) agendar(arma);
}

/* ------------------------------------------------------------------ */
/* Recarregar / descarregar                                           */
/* ------------------------------------------------------------------ */

/**
 * Carrega a arma com a munição. Recarregar gasta ação, então, em combate,
 * o chat registra; fora dele, não. `antesDoAtaque` é a recarga automática
 * de quem atacou com a arma vazia.
 */
export async function recarregar(arma, municao, { antesDoAtaque = false } = {}) {
  const ator = arma.actor;
  if (!ator || !municao) return false;
  const cada = porDisparo(arma);
  const qtd = estoque(municao);
  if (qtd < cada) {
    ui.notifications.warn(`Não há ${municao.name} no inventário para recarregar.`);
    return false;
  }

  const precisa = precisaRecarregar(arma);
  const cap = capacidade(arma);
  const n = precisa ? disparosNaRecarga(cap, qtd, cada) : 0;
  const patch = {
    "system.consume.target": municao.id,
    [`flags.${MODULO}.municao.item`]: municao.id,
    [`flags.${MODULO}.municao.carregadas`]: n
  };
  // Sem quantidade por disparo, o sistema não desconta nada do estoque.
  if (!(Number(arma.system.consume.amount) >= 1)) patch["system.consume.amount"] = 1;
  await arma.update(patch);
  await sincronizarEfeitos(arma);

  if (precisa && emCombate(ator) && mensagensDeMunicao(ator)) {
    await postar(ator, cartaoHTML({
      icone: "fa-solid fa-rotate",
      titulo: `${esc(ator.name)} recarregou ${esc(arma.name)} com ${n}× ${esc(municao.name)}`,
      nota: antesDoAtaque ? "Recarregada antes do ataque: a arma estava vazia." : ""
    }));
  }
  return true;
}

export async function descarregar(arma) {
  await arma.update({ [`flags.${MODULO}.municao.carregadas`]: 0 });
}

/** Tira a munição da arma: nenhuma escolhida, nada carregado, sem os efeitos dela. */
export async function semMunicao(arma) {
  await arma.update({
    "system.consume.target": "",
    [`flags.${MODULO}.municao.item`]: null,
    [`flags.${MODULO}.municao.carregadas`]: 0
  });
  await sincronizarEfeitos(arma);
}

/** Disparos por recarga (aba da arma). Vazio volta ao padrão pelo nome. */
export async function definirCapacidade(arma, valor) {
  const texto = String(valor ?? "").trim();
  const n = Math.floor(Number(texto));
  const capacidadeNova = texto === "" || !Number.isFinite(n) ? null : Math.max(0, n);
  await arma.update({
    [`flags.${MODULO}.municao.capacidade`]: capacidadeNova,
    [`flags.${MODULO}.municao.carregadas`]: Math.min(carregadas(arma), capacidadeNova ?? capacidadePadrao(arma.name))
  });
}

/* ------------------------------------------------------------------ */
/* Disparo (envolve ItemT20.roll)                                     */
/* ------------------------------------------------------------------ */

/**
 * Antes do ataque: confere a munição e põe os efeitos dela na arma.
 * Depois: tira um disparo da carga. O que foi gasto (ou o aviso de disparo
 * sem munição) vai para as flags do cartão do ataque (preCreateChatMessage),
 * que o chat mostra. Sem munição o ataque sai mesmo assim: quem decide é a
 * mesa.
 */
export async function aoUsarItem(original, ...args) {
  if (this.type !== "arma" || !this.actor) return original(...args);
  if (!usaMunicao(this)) {
    // Automação desligada: a arma não leva mais os efeitos da munição.
    if (temCopias(this)) await sincronizarEfeitos(this).catch(() => {});
    return original(...args);
  }

  let s = situacao(this);
  // Arma vazia com munição no inventário: recarrega sozinha antes do ataque.
  if (s.falta === "descarregada") {
    await recarregar(this, s.municao, { antesDoAtaque: true });
    s = situacao(this);
  }
  const semMunicao = s.falta === "estoque" || s.falta === "escolher";
  if (!s.municao && !semMunicao) return original(...args);

  try {
    if (s.municao && !(Number(this.system.consume.amount) >= 1)) await this.update({ "system.consume.amount": 1 }, { render: false });
    await sincronizarEfeitos(this);
  } catch (err) {
    console.error(`${MODULO} | Falha ao preparar a munição`, err);
  }

  const arma = this;
  const nota = semMunicao ? { semMunicao: true } : {
    id: s.municao.id,
    nome: s.municao.name,
    img: s.municao.img,
    gasto: s.porDisparo,
    resta: s.estoque - s.porDisparo,
    carregadas: s.precisa ? s.carregadas - 1 : null,
    capacidade: s.capacidade
  };
  const gancho = Hooks.on("preCreateChatMessage", mensagem => {
    if (!String(mensagem.content ?? "").includes(`data-item-id="${arma.id}"`)) return;
    mensagem.updateSource({ [`flags.${MODULO}.municao`]: nota });
    Hooks.off("preCreateChatMessage", gancho);
  });

  /* Sem munição, o sistema barraria o uso ao descontar o estoque (e quebra
   * se a munição sumiu da ficha). Ele decide se consome lendo o tipo logo
   * no começo de roll(); o tipo some só na memória e volta em seguida. */
  const consumo = this.system.consume;
  if (semMunicao) consumo.type = "";
  let resultado;
  try { resultado = await original(...args); }
  finally {
    Hooks.off("preCreateChatMessage", gancho);
    if (semMunicao && consumo.type === "") consumo.type = "ammo";
  }

  if (resultado && s.precisa && !semMunicao) {
    await arma.update({ [`flags.${MODULO}.municao.carregadas`]: Math.max(0, s.carregadas - 1) });
  }
  return resultado;
}

/* ------------------------------------------------------------------ */
/* Linha da munição na ficha do personagem                            */
/* ------------------------------------------------------------------ */

/**
 * Injeta a linha de munição embaixo de cada arma que usa munição: na
 * seção Ataques da Ficha Hayd, nos ataques da Ficha Ameaça e nas listas de
 * armas das fichas do sistema (personagem e NPC).
 */
export function aoRenderizarFichaAtor(app, html) {
  const ator = app.actor;
  if (!ligada() || !ator) return;
  const bruto = app.element ?? html;
  const raiz = bruto instanceof HTMLElement ? bruto : bruto?.[0];
  if (!raiz?.querySelectorAll) return;

  const hayd = !!app.constructor?.FICHA_HAYD;
  // Na Ficha Ameaça o inventário também usa li.item: só as linhas de ataque.
  const ameaca = !!app.constructor?.FICHA_AMEACA;
  const linhas = raiz.querySelectorAll(hayd
    ? ".hf-secao-armas .hf-item[data-item-id]"
    : ameaca ? "li.ha-ataque[data-item-id]" : "li.item[data-item-id]");
  const editavel = app.isEditable ?? ator.isOwner;

  for (const li of linhas) {
    const arma = ator.items.get(li.dataset.itemId);
    if (!usaMunicao(arma)) continue;
    if (li.querySelector(".hayd-municao") || li.nextElementSibling?.classList.contains("hayd-municao-li")) continue;
    const linha = montarLinha(arma, editavel, hayd || ameaca);
    if (hayd) {
      const alvo = li.querySelector(".hf-item-linha");
      if (alvo) alvo.after(linha);
      else li.append(linha);
    } else {
      const envolta = document.createElement("li");
      envolta.className = "hayd-municao-li";
      envolta.append(linha);
      li.after(envolta);
    }
  }
}

function montarLinha(arma, editavel, escuro) {
  const s = situacao(arma);
  const div = document.createElement("div");
  div.className = "hayd-municao";

  if (!s.municao) {
    div.classList.add("hayd-municao-vazia");
    div.innerHTML = `
      ${editavel ? `<a class="hayd-municao-recarregar" data-acao="menu" role="button" tabindex="0"><i class="fa-solid fa-crosshairs"></i> Escolher munição</a>` : ""}
      <span class="hayd-municao-status">Sem munição</span>`;
  } else {
    // A munição equipada aparece sempre; o estado diz se a arma está carregada.
    const resumo = resumoDoItem(s.municao);
    const sem = s.falta === "estoque";
    const vazia = s.precisa && s.carregadas <= 0;
    div.classList.toggle("hayd-municao-sem", sem);
    div.classList.toggle("hayd-municao-vazia", vazia);
    let estado = "";
    if (s.precisa && !vazia) {
      estado = s.capacidade > 1
        ? `<span class="hayd-municao-carga" data-tooltip="Disparos carregados">${s.carregadas}/${s.capacidade}</span>`
        : `<span class="hayd-municao-carga" data-tooltip="Pronta para disparar"><i class="fa-solid fa-circle-check"></i> Carregada</span>`;
      if (editavel) estado += `<a class="hayd-municao-ejetar" data-acao="descarregar" role="button" tabindex="0" data-tooltip="Descarregar"><i class="fa-solid fa-eject"></i></a>`;
    } else if (vazia && !sem) {
      estado = editavel
        ? `<a class="hayd-municao-recarregar" data-acao="recarregar" role="button" tabindex="0" data-tooltip="Recarrega a arma"><i class="fa-solid fa-rotate"></i> Recarregar</a>`
        : `<span class="hayd-municao-status">Descarregada</span>`;
    }
    div.innerHTML = `
      <img class="hayd-municao-img" src="${esc(s.municao.img)}" alt="">
      <a class="hayd-municao-nome" data-acao="menu" role="button" tabindex="0" data-tooltip="${editavel ? "Trocar a munição" : ""}">
        <span>${esc(s.municao.name)}</span>${resumo ? `<small>${esc(resumo)}</small>` : ""}
      </a>
      <span class="hayd-municao-estoque" data-tooltip="${sem ? "Acabou a munição" : "No inventário"}"><i class="fa-solid fa-grip-lines-vertical"></i> ${s.estoque}</span>
      ${estado}`;
  }

  if (!editavel) return div;
  const agir = ev => {
    const alvo = ev.target.closest("[data-acao]");
    if (!alvo) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (alvo.dataset.acao === "menu") abrirMenu(arma, alvo, escuro);
    else if (alvo.dataset.acao === "recarregar") {
      recarregar(arma, municaoDaArma(arma)).catch(err => console.error(`${MODULO} | Falha ao recarregar`, err));
    }
    else if (alvo.dataset.acao === "descarregar") {
      descarregar(arma).catch(err => console.error(`${MODULO} | Falha ao descarregar`, err));
    }
  };
  div.addEventListener("click", agir);
  div.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") agir(ev); });
  return div;
}

/* ------------------------------------------------------------------ */
/* Menu de recarga                                                    */
/* ------------------------------------------------------------------ */

let menuAberto = null;

function fecharMenu() {
  if (!menuAberto) return;
  menuAberto.remove();
  menuAberto = null;
  document.removeEventListener("pointerdown", aoClicarFora, true);
  document.removeEventListener("keydown", aoTeclar, true);
}

function aoClicarFora(ev) {
  if (menuAberto && !menuAberto.contains(ev.target)) fecharMenu();
}

function aoTeclar(ev) {
  if (ev.key === "Escape") {
    ev.stopPropagation();
    fecharMenu();
  }
}

/** Menu ancorado no botão: as munições do inventário, a atual primeiro. */
function abrirMenu(arma, ancora, escuro) {
  fecharMenu();
  const s = situacao(arma);
  const atualId = s.municao?.id;
  const municoes = arma.actor.items.filter(i => ehMunicao(i))
    .sort((a, b) => (b.id === atualId) - (a.id === atualId) || a.name.localeCompare(b.name, "pt-BR"));

  const menu = document.createElement("div");
  menu.className = `hayd-ui hayd-municao-menu${escuro ? " hayd-ui-escuro" : ""}`;
  menu.setAttribute("role", "menu");
  const opcoes = municoes.map(m => {
    const qtd = estoque(m);
    const falta = qtd < s.porDisparo;
    const resumo = resumoDoItem(m);
    return `<li class="t20g-linha hayd-municao-opcao${m.id === atualId ? " atual" : ""}${falta ? " esgotada" : ""}"
        role="menuitem" tabindex="${falta ? -1 : 0}" aria-disabled="${falta}" data-id="${m.id}">
        <img class="t20g-miniatura" src="${esc(m.img)}" alt="">
        <span class="hayd-municao-opcao-texto">
          <span class="t20g-linha__nome">${esc(m.name)}</span>
          ${resumo ? `<span class="t20g-linha__apoio">${esc(resumo)}</span>` : ""}
        </span>
        <span class="hayd-municao-opcao-qtd">×${qtd}</span>
      </li>`;
  }).join("");
  // Com munição na arma, a última opção é tirá-la.
  const nenhuma = atualId
    ? `<li class="t20g-linha hayd-municao-opcao hayd-municao-nenhuma" role="menuitem" tabindex="0" data-id="">
        <i class="fa-solid fa-ban"></i>
        <span class="hayd-municao-opcao-texto"><span class="t20g-linha__nome">Nenhuma munição</span></span>
      </li>`
    : "";
  menu.innerHTML = `
    <header class="hayd-municao-menu-titulo">${esc(`Munição de ${arma.name}`)}</header>
    ${municoes.length
      ? `<ul class="t20g-lista">${opcoes}${nenhuma}</ul>`
      : `<p class="hayd-municao-menu-vazio">Nenhuma munição no inventário.</p>`}`;

  const escolher = el => {
    if (!el || el.classList.contains("esgotada")) return;
    fecharMenu();
    const id = el.dataset.id;
    const falha = err => console.error(`${MODULO} | Falha ao trocar a munição`, err);
    if (!id) return semMunicao(arma).catch(falha);
    // A mesma munição, já carregada: nada a fazer. Vazia, escolher é recarregar.
    if (id === atualId && (!s.precisa || s.carregadas > 0)) return;
    recarregar(arma, arma.actor.items.get(id)).catch(falha);
  };
  menu.addEventListener("click", ev => escolher(ev.target.closest(".hayd-municao-opcao")));
  menu.addEventListener("keydown", ev => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    ev.preventDefault();
    escolher(ev.target.closest(".hayd-municao-opcao"));
  });

  document.body.append(menu);
  const r = ancora.getBoundingClientRect();
  const alto = menu.offsetHeight;
  const largo = menu.offsetWidth;
  const embaixo = r.bottom + 4 + alto <= window.innerHeight;
  menu.style.top = `${Math.max(4, embaixo ? r.bottom + 4 : r.top - 4 - alto)}px`;
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - largo - 4))}px`;

  menuAberto = menu;
  document.addEventListener("pointerdown", aoClicarFora, true);
  document.addEventListener("keydown", aoTeclar, true);
  menu.querySelector('.hayd-municao-opcao[tabindex="0"]')?.focus();
}
