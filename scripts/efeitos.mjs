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
 *   injetora:   [itemData…]    — dose da Injetora (armadura)
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
    alquimicos: f.alquimicos ?? [],
    injetora: f.injetora ?? []
  };
}

/** É munição? (preços pela metade — T20 p.178) */
export function ehMunicao(item) {
  return item.type === "consumivel" && item.system?.tipo === "ammo";
}

/* ------------------------------------------------------------------ */
/* Preço                                                              */
/* ------------------------------------------------------------------ */

/**
 * Quantidade de melhorias para a tabela de preço:
 * cada material especial também conta como uma melhoria (T20 p.165).
 */
function qtdMelhorias(d) {
  return d.melhorias.length + d.materiais.length;
}

/** Quantidade de encantos para a tabela de preço (cada um conta como 1). */
function qtdEncantos(d) {
  return d.encantos.length;
}

/**
 * Preço a partir de um instantâneo de dados, sem reler o item. Permite
 * calcular o preço do estado FUTURO e gravá-lo no mesmo update que as
 * flags, em vez de precisar de uma segunda ida ao banco.
 */
export function calcularPrecoDados(item, d) {
  const base = Number(d.precoBase ?? item.system?.preco ?? 0) || 0;
  const mult = ehMunicao(item) ? 0.5 : 1;
  const nMelhorias = qtdMelhorias(d);
  const nEncantos = qtdEncantos(d);
  const materiais = d.materiais.reduce((t, m) => t + (Number(m.custo) || 0), 0) * mult;
  const melhorias = precoMelhorias(nMelhorias) * mult;
  const encantos = precoEncantos(nEncantos) * mult;
  return {
    base,
    melhorias,
    encantos,
    materiais,
    total: Math.round((base + melhorias + encantos + materiais) * 100) / 100,
    nMelhorias,
    nEncantos
  };
}

export function calcularPreco(item) {
  return calcularPrecoDados(item, dadosDoItem(item));
}

/**
 * Fragmento de update com o preço recalculado — ou null, se o item ainda
 * não é gerenciado ou o preço não mudou.
 */
function precoAtualizado(item, d) {
  if (d.precoBase === null || d.precoBase === undefined) return null; // ainda não gerenciado
  const { total } = calcularPrecoDados(item, d);
  if (item.system?.preco === total) return null;
  return { "system.preco": total };
}

/** Preço base a capturar na primeira adição (o preço atual do item). */
function precoBaseInicial(item) {
  return Number(item.system?.preco ?? 0) || 0;
}

/** Define o preço base manualmente (campo da aba). */
export async function definirPrecoBase(item, valor) {
  const precoBase = Math.max(0, Number(valor) || 0);
  const d = { ...dadosDoItem(item), precoBase };
  await item.update({
    [`flags.${MODULO}.precoBase`]: precoBase,
    ...(precoAtualizado(item, d) ?? {})
  }, { render: false });
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
    origin: item.uuid,
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
 * Lancinante: usa a automação nativa do sistema. Em rollDamage o sistema
 * faz `lancinante = Object.values(item.system.upgrades).includes("lancinating")`
 * e, no crítico, multiplica o dano conforme a regra variante configurada
 * em tormenta20.lancinatingVersion:
 *   - "revised": multiplica só os termos com flavor "danoCritico"
 *     (o +10 do Dilacerante → +30 em x3, +40 em x4…);
 *   - "default": multiplica todos os bônus numéricos da rolagem.
 *
 * Como o módulo remove a aba nativa, usamos system.upgrades apenas como
 * marcador. O slot "material" é dedicado a esse marcador para não colidir
 * com nada visível ao usuário. Idempotente e re-aplicável.
 */
/**
 * Fragmento de update que acerta o marcador nativo — ou null, se já está
 * correto. Separado da escrita para poder viajar junto do update das flags.
 */
function marcadorLancinante(item, d) {
  const slots = item.system?.upgrades;
  if (!slots) return null;
  const temLanc = d.encantos.some(e => e.key === "lancinante");
  const jaMarcado = Object.values(slots).includes("lancinating");
  if (temLanc === jaMarcado) return null;

  if (temLanc) {
    // Prefere um slot vazio; senão, usa "material" como marcador dedicado.
    const livre = Object.entries(slots).find(([k, v]) => !v && k.startsWith("encanto"))?.[0]
      ?? Object.entries(slots).find(([k, v]) => !v && k !== "material")?.[0]
      ?? "material";
    return { [`system.upgrades.${livre}`]: "lancinating" };
  }
  const slot = Object.entries(slots).find(([, v]) => v === "lancinating")[0];
  return { [`system.upgrades.${slot}`]: "" };
}

/** Avisa se o Lancinante está sem o Dilacerante que ele multiplica. */
function avisarLancinante(d) {
  const temLanc = d.encantos.some(e => e.key === "lancinante");
  const temDilac = d.encantos.some(e => e.key === "dilacerante");
  if (temLanc && !temDilac) {
    ui.notifications.warn("Lancinante requer o encanto Dilacerante na arma — sem ele, não há +10 de crítico para multiplicar.");
  }
}

export async function sincronizarLancinante(item) {
  if (!item.system?.upgrades) return;
  const d = dadosDoItem(item);
  const patch = marcadorLancinante(item, d);
  if (patch) await item.update(patch, { render: false });
  avisarLancinante(d);
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
function montarEfeitosDaEntrada(item, key, def, id, opcoes = {}) {
  const efeitos = def.especial === "ameacadora"
    ? efeitoAmeacadora(item, id)
    : montarEfeitosAE(key, def, id, item, opcoes);

  const doItem = [];
  const doAtor = [];
  for (const e of efeitos) {
    if (e.flags?.[MODULO]?.alvo !== "ator") { doItem.push(e); continue; }
    // Sem ator, efeitos de ator ficam pendentes — o hook createItem os cria
    // quando o item entrar numa ficha.
    if (!item.actor) continue;
    e.origin = item.uuid;
    e.flags[MODULO].itemId = item.id;
    doAtor.push(e);
  }
  return { doItem, doAtor };
}

/** Ids dos efeitos (no item e no ator) originados por certas entradas. */
function efeitosDasEntradas(item, ids) {
  const alvo = new Set(ids);
  const noItem = [...item.effects]
    .filter(e => alvo.has(e.flags?.[MODULO]?.entradaId))
    .map(e => e.id);
  const noAtor = item.actor
    ? [...item.actor.effects]
      .filter(e => alvo.has(e.flags?.[MODULO]?.entradaId) && e.flags?.[MODULO]?.itemId === item.id)
      .map(e => e.id)
    : [];
  return { noItem, noAtor };
}

/**
 * Executa todas as operações de Efeito Ativo de uma ação em UMA ida ao
 * banco por coleção, com item e ator em paralelo — antes cada criação e
 * cada exclusão era um await sequencial (cada uma custa um round-trip de
 * socket), o que dominava o atraso ao adicionar uma melhoria.
 */
async function aplicarEfeitos(item, { criarItem = [], apagarItem = [], criarAtor = [], apagarAtor = [] } = {}) {
  const ator = item.actor;
  const mexeNoAtor = !!ator && (criarAtor.length > 0 || apagarAtor.length > 0);
  const tarefas = [];

  if (apagarItem.length || criarItem.length) {
    tarefas.push((async () => {
      if (apagarItem.length) await item.deleteEmbeddedDocuments("ActiveEffect", apagarItem, { render: false });
      if (criarItem.length) await item.createEmbeddedDocuments("ActiveEffect", criarItem, { render: false });
    })());
  }
  if (mexeNoAtor) {
    tarefas.push((async () => {
      if (apagarAtor.length) await ator.deleteEmbeddedDocuments("ActiveEffect", apagarAtor, { render: false });
      if (criarAtor.length) await ator.createEmbeddedDocuments("ActiveEffect", criarAtor, { render: false });
    })());
  }
  if (!tarefas.length) return;

  await Promise.all(tarefas);

  // Uma única re-preparação/re-render do ator no fim, em vez de uma por
  // operação: os dados derivados (Defesa, RD…) voltam atualizados sem
  // precisar desequipar/reequipar o item.
  if (mexeNoAtor) refrescarAtor(ator);
}

/** Força o ator a recalcular os dados derivados e re-renderizar a ficha. */
function refrescarAtor(ator) {
  try {
    ator.reset();
    ator.render(false);
  } catch (_e) { /* ficha fechada */ }
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

  // Cópias antigas deste item (ids antigos de outra ficha)
  const antigos = [...ator.effects]
    .filter(e => e.flags?.[MODULO]?.itemId === item.id)
    .map(e => e.id);

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

  // Reafirma o marcador nativo do Lancinante (itens copiados/arrastados
  // podem chegar com as flags do módulo mas sem o marcador em upgrades)
  // no mesmo update — sem uma segunda ida ao banco.
  const patch = marcadorLancinante(item, d);

  await Promise.all([
    patch ? item.update(patch, { render: false }) : null,
    aplicarEfeitos(item, { apagarAtor: antigos, criarAtor: novos })
  ].filter(Boolean));

  avisarLancinante(d);
}

/** Remove do ator os efeitos originados de um item (item excluído/removido). */
export async function removerEfeitosAtorDoItem(ator, itemId) {
  const efeitos = [...ator.effects].filter(e => e.flags?.[MODULO]?.itemId === itemId);
  if (efeitos.length) {
    await ator.deleteEmbeddedDocuments("ActiveEffect", efeitos.map(e => e.id));
  }
}

/** Retorna a entrada da lista dada que substitui `key` (ou null). */
function quemSubstituiEm(entradas, key, ignorarId = null) {
  for (const e of entradas) {
    if (e.id === ignorarId) continue;
    if (obterEntrada(e.key)?.substitui?.includes(key)) return e;
  }
  return null;
}

/** Cópia editável das listas de entradas do item. */
function clonarListas(d) {
  return {
    melhorias: foundry.utils.deepClone(d.melhorias),
    encantos: foundry.utils.deepClone(d.encantos),
    materiais: foundry.utils.deepClone(d.materiais)
  };
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

  /* Todo o novo estado é calculado em memória e gravado de uma vez só:
   * antes eram até seis item.update()/create() encadeados, cada um com
   * seu round-trip — a origem do travamento ao adicionar melhorias. */
  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const mudou = new Set([lista]);

  const id = foundry.utils.randomID(8);

  // Já existe algo que substitui esta entrada? (ex.: adicionar Cruel
  // com Atroz presente): entra suprimida, sem efeitos.
  const suprimidaPor = quemSubstituiEm([...listas.melhorias, ...listas.encantos], key);

  const registro = { id, key };
  if (opcoes.pericia) registro.pericia = opcoes.pericia;
  if (suprimidaPor) registro.suprimidaPor = suprimidaPor.id;
  listas[lista].push(registro);

  // Esta entrada substitui outras já presentes? Suprime os efeitos delas.
  const idsSuprimidos = [];
  if (def.substitui?.length) {
    for (const nomeLista of ["melhorias", "encantos"]) {
      for (const e of listas[nomeLista]) {
        if (e.id === id || e.suprimidaPor) continue;
        if (!def.substitui.includes(e.key)) continue;
        e.suprimidaPor = id;
        idsSuprimidos.push(e.id);
        mudou.add(nomeLista);
        const nomeAlvo = obterEntrada(e.key)?.nome ?? e.key;
        ui.notifications.info(`${def.nome} substitui ${nomeAlvo}: o bônus anterior foi suprimido (não acumula).`);
      }
    }
  }

  if (suprimidaPor) {
    const nomeSup = obterEntrada(suprimidaPor.key)?.nome ?? suprimidaPor.key;
    ui.notifications.info(`${def.nome}: bônus substituído por ${nomeSup} (não acumula).`);
  }

  // Estado futuro do item — inclui o preço base capturado na 1ª adição.
  const dNovo = { ...d, ...listas, precoBase: d.precoBase ?? precoBaseInicial(item) };

  const payload = {};
  for (const nomeLista of mudou) payload[`flags.${MODULO}.${nomeLista}`] = listas[nomeLista];
  if (d.precoBase === null) payload[`flags.${MODULO}.precoBase`] = dNovo.precoBase;
  Object.assign(payload, precoAtualizado(item, dNovo) ?? {});
  Object.assign(payload, marcadorLancinante(item, dNovo) ?? {});

  const novos = suprimidaPor
    ? { doItem: [], doAtor: [] }
    : montarEfeitosDaEntrada(item, key, def, id, opcoes);
  const antigos = idsSuprimidos.length
    ? efeitosDasEntradas(item, idsSuprimidos)
    : { noItem: [], noAtor: [] };

  await item.update(payload, { render: false });
  await aplicarEfeitos(item, {
    criarItem: novos.doItem, criarAtor: novos.doAtor,
    apagarItem: antigos.noItem, apagarAtor: antigos.noAtor
  });

  // Aviso só ao adicionar o próprio Lancinante — não a cada melhoria.
  if (key === "lancinante" || def.especial === "lancinante") avisarLancinante(dNovo);

  if (def.especial === "alquimica") {
    ui.notifications.info("Injeção Alquímica: clique com o botão direito na arma (na ficha do personagem) para carregar preparados.");
  }
  return id;
}

/** Adiciona um material especial (conta como melhoria para o preço). */
export async function adicionarMaterial(item, key, custoManual = null) {
  const def = obterMateriais()[key];
  if (!def) return ui.notifications.error(`Material desconhecido: ${key}`);

  const catPreco = categoriaMaterialDoItem(item);
  const custo = custoManual !== null ? Number(custoManual) || 0 : (def.precos?.[catPreco] ?? 0);
  if (custoManual === null && !def.precos?.[catPreco] && !def.raro) {
    // Material sem preço para esta categoria (ex.: madeira tollon em armadura)
    ui.notifications.warn(`${def.nome}: sem preço tabelado para esta categoria de item — ajuste o custo manualmente.`);
  }

  const d = dadosDoItem(item);
  const id = foundry.utils.randomID(8);
  const materiais = [...foundry.utils.deepClone(d.materiais), { id, key, custo }];
  const dNovo = { ...d, materiais, precoBase: d.precoBase ?? precoBaseInicial(item) };

  const payload = { [`flags.${MODULO}.materiais`]: materiais };
  if (d.precoBase === null) payload[`flags.${MODULO}.precoBase`] = dNovo.precoBase;
  Object.assign(payload, precoAtualizado(item, dNovo) ?? {});

  const { doItem, doAtor } = montarEfeitosDaEntrada(item, key, { ...def, tipo: "material" }, id);

  await item.update(payload, { render: false });
  await aplicarEfeitos(item, { criarItem: doItem, criarAtor: doAtor });
  return id;
}

/** Remove uma entrada (melhoria/encanto/material) e seus efeitos. */
export async function removerEntrada(item, lista, id) {
  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const entrada = listas[lista]?.find(e => e.id === id);
  if (!entrada) return;

  listas[lista] = listas[lista].filter(e => e.id !== id);
  const mudou = new Set([lista]);

  // Restaura entradas que estavam suprimidas por esta (ex.: remover
  // Atroz devolve o +1 de Cruel) — a menos que outra entrada presente
  // também as substitua.
  const criarItem = [];
  const criarAtor = [];
  for (const nomeLista of ["melhorias", "encantos"]) {
    for (const e of listas[nomeLista]) {
      if (e.suprimidaPor !== id) continue;
      mudou.add(nomeLista);
      const outro = quemSubstituiEm([...listas.melhorias, ...listas.encantos], e.key, e.id);
      if (outro) {
        e.suprimidaPor = outro.id;
        continue;
      }
      delete e.suprimidaPor;
      const defRestaurada = obterEntrada(e.key);
      if (defRestaurada) {
        const efs = montarEfeitosDaEntrada(item, e.key, defRestaurada, e.id, { pericia: e.pericia });
        criarItem.push(...efs.doItem);
        criarAtor.push(...efs.doAtor);
      }
      ui.notifications.info(`${defRestaurada?.nome ?? e.key}: bônus restaurado.`);
    }
  }

  const dNovo = { ...d, ...listas };
  const payload = {};
  for (const nomeLista of mudou) payload[`flags.${MODULO}.${nomeLista}`] = listas[nomeLista];
  Object.assign(payload, precoAtualizado(item, dNovo) ?? {});
  Object.assign(payload, marcadorLancinante(item, dNovo) ?? {});

  const { noItem, noAtor } = efeitosDasEntradas(item, [id]);

  await item.update(payload, { render: false });
  await aplicarEfeitos(item, { criarItem, criarAtor, apagarItem: noItem, apagarAtor: noAtor });
}

/** Atualiza o custo manual de um material. */
export async function atualizarCustoMaterial(item, id, custo) {
  const d = dadosDoItem(item);
  const materiais = foundry.utils.deepClone(d.materiais);
  const m = materiais.find(e => e.id === id);
  if (!m) return;
  m.custo = Math.max(0, Number(custo) || 0);
  const dNovo = { ...d, materiais };
  await item.update({
    [`flags.${MODULO}.materiais`]: materiais,
    ...(precoAtualizado(item, dNovo) ?? {})
  }, { render: false });
}
