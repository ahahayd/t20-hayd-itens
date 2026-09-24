/**
 * t20-hayd-itens | alquimica.mjs
 * Automação das melhorias com doses carregáveis:
 *
 *  - Injeção Alquímica (T20 p.165, arma, 2 doses): carregue preparados
 *    pela aba Melhorias & Encantos ou pelo clique direito na arma; ao
 *    atacar, o cartão da arma no chat oferece o botão de injetar.
 *  - Injetora (HA p.240, armadura, 1 dose): carregue um preparado ou
 *    poção; ingerir (ação de movimento) pelo menu de contexto.
 *
 * Em ambas, o uso passa pela caixa de diálogo de rolagem do sistema
 * (permitindo escolher poderes/aprimoramentos) e a dose é consumida.
 * Carregar registra no chat o que entrou no item.
 *
 * Também monta o menu de contexto da Conjuradora (guardar/disparar).
 */

import { MODULO, obterEntrada } from "./catalogo.mjs";
import { dadosDoItem, registroAtivo } from "./efeitos.mjs";
import { esc, cartaoHTML, listaHTML, postar } from "./mensagens.mjs";
import { especialLigado, carregarConjuradora, dispararConjuradora } from "./automacoes.mjs";

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

/** O item tem a melhoria com doses, ligada (pelo GM e na aba)? */
export function temMelhoria(item, chave) {
  if (!automacaoAtiva(chave)) return false;
  if (item.type !== CONFIGS[chave].tipoItem) return false;
  return (item.getFlag(MODULO, "melhorias") ?? []).some(m => m.key === chave && !m.desativada);
}

/* ------------------------------------------------------------------ */
/* Carregar / descarregar / usar (núcleo compartilhado)               */
/* ------------------------------------------------------------------ */

async function carregarDose(item, chave) {
  const cfg = CONFIGS[chave];
  const ator = item.actor;
  if (!ator) return ui.notifications.warn(`Coloque o item na ficha de um personagem para carregar a ${cfg.rotulo}.`);

  const doses = item.getFlag(MODULO, cfg.flag) ?? [];
  const livres = cfg.max - doses.length;
  if (livres <= 0) {
    return ui.notifications.warn(`${cfg.rotulo}: capacidade máxima de ${cfg.max} dose${cfg.max > 1 ? "s" : ""}.`);
  }

  const candidatos = ator.items.filter(i =>
    i.type === "consumivel" && ["alchemy", "potion"].includes(i.system?.tipo) && i.id !== item.id
  );
  if (!candidatos.length) {
    return ui.notifications.warn("Nenhum preparado alquímico ou poção (consumível) encontrado no inventário.");
  }

  const linhas = candidatos.map(i => {
    const qtd = Number(i.system?.qtd ?? 1) || 1;
    return `<li class="hayd-carga-linha">
        <img src="${esc(i.img)}" width="28" height="28" alt="">
        <span class="hayd-carga-nome">${esc(i.name)} <small>(${qtd}x)</small></span>
        <input type="number" name="q.${i.id}" value="0" min="0" max="${Math.min(qtd, livres)}" step="1">
      </li>`;
  }).join("");
  const dados = await DialogV2.prompt({
    window: { title: `Carregar ${cfg.rotulo} — ${item.name}` },
    content: `<p>Quantas doses de cada item carregar? (${doses.length}/${cfg.max} carregadas, ${livres} livre${livres > 1 ? "s" : ""}; ${cfg.dicaCarregar})</p>
      <ul class="hayd-carga-lista">${linhas}</ul>`,
    ok: { label: "Carregar", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object }
  }).catch(() => null);
  if (!dados) return;

  const pedidos = candidatos
    .map(fonte => ({ fonte, qtd: Math.max(0, Math.floor(Number(dados[`q.${fonte.id}`]) || 0)) }))
    .filter(p => p.qtd > 0);
  const total = pedidos.reduce((t, p) => t + p.qtd, 0);
  if (!total) return;
  if (total > livres) {
    return ui.notifications.warn(`${cfg.rotulo}: só cabe${livres > 1 ? "m" : ""} mais ${livres} dose${livres > 1 ? "s" : ""}.`);
  }

  // Uma dose = um item com qtd 1, tirada do inventário.
  const cargas = [];
  const atualizar = [];
  const apagar = [];
  for (const { fonte, qtd } of pedidos) {
    const disponivel = Number(fonte.system?.qtd ?? 1) || 1;
    const usar = Math.min(qtd, disponivel);
    for (let n = 0; n < usar; n++) {
      const carga = fonte.toObject();
      carga.system.qtd = 1;
      delete carga._id;
      cargas.push(carga);
    }
    if (disponivel > usar) atualizar.push({ _id: fonte.id, "system.qtd": disponivel - usar });
    else apagar.push(fonte.id);
  }
  if (atualizar.length) await ator.updateEmbeddedDocuments("Item", atualizar);
  if (apagar.length) await ator.deleteEmbeddedDocuments("Item", apagar);
  await item.setFlag(MODULO, cfg.flag, [...doses, ...cargas]);

  await postar(ator, cartaoHTML({
    icone: "fa-solid fa-syringe",
    titulo: `${esc(ator.name)} carregou a ${cfg.rotulo} do(a) ${esc(item.name)} com:`,
    corpo: listaHTML(cargas.map(c => ({ img: c.img, nome: c.name }))),
    nota: `${doses.length + cargas.length}/${cfg.max} dose${cfg.max > 1 ? "s" : ""} carregada${cfg.max > 1 ? "s" : ""}.`
  }));
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

/** Usa uma dose pelo fluxo normal do sistema. Devolve true se foi usada. */
export async function usarDose(item, chave, indice) {
  if (_usandoDose) return false;
  const cfg = CONFIGS[chave];
  const ator = item.actor;
  if (!ator) return false;

  const doses = foundry.utils.deepClone(item.getFlag(MODULO, cfg.flag) ?? []);
  const dose = doses[indice];
  if (!dose) {
    ui.notifications.warn("Esta dose já foi usada.");
    return true;
  }

  _usandoDose = true;
  let temp = null;
  let usada = false;
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
      usada = true;
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
  return usada;
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
    const doses = item.getFlag(MODULO, "alquimicos") ?? [];
    if (doses.length < CONFIGS["injecao-alquimica"].max) {
      menuItems.push({
        name: "Injeção Alquímica: carregar",
        icon: '<i class="fa-solid fa-syringe"></i>',
        callback: () => carregarDose(item, "injecao-alquimica")
      });
    }
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

  // Conjuradora — arma (guardar magia / disparar a guardada)
  if (item.type === "arma" && especialLigado("conjuradora")) {
    const conj = registroAtivo(item, "conjuradora");
    if (conj) {
      const magia = dadosDoItem(item).estado[conj.reg.id]?.magia;
      menuItems.push({
        name: magia ? "Conjuradora: trocar magia guardada" : "Conjuradora: guardar magia",
        icon: '<i class="fa-solid fa-book-open"></i>',
        callback: () => carregarConjuradora(item, conj.reg.id)
      });
      if (magia) {
        menuItems.push({
          name: `Conjuradora: disparar ${magia.dados?.name ?? "magia"}`,
          icon: '<i class="fa-solid fa-wand-sparkles"></i>',
          callback: () => dispararConjuradora(item, conj.reg.id)
        });
      }
    }
  }
}
