/**
 * t20-hayd-itens | main.mjs
 * Ponto de entrada: substitui a aba de aprimoramentos do sistema pela
 * aba do módulo, registra homebrews e liga a Injeção Alquímica.
 */

import { MODULO } from "./catalogo.mjs";
import * as catalogo from "./catalogo.mjs";
import * as efeitos from "./efeitos.mjs";
import { aoRenderizarFichaItem } from "./aba.mjs";
import { registrarHomebrew, abrirGerenciadorHomebrew, obterHomebrews } from "./homebrew.mjs";
import {
  opcoesMenuContexto, aoRenderizarMensagem,
  carregarAlquimico, descarregarAlquimico
} from "./alquimica.mjs";

Hooks.once("init", () => {
  console.log(`${MODULO} | Inicializando — Itens Superiores e Mágicos`);

  registrarHomebrew();

  game.settings.registerMenu(MODULO, "homebrewMenu", {
    name: "Homebrews de Melhorias e Encantos",
    label: "Gerenciar Homebrews",
    hint: "Crie melhorias, encantos e materiais especiais personalizados, disponíveis em todos os itens.",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: class extends FormApplication {
      render() { abrirGerenciadorHomebrew(); return this; }
      async _updateObject() {}
    },
    restricted: true
  });

  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULO}/templates/aba.hbs`
  ]);
});

Hooks.once("ready", () => {
  const api = {
    catalogo,
    efeitos,
    homebrews: obterHomebrews,
    abrirGerenciadorHomebrew,
    carregarAlquimico,
    descarregarAlquimico
  };
  const mod = game.modules.get(MODULO);
  if (mod) mod.api = api;
  globalThis.t20HaydItens = api;
  console.log(`${MODULO} | Pronto. API em game.modules.get("${MODULO}").api`);
});

/* Substitui a aba de aprimoramentos na ficha de item. */
Hooks.on("renderItemSheetT20", (app, html) => {
  aoRenderizarFichaItem(app, html).catch(err =>
    console.error(`${MODULO} | Falha ao renderizar a aba`, err));
});

/* Menu de contexto (Injeção Alquímica) nas fichas de personagem. */
Hooks.on("tormenta20.getItemToggleContextOptions", (item, menuItems) => {
  try { opcoesMenuContexto(item, menuItems); }
  catch (err) { console.error(`${MODULO} | Falha no menu de contexto`, err); }
});

/* Botão de injeção no cartão de chat da arma. */
Hooks.on("renderChatMessageHTML", (mensagem, html) => {
  try { aoRenderizarMensagem(mensagem, html); }
  catch (err) { console.error(`${MODULO} | Falha no cartão de chat`, err); }
});

/* Item gerenciado entra numa ficha: cria no ator os efeitos passivos,
 * de perícia e de magia das entradas do item (a transferência nativa do
 * sistema não cobre efeitos criados depois que o item já era possuído). */
Hooks.on("createItem", (item, options, userId) => {
  if (game.user.id !== userId) return;
  if (!item.actor || !catalogo.itemElegivel(item)) return;
  const f = item.flags?.[MODULO];
  if (!f || (!f.melhorias?.length && !f.encantos?.length && !f.materiais?.length)) return;
  efeitos.sincronizarEfeitosAtor(item).catch(err =>
    console.error(`${MODULO} | Falha ao sincronizar efeitos com o ator`, err));
});

/* Item sai da ficha: limpa os efeitos que ele originou no ator. */
Hooks.on("deleteItem", (item, options, userId) => {
  if (game.user.id !== userId) return;
  if (!item.parent || item.parent.documentName !== "Actor") return;
  if (item.flags?.[MODULO]?.doseTemporaria) return;
  efeitos.removerEfeitosAtorDoItem(item.parent, item.id).catch(err =>
    console.error(`${MODULO} | Falha ao limpar efeitos do ator`, err));
});
