/**
 * t20-hayd-itens | mensagens.mjs
 * Montagem e envio das mensagens de chat do módulo (registros de carga,
 * Dançarina, Frenética, Piedosa, Sanguinária…), no mesmo modelo de cartão
 * das auras do t20-hayd-gmtools.
 */

import { MODULO } from "./catalogo.mjs";

/** Escapa texto para entrar em HTML de mensagem. */
export function esc(texto) {
  return Handlebars.escapeExpression(String(texto ?? ""));
}

/** Lista com ícone e nome — ex.: preparados carregados na Injeção Alquímica. */
export function listaHTML(itens) {
  const linhas = itens.map(i => `<li>
      ${i.img ? `<img src="${esc(i.img)}" width="24" height="24" alt="">` : ""}
      <span>${esc(i.nome)}${i.extra ? ` <small>${esc(i.extra)}</small>` : ""}</span>
    </li>`).join("");
  return `<ul class="hayd-itens-lista">${linhas}</ul>`;
}

/**
 * Cartão padrão. `titulo` e `texto` já devem vir escapados (podem ter
 * negrito); `corpo` é HTML pronto (listas, botões).
 */
export function cartaoHTML({ icone = "fa-solid fa-circle-info", titulo, texto = "", corpo = "", nota = "" }) {
  return `<div class="hayd-itens-card">
    <p><b><i class="${icone}"></i> ${titulo}</b></p>
    ${texto ? `<p>${texto}</p>` : ""}
    ${corpo}
    ${nota ? `<p class="notes">${nota}</p>` : ""}
  </div>`;
}

/** Criatura do Mestre não precisa aparecer para a mesa toda. */
export function destinatarios(ator) {
  if (!ator || ator.hasPlayerOwner) return [];
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/** Publica um cartão falando pelo ator. */
export function postar(ator, content, { flags = null } = {}) {
  const dados = {
    speaker: ChatMessage.getSpeaker({ actor: ator ?? undefined }),
    content,
    whisper: destinatarios(ator)
  };
  if (flags) dados.flags = { [MODULO]: flags };
  return ChatMessage.create(dados);
}
