/**
 * t20-hayd-itens | veneno.mjs
 * Veneno aplicado na arma:
 *
 *  - clique direito na arma → "Aplicar veneno": escolhe um preparado
 *    alquímico do inventário e monta a CD (atributo, poderes e outros
 *    bônus). A dose sai do inventário, fica guardada na arma e o chat
 *    avisa que a arma está envenenada;
 *  - no cartão do ataque, "Veneno na arma" usa o veneno pelo fluxo normal
 *    do sistema (como a Injeção Alquímica), com a CD já calculada na
 *    resistência do item. Dura 1 ataque que acerte; com Veneno
 *    Persistente, 3.
 */

import { MODULO } from "./catalogo.mjs";
import { esc, cartaoHTML, postar } from "./mensagens.mjs";
import { ehV14, efeitoV14, opcoesDeRoll, itemDeMenu } from "./versao.mjs";

const { DialogV2 } = foundry.applications.api;

const ATRIBUTOS = { for: "FOR", des: "DES", con: "CON", int: "INT", sab: "SAB", car: "CAR" };

/**
 * Bônus de CD marcáveis no diálogo. Vêm marcados quando o nome da arma
 * (`arma`) ou um poder da ficha (`poder`, sem acento) bate. `porDado` soma
 * esse valor por dado nas rolagens de dano do veneno.
 */
const BONUS = [
  { id: "agulha", rotulo: "Agulha de Ahlen ou zarabatana", valor: 2, arma: /agulha de ahlen|zarabatana/ },
  { id: "veneficio", rotulo: "Venefício", valor: 2, poder: "veneficio" },
  { id: "potente", rotulo: "Veneno Potente", valor: 5, poder: "veneno potente" },
  { id: "invencao", rotulo: "Invenção Potente", valor: 2, poder: "invencao potente" },
  { id: "selva", rotulo: "Coração da Selva", valor: 2, porDado: 1, poder: "coracao da selva" }
];
const PERSISTENTE = "veneno persistente";
const USOS_PERSISTENTE = 3;

const normalizar = texto => String(texto ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function temPoder(ator, nome) {
  return ator.items.some(i => i.type === "poder" && normalizar(i.name).includes(nome));
}

function venenosDoInventario(ator) {
  return ator.items.filter(i => i.type === "consumivel" && i.system?.tipo === "alchemy");
}

/** Consumíveis que o diálogo oferece (munição não entra). */
function consumiveisDoInventario(ator) {
  return ator.items.filter(i => i.type === "consumivel" && i.system?.tipo !== "ammo");
}

/**
 * Tipo do veneno, lido da descrição ("Tipo: Contato.") — o padrão dos
 * venenos do sistema. Só os de contato vão na arma.
 */
function tipoDoVeneno(item) {
  const NOMES = { contato: "Contato", inalacao: "Inalação", ingestao: "Ingestão" };
  const texto = normalizar(item.system?.description?.value?.replace(/<[^>]+>/g, " "));
  const chave = texto.match(/tipo:\s*(contato|inalacao|ingestao)\b/)?.[1]
    ?? texto.match(/\b(contato|inalacao|ingestao)\b/)?.[1];
  return NOMES[chave] ?? "";
}

/** Veneno guardado na arma, ou null. */
export function venenoDaArma(item) {
  return item?.getFlag(MODULO, "veneno") ?? null;
}

/**
 * Parte da CD que vem da ficha: 10 + metade do nível + atributo, a mesma
 * conta que o sistema faz na resistência dos itens. NPC usa a CD da ficha.
 */
function cdBase(ator, atributo) {
  if (ator.type === "npc") return Number(ator.system.attributes?.cd) || 10;
  const nivel = Number(ator.system.attributes?.nivel?.value) || 0;
  const valor = Number(ator.system.atributos?.[atributo]?.value) || 0;
  return 10 + Math.floor(nivel / 2) + valor;
}

/* ------------------------------------------------------------------ */
/* Aplicar                                                            */
/* ------------------------------------------------------------------ */

function conteudoDoDialogo(item, ator) {
  const atual = venenoDaArma(item);
  const nomeArma = normalizar(item.name);
  const npc = ator.type === "npc";

  // Venenos de contato na lista principal; o resto dos consumíveis fica
  // numa lista recolhida, para quando a descrição não seguir o padrão.
  const consumiveis = consumiveisDoInventario(ator).map(v => ({ v, tipo: tipoDoVeneno(v) }));
  const contato = consumiveis.filter(c => c.tipo === "Contato");
  const outros = consumiveis.filter(c => c.tipo !== "Contato");
  const linha = ({ v, tipo }, marcado) => {
    const qtd = Number(v.system?.qtd ?? 1) || 1;
    return `<li><label class="hayd-carga-linha">
        <input type="radio" name="veneno" value="${v.id}" ${marcado ? "checked" : ""}>
        <img src="${esc(v.img)}" width="28" height="28" alt="">
        <span class="hayd-carga-nome">${esc(v.name)} <small>(${qtd}x)</small></span>
        ${tipo ? `<small class="hayd-veneno-tipo">${tipo}</small>` : ""}
      </label></li>`;
  };
  const listaContato = contato.length
    ? `<ul class="hayd-carga-lista">${contato.map((c, n) => linha(c, n === 0)).join("")}</ul>`
    : `<p class="hayd-aviso">Nenhum veneno de contato no inventário — escolha abaixo.</p>`;
  const listaOutros = outros.length
    ? `<details class="hayd-veneno-outros" ${contato.length ? "" : "open"}>
        <summary>Outros consumíveis (${outros.length})</summary>
        <ul class="hayd-carga-lista">${outros.map(c => linha(c, false)).join("")}</ul>
      </details>` : "";

  const opcoes = Object.entries(ATRIBUTOS).map(([chave, sigla]) =>
    `<option value="${chave}" ${chave === "int" ? "selected" : ""}>${sigla}</option>`).join("");

  const bonus = BONUS.map(b => {
    const marcado = b.arma ? b.arma.test(nomeArma) : temPoder(ator, b.poder);
    return `<label class="hayd-veneno-opcao">
        <input type="checkbox" name="b.${b.id}" data-bonus-cd="${b.valor}" data-por-dado="${b.porDado ?? 0}" ${marcado ? "checked" : ""}>
        <span>${esc(b.rotulo)}</span><small>+${b.valor} CD${b.porDado ? `, +${b.porDado} por dado` : ""}</small>
      </label>`;
  }).join("");

  return `<p>Qual veneno aplicar no(a) ${esc(item.name)}?${atual
    ? ` <span class="hayd-aviso">Substitui o ${esc(atual.dose?.name)} que já está na arma.</span>` : ""}</p>
    ${listaContato}
    ${listaOutros}
    <fieldset class="hayd-fieldset hayd-veneno-cd">
      <legend>Dificuldade</legend>
      <label class="hayd-veneno-atributo">Atributo
        <select name="atributo" ${npc ? "disabled" : ""}>${opcoes}</select>
      </label>
      ${bonus}
      <label class="hayd-veneno-opcao">
        <input type="checkbox" name="persistente" ${temPoder(ator, PERSISTENTE) ? "checked" : ""}>
        <span>Veneno Persistente</span><small>dura ${USOS_PERSISTENTE} ataques</small>
      </label>
      <div class="hayd-veneno-formula">
        CD <b data-cd-base></b> <small data-cd-atributo></small>
        + <b data-cd-bonus></b> <small>(bônus)</small>
        + <input type="number" name="outros" value="0" step="1" title="Outros bônus de CD"> <small>(outros)</small>
        = <b class="hayd-veneno-total" data-cd-total></b>
      </div>
    </fieldset>`;
}

function lerFormulario(form, ator) {
  const atributo = ATRIBUTOS[form.querySelector("[name=atributo]")?.value] ? form.querySelector("[name=atributo]").value : "int";
  const marcados = [...form.querySelectorAll("[data-bonus-cd]:checked")];
  const bonus = marcados.reduce((t, c) => t + Number(c.dataset.bonusCd), 0);
  const porDado = marcados.reduce((t, c) => t + (Number(c.dataset.porDado) || 0), 0);
  const outros = Math.trunc(Number(form.querySelector("[name=outros]")?.value) || 0);
  const base = cdBase(ator, atributo);
  return { atributo, base, bonus, porDado, outros, cd: base + bonus + outros };
}

/** A fórmula embaixo do diálogo acompanha cada mudança. */
function ligarFormula(alvo, ator) {
  const raiz = alvo instanceof HTMLElement ? alvo : alvo?.element;
  const form = raiz?.querySelector("form") ?? raiz;
  if (!form?.querySelector("[data-cd-total]")) return;
  const atualizar = () => {
    const f = lerFormulario(form, ator);
    form.querySelector("[data-cd-base]").textContent = f.base;
    form.querySelector("[data-cd-atributo]").textContent = ator.type === "npc" ? "(ficha)" : `(${ATRIBUTOS[f.atributo]})`;
    form.querySelector("[data-cd-bonus]").textContent = f.bonus;
    form.querySelector("[data-cd-total]").textContent = f.cd;
  };
  form.addEventListener("input", atualizar);
  form.addEventListener("change", atualizar);
  atualizar();
}

export async function aplicarVeneno(item) {
  const ator = item.actor;
  if (!ator) return;
  if (!venenosDoInventario(ator).length) return ui.notifications.warn("Nenhum preparado alquímico (consumível) encontrado no inventário.");

  const escolha = await DialogV2.prompt({
    window: { title: `Aplicar veneno — ${item.name}` },
    position: { width: 420 },
    content: conteudoDoDialogo(item, ator),
    render: (_ev, alvo) => ligarFormula(alvo, ator),
    ok: {
      label: "Aplicar",
      icon: "fa-solid fa-skull-crossbones",
      callback: (_ev, btn) => ({
        id: btn.form.querySelector("[name=veneno]:checked")?.value,
        persistente: btn.form.querySelector("[name=persistente]")?.checked,
        ...lerFormulario(btn.form, ator)
      })
    }
  }).catch(() => null);
  if (escolha && !escolha.id) return ui.notifications.warn("Escolha o veneno a aplicar.");
  const fonte = escolha?.id ? ator.items.get(escolha.id) : null;
  if (!fonte) return;

  // Uma dose sai do inventário e fica guardada na arma.
  const dose = fonte.toObject();
  dose.system.qtd = 1;
  delete dose._id;
  const qtd = Number(fonte.system?.qtd ?? 1) || 1;
  if (qtd > 1) await fonte.update({ "system.qtd": qtd - 1 });
  else await fonte.delete();

  const usos = escolha.persistente ? USOS_PERSISTENTE : 1;
  // setFlag mescla objetos: tira o veneno antigo antes, senão a dose nova
  // herdaria campos da anterior.
  if (venenoDaArma(item)) await item.unsetFlag(MODULO, "veneno");
  await item.setFlag(MODULO, "veneno", {
    dose,
    atributo: escolha.atributo,
    bonus: escolha.bonus + escolha.outros,
    cd: escolha.cd,
    porDado: escolha.porDado,
    usos,
    usosMax: usos
  });

  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-skull-crossbones",
    titulo: `${esc(item.name)} está envenenada com ${esc(dose.name)}`,
    texto: `<b>CD ${escolha.cd}</b>${escolha.porDado ? ` · +${escolha.porDado} por dado de dano` : ""}`,
    nota: usos > 1 ? `Veneno Persistente: dura ${usos} ataques que acertem.` : "Dura 1 ataque que acerte."
  }));
}

async function removerVeneno(item) {
  const veneno = venenoDaArma(item);
  if (!veneno) return;
  await item.unsetFlag(MODULO, "veneno");
  ui.notifications.info(`${veneno.dose?.name ?? "Veneno"} removido do(a) ${item.name}.`);
}

/* ------------------------------------------------------------------ */
/* Usar (botão do cartão do ataque)                                   */
/* ------------------------------------------------------------------ */

/** Rótulo do botão no cartão do ataque. */
export function rotuloDoVeneno(veneno) {
  const usos = veneno.usosMax > 1 ? ` — ${veneno.usos}/${veneno.usosMax}` : "";
  return `Veneno na arma: ${veneno.dose?.name ?? "veneno"} (CD ${veneno.cd})${usos}`;
}

/**
 * Coração da Selva: +N por dado em cada rolagem de dano do veneno — uma
 * parte a mais, do mesmo tipo, com o total (ex.: 2d12 de perda → +2).
 */
function somarPorDado(dados, valor) {
  for (const rolagem of dados.system?.rolls ?? []) {
    if (rolagem.type !== "dano" || !Array.isArray(rolagem.parts)) continue;
    const extras = [];
    for (const [formula, tipo] of rolagem.parts) {
      const dadosNaFormula = [...String(formula ?? "").matchAll(/(\d*)d\d+/gi)]
        .reduce((t, m) => t + (Number(m[1]) || 1), 0);
      if (dadosNaFormula) extras.push([String(dadosNaFormula * valor), tipo, ""]);
    }
    rolagem.parts.push(...extras);
  }
}

let _usando = false;

/** Usa o veneno da arma pelo fluxo normal do sistema. Devolve true se foi usado. */
export async function usarVeneno(item) {
  if (_usando) return false;
  const ator = item.actor;
  const veneno = venenoDaArma(item);
  if (!ator) return false;
  if (!veneno?.dose) {
    ui.notifications.warn(`${item.name} não está mais envenenada.`);
    return true;
  }

  _usando = true;
  let temp = null;
  let usado = false;
  let resta = veneno.usos;
  try {
    // Item temporário com a resistência preenchida: o sistema calcula
    // 10 + ½ nível + atributo + bônus e mostra a CD no cartão.
    const dados = foundry.utils.deepClone(veneno.dose);
    dados.name = `${veneno.dose.name} (veneno na arma)`;
    foundry.utils.setProperty(dados, `flags.${MODULO}.doseTemporaria`, true);
    const res = dados.system.resistencia ??= {};
    res.atributo = veneno.atributo;
    res.bonus = veneno.bonus;
    if (!res.txt) res.txt = "Fortitude";
    if (!res.pericia) res.pericia = "fort";
    if (veneno.porDado) somarPorDado(dados, veneno.porDado);
    // v14: doses guardadas no v13 trazem efeitos no formato antigo.
    if (ehV14() && Array.isArray(dados.effects)) dados.effects = dados.effects.map(efeitoV14);
    [temp] = await ator.createEmbeddedDocuments("Item", [dados]);

    // O cartão do sistema só mostra a resistência de magias e poderes:
    // marca a mensagem deste uso com a CD para notaDeCD() exibi-la.
    const idTemp = temp.id;
    const marcarMensagem = (mensagem) => {
      if (!mensagem.content?.includes(`data-item-id="${idTemp}"`)) return;
      mensagem.updateSource({ [`flags.${MODULO}.venenoCD`]: { cd: veneno.cd, resistencia: res.txt } });
    };
    const gancho = Hooks.on("preCreateChatMessage", marcarMensagem);

    let resultado;
    try { resultado = await temp.roll(opcoesDeRoll()); }
    finally { Hooks.off("preCreateChatMessage", gancho); }
    if (resultado !== undefined && resultado !== null) {
      usado = true;
      resta = veneno.usos - 1;
      if (resta > 0) await item.setFlag(MODULO, "veneno.usos", resta);
      else await item.unsetFlag(MODULO, "veneno");
    }
  } catch (err) {
    console.error(`${MODULO} | Falha ao usar o veneno da arma`, err);
  } finally {
    if (temp) {
      const aindaExiste = ator.items.get(temp.id);
      if (aindaExiste) await aindaExiste.delete();
    }
    _usando = false;
  }
  if (usado && resta <= 0 && veneno.usosMax > 1) {
    ui.notifications.info(`O ${veneno.dose.name} do(a) ${item.name} acabou.`);
  }
  return usado;
}

/** CD do veneno embaixo do título do cartão do uso (para todos). */
export function notaDeCD(mensagem, card) {
  const marca = mensagem.flags?.[MODULO]?.venenoCD;
  if (!marca || card.querySelector(".hayd-veneno-nota")) return;
  // v14: se o próprio sistema já mostra a CD, não repete.
  if (card.textContent.includes(`CD ${marca.cd}`)) return;
  const div = document.createElement("div");
  div.className = "hayd-veneno-nota";
  div.innerHTML = `<i class="fa-solid fa-skull-crossbones"></i> <span><b>Resistência:</b> ${esc(marca.resistencia || "Fortitude")} (CD ${Number(marca.cd) || 0})</span>`;
  const cabecalho = card.querySelector(".card-header");
  if (cabecalho) cabecalho.after(div);
  else card.prepend(div);
}

/* ------------------------------------------------------------------ */
/* Menu de contexto                                                   */
/* ------------------------------------------------------------------ */

export function opcoesMenuVeneno(item, menuItems) {
  if (!item.actor || item.type !== "arma") return;
  if (venenosDoInventario(item.actor).length) {
    menuItems.push(itemDeMenu({
      name: "Aplicar veneno",
      icon: '<i class="fa-solid fa-skull-crossbones"></i>',
      callback: () => aplicarVeneno(item)
    }));
  }
  const veneno = venenoDaArma(item);
  if (veneno) {
    menuItems.push(itemDeMenu({
      name: `Remover veneno (${veneno.dose?.name ?? "veneno"})`,
      icon: '<i class="fa-solid fa-droplet-slash"></i>',
      callback: () => removerVeneno(item)
    }));
  }
}
