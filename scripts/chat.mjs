/**
 * t20-hayd-itens | chat.mjs
 * Botões nas mensagens do chat:
 *  - cartão de ataque da arma: injetar dose (Injeção Alquímica), disparar
 *    a magia guardada (Conjuradora), aplicar sangramento (Sanguinária),
 *    onda de choque (Ressonante), receber PV temporários (Drenante),
 *    gastar PM na Frenética e ligar/desligar a Piedosa — também os da
 *    munição disparada; usar o veneno aplicado na arma (veneno.mjs);
 *  - a munição gasta no disparo, para todos (municao.mjs);
 *  - cartões do módulo com [data-hayd-acao] (sustentar/cancelar Dançarina).
 */

import { MODULO } from "./catalogo.mjs";
import { dadosDoItem, registroAtivo } from "./efeitos.mjs";
import { usarDose, temMelhoria } from "./alquimica.mjs";
import {
  especialLigado, dispararConjuradora, aplicarSangramento, ondaDeChoque,
  receberRolagem, acaoDeMensagem, gastarFrenetica, alternarPiedosa
} from "./automacoes.mjs";
import { esc } from "./mensagens.mjs";
import { mensagensDeMunicao } from "./municao.mjs";
import { venenoDaArma, rotuloDoVeneno, usarVeneno, notaDeCD } from "./veneno.mjs";

export function aoRenderizarMensagem(mensagem, html) {
  const raiz = html instanceof HTMLElement ? html : html?.[0];
  if (!raiz?.querySelector) return;
  ligarAcoes(raiz);
  const card = raiz.querySelector(".chat-card.item-card");
  if (!card) return;
  notaDeCD(mensagem, card);
  decorarCartao(mensagem, card);
}

/* ------------------------------------------------------------------ */
/* Cartões do módulo                                                  */
/* ------------------------------------------------------------------ */

function atorPorUuid(uuid) {
  try { return uuid ? fromUuidSync(uuid) : null; }
  catch { return null; }
}

/** Botões dos cartões do módulo: só o dono da ficha (ou o Mestre) usa. */
function ligarAcoes(raiz) {
  for (const botao of raiz.querySelectorAll("[data-hayd-acao]")) {
    const ator = atorPorUuid(botao.dataset.ator);
    if (!ator?.isOwner) { botao.disabled = true; continue; }
    botao.addEventListener("click", async ev => {
      ev.preventDefault();
      botao.disabled = true;
      try {
        const ok = await acaoDeMensagem(botao.dataset.haydAcao, ator, botao.dataset.item, botao.dataset.entrada);
        if (ok === false) botao.disabled = false;
      } catch (err) {
        console.error(`${MODULO} | Falha na ação do chat`, err);
        botao.disabled = false;
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Cartão de uso do item                                              */
/* ------------------------------------------------------------------ */

/**
 * Botão do rodapé. Ação que devolve false (cancelada, sem PM…) libera o
 * botão de novo; as de uso único ficam desabilitadas depois de feitas.
 */
function botao(icone, rotulo, acao, { reutilizavel = false } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "hayd-cartao-btn";
  b.innerHTML = `<i class="${icone}"></i> ${esc(rotulo)}`;
  b.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (b.disabled) return;
    b.disabled = true;
    let ok = false;
    try { ok = await acao(); }
    catch (err) { console.error(`${MODULO} | Falha no botão do cartão`, err); }
    if (reutilizavel || ok === false) b.disabled = false;
  });
  return b;
}

/**
 * Os modelos oferecidos pelo cartão têm `img`, mas o template do sistema
 * lê `icon` — sem isto o botão de aplicar sai com a imagem quebrada.
 */
function corrigirImagensDeModelo(mensagem, card) {
  const efeitos = mensagem.flags?.tormenta20?.effects;
  if (!Array.isArray(efeitos)) return;
  for (const b of card.querySelectorAll(".chat-apply-ae")) {
    const ef = efeitos[Number(b.dataset.effectIndex)]?.[0];
    if (!ef?.flags?.[MODULO]?.copiaDeModelo || !ef.img) continue;
    const img = b.querySelector("img");
    if (img && !img.getAttribute("src")) img.src = ef.img;
  }
}

/** Munição gasta no disparo, logo abaixo do título do cartão (para todos). */
function notaDeMunicao(card, nota, ator) {
  if (!mensagensDeMunicao(ator) || card.querySelector(".hayd-municao-nota, .hayd-municao-aviso")) return;
  if (nota?.semMunicao) {
    const aviso = document.createElement("div");
    aviso.className = "hayd-municao-aviso";
    aviso.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Disparo feito sem munição`;
    card.prepend(aviso);
    return;
  }
  if (!nota?.nome) return;
  const resta = Math.max(0, Number(nota.resta) || 0);
  const partes = [`Gastou <b>${Number(nota.gasto) || 1}× ${esc(nota.nome)}</b>`];
  if (!resta) partes.push("<b>acabou a munição</b>");
  else {
    partes.push(`restam ${resta}`);
    if (nota.carregadas === 0) partes.push("arma descarregada");
    else if (nota.carregadas > 0 && nota.capacidade > 1) partes.push(`${nota.carregadas}/${nota.capacidade} na arma`);
  }
  const div = document.createElement("div");
  div.className = "hayd-municao-nota";
  div.innerHTML = `${nota.img ? `<img src="${esc(nota.img)}" alt="">` : ""}<span>${partes.join(" · ")}</span>`;
  const cabecalho = card.querySelector(".card-header");
  if (cabecalho) cabecalho.after(div);
  else card.prepend(div);
}

/** Botões de injetar as doses da Injeção Alquímica de um item (arma ou munição). */
function botoesDeInjecao(item) {
  if (!temMelhoria(item, "injecao-alquimica")) return [];
  // Uma dose por botão, procurada pelo nome na hora do clique — o índice
  // muda quando outra dose é usada antes.
  return (item.getFlag(MODULO, "alquimicos") ?? []).map(dose =>
    botao("fa-solid fa-syringe", `Injetar ${dose.name}`, () => {
      const atual = item.getFlag(MODULO, "alquimicos") ?? [];
      const i = atual.findIndex(d => d.name === dose.name);
      if (i < 0) {
        ui.notifications.warn("Esta dose já foi usada.");
        return true;
      }
      return usarDose(item, "injecao-alquimica", i);
    }));
}

function decorarCartao(mensagem, card) {
  corrigirImagensDeModelo(mensagem, card);
  const nota = mensagem.flags?.[MODULO]?.municao;
  const ator = mensagem.speakerActor ?? game.actors.get(card.dataset.actorId);
  notaDeMunicao(card, nota, ator);
  if (card.querySelector(".hayd-cartao-rodape")) return;

  const item = ator?.items?.get(card.dataset.itemId);
  if (!ator?.isOwner || item?.type !== "arma") return;
  // A munição disparada: os encantos dela também oferecem botões. Com a
  // mesma entrada nos dois, vale a da arma.
  const municao = nota?.id ? ator.items.get(nota.id) : null;
  if (!item.flags?.[MODULO] && !municao?.flags?.[MODULO]) return;
  const fonte = key => (registroAtivo(item, key) ? item : (municao && registroAtivo(municao, key) ? municao : null));

  const botoes = [];

  // Injeção Alquímica: as doses da arma e as da munição disparada.
  botoes.push(...botoesDeInjecao(item));
  if (municao) botoes.push(...botoesDeInjecao(municao));

  // Veneno aplicado na arma: usado no ataque que acertar.
  const veneno = venenoDaArma(item);
  if (veneno) botoes.push(botao("fa-solid fa-skull-crossbones", rotuloDoVeneno(veneno), () => usarVeneno(item)));

  // Conjuradora: dispara a magia guardada.
  const conj = especialLigado("conjuradora") ? registroAtivo(item, "conjuradora") : null;
  const magia = conj ? dadosDoItem(item).estado[conj.reg.id]?.magia : null;
  if (magia) {
    botoes.push(botao("fa-solid fa-wand-sparkles", `Disparar ${magia.dados?.name ?? "magia"}`,
      () => dispararConjuradora(item, conj.reg.id)));
  }

  // Sanguinária: aplica/agrava o sangramento nos tokens selecionados.
  const sanguinaria = especialLigado("sanguinaria") ? fonte("sanguinaria") : null;
  if (sanguinaria) {
    botoes.push(botao("fa-solid fa-droplet", "Aplicar sangramento", () => aplicarSangramento(sanguinaria), { reutilizavel: true }));
  }

  // Ressonante: onda de choque com metade do dano do ataque.
  const temDano = (mensagem.rolls ?? []).some(r => r.options?.type === "damage" && !r.options?.haydExtra);
  const ressonante = temDano && especialLigado("ressonante") ? fonte("ressonante") : null;
  if (ressonante) {
    botoes.push(botao("fa-solid fa-wave-square", "Onda de choque (2 PM)", () => ondaDeChoque(mensagem, ressonante)));
  }

  // Frenética: o bônus sobe a cada ataque, 1 PM por vez — o botão vem no
  // cartão do próprio ataque para não obrigar a voltar na ficha. Reutilizável
  // porque dá para subir mais de um ponto no mesmo turno (até o máximo, que
  // `gastarFrenetica` avisa quando é atingido).
  const fren = especialLigado("frenetica") ? registroAtivo(item, "frenetica") : null;
  if (fren) {
    botoes.push(botao("fa-solid fa-fire-flame-curved", "Frenética — Gastar 1 PM",
      () => gastarFrenetica(item, fren.reg.id), { reutilizavel: true }));
  }

  // Piedosa: liga/desliga com 1 PM, como a Frenética sobe o bônus — vale para
  // os próximos ataques, então o botão fica no cartão. O rótulo acompanha o
  // estado depois de cada clique.
  const donoPiedosa = especialLigado("piedosa") ? fonte("piedosa") : null;
  const pied = donoPiedosa ? registroAtivo(donoPiedosa, "piedosa") : null;
  if (pied) {
    const rotuloPiedosa = () => (dadosDoItem(donoPiedosa).estado[pied.reg.id]?.inativa
      ? "Piedosa — Ativar (1 PM)"
      : "Piedosa — Desativar (1 PM)");
    const b = botao("fa-solid fa-dove", rotuloPiedosa(), async () => {
      await alternarPiedosa(donoPiedosa, pied.reg.id);
      b.innerHTML = `<i class="fa-solid fa-dove"></i> ${esc(rotuloPiedosa())}`;
    }, { reutilizavel: true });
    botoes.push(b);
  }

  if (botoes.length) {
    const rodape = document.createElement("footer");
    rodape.className = "card-item-effects flexcol hayd-cartao-rodape";
    rodape.append(...botoes);
    card.appendChild(rodape);
  }

  // Drenante (e outras rolagens "de receber"): botão ao lado da rolagem.
  for (const r of mensagem.rolls ?? []) {
    if (!r.options?.haydReceber) continue;
    const titulo = r.options.title;
    const bloco = [...card.querySelectorAll(".roll")].find(el => el.dataset.rollTitle === titulo);
    if (!bloco || bloco.nextElementSibling?.classList.contains("hayd-receber")) continue;
    // Mesmo rodapé dos outros botões do cartão (Frenética, Sanguinária…): solto
    // no cartão, o sistema pinta o botão com o próprio estilo e ele destoa.
    const rodape = document.createElement("footer");
    rodape.className = "card-item-effects flexcol hayd-cartao-rodape hayd-receber";
    rodape.appendChild(botao("fa-solid fa-heart-circle-plus", "Receber PV temporários",
      () => receberRolagem(mensagem, titulo, ator)));
    bloco.after(rodape);
  }
}
