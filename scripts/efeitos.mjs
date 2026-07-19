/**
 * t20-hayd-itens | efeitos.mjs
 * Motor: adiciona/remove melhorias, encantos e materiais em um item,
 * cria os Efeitos Ativos correspondentes e mantém o preço ajustado.
 *
 * Dados no item (flags[MODULO]):
 *   precoBase: number          — preço do item sem aprimoramentos
 *   melhorias: [{ id, key }]
 *   encantos:  [{ id, key }]
 *   materiais: [{ id, key, custo }]
 *   alquimicos: [itemData…]    — doses da Injeção Alquímica
 */

import {
  MODULO, obterEntrada, obterMateriais, montarEfeitosAE,
  precoMelhorias, precoEncantos, categoriaMaterialDoItem
} from "./catalogo.mjs";

/* ------------------------------------------------------------------ */
/* Leitura                                                            */
/* ------------------------------------------------------------------ */

export function dadosDoItem(item) {
  const f = item.flags?.[MODULO] ?? {};
  return {
    precoBase: f.precoBase ?? null,
    melhorias: f.melhorias ?? [],
    encantos: f.encantos ?? [],
    materiais: f.materiais ?? [],
    alquimicos: f.alquimicos ?? []
  };
}

/** É munição? (preços pela metade — LB p.178) */
export function ehMunicao(item) {
  return item.type === "consumivel" && item.system?.tipo === "ammo";
}

/* ------------------------------------------------------------------ */
/* Preço                                                              */
/* ------------------------------------------------------------------ */

/**
 * Quantidade de melhorias para a tabela de preço:
 * cada material especial também conta como uma melhoria (LB p.165).
 */
function qtdMelhorias(d) {
  return d.melhorias.length + d.materiais.length;
}

/** Quantidade de encantos para a tabela (entradas "dois" contam dobrado). */
function qtdEncantos(d) {
  return d.encantos.reduce((t, e) => {
    const def = obterEntrada(e.key);
    return t + (def?.dois ? 2 : 1);
  }, 0);
}

export function calcularPreco(item) {
  const d = dadosDoItem(item);
  const base = Number(d.precoBase ?? item.system?.preco ?? 0) || 0;
  const mult = ehMunicao(item) ? 0.5 : 1;
  const materiais = d.materiais.reduce((t, m) => t + (Number(m.custo) || 0), 0);
  const total = base
    + precoMelhorias(qtdMelhorias(d)) * mult
    + precoEncantos(qtdEncantos(d)) * mult
    + materiais * mult;
  return {
    base,
    melhorias: precoMelhorias(qtdMelhorias(d)) * mult,
    encantos: precoEncantos(qtdEncantos(d)) * mult,
    materiais: materiais * mult,
    total: Math.round(total * 100) / 100,
    nMelhorias: qtdMelhorias(d),
    nEncantos: qtdEncantos(d)
  };
}

async function atualizarPreco(item) {
  const d = dadosDoItem(item);
  if (d.precoBase === null) return; // ainda não gerenciado
  const { total } = calcularPreco(item);
  if (item.system?.preco !== total) {
    await item.update({ "system.preco": total }, { render: false });
  }
}

/** Define o preço base manualmente (campo da aba). */
export async function definirPrecoBase(item, valor) {
  await item.update({ [`flags.${MODULO}.precoBase`]: Math.max(0, Number(valor) || 0) }, { render: false });
  await atualizarPreco(item);
}

/** Garante que o preço base foi capturado antes da primeira adição. */
async function garantirPrecoBase(item) {
  const d = dadosDoItem(item);
  if (d.precoBase === null) {
    await item.update({ [`flags.${MODULO}.precoBase`]: Number(item.system?.preco ?? 0) || 0 }, { render: false });
  }
}

/* ------------------------------------------------------------------ */
/* Efeitos especiais                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ameaçadora: duplica a margem de ameaça. Calculada no momento da
 * aplicação a partir da margem atual da arma (ex.: 19 → 17; 18 → 15).
 */
function efeitoAmeacadora(item, entradaId) {
  const criticoM = Number(item.system?.criticoM) || 20;
  const margem = Math.max(1, 21 - criticoM);
  return [{
    name: "Ameaçadora",
    img: "icons/magic/symbols/runes-star-pentagon-blue.webp",
    description: `<p>Duplica a margem de ameaça (${criticoM}–20 → ${21 - margem * 2}–20).</p>`,
    changes: [{ key: "criticoM", value: String(-margem), mode: 2, priority: 0 }],
    disabled: false,
    transfer: false,
    flags: {
      tormenta20: { onuse: true, durationScene: false, upgrade: "hayd-ameacadora", self: true },
      [MODULO]: { entradaId, key: "ameacadora" }
    }
  }];
}

/**
 * Lancinante: usa a automação nativa do sistema. O sistema ativa a
 * multiplicação de bônus em críticos quando algum slot de
 * system.upgrades contém "lancinating" (respeitando a regra variante
 * configurada em tormenta20.lancinatingVersion).
 */
async function sincronizarLancinante(item) {
  if (!item.system?.upgrades) return;
  const d = dadosDoItem(item);
  const tem = d.encantos.some(e => e.key === "lancinante");
  const slots = item.system.upgrades;
  const slotComLanc = Object.entries(slots).find(([, v]) => v === "lancinating")?.[0];

  if (tem && !slotComLanc) {
    const livre = Object.entries(slots).find(([k, v]) => !v && k.startsWith("encanto"))?.[0]
      ?? Object.entries(slots).find(([, v]) => !v)?.[0];
    if (livre) await item.update({ [`system.upgrades.${livre}`]: "lancinating" }, { render: false });
    else ui.notifications.warn("Lancinante: nenhum slot interno livre para ativar a automação nativa.");
  } else if (!tem && slotComLanc) {
    await item.update({ [`system.upgrades.${slotComLanc}`]: "" }, { render: false });
  }
}

/* ------------------------------------------------------------------ */
/* Adicionar / remover entradas                                       */
/* ------------------------------------------------------------------ */

function checarPrereqs(item, def) {
  if (!def?.prereqs?.length) return null;
  const d = dadosDoItem(item);
  const possui = new Set([...d.melhorias, ...d.encantos].map(e => e.key));

  if (def.prereqs.includes("*")) {
    const total = d.melhorias.length + d.encantos.length + d.materiais.length;
    if (total === 0) return "Pré-requisito: possuir outra melhoria/encanto";
    return null;
  }
  const nomes = def.prereqs.map(k => obterEntrada(k)?.nome ?? k);
  if (def.prereqAlternativo) {
    if (!def.prereqs.some(k => possui.has(k))) return `Pré-requisito: ${nomes.join(" ou ")}`;
  } else {
    const faltam = def.prereqs.filter(k => !possui.has(k));
    if (faltam.length) return `Pré-requisito: ${faltam.map(k => obterEntrada(k)?.nome ?? k).join(", ")}`;
  }
  return null;
}

function checarConflitos(item, def) {
  if (!def?.conflita?.length) return null;
  const d = dadosDoItem(item);
  const possui = new Set([...d.melhorias, ...d.encantos].map(e => e.key));
  const conflito = def.conflita.find(k => possui.has(k));
  if (conflito) return `Conflita com: ${obterEntrada(conflito)?.nome ?? conflito}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Substituição (Atroz substitui Cruel, Magnífica substitui           */
/* Formidável, Guardião substitui Defensor… — bônus não acumulam)     */
/* ------------------------------------------------------------------ */

/**
 * Cria os efeitos de uma entrada (respeitando os casos especiais).
 * Efeitos com alvo "ator" (passivos, perícia, magia) são criados
 * diretamente no ator — a transferência nativa do sistema não acontece
 * para itens que já estão na ficha. Sem ator, ficam pendentes e são
 * criados pelo hook createItem quando o item entrar numa ficha.
 */
async function criarEfeitosDaEntrada(item, key, def, id, opcoes = {}) {
  let efeitos;
  if (def.especial === "ameacadora") efeitos = efeitoAmeacadora(item, id);
  else efeitos = montarEfeitosAE(key, def, id, item, opcoes);
  if (!efeitos.length) return;

  const doItem = efeitos.filter(e => e.flags?.[MODULO]?.alvo !== "ator");
  const doAtor = efeitos.filter(e => e.flags?.[MODULO]?.alvo === "ator");

  if (doItem.length) await item.createEmbeddedDocuments("ActiveEffect", doItem, { render: false });

  if (doAtor.length && item.actor) {
    for (const e of doAtor) {
      e.origin = item.uuid;
      e.flags[MODULO].itemId = item.id;
    }
    await item.actor.createEmbeddedDocuments("ActiveEffect", doAtor, { render: false });
  }
}

async function excluirEfeitosDaEntrada(item, id) {
  const noItem = [...item.effects].filter(e => e.flags?.[MODULO]?.entradaId === id);
  if (noItem.length) {
    await item.deleteEmbeddedDocuments("ActiveEffect", noItem.map(e => e.id), { render: false });
  }
  if (item.actor) {
    const noAtor = [...item.actor.effects].filter(e =>
      e.flags?.[MODULO]?.entradaId === id && e.flags?.[MODULO]?.itemId === item.id
    );
    if (noAtor.length) {
      await item.actor.deleteEmbeddedDocuments("ActiveEffect", noAtor.map(e => e.id), { render: false });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sincronização com o ator (item entra/sai da ficha)                 */
/* ------------------------------------------------------------------ */

/**
 * Recria no ator os efeitos "de ator" de todas as entradas do item.
 * Chamada quando um item gerenciado é adicionado a uma ficha.
 */
export async function sincronizarEfeitosAtor(item) {
  const ator = item.actor;
  if (!ator) return;

  // Limpa cópias antigas deste item (ids antigos de outra ficha)
  const antigos = [...ator.effects].filter(e => e.flags?.[MODULO]?.itemId === item.id);
  if (antigos.length) {
    await ator.deleteEmbeddedDocuments("ActiveEffect", antigos.map(e => e.id), { render: false });
  }

  const d = dadosDoItem(item);
  const novos = [];
  for (const e of [...d.melhorias, ...d.encantos, ...d.materiais]) {
    if (e.suprimidaPor) continue;
    const def = obterEntrada(e.key);
    if (!def) continue;
    const efeitos = montarEfeitosAE(e.key, def.tipo ? def : { ...def, tipo: "material" }, e.id, item, { pericia: e.pericia })
      .filter(x => x.flags?.[MODULO]?.alvo === "ator");
    for (const ef of efeitos) {
      ef.origin = item.uuid;
      ef.flags[MODULO].itemId = item.id;
      novos.push(ef);
    }
  }
  if (novos.length) await ator.createEmbeddedDocuments("ActiveEffect", novos, { render: false });
}

/** Remove do ator os efeitos originados de um item (item excluído/removido). */
export async function removerEfeitosAtorDoItem(ator, itemId) {
  const efeitos = [...ator.effects].filter(e => e.flags?.[MODULO]?.itemId === itemId);
  if (efeitos.length) {
    await ator.deleteEmbeddedDocuments("ActiveEffect", efeitos.map(e => e.id));
  }
}

/** Retorna a entrada já presente no item que substitui `key` (ou null). */
function quemSubstitui(item, key, ignorarId = null) {
  const d = dadosDoItem(item);
  for (const e of [...d.melhorias, ...d.encantos]) {
    if (e.id === ignorarId) continue;
    const def = obterEntrada(e.key);
    if (def?.substitui?.includes(key)) return e;
  }
  return null;
}

async function salvarLista(item, lista, valor) {
  await item.update({ [`flags.${MODULO}.${lista}`]: valor }, { render: false });
}

/**
 * Adiciona uma melhoria ou encanto ao item.
 * Pré-requisitos e conflitos geram apenas AVISO (o padrão pode ser
 * quebrado, conforme itens dos livros que fogem à regra).
 * Entradas que substituem o pré-requisito (Atroz→Cruel etc.) suprimem
 * os efeitos da entrada substituída, para os bônus não acumularem.
 */
export async function adicionarEntrada(item, key, opcoes = {}) {
  const def = obterEntrada(key);
  if (!def) return ui.notifications.error(`Entrada desconhecida: ${key}`);
  const lista = def.tipo === "melhoria" ? "melhorias" : "encantos";

  const avisoP = checarPrereqs(item, def);
  if (avisoP) ui.notifications.warn(`${def.nome}: ${avisoP} (adicionado mesmo assim).`);
  const avisoC = checarConflitos(item, def);
  if (avisoC) ui.notifications.warn(`${def.nome}: ${avisoC} (adicionado mesmo assim).`);

  await garantirPrecoBase(item);

  const id = foundry.utils.randomID(8);

  // Já existe algo que substitui esta entrada? (ex.: adicionar Cruel
  // com Atroz presente): entra suprimida, sem efeitos.
  const suprimidaPor = quemSubstitui(item, key);

  const registro = { id, key };
  if (opcoes.pericia) registro.pericia = opcoes.pericia;
  if (suprimidaPor) registro.suprimidaPor = suprimidaPor.id;

  const atual = foundry.utils.deepClone(item.getFlag(MODULO, lista) ?? []);
  atual.push(registro);
  await salvarLista(item, lista, atual);

  if (suprimidaPor) {
    const nomeSup = obterEntrada(suprimidaPor.key)?.nome ?? suprimidaPor.key;
    ui.notifications.info(`${def.nome}: bônus substituído por ${nomeSup} (não acumula).`);
  } else {
    await criarEfeitosDaEntrada(item, key, def, id, opcoes);
  }

  // Esta entrada substitui outras já presentes? Suprime os efeitos delas.
  if (def.substitui?.length) {
    for (const nomeLista of ["melhorias", "encantos"]) {
      const itens = foundry.utils.deepClone(item.getFlag(MODULO, nomeLista) ?? []);
      let mudou = false;
      for (const e of itens) {
        if (e.id === id || e.suprimidaPor) continue;
        if (!def.substitui.includes(e.key)) continue;
        await excluirEfeitosDaEntrada(item, e.id);
        e.suprimidaPor = id;
        mudou = true;
        const nomeAlvo = obterEntrada(e.key)?.nome ?? e.key;
        ui.notifications.info(`${def.nome} substitui ${nomeAlvo}: o bônus anterior foi suprimido (não acumula).`);
      }
      if (mudou) await salvarLista(item, nomeLista, itens);
    }
  }

  if (def.especial === "lancinante" || key === "lancinante") await sincronizarLancinante(item);
  await atualizarPreco(item);

  if (def.especial === "alquimica") {
    ui.notifications.info("Injeção Alquímica: clique com o botão direito na arma (na ficha do personagem) para carregar preparados.");
  }
  return id;
}

/** Adiciona um material especial (conta como melhoria para o preço). */
export async function adicionarMaterial(item, key, custoManual = null) {
  const def = obterMateriais()[key];
  if (!def) return ui.notifications.error(`Material desconhecido: ${key}`);

  await garantirPrecoBase(item);

  const catPreco = categoriaMaterialDoItem(item);
  let custo = custoManual !== null ? Number(custoManual) || 0 : (def.precos?.[catPreco] ?? 0);
  if (custoManual === null && !def.precos?.[catPreco] && !def.raro) {
    // Material sem preço para esta categoria (ex.: madeira tollon em armadura)
    ui.notifications.warn(`${def.nome}: sem preço tabelado para esta categoria de item — ajuste o custo manualmente.`);
  }

  const id = foundry.utils.randomID(8);
  const atual = foundry.utils.deepClone(item.getFlag(MODULO, "materiais") ?? []);
  atual.push({ id, key, custo });
  await item.update({ [`flags.${MODULO}.materiais`]: atual }, { render: false });

  const efeitos = montarEfeitosAE(key, { ...def, tipo: "material" }, id, item);
  if (efeitos.length) await item.createEmbeddedDocuments("ActiveEffect", efeitos, { render: false });

  await atualizarPreco(item);
  return id;
}

/** Remove uma entrada (melhoria/encanto/material) e seus efeitos. */
export async function removerEntrada(item, lista, id) {
  const atual = foundry.utils.deepClone(item.getFlag(MODULO, lista) ?? []);
  const entrada = atual.find(e => e.id === id);
  if (!entrada) return;

  await salvarLista(item, lista, atual.filter(e => e.id !== id));
  await excluirEfeitosDaEntrada(item, id);

  // Restaura entradas que estavam suprimidas por esta (ex.: remover
  // Atroz devolve o +1 de Cruel) — a menos que outra entrada presente
  // também as substitua.
  for (const nomeLista of ["melhorias", "encantos"]) {
    const itens = foundry.utils.deepClone(item.getFlag(MODULO, nomeLista) ?? []);
    let mudou = false;
    for (const e of itens) {
      if (e.suprimidaPor !== id) continue;
      const outro = quemSubstitui(item, e.key, e.id);
      if (outro) {
        e.suprimidaPor = outro.id;
      } else {
        delete e.suprimidaPor;
        const defRestaurada = obterEntrada(e.key);
        if (defRestaurada) await criarEfeitosDaEntrada(item, e.key, defRestaurada, e.id, { pericia: e.pericia });
        const nomeRest = defRestaurada?.nome ?? e.key;
        ui.notifications.info(`${nomeRest}: bônus restaurado.`);
      }
      mudou = true;
    }
    if (mudou) await salvarLista(item, nomeLista, itens);
  }

  if (entrada.key === "lancinante") await sincronizarLancinante(item);
  await atualizarPreco(item);
}

/** Atualiza o custo manual de um material. */
export async function atualizarCustoMaterial(item, id, custo) {
  const atual = foundry.utils.deepClone(item.getFlag(MODULO, "materiais") ?? []);
  const m = atual.find(e => e.id === id);
  if (!m) return;
  m.custo = Math.max(0, Number(custo) || 0);
  await item.update({ [`flags.${MODULO}.materiais`]: atual }, { render: false });
  await atualizarPreco(item);
}
