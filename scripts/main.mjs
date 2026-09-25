/**
 * t20-hayd-itens | main.mjs
 * Ponto de entrada: substitui a aba de aprimoramentos do sistema pela
 * aba do módulo, registra homebrews e liga as automações de uso.
 */

import { MODULO } from "./catalogo.mjs";
import * as catalogo from "./catalogo.mjs";
import * as efeitos from "./efeitos.mjs";
import * as automacoes from "./automacoes.mjs";
import { aoRenderizarFichaItem } from "./aba.mjs";
import { registrarHomebrew, abrirGerenciadorHomebrew, obterHomebrews } from "./homebrew.mjs";
import { registrarEditor, abrirEditor, obterOverrides } from "./editor.mjs";
import { opcoesMenuContexto, carregarAlquimico, descarregarAlquimico } from "./alquimica.mjs";
import { aoRenderizarMensagem } from "./chat.mjs";
import { registrarEnvoltorios } from "./rolagem.mjs";

Hooks.once("init", () => {
  console.log(`${MODULO} | Inicializando — Itens Superiores e Mágicos`);

  registrarHomebrew();
  registrarEditor();

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
    `modules/${MODULO}/templates/aba.hbs`,
    `modules/${MODULO}/templates/editor-lista.hbs`,
    `modules/${MODULO}/templates/editor-entrada.hbs`
  ]);
});

/* Depois do init do sistema: envolve rollDamage/displayCard do ItemT20. */
Hooks.once("setup", () => {
  try { registrarEnvoltorios(); }
  catch (err) { console.error(`${MODULO} | Falha ao ligar as automações de rolagem`, err); }
  try { automacoes.registrarEnvoltoriosDeAtor(); }
  catch (err) { console.error(`${MODULO} | Falha ao ligar as automações do ator`, err); }
});

Hooks.once("ready", () => {
  const api = {
    catalogo,
    efeitos,
    automacoes,
    homebrews: obterHomebrews,
    overrides: obterOverrides,
    abrirGerenciadorHomebrew,
    abrirEditor,
    carregarAlquimico,
    descarregarAlquimico
  };
  const mod = game.modules.get(MODULO);
  if (mod) mod.api = api;
  globalThis.t20HaydItens = api;
  console.log(`${MODULO} | Pronto. API em game.modules.get("${MODULO}").api`);

  // Migração leve (GM): (1) marcador nativo do Lancinante; (2) preenche
  // origin nos efeitos do módulo criados antes desta versão — sem origin,
  // o motor de rolagem aplicava o aumento de passo na parte errada do dano;
  // (3) refaz o Geomântico que dava RD só contra impacto.
  if (game.user === game.users.activeGM) {
    const corrigir = async (item) => {
      const f = item.flags[MODULO];
      const tarefas = [];

      if (f.encantos?.some(e => e.key === "lancinante" && !e.desativada)
        && !Object.values(item.system?.upgrades ?? {}).includes("lancinating")) {
        tarefas.push(efeitos.sincronizarLancinante(item));
      }

      // Geomântico antigo: dava RD só contra impacto (o certo é RD 10/impacto,
      // contra tudo exceto impacto). Refaz a entrada com a definição atual.
      const errado = c => c.key === "system.tracos.resistencias.impacto.bonus";
      const geomanticos = (f.encantos ?? []).filter(reg => reg.key === "geomantico"
        && ([...item.effects].some(e => e.flags?.[MODULO] && e.changes.some(errado))
          || [...(item.actor?.effects ?? [])].some(e => e.origin?.includes(item.id) && e.changes.some(errado))));

      const semOrigin = [...item.effects].filter(e => e.flags?.[MODULO] && !e.origin);
      if (semOrigin.length) {
        tarefas.push(item.updateEmbeddedDocuments("ActiveEffect",
          semOrigin.map(e => ({ _id: e.id, origin: item.uuid })), { render: false }));
      }

      if (tarefas.length) await Promise.all(tarefas);
      // Depois das demais: reconstruir apaga e recria efeitos que elas podem tocar
      for (const reg of geomanticos) await efeitos.reconstruirEntrada(item, "encantos", reg.id);
    };
    (async () => {
      // Seleciona os candidatos primeiro: em mundos grandes, criar uma
      // Promise por item só para descartá-lo custa mais que a migração.
      const candidatos = [];
      for (const item of game.items) if (item.flags?.[MODULO]) candidatos.push(item);
      for (const ator of game.actors) {
        for (const item of ator.items) if (item.flags?.[MODULO]) candidatos.push(item);
      }
      for (const item of candidatos) await corrigir(item).catch(() => {});
    })();
  }
});

/* Homebrews e overrides do GM mudaram: derruba o catálogo memoizado (em
 * todos os clientes) para as listas voltarem a refletir as settings. */
Hooks.on("updateSetting", (setting) => {
  if (setting?.key?.startsWith(`${MODULO}.`)) catalogo.invalidarCatalogo();
});

/* Substitui a aba de aprimoramentos na ficha de item. */
Hooks.on("renderItemSheetT20", (app, html) => {
  aoRenderizarFichaItem(app, html).catch(err =>
    console.error(`${MODULO} | Falha ao renderizar a aba`, err));
});

/* Menu de contexto (Injeção Alquímica, Injetora, Conjuradora) nas fichas. */
Hooks.on("tormenta20.getItemToggleContextOptions", (item, menuItems) => {
  try { opcoesMenuContexto(item, menuItems); }
  catch (err) { console.error(`${MODULO} | Falha no menu de contexto`, err); }
});

/* Botões nos cartões do chat (ataque da arma e mensagens do módulo). */
Hooks.on("renderChatMessageHTML", (mensagem, html) => {
  try { aoRenderizarMensagem(mensagem, html); }
  catch (err) { console.error(`${MODULO} | Falha no cartão de chat`, err); }
});

/* Disparo da Conjuradora: a janela de uso abre já configurada. */
Hooks.on("renderAbilityUseDialog", (app, html) => {
  try { automacoes.aoRenderizarDialogoUso(app, html); }
  catch (err) { console.error(`${MODULO} | Falha ao preencher a janela de uso`, err); }
});

/* Dançarina: pergunta no início de cada turno se continua sustentada. */
Hooks.on("updateCombat", (combate, mudou) => {
  automacoes.aoAvancarTurno(combate, mudou).catch(err =>
    console.error(`${MODULO} | Falha no lembrete da Dançarina`, err));
});

/* Cuidadora: a RD 10 some ao sofrer o próximo dano. */
Hooks.on("preUpdateActor", (ator, mudou, opcoes) => {
  try { automacoes.aoPreAtualizarAtor(ator, mudou, opcoes); }
  catch (err) { console.error(`${MODULO} | Falha ao checar dano sofrido`, err); }
});
Hooks.on("updateActor", (ator, mudou, opcoes, userId) => {
  automacoes.aoAtualizarAtor(ator, mudou, opcoes, userId).catch(err =>
    console.error(`${MODULO} | Falha ao remover a RD da Cuidadora`, err));
});

/* Item gerenciado entra numa ficha: cria no ator os efeitos passivos,
 * de perícia, de magia e de poder das entradas do item (a transferência
 * nativa do sistema não cobre efeitos criados depois que o item já era
 * possuído) e escolhe os poderes/magias sugeridos. */
Hooks.on("createItem", (item, options, userId) => {
  if (game.user.id !== userId) return;
  if (!item.actor || !catalogo.itemElegivel(item)) return;
  const f = item.flags?.[MODULO];
  if (!f || (!f.melhorias?.length && !f.encantos?.length && !f.materiais?.length)) return;
  efeitos.sincronizarEfeitosAtor(item).catch(err =>
    console.error(`${MODULO} | Falha ao sincronizar efeitos com o ator`, err));
});

/* Item renomeado: efeitos com o nome da arma (Cantante, Discreto) acompanham. */
Hooks.on("updateItem", (item, mudou, options, userId) => {
  if (game.user.id !== userId || !("name" in mudou) || !item.flags?.[MODULO]) return;
  efeitos.atualizarNomesDinamicos(item).catch(err =>
    console.error(`${MODULO} | Falha ao renomear efeitos`, err));
});

/* Poder/magia renomeado: as entradas que o escolheram guardam o NOME, então
 * o vínculo se perderia. Só em `preUpdate` os dois nomes existem ao mesmo
 * tempo — o documento ainda tem o antigo e a mudança traz o novo. */
const nomesAntigos = new Map();

Hooks.on("preUpdateItem", (item, mudou, options, userId) => {
  if (game.user.id !== userId || !mudou?.name || mudou.name === item.name) return;
  if (!item.actor || !["poder", "magia"].includes(item.type)) return;
  nomesAntigos.set(item.uuid, item.name);
});

Hooks.on("updateItem", (item, mudou, options, userId) => {
  const antigo = nomesAntigos.get(item.uuid);
  if (antigo === undefined) return;
  nomesAntigos.delete(item.uuid);
  if (game.user.id !== userId || !item.actor) return;

  efeitos.renomearAlvos(item.actor, antigo, item.name).then(corrigidos => {
    if (!corrigidos.length) return;
    ui.notifications.info(`"${antigo}" virou "${item.name}": vínculo atualizado em ${corrigidos.join(", ")}.`);
  }).catch(err =>
    console.error(`${MODULO} | Falha ao atualizar os vínculos do item renomeado`, err));
});

/* Item sai da ficha: limpa os efeitos que ele originou no ator. */
Hooks.on("deleteItem", (item, options, userId) => {
  if (game.user.id !== userId) return;
  if (!item.parent || item.parent.documentName !== "Actor") return;
  if (item.flags?.[MODULO]?.doseTemporaria) return;
  efeitos.removerEfeitosAtorDoItem(item.parent, item.id).catch(err =>
    console.error(`${MODULO} | Falha ao limpar efeitos do ator`, err));
});
