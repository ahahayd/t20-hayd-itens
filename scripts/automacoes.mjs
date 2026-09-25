/**
 * t20-hayd-itens | automacoes.mjs
 * Automações com estado ou interação própria:
 *  - Conjuradora: guarda uma magia já configurada na arma e a dispara depois;
 *  - Dançarina: ativa e pergunta, a cada turno, se continua sustentada;
 *  - Frenética: bônus acumulado controlado pela aba;
 *  - Piedosa: liga/desliga pagando 1 PM;
 *  - Sanguinária: aplica ou agrava o sangramento pelo cartão do ataque;
 *  - Ressonante: onda de choque (metade do dano, psíquico) pelo cartão;
 *  - Drenante: receber os PV temporários rolados no cartão;
 *  - Cuidadora: a RD 10 some quando o usuário sofre o próximo dano.
 */

import { MODULO, obterEntrada } from "./catalogo.mjs";
import {
  dadosDoItem, definirEstado, apagarCampoDeEstado, registroAtivo, MAX_FRENETICA
} from "./efeitos.mjs";
import { esc, cartaoHTML, listaHTML, postar } from "./mensagens.mjs";
import { custoDeConjuracao, agravarSangramento, limitar, houveDano } from "./regras.mjs";

const { DialogV2 } = foundry.applications.api;

/** A automação exclusiva desta entrada não foi desligada pelo Mestre? */
export function especialLigado(key, valor = key) {
  return obterEntrada(key)?.especial === valor;
}

function estadoDe(item, entradaId) {
  return dadosDoItem(item).estado[entradaId] ?? {};
}

/**
 * Desconta PM do ator (primeiro os temporários, pelo método do sistema).
 * Sem PM suficiente, avisa e não desconta.
 */
export async function gastarPM(ator, custo) {
  if (!(custo > 0)) return true;
  const pm = ator?.system?.attributes?.pm;
  if (!pm) return true;
  const disponivel = (Number(pm.value) || 0) + (Number(pm.temp) || 0);
  if (disponivel < custo) {
    ui.notifications.warn(`${ator.name} não tem PM suficientes (${disponivel}/${custo}).`);
    return false;
  }
  if (typeof ator.spendMana === "function") await ator.spendMana(custo, 0, false);
  else await ator.update({ "system.attributes.pm.value": Math.max(0, (Number(pm.value) || 0) - custo) });
  return true;
}

function gastoAutomatico() {
  try { return game.settings.get("tormenta20", "automaticManaSpend") !== false; }
  catch { return true; }
}

/* ------------------------------------------------------------------ */
/* Conjuradora                                                        */
/* ------------------------------------------------------------------ */

/**
 * Preenchimento pendente do diálogo de uso do sistema: ao disparar a
 * magia guardada, a janela abre já com os aprimoramentos escolhidos na
 * hora de guardar e confirma sozinha.
 */
let _preenchimento = null;

/** Todos os aprimoramentos listados no formulário do diálogo: id → qtd. */
function selecaoDoFormulario(config) {
  const todas = new Map();
  for (const [id, v] of Object.entries(config?.aprs ?? {})) todas.set(id, Number(v?.aplica) || 0);
  for (const [chave, v] of Object.entries(config ?? {})) {
    const m = chave.match(/^aprs\.([^.]+)\.aplica$/);
    if (m) todas.set(m[1], Number(v) || 0);
  }
  return todas;
}

/**
 * Guarda uma magia do ator na arma. A janela de uso do sistema abre para
 * escolher aprimoramentos e bônus; o custo é pago agora (como lançar a
 * magia na arma) e a configuração fica salva para o disparo.
 */
export async function carregarConjuradora(item, entradaId) {
  const ator = item.actor;
  if (!ator) return ui.notifications.warn("Coloque a arma na ficha de um personagem para guardar uma magia.");
  const AbilityUseDialog = game.tormenta20?.applications?.AbilityUseDialog;
  if (!AbilityUseDialog) return ui.notifications.error("Conjuradora: a janela de uso do sistema não foi encontrada.");

  const magias = ator.items.filter(i => i.type === "magia")
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (!magias.length) return ui.notifications.warn(`${ator.name} não tem magias na ficha.`);

  const atual = estadoDe(item, entradaId).magia;
  const opcoes = magias.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
  const aviso = atual
    ? `<p class="notes">A magia guardada (${esc(atual.dados?.name)}) será substituída — o PM gasto nela não volta.</p>`
    : "";
  const escolha = await DialogV2.prompt({
    window: { title: `Conjuradora — ${item.name}` },
    content: `<p>Escolha a magia e configure-a como se fosse lançá-la. O PM é pago agora.</p>${aviso}
      <div class="form-group"><label>Magia</label><select name="magiaId">${opcoes}</select></div>`,
    ok: { label: "Configurar", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object }
  }).catch(() => null);
  const magia = escolha?.magiaId ? ator.items.get(escolha.magiaId) : null;
  if (!magia) return;

  // A janela de uso do sistema, aplicada numa cópia: mostra os
  // aprimoramentos e calcula o custo sem rolar nem gastar nada.
  const copia = magia.clone({}, { keepId: true });
  const config = await AbilityUseDialog.create(copia);
  if (!config) return;

  const selecao = [];
  const resumo = [];
  for (const [efId, qtd] of selecaoDoFormulario(config)) {
    const ef = copia.effects.get(efId) ?? ator.effects.get(efId);
    if (!ef) continue;
    selecao.push({ nome: ef.name, aplica: qtd });
    if (qtd) resumo.push(qtd > 1 ? `${ef.name} (${qtd}x)` : ef.name);
  }

  const custo = custoDeConjuracao({
    custoTotal: copia.system.ativacao?.custo,
    custoBase: magia.system.ativacao?.custo,
    truque: config.truque,
    metade: config.halfCost,
    extra: ator.system.modificadores?.custoPM,
    ajuste: config.ajustecusto
  });
  const automatico = gastoAutomatico();
  if (automatico && !(await gastarPM(ator, custo))) return;

  const campos = {
    bonus: config.bonus ?? "",
    bonusdano: config.bonusdano ?? "",
    rollKeep: config.rollKeep ?? "",
    rollMode: config.rollMode ?? ""
  };
  if (atual) await apagarCampoDeEstado(item, entradaId, "magia");
  await definirEstado(item, entradaId, {
    magia: { dados: magia.toObject(), selecao, campos, resumo, custo }
  }, { reconstruir: false });

  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-wand-sparkles",
    titulo: `${esc(ator.name)} carregou a Conjuradora do(a) ${esc(item.name)} com:`,
    corpo: listaHTML([{ img: magia.img, nome: magia.name, extra: resumo.join(", ") }]),
    nota: `Custo: ${custo} PM${custo && !automatico ? " (desconte manualmente)" : ""}. Ao acertar, dispare a magia pelo cartão do ataque.`
  }));
}

/** Descarta a magia guardada (o PM gasto não volta). */
export async function descartarConjuradora(item, entradaId) {
  const magia = estadoDe(item, entradaId).magia;
  if (!magia) return;
  const ok = await DialogV2.confirm({
    window: { title: "Conjuradora" },
    content: `<p>Descartar <strong>${esc(magia.dados?.name)}</strong> guardada em ${esc(item.name)}? O PM gasto não volta.</p>`
  });
  if (!ok) return;
  await apagarCampoDeEstado(item, entradaId, "magia");
}

/**
 * Dispara a magia guardada: rola normalmente, com a configuração salva,
 * sem custo (já foi pago ao guardar). Devolve true se a magia saiu.
 */
export async function dispararConjuradora(item, entradaId) {
  const ator = item.actor;
  if (!ator) return false;
  const salvo = estadoDe(item, entradaId).magia;
  if (!salvo?.dados) {
    ui.notifications.warn("Nenhuma magia guardada na Conjuradora.");
    return false;
  }
  if (_preenchimento) return false;

  // Cópia temporária sem custo: o sistema só desconta PM se o custo base
  // for maior que zero, e os aprimoramentos entram com custo zerado.
  // A janela do sistema recebe uma cópia sem id do item rolado: ela é
  // reconhecida por esta marca, que viaja nas flags.
  const marca = foundry.utils.randomID(12);
  const dados = foundry.utils.deepClone(salvo.dados);
  delete dados._id;
  foundry.utils.setProperty(dados, "system.ativacao.custo", 0);
  foundry.utils.setProperty(dados, `flags.${MODULO}.doseTemporaria`, true);
  foundry.utils.setProperty(dados, `flags.${MODULO}.disparo`, marca);

  let temp = null;
  let saiu = false;
  try {
    [temp] = await ator.createEmbeddedDocuments("Item", [dados]);
    _preenchimento = { marca, selecao: salvo.selecao ?? [], campos: salvo.campos ?? {} };
    const mensagem = await temp.roll();
    saiu = !!mensagem;
    if (saiu) await apagarCampoDeEstado(item, entradaId, "magia");
  } catch (err) {
    console.error(`${MODULO} | Falha ao disparar a Conjuradora`, err);
  } finally {
    _preenchimento = null;
    if (temp && ator.items.get(temp.id)) await temp.delete();
  }
  return saiu;
}

/**
 * renderAbilityUseDialog: se for o disparo da Conjuradora, marca os
 * aprimoramentos salvos, zera os custos e confirma a janela sozinha.
 */
export function aoRenderizarDialogoUso(app, html) {
  const p = _preenchimento;
  if (!p || app?.item?.flags?.[MODULO]?.disparo !== p.marca || app._haydPreenchido) return;
  app._haydPreenchido = true;

  const raiz = html?.[0] ?? html;
  const form = raiz?.querySelector?.("form");
  if (!form) return;

  for (const li of form.querySelectorAll(".aprimoramentos-list li.item")) {
    if (li.classList.contains("items-header")) continue;
    const nome = li.querySelector(".item-name")?.textContent?.trim();
    const qtd = Number(p.selecao.find(s => s.nome === nome)?.aplica) || 0;
    const aplica = li.querySelector('input[name$=".aplica"]');
    if (aplica?.type === "checkbox") aplica.checked = qtd > 0;
    else if (aplica) aplica.value = String(qtd);
    const custo = li.querySelector('input[type="hidden"][name$=".custo"]');
    if (custo && custo.value !== "Truque") custo.value = "0";
  }
  for (const [nome, valor] of Object.entries(p.campos ?? {})) {
    const campo = form.querySelector(`[name="${nome}"]`);
    if (campo && valor !== undefined && valor !== null && valor !== "") campo.value = valor;
  }
  const ajuste = form.querySelector('[name="ajustecusto"]');
  if (ajuste) ajuste.value = "";

  // Já configurada ao guardar: não precisa aparecer.
  app.element?.hide?.();
  const botao = app.data?.buttons?.use;
  if (botao) setTimeout(() => app.submit(botao), 0);
}

/* ------------------------------------------------------------------ */
/* Dançarina                                                          */
/* ------------------------------------------------------------------ */

/** Ativa a Dançarina (pela aba, pagando 1 PM, ou pelo efeito de uso já pago). */
export async function ativarDancarina(item, entradaId, { pagar = true } = {}) {
  const ator = item.actor;
  if (!ator) return ui.notifications.warn("Coloque a arma na ficha de um personagem para ativar a Dançarina.");
  if (estadoDe(item, entradaId).ativa) return ui.notifications.info(`A Dançarina de ${item.name} já está ativa.`);
  if (pagar && !(await gastarPM(ator, 1))) return;

  await definirEstado(item, entradaId, { ativa: true, sustentada: null }, { reconstruir: false });
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-feather-pointed",
    titulo: `Dançarina ativada — ${esc(item.name)}`,
    texto: `${esc(ator.name)} solta a arma${pagar ? " (1 PM)" : ""}: ela flutua e ataca sozinha em alcance curto.`,
    nota: "No início de cada turno, o chat pergunta se a Dançarina continua sustentada."
  }));
}

export async function desativarDancarina(item, entradaId) {
  const ator = item.actor;
  if (!estadoDe(item, entradaId).ativa) return;
  await definirEstado(item, entradaId, { ativa: false, sustentada: null }, { reconstruir: false });
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-ban",
    titulo: `Dançarina encerrada — ${esc(item.name)}`,
    texto: `A arma de ${esc(ator?.name)} para de dançar e cai no chão.`
  }));
}

/** Lembrete do início do turno, no modelo do lembrete de aura do gmtools. */
async function pedirSustentacao(ator, item, entradaId) {
  const dados = `data-ator="${esc(ator.uuid)}" data-item="${item.id}" data-entrada="${entradaId}"`;
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-hourglass-half",
    titulo: `Sustentar a Dançarina — ${esc(item.name)}?`,
    texto: `Início do turno de ${esc(ator.name)}: manter a arma dançando custa 1 PM. Confirmar já desconta o PM.`,
    corpo: `<div class="hayd-itens-acoes">
        <button type="button" data-hayd-acao="dancarina-sustentar" ${dados}>
          <i class="fa-solid fa-check"></i> Sustentar (1 PM)
        </button>
        <button type="button" data-hayd-acao="dancarina-cancelar" ${dados}>
          <i class="fa-solid fa-ban"></i> Cancelar
        </button>
      </div>`,
    nota: "Se ninguém clicar, a arma continua dançando."
  }));
}

async function sustentarDancarina(ator, item, entradaId) {
  const estado = estadoDe(item, entradaId);
  if (!estado.ativa) {
    ui.notifications.info("A Dançarina já foi encerrada.");
    return true;
  }
  const rodada = game.combat ? `${game.combat.id}:${game.combat.round}` : null;
  if (rodada && estado.sustentada === rodada) {
    ui.notifications.info("A Dançarina já foi sustentada nesta rodada.");
    return true;
  }
  if (!(await gastarPM(ator, 1))) return false;
  await definirEstado(item, entradaId, { sustentada: rodada }, { reconstruir: false });
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-feather-pointed",
    titulo: `${esc(ator.name)} sustentou a Dançarina — ${esc(item.name)}`,
    nota: "1 PM descontado."
  }));
  return true;
}

/** updateCombat: no início do turno do dono, pergunta se sustenta. */
export async function aoAvancarTurno(combate, mudou) {
  if (!("turn" in mudou || "round" in mudou)) return;
  if (game.user !== game.users.activeGM) return;
  if (!(combate.round > 0) || !especialLigado("dancarina")) return;

  const ator = combate.combatant?.actor;
  if (!ator) return;
  for (const item of ator.items) {
    if (!item.flags?.[MODULO]) continue;
    const achado = registroAtivo(item, "dancarina");
    if (!achado || !estadoDe(item, achado.reg.id).ativa) continue;
    await pedirSustentacao(ator, item, achado.reg.id);
  }
}

/** Botões das mensagens do módulo ([data-hayd-acao]). */
export async function acaoDeMensagem(acao, ator, itemId, entradaId) {
  const item = ator.items.get(itemId);
  if (!item) {
    ui.notifications.warn("A arma não está mais na ficha.");
    return true;
  }
  if (acao === "dancarina-sustentar") return sustentarDancarina(ator, item, entradaId);
  if (acao === "dancarina-cancelar") {
    await desativarDancarina(item, entradaId);
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Frenética e Piedosa                                                */
/* ------------------------------------------------------------------ */

/** Gasta 1 PM para +1 no bônus da Frenética (até +5) e registra no chat. */
export async function gastarFrenetica(item, entradaId) {
  const ator = item.actor;
  if (!ator) return ui.notifications.warn("Coloque a arma na ficha de um personagem para usar a Frenética.");
  const bonus = Number(estadoDe(item, entradaId).bonus) || 0;
  if (bonus >= MAX_FRENETICA) return ui.notifications.warn(`A Frenética já está no máximo (+${MAX_FRENETICA}).`);
  if (!(await gastarPM(ator, 1))) return;

  const total = bonus + 1;
  await definirEstado(item, entradaId, { bonus: total });
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-fire-flame-curved",
    titulo: `Frenética — ${esc(item.name)}`,
    texto: `Frenética se alimenta do seu espírito de luta aumentando em +1 o bônus de ataque da arma. Total: +${total}`
  }));
}

/** Ajuste manual do bônus da Frenética (sem custo). */
export async function ajustarFrenetica(item, entradaId, delta) {
  const bonus = Number(estadoDe(item, entradaId).bonus) || 0;
  const total = limitar(bonus + delta, 0, MAX_FRENETICA);
  if (total !== bonus) await definirEstado(item, entradaId, { bonus: total });
}

/** Liga/desliga a Piedosa (1 PM). Desligada, o +1d8 sai da arma. */
export async function alternarPiedosa(item, entradaId) {
  const ator = item.actor;
  if (!ator) return ui.notifications.warn("Coloque a arma na ficha de um personagem para alternar a Piedosa.");
  const ativa = !estadoDe(item, entradaId).inativa;
  if (!(await gastarPM(ator, 1))) return;

  await definirEstado(item, entradaId, { inativa: ativa });
  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-dove",
    titulo: `Piedosa ${ativa ? "desativada" : "ativada"} — ${esc(item.name)}`,
    texto: ativa
      ? `${esc(ator.name)} desativou a Piedosa (1 PM): a arma volta a causar dano letal, sem o +1d8.`
      : `${esc(ator.name)} ativou a Piedosa (1 PM): +1d8 de dano e todo o dano da arma é não letal.`
  }));
}

/* ------------------------------------------------------------------ */
/* Botões do cartão do ataque                                         */
/* ------------------------------------------------------------------ */

/** Arte da condição Sangrando, do próprio sistema. */
const ICONE_SANGRANDO = "systems/tormenta20/icons/conditions/sangrando.svg";

/** Condição Sangrando do sistema (dano custom 1d6[perda] no início do turno). */
async function dadosDeSangramento() {
  let dados = null;
  try {
    dados = (await ActiveEffect.implementation.fromStatusEffect("sangrando"))?.toObject() ?? null;
  } catch (_e) { /* status não registrado */ }
  if (!dados) {
    const base = foundry.utils.deepClone(game.tormenta20?.conditions?.sangrando ?? {});
    dados = { name: base.name ?? "Sangrando", img: base.icon, statuses: ["sangrando"], flags: base.flags, changes: base.changes, duration: base.duration };
  }
  dados.changes ??= [];
  if (!dados.changes.some(c => c.key === "dano")) dados.changes.push({ key: "dano", mode: 0, value: "1d6[perda]" });
  // O catálogo de condições ainda usa `icon`, campo que o v13 renomeou para
  // `img`; conforme o caminho que montou o efeito, ele chegava aqui sem arte
  // nenhuma e o token ficava com o sangramento invisível.
  dados.img ||= game.tormenta20?.conditions?.sangrando?.icon || ICONE_SANGRANDO;
  return dados;
}

/**
 * Sanguinária: aplica Sangrando nos tokens selecionados; quem já sangra
 * tem o dano do sangramento aumentado em 1d6.
 */
export async function aplicarSangramento(arma) {
  const tokens = canvas?.tokens?.controlled ?? [];
  if (!tokens.length) {
    ui.notifications.warn("Selecione o token (ou tokens) de quem foi atingido para aplicar o sangramento.");
    return false;
  }

  const linhas = [];
  for (const token of tokens) {
    const ator = token.actor;
    if (!ator) continue;
    if (!ator.isOwner) {
      ui.notifications.warn(`Sem permissão para alterar ${ator.name}.`);
      continue;
    }
    const atual = ator.effects.find(e => e.statuses?.has?.("sangrando"));
    if (atual) {
      const changes = foundry.utils.deepClone(atual.changes ?? []);
      let i = changes.findIndex(c => c.key === "dano");
      if (i >= 0) changes[i].value = agravarSangramento(changes[i].value);
      else i = changes.push({ key: "dano", mode: 0, value: "2d6[perda]" }) - 1;
      // Sangramento aplicado antes desta correção pode estar sem arte; a
      // troca só acontece quando não há nenhuma, para não apagar um ícone
      // que o Mestre tenha escolhido.
      await atual.update({ changes, ...(atual.img ? {} : { img: ICONE_SANGRANDO }) });
      linhas.push({ img: token.document?.texture?.src, nome: ator.name, extra: `sangramento agravado: ${String(changes[i].value).replace(/\[perda\]/, "")} de perda por turno` });
    } else {
      await ator.createEmbeddedDocuments("ActiveEffect", [await dadosDeSangramento()]);
      linhas.push({ img: token.document?.texture?.src, nome: ator.name, extra: "começou a sangrar: 1d6 de perda por turno" });
    }
  }
  if (linhas.length) {
    await postar(arma.actor, cartaoHTML({
      icone: "fa-solid fa-droplet",
      titulo: `Sanguinária — ${esc(arma.name)}`,
      corpo: listaHTML(linhas)
    }));
  }
  return true;
}

/**
 * Ressonante: 2 PM para uma onda de choque psíquica igual à metade do dano
 * do ataque, rolada em uma mensagem própria (para aplicar em outro alvo).
 */
export async function ondaDeChoque(mensagem, arma) {
  const ator = arma.actor;
  if (!ator) return false;
  const dano = (mensagem.rolls ?? []).find(r => r.options?.type === "damage" && !r.options?.haydExtra);
  if (!dano) {
    ui.notifications.warn("Este ataque não tem rolagem de dano.");
    return false;
  }
  const metade = Math.floor((Number(dano.total) || 0) / 2);
  if (!(await gastarPM(ator, 2))) return false;

  const roll = await new Roll(`${metade}[psiquico]`, {}, { type: "damage", title: "Onda de choque (Ressonante)" }).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor: ator }),
    flavor: `Ressonante — ${arma.name}: onda de choque psíquica (metade de ${dano.total}). Compare o ataque com a Defesa de outra criatura em alcance curto.`
  });
  return true;
}

/** Drenante: o dono do ataque recebe os PV temporários rolados no cartão. */
export async function receberRolagem(mensagem, titulo, ator) {
  const roll = (mensagem.rolls ?? []).find(r => r.options?.title === titulo);
  if (!roll || typeof ator?.applyDamageV2 !== "function") return false;
  await ator.applyDamageV2(roll, -1);
  return true;
}

/* ------------------------------------------------------------------ */
/* Cuidadora: RD que some ao sofrer dano                              */
/* ------------------------------------------------------------------ */

/** preUpdateActor: marca a atualização que tira PV de quem tem a RD. */
export function aoPreAtualizarAtor(ator, mudou, opcoes) {
  const pv = ator.system?.attributes?.pv;
  if (!pv || !ator.effects.some(e => e.flags?.[MODULO]?.expiraAoSofrerDano)) return;
  const valor = foundry.utils.getProperty(mudou, "system.attributes.pv.value");
  const temp = foundry.utils.getProperty(mudou, "system.attributes.pv.temp");
  const sofreu = (valor !== undefined && Number(valor) < Number(pv.value))
    || (temp !== undefined && Number(temp) < Number(pv.temp));
  if (sofreu) opcoes.haydSofreuDano = true;
}

/** updateActor: quem aplicou o dano remove a RD de uso único. */
export async function aoAtualizarAtor(ator, _mudou, opcoes, userId) {
  if (!opcoes?.haydSofreuDano || userId !== game.user.id) return;
  await expirarRDdeUsoUnico(ator);
}

/** Tira do ator as RDs que valem contra um dano só (Cuidadora). */
export async function expirarRDdeUsoUnico(ator) {
  const efeitos = ator?.effects?.filter(e => e.flags?.[MODULO]?.expiraAoSofrerDano) ?? [];
  if (!efeitos.length) return false;
  // Outra volta pode ter apagado no meio do caminho (o preUpdateActor e o
  // cartão de dano chegam quase juntos quando os PV chegam a cair).
  const ids = efeitos.map(e => e.id).filter(id => ator.effects.get(id));
  if (!ids.length) return false;
  await ator.deleteEmbeddedDocuments("ActiveEffect", ids);
  ui.notifications.info(`${efeitos.map(e => e.name).join(", ")}: usada contra o dano sofrido por ${ator.name}.`);
  return true;
}


/**
 * A RD de uso único também precisa sair quando ela absorve o golpe inteiro.
 *
 * O `preUpdateActor` só enxerga dano pela queda de PV — e é justamente o que
 * não acontece quando a RD 10 come um dano de 8. `displayDamageCard` é
 * chamado a cada dano aplicado e recebe as parcelas antes da redução, então é
 * daqui que dá para ver o golpe que não tirou nenhum PV.
 */
export function registrarEnvoltoriosDeAtor() {
  const classe = CONFIG.Actor?.documentClass;
  if (typeof classe?.prototype?.displayDamageCard !== "function") {
    console.warn(`${MODULO} | ActorT20.displayDamageCard não encontrado — a RD da Cuidadora só sai quando os PV caem.`);
    return;
  }
  if (classe.prototype._haydRDdeUsoUnico) return;

  const original = classe.prototype.displayDamageCard;
  classe.prototype.displayDamageCard = function (partes, final, multiplicador = 1, ...resto) {
    // O dano já foi aplicado (com a RD valendo) antes de o cartão ser montado.
    if (houveDano(partes, multiplicador)) {
      expirarRDdeUsoUnico(this).catch(err =>
        console.error(`${MODULO} | Falha ao remover a RD da Cuidadora`, err));
    }
    return original.call(this, partes, final, multiplicador, ...resto);
  };
  classe.prototype._haydRDdeUsoUnico = true;
}
