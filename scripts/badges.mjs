/**
 * t20-hayd-itens | badges.mjs
 * Resumo visual dos aprimoramentos de um item (material, melhorias e
 * encantos) para as listas e cartões: o cálculo mora aqui, e as fichas
 * (inclusive a Ficha Hayd, do t20-hayd-ui) só desenham o que ele devolve.
 *
 * Os badges não supõem fundo: o texto mistura o tom da família com a cor
 * do texto herdada (ver styles/badges.css), então servem a qualquer tema.
 */

import { MODULO, obterEntrada, beneficioDaVariante, varianteInicial, VARIANTES } from "./catalogo.mjs";
import { dadosDoItem, calcularPreco, ehMagico } from "./efeitos.mjs";
import { esc } from "./mensagens.mjs";

/**
 * Tom (matiz e croma, em oklch) de cada material do catálogo. O material só
 * aparece como ícone de diamante; o tom pinta o ícone e o aro. Material fora
 * da tabela (homebrew) usa o tom neutro.
 */
const VISUAL_MATERIAL = {
  "aco-rubi":         { h: 22,  c: .17 },
  "adamante":         { h: 265, c: .04 },
  "gelo-eterno":      { h: 238, c: .13 },
  "madeira-tollon":   { h: 148, c: .13 },
  "materia-vermelha": { h: 5,   c: .19 },
  "mitral":           { h: 200, c: .13 },
  "casco-de-monstro": { h: 70,  c: .06 },
  "lanajuste":        { h: 110, c: .10 },
  "prata":            { h: 250, c: .02 },
  "couraca-de-kaiju": { h: 175, c: .12 },
  "couro-de-bulette": { h: 40,  c: .09 },
  "cristal-de-sol":   { h: 55,  c: .18 },
  "pena-de-kraken":   { h: 275, c: .10 },
  "quitina-razza":    { h: 125, c: .10 }
};
const TOM_NEUTRO = { h: 250, c: .03 };

/** Quantidade de losangos desenhados na coluna da Ficha Hayd; o resto vira "+N". */
export const PIPS_VISIVEIS = 4;

/* ------------------------------------------------------------------ */
/* Resumo                                                             */
/* ------------------------------------------------------------------ */

function entradaResumo(reg, def, supressor) {
  return {
    id: reg.id,
    key: reg.key,
    nome: def?.nome ?? reg.key,
    beneficio: def?.beneficio ?? "",
    desativada: !!reg.desativada,
    suprimida: !!reg.suprimidaPor,
    suprimidaPor: supressor ? (obterEntrada(supressor.key)?.nome ?? supressor.key) : "",
    ativa: !reg.desativada && !reg.suprimidaPor
  };
}

function materialResumo(reg, item) {
  const def = obterEntrada(reg.key) ?? {};
  const visual = VISUAL_MATERIAL[reg.key] ?? {};
  const variante = reg.variante ?? varianteInicial(def, item);
  return {
    ...entradaResumo(reg, def, null),
    nome: def.nome ?? reg.key,
    h: visual.h ?? TOM_NEUTRO.h,
    c: visual.c ?? TOM_NEUTRO.c,
    variante,
    varianteNome: VARIANTES[variante] ?? "",
    beneficio: beneficioDaVariante(def, variante)
  };
}

/**
 * Resumo dos aprimoramentos do item, ou null se ele não tem nenhum.
 * Entrada desativada ou substituída continua contando nos totais, como no
 * preço (efeitos.calcularPrecoDados): Cruel + Atroz são duas melhorias, mesmo
 * que Atroz substitua o bônus de Cruel. Na lista ela aparece riscada.
 */
export function resumoDoItem(item) {
  const d = dadosDoItem(item);
  const magico = ehMagico(item);
  if (!d.melhorias.length && !d.encantos.length && !d.materiais.length && !magico) return null;

  const todas = [...d.melhorias, ...d.encantos];
  const porId = new Map(todas.map(r => [r.id, r]));
  const lista = regs => regs.map(r => entradaResumo(r, obterEntrada(r.key), r.suprimidaPor ? porId.get(r.suprimidaPor) : null));

  const materiais = d.materiais.map(r => materialResumo(r, item));
  const melhorias = lista(d.melhorias);
  const encantos = lista(d.encantos);

  const gerenciado = d.precoBase !== null && d.precoBase !== undefined;
  return {
    // O primeiro material valendo é o que dá nome ao item na lista
    material: materiais.find(m => m.ativa) ?? materiais[0] ?? null,
    materiais,
    melhorias,
    encantos,
    nMelhorias: melhorias.length,
    nEncantos: encantos.length,
    nMateriais: materiais.length,
    magico,
    preco: gerenciado ? calcularPreco(item).total : null
  };
}

/**
 * O que a coluna de aprimoramentos da Ficha Hayd precisa, já medido.
 * O material especial conta como aprimoramento (como no preço): entra entre
 * as marcas das melhorias, de preferência como a primeira. Com 3 marcas elas
 * formam um triângulo invertido e o material vira a ponta de baixo. Passando
 * de 4 marcas, o resto vira +N.
 */
export function resumoParaColuna(resumo) {
  if (!resumo) return null;
  const materiais = (resumo.materiais ?? []).map(m => ({ material: true, estilo: estiloDoMaterial(m), nome: m.nome }));
  const melhorias = Array.from({ length: resumo.nMelhorias }, () => ({ material: false }));
  const total = materiais.length + melhorias.length;
  const ordem = total === 3 ? [...melhorias, ...materiais] : [...materiais, ...melhorias];
  const estrelas = n => Array.from({ length: Math.min(n, PIPS_VISIVEIS) }, (_, i) => i);
  return {
    marcas: ordem.slice(0, PIPS_VISIVEIS),
    mais: Math.max(0, total - PIPS_VISIVEIS),
    // Uma estrela por encanto, com o mesmo limite
    estrelas: estrelas(resumo.nEncantos),
    maisEncantos: Math.max(0, resumo.nEncantos - PIPS_VISIVEIS),
    encanto: resumo.nEncantos > 0,
    magico: !!resumo.magico,
    nMelhorias: resumo.nMelhorias,
    nEncantos: resumo.nEncantos,
    nAprimoramentos: total
  };
}

/* ------------------------------------------------------------------ */
/* HTML                                                               */
/* ------------------------------------------------------------------ */

/** Estrela de quatro pontas própria: a varinha de brilhos já marca "magia" na Ficha Hayd. */
export const ICONE_ENCANTO = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1.5c.7 5.6 4.9 9.8 10.5 10.5-5.6.7-9.8 4.9-10.5 10.5C11.3 16.9 7.1 12.7 1.5 12 7.1 11.3 11.3 7.1 12 1.5z"/></svg>';
export const ICONE_MELHORIA = '<i class="fa-solid fa-hammer" aria-hidden="true"></i>';
export const ICONE_MATERIAL = '<i class="fa-solid fa-gem" aria-hidden="true"></i>';

/** Estilo inline com o tom de um material (usado no chip, no aro e no painel). */
export function estiloDoMaterial(material) {
  return material ? `--h:${material.h};--c:${material.c}` : "";
}

function itemDoTooltip(e) {
  const nota = e.suprimida ? `substituída por ${esc(e.suprimidaPor)}` : e.desativada ? "desativada" : esc(e.beneficio);
  return `<li class="${e.ativa ? "" : "off"}"><b>${esc(e.nome)}</b> <small>${nota}</small></li>`;
}

/** Conteúdo do tooltip: o mesmo texto serve ao chip, ao cartão e à lista. */
export function tooltipHtml(resumo) {
  const blocos = [];
  if (resumo.materiais.length) {
    blocos.push(`<h6>Material</h6><ul>${resumo.materiais.map(m =>
      `<li class="${m.ativa ? "" : "off"}"><b>${esc(m.nome)}</b>${m.varianteNome ? ` <em>${esc(m.varianteNome)}</em>` : ""} <small>${esc(m.beneficio)}</small></li>`).join("")}</ul>`);
  }
  if (resumo.melhorias.length) blocos.push(`<h6>Melhorias</h6><ul>${resumo.melhorias.map(itemDoTooltip).join("")}</ul>`);
  if (resumo.encantos.length) blocos.push(`<h6>Encantos</h6><ul>${resumo.encantos.map(itemDoTooltip).join("")}</ul>`);
  return `<div class="hbdg-tip">${blocos.join("")}</div>`;
}

/**
 * Chips para listas e cartões: material (só o diamante), melhorias (contador)
 * e encantos (contador). O tooltip traz tudo por extenso.
 */
export function chipsHtml(resumo) {
  if (!resumo) return "";
  const partes = [];
  const m = resumo.material;
  if (m) partes.push(`<span class="hbdg hbdg-mat hbdg-icone" style="${estiloDoMaterial(m)}" aria-label="${esc(m.nome)}">${ICONE_MATERIAL}</span>`);
  if (resumo.nMelhorias) partes.push(`<span class="hbdg hbdg-mel">${ICONE_MELHORIA}<span class="n">${resumo.nMelhorias}</span></span>`);
  if (resumo.nEncantos) partes.push(`<span class="hbdg hbdg-enc">${ICONE_ENCANTO}<span class="n">${resumo.nEncantos}</span></span>`);
  if (!partes.length) return "";
  const dica = tooltipHtml(resumo).replaceAll('"', "&quot;");
  return `<span class="hbdgs" tabindex="0" data-tooltip="${dica}" data-tooltip-class="hbdg-tooltip" data-tooltip-direction="DOWN">${partes.join("")}</span>`;
}

/**
 * Acrescenta os chips depois do nome de um elemento. Idempotente: a ficha
 * é redesenhada com frequência e o chip não pode se repetir.
 */
export function injetarChips(alvo, item) {
  if (!alvo) return;
  alvo.parentElement?.querySelector(":scope > .hbdgs")?.remove();
  const html = chipsHtml(resumoDoItem(item));
  if (html) alvo.insertAdjacentHTML("afterend", html);
}

/* ------------------------------------------------------------------ */
/* Ficha do sistema e chat                                            */
/* ------------------------------------------------------------------ */

function raizDe(html) {
  return html instanceof HTMLElement ? html : html?.[0];
}

/**
 * Listas da ficha do sistema: chips depois do nome de cada item melhorado.
 * A Ficha Hayd tem coluna e aro próprios (t20-hayd-ui) e fica de fora.
 */
export function aoRenderizarFichaAtor(app, html) {
  const raiz = raizDe(html);
  const ator = app?.actor ?? app?.document;
  if (!raiz?.querySelectorAll || !ator?.items || raiz.matches?.(".hayd-ficha") || raiz.querySelector(".hayd-ficha")) return;
  for (const li of raiz.querySelectorAll("li.item[data-item-id]")) {
    const item = ator.items.get(li.dataset.itemId);
    if (!item?.flags?.[MODULO]) continue;
    injetarChips(li.querySelector(".item-name label"), item);
  }
}

/**
 * As entradas do módulo são gravadas com render:false (a aba do item se
 * redesenha sozinha), então a ficha do personagem não saberia que os badges
 * mudaram. Quem tem a ficha aberta (inclusive outros jogadores) redesenha.
 * Várias gravações seguidas (melhoria + preço + efeitos) viram um só redesenho.
 */
const CHAVES_DE_APRIMORAMENTO = /^(?:-=|\+=)?(?:melhorias|encantos|materiais|magico)$/;
const redesenhos = new Map();

export function aoAtualizarItem(item, mudou) {
  const flags = mudou?.flags?.[MODULO];
  const ator = item.parent;
  if (!flags || !ator || !Object.keys(flags).some(k => CHAVES_DE_APRIMORAMENTO.test(k))) return;
  clearTimeout(redesenhos.get(ator.uuid));
  redesenhos.set(ator.uuid, setTimeout(() => {
    redesenhos.delete(ator.uuid);
    const fichas = new Set(Object.values(ator.apps ?? {}));
    if (ator.sheet) fichas.add(ator.sheet);
    for (const ficha of fichas) if (ficha.rendered) ficha.render();
  }, 80));
}

/** Cartão de uso do item no chat: chips logo abaixo do título. */
export function aoRenderizarMensagem(mensagem, html) {
  const raiz = raizDe(html);
  const card = raiz?.querySelector?.(".chat-card.item-card");
  if (!card || card.querySelector(".hbdgs")) return;
  const ator = mensagem.speakerActor ?? game.actors.get(card.dataset.actorId);
  const item = ator?.items?.get(card.dataset.itemId);
  if (!item?.flags?.[MODULO]) return;
  const chips = chipsHtml(resumoDoItem(item));
  if (!chips) return;
  const cabecalho = card.querySelector(".card-header");
  const caixa = document.createElement("div");
  caixa.className = "hbdg-linha";
  caixa.innerHTML = chips;
  caixa.firstElementChild.classList.add("hbdg-cartao");
  if (cabecalho) cabecalho.after(caixa);
  else card.prepend(caixa);
}

export const ICONES = { material: ICONE_MATERIAL, melhoria: ICONE_MELHORIA, encanto: ICONE_ENCANTO };

export const BADGES = { resumoDoItem, resumoParaColuna, chipsHtml, tooltipHtml, injetarChips, estiloDoMaterial, ICONES };
