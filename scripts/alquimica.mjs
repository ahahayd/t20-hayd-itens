/**
 * t20-hayd-itens | alquimica.mjs
 * Automação das melhorias com doses carregáveis:
 *
 *  - Injeção Alquímica (T20 p.165, arma, 2 doses): clique direito na arma
 *    para carregar preparados; ao atacar, o cartão da arma no chat oferece
 *    o botão de injetar.
 *  - Injetora (HA p.240, armadura, 1 dose): clique direito na armadura para
 *    carregar um preparado ou poção; ingerir (ação de movimento) também
 *    pelo menu de contexto.
 *
 * Em ambas, o uso passa pela caixa de diálogo de rolagem do sistema
 * (permitindo escolher poderes/aprimoramentos) e a dose é consumida.
 */

import { MODULO, obterEntrada } from "./catalogo.mjs";

const { DialogV2 } = foundry.applications.api;

/* ------------------------------------------------------------------ */
/* Configuração das melhorias com doses                               */
/* ------------------------------------------------------------------ */

const CONFIGS = {
  "injecao-alquimica": {
    flag: "alquimicos",
    max: 2,
    rotulo: "Injeção Alquímica",
    especial: "alquimica",
    verboUso: "Injetar",
    sufixoUso: "injeção",
    tipoItem: "arma",
    dicaCarregar: "carregar exige ação completa"
  },
  "injetora": {
    flag: "injetora",
    max: 1,
    rotulo: "Injetora",
    especial: "injetora",
    verboUso: "Ingerir",
    sufixoUso: "injetora",
    tipoItem: "equipamento",
    dicaCarregar: "carregar exige ação completa; ingerir é ação de movimento"
  }
};

function automacaoAtiva(chave) {
  return obterEntrada(chave)?.especial === CONFIGS[chave].especial;
}

/** true se a automação da Injeção Alquímica não foi desabilitada pelo GM. */
export function automacaoAlquimicaAtiva() {
  return automacaoAtiva("injecao-alquimica");
}

function temMelhoria(item, chave) {
  if (!automacaoAtiva(chave)) return false;
  if (item.type !== CONFIGS[chave].tipoItem) return false;
  return (item.getFlag(MODULO, "melhorias") ?? []).some(m => m.key === chave);
}

/* ------------------------------------------------------------------ */
/* Carregar / descarregar / usar (núcleo compartilhado)               */
/* ------------------------------------------------------------------ */

async function carregarDose(item, chave) {
  const cfg = CONFIGS[chave];
  const ator = item.actor;
  if (!ator) return;

  const doses = item.getFlag(MODULO, cfg.flag) ?? [];
  if (doses.length >= cfg.max) {
    return ui.notifications.warn(`${cfg.rotulo}: capacidade máxima de ${cfg.max} dose${cfg.max > 1 ? "s" : ""}.`);
  }

  const candidatos = ator.items.filter(i =>
    i.type === "consumivel" && ["alchemy", "potion"].includes(i.system?.tipo) && i.id !== item.id
  );
  if (!candidatos.length) {
    return ui.notifications.warn("Nenhum preparado alquímico ou poção (consumível) encontrado no inventário.");
  }

  const opcoes = candidatos
    .map(i => `<option value="${i.id}">${i.name} (${i.system?.qtd ?? 1}x)</option>`)
    .join("");
  const dados = await DialogV2.prompt({
    window: { title: `Carregar ${cfg.rotulo} — ${item.name}` },
    content: `<p>Escolha a dose a carregar (${doses.length}/${cfg.max}; ${cfg.dicaCarregar}):</p>
      <div class="form-group"><select name="itemId">${opcoes}</select></div>`,
    ok: { label: "Carregar", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object }
  }).catch(() => null);
  if (!dados?.itemId) return;

  const fonte = ator.items.get(dados.itemId);
  if (!fonte) return;

  // Uma dose = um item com qtd 1
  const carga = fonte.toObject();
  carga.system.qtd = 1;
  delete carga._id;

  const qtd = Number(fonte.system?.qtd ?? 1) || 1;
  if (qtd > 1) await fonte.update({ "system.qtd": qtd - 1 });
  else await fonte.delete();

  await item.setFlag(MODULO, cfg.flag, [...doses, carga]);
  ui.notifications.info(`${carga.name} carregado em ${item.name} (${doses.length + 1}/${cfg.max}).`);
}

async function descarregarDose(item, chave, indice) {
  const cfg = CONFIGS[chave];
  const ator = item.actor;
  const doses = foundry.utils.deepClone(item.getFlag(MODULO, cfg.flag) ?? []);
  const dose = doses[indice];
  if (!dose) return;

  doses.splice(indice, 1);
  await item.setFlag(MODULO, cfg.flag, doses);

  if (ator) {
    const existente = ator.items.find(i => i.name === dose.name && i.type === "consumivel");
    if (existente) await existente.update({ "system.qtd": (Number(existente.system?.qtd) || 1) + 1 });
    else await ator.createEmbeddedDocuments("Item", [dose]);
    ui.notifications.info(`${dose.name} devolvido ao inventário.`);
  }
}

let _usandoDose = false;

async function usarDose(item, chave, indice) {
  if (_usandoDose) return;
  const cfg = CONFIGS[chave];
  const ator = item.actor;
  if (!ator) return;

  const doses = foundry.utils.deepClone(item.getFlag(MODULO, cfg.flag) ?? []);
  const dose = doses[indice];
  if (!dose) return ui.notifications.warn("Esta dose já foi usada.");

  _usandoDose = true;
  let temp = null;
  try {
    // Cria o item temporário no ator e usa o fluxo normal do sistema,
    // com a caixa de diálogo de uso (bônus, poderes, aprimoramentos).
    const dadosTemp = foundry.utils.deepClone(dose);
    dadosTemp.name = `${dose.name} (${cfg.sufixoUso})`;
    foundry.utils.setProperty(dadosTemp, `flags.${MODULO}.doseTemporaria`, true);
    [temp] = await ator.createEmbeddedDocuments("Item", [dadosTemp]);

    const resultado = await temp.roll();

    if (resultado !== undefined && resultado !== null) {
      // Uso confirmado: consome a dose
      doses.splice(indice, 1);
      await item.setFlag(MODULO, cfg.flag, doses);
    }
  } catch (err) {
    console.error(`${MODULO} | Falha ao usar dose (${cfg.rotulo})`, err);
  } finally {
    if (temp) {
      const aindaExiste = ator.items.get(temp.id);
      if (aindaExiste) await aindaExiste.delete();
    }
    _usandoDose = false;
  }
}

/* API pública mantida (Injeção Alquímica) + Injetora */
export const carregarAlquimico = arma => carregarDose(arma, "injecao-alquimica");
export const descarregarAlquimico = (arma, indice) => descarregarDose(arma, "injecao-alquimica", indice);
export const carregarInjetora = item => carregarDose(item, "injetora");
export const descarregarInjetora = (item, indice) => descarregarDose(item, "injetora", indice);

/* ------------------------------------------------------------------ */
/* Menu de contexto do item na ficha                                  */
/* ------------------------------------------------------------------ */

export function opcoesMenuContexto(item, menuItems) {
  if (!item.actor) return;

  // Injeção Alquímica — arma (uso pelo cartão de ataque no chat)
  if (temMelhoria(item, "injecao-alquimica")) {
    menuItems.push({
      name: "Injeção Alquímica: carregar",
      icon: '<i class="fa-solid fa-syringe"></i>',
      callback: () => carregarDose(item, "injecao-alquimica")
    });

    const doses = item.getFlag(MODULO, "alquimicos") ?? [];
    if (doses.length) {
      menuItems.push({
        name: `Injeção Alquímica: descarregar (${doses.length})`,
        icon: '<i class="fa-solid fa-rotate-left"></i>',
        callback: () => descarregarDose(item, "injecao-alquimica", 0)
      });
    }
  }

  // Injetora — armadura (ingerir direto pelo menu, ação de movimento)
  if (temMelhoria(item, "injetora")) {
    const doses = item.getFlag(MODULO, "injetora") ?? [];
    if (doses.length < CONFIGS.injetora.max) {
      menuItems.push({
        name: "Injetora: carregar",
        icon: '<i class="fa-solid fa-syringe"></i>',
        callback: () => carregarDose(item, "injetora")
      });
    }
    if (doses.length) {
      menuItems.push({
        name: `Injetora: ingerir ${doses[0].name}`,
        icon: '<i class="fa-solid fa-flask"></i>',
        callback: () => usarDose(item, "injetora", 0)
      });
      menuItems.push({
        name: "Injetora: descarregar",
        icon: '<i class="fa-solid fa-rotate-left"></i>',
        callback: () => descarregarDose(item, "injetora", 0)
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Botão no cartão de chat da arma (Injeção Alquímica)                */
/* ------------------------------------------------------------------ */

export function aoRenderizarMensagem(mensagem, html) {
  const card = html.querySelector?.(".chat-card.item-card") ?? null;
  if (!card) return;

  const actorId = card.dataset.actorId;
  const itemId = card.dataset.itemId;
  if (!actorId || !itemId) return;

  const ator = game.actors.get(actorId);
  const arma = ator?.items?.get(itemId);
  if (!ator || !arma || arma.type !== "arma") return;
  if (!temMelhoria(arma, "injecao-alquimica")) return;
  if (!ator.isOwner) return;

  const doses = arma.getFlag(MODULO, "alquimicos") ?? [];
  if (!doses.length) return;
  if (card.querySelector(".hayd-injetar")) return;

  const rodape = document.createElement("footer");
  rodape.className = "card-item-effects flexcol hayd-injecao-rodape";
  for (let i = 0; i < doses.length; i++) {
    const dose = doses[i];
    const btn = document.createElement("button");
    btn.className = "hayd-injetar";
    btn.dataset.indice = String(i);
    btn.innerHTML = `<i class="fa-solid fa-syringe"></i> Injetar ${dose.name}`;
    btn.addEventListener("click", ev => {
      ev.preventDefault();
      usarDose(arma, "injecao-alquimica", Number(ev.currentTarget.dataset.indice));
    });
    rodape.appendChild(btn);
  }
  card.appendChild(rodape);
}
