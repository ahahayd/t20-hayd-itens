/**
 * t20-hayd-itens | alquimica.mjs
 * Automação da melhoria Injeção Alquímica (LB p.165):
 *  - Clique direito na arma (ficha do personagem) → carregar preparados
 *    do inventário (o item sai do inventário e fica armazenado na arma).
 *  - Ao atacar, o cartão da arma no chat oferece um botão para injetar:
 *    o preparado é usado com a caixa de diálogo de rolagem do sistema
 *    (permitindo escolher poderes/aprimoramentos) e a dose é consumida.
 */

import { MODULO } from "./catalogo.mjs";
import { dadosDoItem } from "./efeitos.mjs";

const MAX_DOSES = 2;
const { DialogV2 } = foundry.applications.api;

function temInjecao(item) {
  return (item.getFlag(MODULO, "melhorias") ?? []).some(m => m.key === "injecao-alquimica");
}

/* ------------------------------------------------------------------ */
/* Carregar / descarregar                                             */
/* ------------------------------------------------------------------ */

export async function carregarAlquimico(arma) {
  const ator = arma.actor;
  if (!ator) return;

  const doses = arma.getFlag(MODULO, "alquimicos") ?? [];
  if (doses.length >= MAX_DOSES) {
    return ui.notifications.warn(`Injeção Alquímica: capacidade máxima de ${MAX_DOSES} doses.`);
  }

  const candidatos = ator.items.filter(i =>
    i.type === "consumivel" && ["alchemy", "potion"].includes(i.system?.tipo) && i.id !== arma.id
  );
  if (!candidatos.length) {
    return ui.notifications.warn("Nenhum preparado alquímico (consumível) encontrado no inventário.");
  }

  const opcoes = candidatos
    .map(i => `<option value="${i.id}">${i.name} (${i.system?.qtd ?? 1}x)</option>`)
    .join("");
  const dados = await DialogV2.prompt({
    window: { title: `Carregar Injeção Alquímica — ${arma.name}` },
    content: `<p>Escolha o preparado a carregar (${doses.length}/${MAX_DOSES} doses; carregar exige ação completa):</p>
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

  await arma.setFlag(MODULO, "alquimicos", [...doses, carga]);
  ui.notifications.info(`${carga.name} carregado em ${arma.name} (${doses.length + 1}/${MAX_DOSES}).`);
}

export async function descarregarAlquimico(arma, indice) {
  const ator = arma.actor;
  const doses = foundry.utils.deepClone(arma.getFlag(MODULO, "alquimicos") ?? []);
  const dose = doses[indice];
  if (!dose) return;

  doses.splice(indice, 1);
  await arma.setFlag(MODULO, "alquimicos", doses);

  if (ator) {
    const existente = ator.items.find(i => i.name === dose.name && i.type === "consumivel");
    if (existente) await existente.update({ "system.qtd": (Number(existente.system?.qtd) || 1) + 1 });
    else await ator.createEmbeddedDocuments("Item", [dose]);
    ui.notifications.info(`${dose.name} devolvido ao inventário.`);
  }
}

/* ------------------------------------------------------------------ */
/* Menu de contexto do item na ficha                                  */
/* ------------------------------------------------------------------ */

export function opcoesMenuContexto(item, menuItems) {
  if (item.type !== "arma" || !item.actor) return;
  if (!temInjecao(item)) return;

  menuItems.push({
    name: "Injeção Alquímica: carregar",
    icon: '<i class="fa-solid fa-syringe"></i>',
    callback: () => carregarAlquimico(item)
  });

  const doses = item.getFlag(MODULO, "alquimicos") ?? [];
  if (doses.length) {
    menuItems.push({
      name: `Injeção Alquímica: descarregar (${doses.length})`,
      icon: '<i class="fa-solid fa-rotate-left"></i>',
      callback: () => descarregarAlquimico(item, 0)
    });
  }
}

/* ------------------------------------------------------------------ */
/* Botão no cartão de chat da arma                                    */
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
  if (!temInjecao(arma)) return;
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
      injetar(arma, Number(ev.currentTarget.dataset.indice));
    });
    rodape.appendChild(btn);
  }
  card.appendChild(rodape);
}

let _injetando = false;

async function injetar(arma, indice) {
  if (_injetando) return;
  const ator = arma.actor;
  if (!ator) return;

  const doses = foundry.utils.deepClone(arma.getFlag(MODULO, "alquimicos") ?? []);
  const dose = doses[indice];
  if (!dose) return ui.notifications.warn("Esta dose já foi usada.");

  _injetando = true;
  let temp = null;
  try {
    // Cria o item temporário no ator e usa o fluxo normal do sistema,
    // com a caixa de diálogo de uso (bônus, poderes, aprimoramentos).
    const dadosTemp = foundry.utils.deepClone(dose);
    dadosTemp.name = `${dose.name} (injeção)`;
    foundry.utils.setProperty(dadosTemp, `flags.${MODULO}.doseTemporaria`, true);
    [temp] = await ator.createEmbeddedDocuments("Item", [dadosTemp]);

    const resultado = await temp.roll();

    if (resultado !== undefined && resultado !== null) {
      // Uso confirmado: consome a dose da arma
      doses.splice(indice, 1);
      await arma.setFlag(MODULO, "alquimicos", doses);
    }
  } catch (err) {
    console.error(`${MODULO} | Falha ao injetar preparado`, err);
  } finally {
    if (temp) {
      const aindaExiste = ator.items.get(temp.id);
      if (aindaExiste) await aindaExiste.delete();
    }
    _injetando = false;
  }
}
