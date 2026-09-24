/**
 * t20-hayd-itens | chat.mjs
 * Botões nas mensagens do chat:
 *  - cartão de ataque da arma: injetar dose (Injeção Alquímica), disparar
 *    a magia guardada (Conjuradora), aplicar sangramento (Sanguinária),
 *    onda de choque (Ressonante), receber PV temporários (Drenante),
 *    gastar PM na Frenética e ligar/desligar a Piedosa;
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

export function aoRenderizarMensagem(mensagem, html) {
  const raiz = html instanceof HTMLElement ? html : html?.[0];
  if (!raiz?.querySelector) return;
  ligarAcoes(raiz);
  const card = raiz.querySelector(".chat-card.item-card");
  if (card) decorarCartao(mensagem, card);
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

function decorarCartao(mensagem, card) {
  corrigirImagensDeModelo(mensagem, card);
  if (card.querySelector(".hayd-cartao-rodape")) return;

  const ator = mensagem.speakerActor ?? game.actors.get(card.dataset.actorId);
  const item = ator?.items?.get(card.dataset.itemId);
  if (!ator?.isOwner || !item?.flags?.[MODULO] || item.type !== "arma") return;

  const botoes = [];

  // Injeção Alquímica: uma dose por botão (procurada pelo nome na hora do
  // clique — o índice muda quando outra dose é usada antes).
  if (temMelhoria(item, "injecao-alquimica")) {
    for (const dose of item.getFlag(MODULO, "alquimicos") ?? []) {
      botoes.push(botao("fa-solid fa-syringe", `Injetar ${dose.name}`, () => {
        const atual = item.getFlag(MODULO, "alquimicos") ?? [];
        const i = atual.findIndex(d => d.name === dose.name);
        if (i < 0) {
          ui.notifications.warn("Esta dose já foi usada.");
          return true;
        }
        return usarDose(item, "injecao-alquimica", i);
      }));
    }
  }

  // Conjuradora: dispara a magia guardada.
  const conj = especialLigado("conjuradora") ? registroAtivo(item, "conjuradora") : null;
  const magia = conj ? dadosDoItem(item).estado[conj.reg.id]?.magia : null;
  if (magia) {
    botoes.push(botao("fa-solid fa-wand-sparkles", `Disparar ${magia.dados?.name ?? "magia"}`,
      () => dispararConjuradora(item, conj.reg.id)));
  }

  // Sanguinária: aplica/agrava o sangramento nos tokens selecionados.
  if (especialLigado("sanguinaria") && registroAtivo(item, "sanguinaria")) {
    botoes.push(botao("fa-solid fa-droplet", "Aplicar sangramento", () => aplicarSangramento(item), { reutilizavel: true }));
  }

  // Ressonante: onda de choque com metade do dano do ataque.
  const temDano = (mensagem.rolls ?? []).some(r => r.options?.type === "damage" && !r.options?.haydExtra);
  if (temDano && especialLigado("ressonante") && registroAtivo(item, "ressonante")) {
    botoes.push(botao("fa-solid fa-wave-square", "Onda de choque (2 PM)", () => ondaDeChoque(mensagem, item)));
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
  const pied = especialLigado("piedosa") ? registroAtivo(item, "piedosa") : null;
  if (pied) {
    const rotuloPiedosa = () => (dadosDoItem(item).estado[pied.reg.id]?.inativa
      ? "Piedosa — Ativar (1 PM)"
      : "Piedosa — Desativar (1 PM)");
    const b = botao("fa-solid fa-dove", rotuloPiedosa(), async () => {
      await alternarPiedosa(item, pied.reg.id);
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
