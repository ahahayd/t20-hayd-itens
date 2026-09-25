/**
 * t20-hayd-itens | efeitos.mjs
 * Motor: adiciona/remove melhorias, encantos e materiais em um item,
 * cria os Efeitos Ativos correspondentes e mantém o preço ajustado.
 *
 * Dados no item (flags[MODULO]):
 *   precoBase: number          — preço do item sem aprimoramentos
 *   melhorias: [{ id, key, pericia?, alvos?, desativada?, suprimidaPor? }]
 *   encantos:  [{ id, key, … }]
 *   materiais: [{ id, key, custo, variante?, desativada? }]
 *   alquimicos: [itemData…]    — doses da Injeção Alquímica
 *   injetora:   [itemData…]    — dose da Injetora (armadura)
 *   estado:     { [entradaId]: {…} } — estado das automações (bônus da
 *               Frenética, Piedosa ligada, Dançarina ativa, magia guardada
 *               na Conjuradora)
 *
 * `alvos` guarda os NOMES dos poderes/magias escolhidos na aba (é pelo
 * nome que o sistema restringe um efeito a certos itens). `desativada`
 * desliga só a automação da entrada: o preço e o registro continuam.
 */

import {
  MODULO, obterEntrada, obterMateriais, montarEfeitosAE,
  precoMelhorias, precoEncantos, varianteInicial, variantesDoMaterial, precoDaVariante
} from "./catalogo.mjs";
import { acharSugestao, temMarcadores } from "./regras.mjs";

export const LISTAS = ["melhorias", "encantos", "materiais"];
export const MAX_FRENETICA = 5;

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
    injetora: f.injetora ?? [],
    estado: f.estado ?? {}
  };
}

/** É munição? (preços pela metade — T20 p.178) */
export function ehMunicao(item) {
  return item.type === "consumivel" && item.system?.tipo === "ammo";
}

/** Localiza uma entrada do item pelo id: { lista, reg } ou null. */
export function registroPorId(item, id) {
  const d = dadosDoItem(item);
  for (const lista of LISTAS) {
    const reg = d[lista].find(e => e.id === id);
    if (reg) return { lista, reg };
  }
  return null;
}

/**
 * Primeira entrada do item com esta chave que está valendo (nem
 * desativada pelo usuário, nem substituída por outra): { lista, reg }.
 */
export function registroAtivo(item, key) {
  const d = dadosDoItem(item);
  for (const lista of LISTAS) {
    const reg = d[lista].find(e => e.key === key && !e.desativada && !e.suprimidaPor);
    if (reg) return { lista, reg };
  }
  return null;
}

/** Definição de uma entrada com o tipo certo (materiais do catálogo não trazem tipo). */
function defDoRegistro(lista, key) {
  const def = obterEntrada(key);
  if (!def) return null;
  return lista === "materiais" && !def.tipo ? { ...def, tipo: "material" } : def;
}

/** Escolhas do usuário para uma instância, no formato de montarEfeitosAE. */
export function opcoesDoRegistro(item, lista, reg, estado = null) {
  const opcoes = {
    pericia: reg.pericia,
    alvos: reg.alvos ?? [],
    estado: (estado ?? dadosDoItem(item).estado)[reg.id] ?? {}
  };
  if (lista === "materiais") opcoes.variante = reg.variante ?? varianteInicial(obterEntrada(reg.key), item);
  return opcoes;
}

/** Nomes dos itens do ator que podem ser escolhidos para uma entrada. */
export function nomesParaEscolha(ator, escolha) {
  if (!ator) return [];
  const tipos = escolha?.tipos ?? ["poder"];
  return [...new Set(ator.items.filter(i => tipos.includes(i.type)).map(i => i.name))];
}

/**
 * Preenche a escolha de uma entrada com o item sugerido pelo catálogo
 * (Conduíte → Abençoar Arma, Sombria → Escuridão, Assassina → Ataque
 * Furtivo…), se o ator o tiver e nada tiver sido escolhido. Altera o
 * registro em memória; devolve true se mudou.
 */
function sugerirAlvos(item, reg) {
  const def = obterEntrada(reg.key);
  const sugestao = def?.escolha?.sugestao;
  if (!sugestao || !item.actor || reg.alvos?.length) return false;
  const achado = acharSugestao(nomesParaEscolha(item.actor, def.escolha), sugestao);
  if (!achado) return false;
  reg.alvos = [achado];
  return true;
}

/** A entrada tem efeitos com {arma}/{ator} no nome? */
function temNomeDinamico(def) {
  return (def?.efeitos ?? []).some(ef => temMarcadores(ef.nome));
}

/* ------------------------------------------------------------------ */
/* Preço                                                              */
/* ------------------------------------------------------------------ */

/**
 * Quantidade de melhorias para a tabela de preço:
 * cada material especial também conta como uma melhoria (T20 p.165).
 * Entradas desativadas continuam contando — desativar não muda o preço.
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
 * Definição efetiva de uma entrada com estado: a Frenética ganha o efeito
 * do bônus acumulado; a Piedosa desligada não concede nada.
 */
function defEfetiva(def, opcoes) {
  const estado = opcoes.estado ?? {};
  if (def.especial === "piedosa" && estado.inativa) return { ...def, efeitos: [] };
  if (def.especial === "frenetica") {
    const bonus = Number(estado.bonus) || 0;
    if (bonus <= 0) return def;
    return {
      ...def,
      efeitos: [...(def.efeitos ?? []), {
        nome: `Frenética (+${bonus})`, nomeExato: true, suspenso: false,
        changes: [{ key: "ataque", value: String(bonus) }, { key: "dano", value: String(bonus) }],
        desc: `Bônus acumulado da Frenética: +${bonus} no ataque e no dano até o fim da cena`
      }]
    };
  }
  return def;
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
  const temLanc = d.encantos.some(e => e.key === "lancinante" && !e.desativada);
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
  const temLanc = d.encantos.some(e => e.key === "lancinante" && !e.desativada);
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
 * Efeitos com alvo "ator" (passivos, perícia, magia, poder) são criados
 * diretamente no ator — a transferência nativa do sistema não acontece
 * para itens que já estão na ficha. Sem ator, ficam pendentes e são
 * criados pelo hook createItem quando o item entrar numa ficha.
 */
function montarEfeitosDaEntrada(item, key, def, id, opcoes = {}) {
  const efeitos = def.especial === "ameacadora"
    ? efeitoAmeacadora(item, id)
    : montarEfeitosAE(key, defEfetiva(def, opcoes), id, item, opcoes);

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

/**
 * Refaz os efeitos (item e ator) de UMA entrada a partir do estado atual:
 * escolha de poder/magia, variante, estado da automação, ligada/desligada.
 * Também serve para "reaplicar" uma entrada com a definição atual do
 * catálogo (desligar e religar).
 */
export async function reconstruirEntrada(item, lista, id) {
  const d = dadosDoItem(item);
  const reg = d[lista]?.find(e => e.id === id);
  const { noItem, noAtor } = efeitosDasEntradas(item, [id]);

  let novos = { doItem: [], doAtor: [] };
  if (reg && !reg.desativada && !reg.suprimidaPor) {
    const def = defDoRegistro(lista, reg.key);
    if (def) novos = montarEfeitosDaEntrada(item, reg.key, def, id, opcoesDoRegistro(item, lista, reg, d.estado));
  }

  await aplicarEfeitos(item, {
    criarItem: novos.doItem, criarAtor: novos.doAtor,
    apagarItem: noItem, apagarAtor: noAtor
  });
}

/* ------------------------------------------------------------------ */
/* Sincronização com o ator (item entra/sai da ficha)                 */
/* ------------------------------------------------------------------ */

/**
 * Recria no ator os efeitos "de ator" de todas as entradas do item.
 * Chamada quando um item gerenciado é adicionado a uma ficha. Também
 * escolhe sozinha o poder/magia sugerido das entradas sem escolha e
 * refaz os efeitos do item cujo nome traz {arma}/{ator}.
 */
export async function sincronizarEfeitosAtor(item) {
  const ator = item.actor;
  if (!ator) return;

  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const mudou = new Set();
  for (const nome of ["melhorias", "encantos"]) {
    for (const reg of listas[nome]) if (sugerirAlvos(item, reg)) mudou.add(nome);
  }

  // Cópias antigas deste item (ids antigos de outra ficha)
  const apagarAtor = [...ator.effects]
    .filter(e => e.flags?.[MODULO]?.itemId === item.id)
    .map(e => e.id);

  const criarAtor = [];
  const criarItem = [];
  const apagarItem = [];
  for (const lista of LISTAS) {
    for (const reg of listas[lista]) {
      if (reg.desativada || reg.suprimidaPor) continue;
      const def = defDoRegistro(lista, reg.key);
      if (!def) continue;
      const efs = montarEfeitosDaEntrada(item, reg.key, def, reg.id, opcoesDoRegistro(item, lista, reg, d.estado));
      criarAtor.push(...efs.doAtor);
      // Nomes com {arma}/{ator} (Cantante…) mudam junto com o dono.
      if (temNomeDinamico(def)) {
        apagarItem.push(...[...item.effects].filter(e => e.flags?.[MODULO]?.entradaId === reg.id).map(e => e.id));
        criarItem.push(...efs.doItem);
      }
    }
  }

  // Reafirma o marcador nativo do Lancinante (itens copiados/arrastados
  // podem chegar com as flags do módulo mas sem o marcador em upgrades)
  // no mesmo update das escolhas sugeridas.
  const patch = {};
  for (const nome of mudou) patch[`flags.${MODULO}.${nome}`] = listas[nome];
  Object.assign(patch, marcadorLancinante(item, { ...d, ...listas }) ?? {});

  await Promise.all([
    Object.keys(patch).length ? item.update(patch, { render: false }) : null,
    aplicarEfeitos(item, { apagarAtor, criarAtor, apagarItem, criarItem })
  ].filter(Boolean));

  avisarLancinante(d);
}

/** O item foi renomeado: refaz os efeitos cujo nome inclui o nome da arma. */
export async function atualizarNomesDinamicos(item) {
  const d = dadosDoItem(item);
  for (const lista of LISTAS) {
    for (const reg of d[lista]) {
      if (reg.desativada || reg.suprimidaPor) continue;
      if (temNomeDinamico(obterEntrada(reg.key))) await reconstruirEntrada(item, lista, reg.id);
    }
  }
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
  sugerirAlvos(item, registro);
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
        ui.notifications.info(`${def.nome} substitui ${nomeAlvo}: os bônus não acumulam.`);
      }
    }
  }

  if (suprimidaPor) {
    const nomeSup = obterEntrada(suprimidaPor.key)?.nome ?? suprimidaPor.key;
    ui.notifications.info(`${def.nome}: substituído por ${nomeSup}, os bônus não acumulam.`);
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
    : montarEfeitosDaEntrada(item, key, def, id, opcoesDoRegistro(item, lista, registro, d.estado));
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
    ui.notifications.info("Injeção Alquímica: carregue preparados na aba Melhorias & Encantos ou com clique direito na arma.");
  }
  if (def.escolha && !registro.alvos?.length && !suprimidaPor) {
    ui.notifications.info(`${def.nome}: escolha na aba Melhorias & Encantos qual ${(def.escolha.rotulo ?? "poder ou magia").toLowerCase()} recebe o efeito.`);
  }
  return id;
}

/** Adiciona um material especial (conta como melhoria para o preço). */
export async function adicionarMaterial(item, key, custoManual = null) {
  const def = obterMateriais()[key];
  if (!def) return ui.notifications.error(`Material desconhecido: ${key}`);

  const variante = varianteInicial(def, item);
  const custo = custoManual !== null ? Number(custoManual) || 0 : precoDaVariante(def, variante);
  if (custoManual === null && !custo && !def.raro) {
    // Material sem preço para esta categoria (ex.: madeira tollon em armadura)
    ui.notifications.warn(`${def.nome}: sem preço tabelado para esta categoria de item — ajuste o custo manualmente.`);
  }

  const d = dadosDoItem(item);
  const id = foundry.utils.randomID(8);
  const materiais = [...foundry.utils.deepClone(d.materiais), { id, key, custo, variante }];
  const dNovo = { ...d, materiais, precoBase: d.precoBase ?? precoBaseInicial(item) };

  const payload = { [`flags.${MODULO}.materiais`]: materiais };
  if (d.precoBase === null) payload[`flags.${MODULO}.precoBase`] = dNovo.precoBase;
  Object.assign(payload, precoAtualizado(item, dNovo) ?? {});

  const { doItem, doAtor } = montarEfeitosDaEntrada(item, key, { ...def, tipo: "material" }, id, { variante, estado: {} });

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
      if (defRestaurada && !e.desativada) {
        const efs = montarEfeitosDaEntrada(item, e.key, defRestaurada, e.id, opcoesDoRegistro(item, nomeLista, e, d.estado));
        criarItem.push(...efs.doItem);
        criarAtor.push(...efs.doAtor);
      }
      ui.notifications.info(`${defRestaurada?.nome ?? e.key}: bônus restaurado.`);
    }
  }

  const dNovo = { ...d, ...listas };
  const payload = {};
  for (const nomeLista of mudou) payload[`flags.${MODULO}.${nomeLista}`] = listas[nomeLista];
  if (d.estado[id]) payload[`flags.${MODULO}.estado.-=${id}`] = null;
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

/* ------------------------------------------------------------------ */
/* Ajustes por entrada (aba)                                          */
/* ------------------------------------------------------------------ */

/**
 * Liga/desliga a automação de uma entrada. Desligada, ela não cria
 * efeitos nem dispara automações — mas continua no item e no preço.
 */
export async function alternarEntrada(item, lista, id) {
  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const reg = listas[lista]?.find(e => e.id === id);
  if (!reg) return;
  if (reg.desativada) delete reg.desativada;
  else reg.desativada = true;

  const payload = {
    [`flags.${MODULO}.${lista}`]: listas[lista],
    ...(marcadorLancinante(item, { ...d, ...listas }) ?? {})
  };
  await item.update(payload, { render: false });
  await reconstruirEntrada(item, lista, id);
}

/** Define os poderes/magias escolhidos para uma entrada (pelos nomes). */
export async function definirAlvos(item, lista, id, alvos) {
  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const reg = listas[lista]?.find(e => e.id === id);
  if (!reg) return;
  reg.alvos = [...new Set((alvos ?? []).filter(Boolean))];
  await item.update({ [`flags.${MODULO}.${lista}`]: listas[lista] }, { render: false });
  await reconstruirEntrada(item, lista, id);
}

/**
 * Um poder/magia do ator foi renomeado: as entradas que o escolheram guardam
 * o NOME (é assim que o sistema restringe o efeito a certos itens), então o
 * vínculo se perderia calado. Percorre os itens gerenciados do ator trocando
 * o nome antigo pelo novo e refaz os efeitos das entradas mexidas.
 *
 * Devolve os nomes dos itens corrigidos, para avisar quem renomeou.
 */
export async function renomearAlvos(ator, antigo, novo) {
  if (!ator?.items || !antigo || !novo || antigo === novo) return [];
  const corrigidos = [];

  for (const item of ator.items) {
    if (!item.flags?.[MODULO]) continue;
    const listas = clonarListas(dadosDoItem(item));
    const mexidas = [];
    for (const lista of LISTAS) {
      for (const reg of listas[lista] ?? []) {
        if (!reg.alvos?.includes(antigo)) continue;
        reg.alvos = [...new Set(reg.alvos.map(nome => (nome === antigo ? novo : nome)))];
        mexidas.push({ lista, id: reg.id });
      }
    }
    if (!mexidas.length) continue;

    const payload = {};
    for (const { lista } of mexidas) payload[`flags.${MODULO}.${lista}`] = listas[lista];
    await item.update(payload, { render: false });
    for (const { lista, id } of mexidas) await reconstruirEntrada(item, lista, id);
    corrigidos.push(item.name);
  }
  return corrigidos;
}

/** Troca a variante de um material (arma, armadura leve…) e o preço tabelado. */
export async function definirVariante(item, id, variante) {
  const d = dadosDoItem(item);
  const listas = clonarListas(d);
  const reg = listas.materiais.find(e => e.id === id);
  if (!reg) return;
  const def = obterEntrada(reg.key);
  if (!variantesDoMaterial(def).includes(variante)) return;
  reg.variante = variante;
  const preco = precoDaVariante(def, variante);
  if (preco) reg.custo = preco;

  await item.update({
    [`flags.${MODULO}.materiais`]: listas.materiais,
    ...(precoAtualizado(item, { ...d, ...listas }) ?? {})
  }, { render: false });
  await reconstruirEntrada(item, "materiais", id);
}

/**
 * Grava o estado da automação de uma entrada (mescla com o atual) e,
 * por padrão, refaz os efeitos dela.
 */
export async function definirEstado(item, id, patch, { reconstruir = true } = {}) {
  const atual = dadosDoItem(item).estado[id] ?? {};
  await item.update({ [`flags.${MODULO}.estado.${id}`]: { ...atual, ...patch } }, { render: false });
  if (!reconstruir) return;
  const achado = registroPorId(item, id);
  if (achado) await reconstruirEntrada(item, achado.lista, id);
}

/** Apaga um campo do estado de uma entrada (ex.: a magia da Conjuradora). */
export async function apagarCampoDeEstado(item, id, campo) {
  await item.update({ [`flags.${MODULO}.estado.${id}.-=${campo}`]: null }, { render: false });
}
