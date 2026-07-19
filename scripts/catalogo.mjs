/**
 * t20-hayd-itens | catalogo.mjs
 * Catálogo completo de Melhorias, Encantos e Materiais Especiais do
 * Tormenta20 — Livro Básico (LB), Ameaças de Arton (AA), Heróis de
 * Arton (HA) e Deuses de Arton (DA).
 *
 * Formato dos efeitos (shorthand → ActiveEffect via montarEfeitosAE):
 *   { changes: [{key, value, mode?}] }       → efeito de uso (onuse+self)
 *   { ..., custo: "2" }                      → efeito de uso com custo em PM
 *   { ..., passivo: true }                   → efeito passivo (transfer)
 *   { ..., skill: true }                     → efeito de perícia (padrão "balanced")
 *   { ..., condicao: "enredado" }            → vira change { key: "condicao",
 *     mode: CUSTOM, value: "enredado" } no MESMO efeito de uso (junto de
 *     acerto/dano, se houver) — o sistema anexa a condição oficial ao uso
 *     e oferece a aplicação no alvo pelo cartão do chat. Aceita array.
 *
 * Chaves especiais de change (motor de rolagem do T20):
 *   ataque, dano, criticoM (-1 = +1 margem), criticoX, danoCritico,
 *   danoMultiplicavel, ignoraRD (mode 2) e passos (mode 0 / CUSTOM).
 *   Dano tipado: valor "2d6[frio]" — tipos: acido, corte, eletricidade,
 *   essencia, fogo, frio, impacto, luz, psiquico, perfuracao, trevas.
 */

export const MODULO = "t20-hayd-itens";

/** true quando o módulo de tema t20-hayd-ui está ativo no mundo. */
export function temaHayd() {
  return game.modules?.get("t20-hayd-ui")?.active === true;
}

/* ================================================================== */
/* Categorias de item                                                 */
/* ================================================================== */

export const CATEGORIAS = {
  arma:       "Armas",
  municao:    "Munições",
  armadura:   "Armaduras",
  escudo:     "Escudos",
  esoterico:  "Esotéricos",
  ferramenta: "Ferramentas",
  vestuario:  "Vestuários",
  acessorio:  "Acessórios",
  geral:      "Qualquer item"
};

/**
 * Categorias naturais de um item do sistema (a primeira é a principal).
 * O usuário pode "quebrar o padrão" e escolher entradas de qualquer
 * categoria (ex.: manopla que recebe melhorias de arma).
 */
export function categoriasDoItem(item) {
  if (item.type === "arma") return ["arma", "geral"];
  if (item.type === "consumivel" && item.system?.tipo === "ammo") return ["municao", "arma", "geral"];
  if (item.type === "equipamento") {
    switch (item.system?.tipo) {
      case "leve":
      case "pesada":     return ["armadura", "geral"];
      case "escudo":     return ["escudo", "geral"];
      case "esoterico":  return ["esoterico", "arma", "geral"];
      case "ferramenta": return ["ferramenta", "geral"];
      case "traje":      return ["vestuario", "acessorio", "geral"];
      default:           return ["acessorio", "geral"];
    }
  }
  return [];
}

/** Itens que recebem a nova aba (mesmo critério do sistema, sem restrição de subtipo). */
export function itemElegivel(item) {
  if (item.type === "arma") return true;
  if (item.type === "equipamento") return true;
  if (item.type === "consumivel" && item.system?.tipo === "ammo") return true;
  return false;
}

/** Categoria de preço de material para um item. */
export function categoriaMaterialDoItem(item) {
  if (item.type === "arma") return "arma";
  if (item.type === "consumivel" && item.system?.tipo === "ammo") return "arma";
  if (item.type === "equipamento") {
    switch (item.system?.tipo) {
      case "leve":      return "armaduraLeve";
      case "pesada":    return "armaduraPesada";
      case "escudo":    return "escudo";
      case "esoterico": return "esoterico";
      default:          return "arma";
    }
  }
  return "arma";
}

/* ================================================================== */
/* Tabelas de preço (LB p.164 e p.334; munições pela metade, LB p.178)*/
/* ================================================================== */

/**
 * Preço acumulado por quantidade de melhorias. Oficial até 4; acima
 * disso extrapola a progressão triangular da tabela (300×10×T(n−1)):
 * 5 → 30.000, 6 → 45.000, 7 → 63.000…
 */
export function precoMelhorias(n) {
  if (n <= 0) return 0;
  const oficial = { 1: 300, 2: 3000, 3: 9000, 4: 18000 };
  if (oficial[n]) return oficial[n];
  // Extrapolação: multiplicador 10 × triangular(n−1) sobre T$ 300
  // (2→10, 3→30, 4→60, 5→100, 6→150…)
  const t = ((n - 1) * n) / 2;
  return 300 * 10 * t;
}

/**
 * Preço acumulado por quantidade de encantos. Oficial até 3; acima
 * disso segue dobrando (18.000 × 2^(n−1)): 4 → 144.000, 5 → 288.000…
 */
export function precoEncantos(n) {
  if (n <= 0) return 0;
  return 18000 * Math.pow(2, n - 1);
}

/* ================================================================== */
/* Condições (nomes idênticos à lista do livro base)                  */
/* ================================================================== */

const CONDICOES = {
  abalado: "Abalado", atordoado: "Atordoado", cego: "Cego",
  debilitado: "Debilitado", desprevenido: "Desprevenido",
  "em-chamas": "Em Chamas", enjoado: "Enjoado", enredado: "Enredado",
  envenenado: "Envenenado", fascinado: "Fascinado", fraco: "Fraco",
  lento: "Lento", ofuscado: "Ofuscado", sangrando: "Sangrando",
  vulneravel: "Vulnerável"
};

/* ================================================================== */
/* MELHORIAS                                                          */
/* ================================================================== */

export const MELHORIAS = {
  /* ---------------- Armas (LB / AA / HA / DA) ---------------- */
  "certeira": { nome: "Certeira", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.164",
    beneficio: "+1 nos testes de ataque",
    efeitos: [{ changes: [{ key: "ataque", value: "1" }] }] },

  "pungente": { nome: "Pungente", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.165",
    beneficio: "+2 nos testes de ataque (substitui o bônus de Certeira)", prereqs: ["certeira"], substitui: ["certeira"],
    efeitos: [{ changes: [{ key: "ataque", value: "2" }] }] },

  "cruel": { nome: "Cruel", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.164",
    beneficio: "+1 nas rolagens de dano",
    efeitos: [{ changes: [{ key: "dano", value: "1" }] }] },

  "atroz": { nome: "Atroz", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.164",
    beneficio: "+2 nas rolagens de dano (substitui o bônus de Cruel)", prereqs: ["cruel"], substitui: ["cruel"],
    efeitos: [{ changes: [{ key: "dano", value: "2" }] }] },

  "equilibrada": { nome: "Equilibrada", tipo: "melhoria", cats: ["arma"], fonte: "LB p.165",
    beneficio: "+2 em testes de manobras de combate (desarmar, quebrar…)",
    efeitos: [{ changes: [{ key: "ataque", value: "2" }],
      opcional: true, desc: "Use somente em testes de manobras de combate (desarmar, quebrar, derrubar…)" }] },

  "harmonizada": { nome: "Harmonizada", tipo: "melhoria", cats: ["arma"], fonte: "LB p.165",
    beneficio: "Uma habilidade de ataque escolhida custa −1 PM com esta arma", prereqs: ["*"],
    efeitos: [{ custo: "-1", desc: "Reduz em −1 PM o custo de uma habilidade ativada junto ao ataque" }] },

  "injecao-alquimica": { nome: "Injeção Alquímica", tipo: "melhoria", cats: ["arma"], fonte: "LB p.165",
    beneficio: "Ao acertar, libera uma dose de preparado carregada na arma (2 doses; clique direito na arma para carregar)",
    especial: "alquimica", efeitos: [] },

  "macica": { nome: "Maciça", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.165",
    beneficio: "+1 no multiplicador de crítico (não pode ser Precisa)", conflita: ["precisa"],
    efeitos: [{ changes: [{ key: "criticoX", value: "1" }] }] },

  "mira-telescopica": { nome: "Mira Telescópica", tipo: "melhoria", cats: ["arma"], fonte: "LB p.165",
    beneficio: "Aumenta o alcance da arma em uma categoria (só armas de disparo, exceto fundas)",
    nota: "Ajuste o alcance manualmente na ficha da arma", efeitos: [] },

  "precisa": { nome: "Precisa", tipo: "melhoria", cats: ["arma", "municao"], fonte: "LB p.165",
    beneficio: "+1 na margem de ameaça (não pode ser Maciça)", conflita: ["macica"],
    efeitos: [{ changes: [{ key: "criticoM", value: "-1" }] }] },

  "penetrante": { nome: "Penetrante", tipo: "melhoria", cats: ["arma", "municao"], fonte: "AA p.399",
    beneficio: "Ignora 5 pontos de redução de dano", prereqs: ["cruel"],
    efeitos: [{ changes: [{ key: "ignoraRD", value: "5" }] }] },

  "farpada": { nome: "Farpada", tipo: "melhoria", cats: ["arma", "municao"], fonte: "HA p.239",
    beneficio: "Acerto crítico deixa o alvo sangrando, com −5 em Constituição para remover (só corte/perfuração)",
    prereqs: ["cruel"],
    efeitos: [{ condicao: "sangrando", opcional: true, desc: "Aplique ao alvo em um acerto crítico (−5 em Con para remover)" }] },

  "fosforo": { nome: "Fósforo", tipo: "melhoria", cats: ["municao"], fonte: "HA p.239",
    beneficio: "Dano −1 passo; ao atingir, ofusca o alvo por 1 rodada (só munições)",
    efeitos: [{ changes: [{ key: "passos", value: "-1", mode: 0 }], condicao: "ofuscado",
      desc: "Dano −1 passo; o alvo atingido fica ofuscado por 1 rodada" }] },

  "guarda": { nome: "Guarda", tipo: "melhoria", cats: ["arma"], fonte: "HA p.239",
    beneficio: "+1 na Defesa e em testes contra manobras (só corpo a corpo)",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.bonus", value: "1" }] }] },

  "incendiaria": { nome: "Incendiária", tipo: "melhoria", cats: ["municao"], fonte: "HA p.239",
    beneficio: "+1 de dano de fogo; se acertar por 5 ou mais, deixa o alvo em chamas (só munições)",
    efeitos: [{ changes: [{ key: "dano", value: "1[fogo]" }], condicao: "em-chamas",
      desc: "+1 de dano de fogo; aplique Em Chamas se o ataque acertar por 5 ou mais" }] },

  "pressurizada": { nome: "Pressurizada", tipo: "melhoria", cats: ["arma"], fonte: "HA p.240",
    beneficio: "Após pressurizar (ação completa), +2 no ataque e no dano no próximo ataque (impacto corpo a corpo/armas de fogo)",
    efeitos: [{ nome: "Pressurizada (ativada)", changes: [{ key: "ataque", value: "2" }, { key: "dano", value: "2" }],
      opcional: true, desc: "Marque somente se a arma foi pressurizada com uma ação completa" }] },

  "conduite": { nome: "Conduíte", tipo: "melhoria", cats: ["arma"], fonte: "DA p.54",
    beneficio: "O custo do poder Abençoar Arma nesta arma é reduzido em −1 PM",
    efeitos: [{ custo: "-1", desc: "Reduz em −1 PM o custo de Abençoar Arma usada nesta arma" }] },

  /* ---------------- Armaduras e Escudos ---------------- */
  "ajustada": { nome: "Ajustada", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "LB p.164",
    beneficio: "Penalidade de armadura −1",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.pda", value: "1" }],
      desc: "Reduz a penalidade de armadura em 1" }] },

  "sob-medida": { nome: "Sob Medida", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "LB p.165",
    beneficio: "Penalidade de armadura −2, apenas para o usuário específico (substitui o bônus de Ajustada)",
    prereqs: ["ajustada"], substitui: ["ajustada"],
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.pda", value: "2" }],
      desc: "Reduz a penalidade de armadura em 2 (apenas para o dono)" }] },

  "delicada": { nome: "Delicada", tipo: "melhoria", cats: ["armadura"], fonte: "LB p.164",
    beneficio: "Permite aplicar 1 ponto de Destreza na Defesa (só armadura pesada; não pode ser Reforçada)",
    conflita: ["reforcada"], nota: "Ajuste o limite de Destreza manualmente", efeitos: [] },

  "espinhosa-armadura": { nome: "Espinhosa (Armadura)", tipo: "melhoria", cats: ["armadura"], fonte: "LB p.164",
    beneficio: "Ao agarrar/ser agarrado, causa dano de perfuração igual à sua Força",
    nota: "Role o dano manualmente nas manobras de agarrar", efeitos: [] },

  "espinhoso-escudo": { nome: "Espinhoso (Escudo)", tipo: "melhoria", cats: ["escudo"], fonte: "LB p.164",
    beneficio: "Aumenta o dano de um ataque com o escudo em um passo",
    efeitos: [{ changes: [{ key: "passos", value: "1", mode: 0 }],
      opcional: true, desc: "Use ao atacar com o escudo" }] },

  "polida": { nome: "Polida", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "LB p.165",
    beneficio: "+5 na Defesa na primeira rodada de combate (ambientes iluminados)",
    efeitos: [{ nome: "Polida (1ª rodada)", condicaoLivre: true, rodadas: 1,
      changes: [{ key: "system.attributes.defesa.bonus", value: "5" }],
      opcional: true, desc: "Ative na primeira rodada de combate em ambiente iluminado" }] },

  "reforcada": { nome: "Reforçada", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "LB p.165",
    beneficio: "+1 na Defesa e +1 na penalidade de armadura (não pode ser Delicada)", conflita: ["delicada"],
    efeitos: [{ passivo: true, changes: [
      { key: "system.attributes.defesa.bonus", value: "1" },
      { key: "system.attributes.defesa.pda", value: "-1" }
    ] }] },

  "selada": { nome: "Selada", tipo: "melhoria", cats: ["armadura"], fonte: "LB p.165",
    beneficio: "+1 nos testes de resistência (só armaduras pesadas)",
    efeitos: [{ passivo: true, changes: [{ key: "system.modificadores.pericias.resistencia", value: "+1" }] }] },

  "balistico": { nome: "Balístico", tipo: "melhoria", cats: ["escudo"], fonte: "HA p.239",
    beneficio: "Ao atacar com o escudo, gaste 1 bala para +2d6 de dano (2 balas; recarregar é ação completa)",
    prereqs: ["reforcada"],
    efeitos: [{ nome: "Bala", changes: [{ key: "dano", value: "2d6" }],
      desc: "Gasta 1 bala carregada no escudo" }] },

  "injetora": { nome: "Injetora", tipo: "melhoria", cats: ["armadura"], fonte: "HA p.240",
    beneficio: "Ação de movimento para acionar e ingerir 1 dose de preparado ou poção (1 dose; carregar é ação completa)",
    nota: "Use a poção/preparado do inventário normalmente", efeitos: [] },

  "prudente": { nome: "Prudente", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "HA p.240",
    beneficio: "1×/dia, role duas vezes na tabela de falhas críticas e escolha o resultado (regra opcional)",
    efeitos: [] },

  "diligente": { nome: "Diligente", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "DA p.54",
    beneficio: "Reduz o custo do poder Prece de Combate em −1 PM",
    efeitos: [{ custo: "-1", desc: "Reduz em −1 PM o custo de Prece de Combate" }] },

  "inscrito": { nome: "Inscrito", tipo: "melhoria", cats: ["armadura", "escudo"], fonte: "DA p.54",
    beneficio: "Conta como símbolo sagrado da divindade (+1 em testes de resistência para devotos)",
    efeitos: [{ passivo: true, changes: [{ key: "system.modificadores.pericias.resistencia", value: "+1" }] }] },

  /* ---------------- Esotéricos ---------------- */
  "canalizador": { nome: "Canalizador", tipo: "melhoria", cats: ["esoterico"], fonte: "LB p.164",
    beneficio: "+1 no limite de PM que pode gastar por magia",
    nota: "Limite de PM não é automatizável; aplique manualmente", efeitos: [] },

  "energetico": { nome: "Energético", tipo: "melhoria", cats: ["esoterico"], fonte: "LB p.164",
    beneficio: "Suas magias que causam dano causam +1d6 do mesmo tipo",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d6" }] }] },

  "harmonizado-esoterico": { nome: "Harmonizado (Esotérico)", tipo: "melhoria", cats: ["esoterico"], fonte: "LB p.165",
    beneficio: "Uma magia escolhida custa −1 PM",
    efeitos: [{ spell: true, custo: "-1", desc: "Reduz em −1 PM o custo da magia escolhida" }] },

  "poderoso": { nome: "Poderoso", tipo: "melhoria", cats: ["esoterico"], fonte: "LB p.165",
    beneficio: "+1 na CD para resistir às suas magias",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.cd", value: "1" }] }] },

  "vigilante": { nome: "Vigilante", tipo: "melhoria", cats: ["esoterico"], fonte: "LB p.165",
    beneficio: "+2 na Defesa",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.bonus", value: "2" }] }] },

  "potencializador": { nome: "Potencializador", tipo: "melhoria", cats: ["esoterico"], fonte: "HA p.240",
    beneficio: "+2 no limite de PM que pode gastar por magia (substitui o bônus de Canalizador)",
    prereqs: ["canalizador"], substitui: ["canalizador"],
    nota: "Limite de PM não é automatizável; aplique manualmente", efeitos: [] },

  /* ---------------- Ferramentas e Vestuário ---------------- */
  "aprimorado": { nome: "Aprimorado", tipo: "melhoria", cats: ["ferramenta", "vestuario"], fonte: "LB p.164",
    beneficio: "+1 em testes da perícia modificada pelo item", escolhePericia: true,
    efeitos: [{ skill: true, changes: [{ key: "roll", value: "1" }],
      desc: "+1 na rolagem da perícia modificada pelo item" }] },

  "multifuncional": { nome: "Multifuncional", tipo: "melhoria", cats: ["ferramenta", "vestuario"], fonte: "AA p.399",
    beneficio: "O item passa a funcionar também para uma segunda perícia do mesmo atributo-chave",
    efeitos: [] },

  "brasonado": { nome: "Brasonado", tipo: "melhoria", cats: ["ferramenta", "vestuario"], fonte: "HA p.240",
    beneficio: "Pode substituir o primeiro teste de Diplomacia (mudar atitude) da cena por outra perícia do item",
    conflita: ["discreto"], efeitos: [] },

  "usado": { nome: "Usado", tipo: "melhoria", cats: ["ferramenta", "vestuario"], fonte: "HA p.240",
    beneficio: "1×/dia, role novamente um 1 natural em teste de perícia com o item",
    efeitos: [] },

  /* ---------------- Qualquer categoria ---------------- */
  "banhado-a-ouro": { nome: "Banhado a Ouro", tipo: "melhoria", cats: ["geral"], fonte: "LB p.164",
    beneficio: "+2 em Diplomacia",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.dipl.bonus", value: "2" }] }] },

  "cravejado-de-gemas": { nome: "Cravejado de Gemas", tipo: "melhoria", cats: ["geral"], fonte: "LB p.164",
    beneficio: "+2 em Enganação",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.enga.bonus", value: "2" }] }] },

  "discreto": { nome: "Discreto", tipo: "melhoria", cats: ["geral"], fonte: "LB p.164",
    beneficio: "Ocupa −1 espaço (mínimo 1) e +5 em Ladinagem para ser ocultado", conflita: ["brasonado"],
    efeitos: [] },

  "macabro": { nome: "Macabro", tipo: "melhoria", cats: ["geral"], fonte: "LB p.165",
    beneficio: "+2 em Intimidação, −2 em Diplomacia",
    efeitos: [{ passivo: true, changes: [
      { key: "system.pericias.inti.bonus", value: "2" },
      { key: "system.pericias.dipl.bonus", value: "-2" }
    ] }] },

  "deslumbrante": { nome: "Deslumbrante", tipo: "melhoria", cats: ["armadura", "vestuario"], fonte: "HA p.240",
    beneficio: "+1 na CD para resistir às suas habilidades baseadas em Carisma",
    prereqs: ["banhado-a-ouro", "cravejado-de-gemas"], prereqAlternativo: true, efeitos: [] },

  "canonico": { nome: "Canônico", tipo: "melhoria", cats: ["geral"], fonte: "DA p.54",
    beneficio: "Se você for devoto da divindade inscrita, +1 na CD de suas habilidades mágicas",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.cd", value: "1" }],
      desc: "Válido apenas se o usuário for devoto da divindade" }] },

  "devotado": { nome: "Devotado", tipo: "melhoria", cats: ["geral"], fonte: "DA p.54",
    beneficio: "Um poder concedido escolhido custa −1 PM", prereqs: ["inscrito"],
    efeitos: [{ custo: "-1", desc: "Reduz em −1 PM o custo do poder concedido escolhido" }] }
};

/* ================================================================== */
/* ENCANTOS                                                           */
/* ================================================================== */

export const ENCANTOS = {
  /* ---------------- Armas — Livro Básico ---------------- */
  "ameacadora": { nome: "Ameaçadora", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Duplica a margem de ameaça da arma (aplicada antes de outros aumentos)",
    especial: "ameacadora", efeitos: [] },

  "anticriatura": { nome: "Anticriatura", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "1×/rodada, 2 PM ao atacar o tipo de criatura escolhido: +4d8 de dano se acertar",
    efeitos: [{ custo: "2", changes: [{ key: "dano", value: "4d8" }],
      desc: "Use somente contra o tipo de criatura da arma" }] },

  "arremesso": { nome: "Arremesso", tipo: "encanto", cats: ["arma"], fonte: "LB p.335",
    beneficio: "Pode ser arremessada em alcance curto (ou +1 categoria) e volta voando", efeitos: [] },

  "assassina": { nome: "Assassina", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Dados de ataque furtivo viram d8; 2 PM para rolar novamente resultados 1 no furtivo",
    efeitos: [{ custo: "2", desc: "Ao usar Ataque Furtivo: dados d8 e rola novamente resultados 1" }] },

  "cacadora": { nome: "Caçadora", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Ignora camuflagem leve/total e cobertura leve; +1 categoria de alcance à distância", efeitos: [] },

  "congelante": { nome: "Congelante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+1d6 de frio; 1×/rodada, 2 PM: se acertar, enreda a vítima por 1 rodada",
    efeitos: [
      { changes: [{ key: "dano", value: "1d6[frio]" }] },
      { nome: "Enredar", condicao: "enredado", custo: "2",
        desc: "1×/rodada: se o ataque acertar, a vítima fica enredada por 1 rodada" }
    ] },

  "conjuradora": { nome: "Conjuradora", tipo: "encanto", cats: ["arma"], fonte: "LB p.335",
    beneficio: "Guarda uma magia; ao acertar, descarrega-a como ação livre sem custo", efeitos: [] },

  "corrosiva": { nome: "Corrosiva", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+1d6 de ácido; 1×/rodada, 2 PM: se acertar, a vítima sofre 4d4 de ácido na próxima rodada",
    efeitos: [
      { changes: [{ key: "dano", value: "1d6[acido]" }] },
      { nome: "Corrosão persistente", custo: "2", desc: "1×/rodada: a vítima sofre 4d4 de ácido no início da próxima rodada dela" }
    ] },

  "dancarina": { nome: "Dançarina", tipo: "encanto", cats: ["arma"], fonte: "LB p.335",
    beneficio: "Ação de movimento + 1 PM: a arma flutua e ataca sozinha em alcance curto (sustentada)", efeitos: [] },

  "defensora": { nome: "Defensora", tipo: "encanto", cats: ["arma"], fonte: "LB p.335",
    beneficio: "+2 na Defesa",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.bonus", value: "2" }] }] },

  "destruidora": { nome: "Destruidora", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+2 no ataque e +2d8 de dano contra construtos e objetos",
    efeitos: [{ changes: [{ key: "ataque", value: "2" }, { key: "dano", value: "2d8" }],
      opcional: true, desc: "Use somente contra construtos e objetos" }] },

  "dilacerante": { nome: "Dilacerante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Acerto crítico causa +10 pontos de dano",
    efeitos: [{ changes: [{ key: "danoCritico", value: "10" }] }] },

  "drenante": { nome: "Drenante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Crítico em criatura viva: ela fica fraca e você ganha 2d10 PV temporários",
    efeitos: [{ condicao: "fraco", opcional: true, desc: "Aplique em um acerto crítico; role 2d10 PV temporários para você" }] },

  "eletrica": { nome: "Elétrica", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+1d6 de eletricidade; 1×/rodada, 2 PM: raio de 3d8 em outra criatura em alcance curto",
    efeitos: [
      { changes: [{ key: "dano", value: "1d6[eletricidade]" }] },
      { nome: "Raio secundário", custo: "2", desc: "1×/rodada: um raio causa 3d8 de eletricidade em outra criatura em alcance curto" }
    ] },

  "energetica": { nome: "Energética", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+4 no ataque, ignora 20 de RD e converte o dano em essência; emana luz",
    prereqs: ["formidavel"], dois: true,
    efeitos: [{ changes: [
      { key: "ataque", value: "4" },
      { key: "ignoraRD", value: "20" },
      { key: "tipoDano", value: "essencia", mode: 5 }
    ] }] },

  "excruciante": { nome: "Excruciante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "Criatura viva atingida fica fraca (se já fraca, debilitada)",
    efeitos: [{ condicao: "fraco", desc: "Aplique à criatura viva atingida (se já fraca, aplique Debilitado)" }] },

  "flamejante": { nome: "Flamejante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.335",
    beneficio: "+1d6 de fogo; 1×/rodada, 2 PM: em vez do ataque, bola de fogo 6d6 em alcance médio",
    efeitos: [
      { changes: [{ key: "dano", value: "1d6[fogo]" }] },
      { nome: "Bola de fogo", custo: "2", desc: "Em vez de atacar: 6d6 de fogo em alcance médio (Reflexos CD For/Des reduz à metade)" }
    ] },

  "formidavel": { nome: "Formidável", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+2 em testes de ataque e rolagens de dano",
    efeitos: [{ changes: [{ key: "ataque", value: "2" }, { key: "dano", value: "2" }] }] },

  "lancinante": { nome: "Lancinante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "Em críticos, multiplica também os bônus numéricos (ou o +10, conforme a regra variante do sistema). Substitui Dilacerante",
    prereqs: ["dilacerante"], dois: true, especial: "lancinante", efeitos: [] },

  "magnifica": { nome: "Magnífica", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+4 em testes de ataque e rolagens de dano (substitui Formidável — bônus não acumulam)",
    prereqs: ["formidavel"], substitui: ["formidavel"], dois: true,
    efeitos: [{ changes: [{ key: "ataque", value: "4" }, { key: "dano", value: "4" }] }] },

  "piedosa": { nome: "Piedosa", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+1d8 de dano e todo o dano se torna não letal (1 PM para ativar/desativar)",
    efeitos: [{ custo: "1", changes: [{ key: "dano", value: "1d8" }],
      desc: "+1d8 e todo o dano é não letal enquanto ativa" }] },

  "profana": { nome: "Profana", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+2d8 contra devotos do Bem e criaturas bondosas",
    efeitos: [{ changes: [{ key: "dano", value: "2d8" }],
      opcional: true, desc: "Use somente contra devotos do Bem/criaturas bondosas" }] },

  "sagrada": { nome: "Sagrada", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+2d8 contra devotos do Mal e criaturas malignas",
    efeitos: [{ changes: [{ key: "dano", value: "2d8" }],
      opcional: true, desc: "Use somente contra devotos do Mal/criaturas malignas" }] },

  "sanguinaria": { nome: "Sanguinária", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "Criatura viva atingida fica sangrando (cumulativo)",
    efeitos: [{ condicao: "sangrando", desc: "Aplique à criatura viva atingida (cumulativo)" }] },

  "trovejante": { nome: "Trovejante", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "Acerto crítico atordoa a vítima por 1 rodada (1×/cena; Fortitude evita)",
    efeitos: [{ condicao: "atordoado", opcional: true, desc: "Aplique em acerto crítico, 1×/cena (Fortitude CD For/Des evita)" }] },

  "tumular": { nome: "Tumular", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "+1d8 de trevas; 1×/rodada, 2 PM: o bônus vira +2d8, mas você perde 1d8 PV",
    efeitos: [
      { changes: [{ key: "dano", value: "1d8[trevas]" }] },
      { nome: "Trevas maiores", custo: "2", changes: [{ key: "dano", value: "1d8[trevas]" }],
        desc: "1×/rodada: soma +1d8 de trevas extra (total 2d8), mas você perde 1d8 PV" }
    ] },

  "veloz": { nome: "Veloz", tipo: "encanto", cats: ["arma"], fonte: "LB p.336",
    beneficio: "Concede Ataque Extra do guerreiro, só com esta arma (se já possui, custo −1 PM)", efeitos: [] },

  "venenosa": { nome: "Venenosa", tipo: "encanto", cats: ["arma", "municao"], fonte: "LB p.336",
    beneficio: "1×/rodada, 2 PM: se acertar, a vítima fica envenenada (1d12 PV/rodada por 3 rodadas)",
    efeitos: [{ condicao: "envenenado", custo: "2",
      desc: "Aplique se o ataque acertar (perde 1d12 PV por rodada, 3 rodadas)" }] },

  /* ---------------- Armas — Heróis de Arton ---------------- */
  "alvorada": { nome: "Alvorada", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "+1d8 de luz contra mortos-vivos/sensíveis à luz; 1×/rodada, 2 PM cega por 1 rodada",
    efeitos: [
      { changes: [{ key: "dano", value: "1d8[luz]" }], opcional: true, desc: "Use contra mortos-vivos e criaturas com sensibilidade à luz" },
      { nome: "Cegar", condicao: "cego", custo: "2",
        desc: "1×/rodada: cega uma criatura em alcance curto por 1 rodada (1×/cena por criatura; Fortitude evita)" }
    ] },

  "anatema": { nome: "Anátema", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "Criatura atingida: a CD das habilidades mágicas dela sofre −2 por 1 rodada", efeitos: [] },

  "brumosa": { nome: "Brumosa", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "A cada acerto, você recebe camuflagem leve por 1 rodada", efeitos: [] },

  "cantante": { nome: "Cantante", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "+2 em Atuação; 1 PM: você e aliados em alcance curto recebem +1 no ataque por 1 rodada",
    efeitos: [
      { passivo: true, changes: [{ key: "system.pericias.atua.bonus", value: "2" }] },
      { nome: "Inspirar", custo: "1", changes: [{ key: "ataque", value: "1" }],
        desc: "Você e aliados em alcance curto recebem +1 no ataque por 1 rodada" }
    ] },

  "ciclonica": { nome: "Ciclônica", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "+2 contra manobras; 1×/rodada, 1 PM: rajada de vento em cone de 9m que empurra 3m",
    efeitos: [{ nome: "Rajada", custo: "1",
      desc: "Cone de 9m: criaturas são empurradas 3m (Fortitude CD For/Des evita)" }] },

  "crescente": { nome: "Crescente", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "2 PM: a arma cresce até o fim do turno — dano +1 passo e alcance +1,5m (só corpo a corpo)",
    efeitos: [{ custo: "2", changes: [{ key: "passos", value: "1", mode: 0 }],
      desc: "Dano +1 passo e alcance +1,5m até o fim do turno" }] },

  "cristalina": { nome: "Cristalina", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "+1d6 de luz; 1×/rodada, 1 PM: se acertar, ofusca por 1 rodada",
    efeitos: [
      { changes: [{ key: "dano", value: "1d6[luz]" }] },
      { nome: "Ofuscar", condicao: "ofuscado", custo: "1",
        desc: "1×/rodada: se o ataque acertar, o alvo fica ofuscado por 1 rodada" }
    ] },

  "cronal": { nome: "Cronal", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "3 PM ao atacar: rola dois dados e usa o melhor; o próximo ataque contra você usa o pior de dois",
    prereqs: ["formidavel"],
    efeitos: [{ custo: "3", changes: [{ key: "ataque", value: "kh", mode: 0 }],
      desc: "Rola 2d20 e usa o melhor; o próximo ataque contra você usa o pior de 2d20" }] },

  "cuidadora": { nome: "Cuidadora", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "Errou o ataque: +2 na Defesa por 1 rodada; 1×/rodada, 2 PM: RD 10 contra um dano sofrido",
    efeitos: [{ nome: "Aparar", custo: "2", desc: "1×/rodada, ao sofrer dano: RD 10 contra esse dano" }] },

  "espreitadora": { nome: "Espreitadora", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "2 PM ao atacar: deixa o oponente desprevenido (1×/cena por criatura; Vontade evita)",
    efeitos: [{ condicao: "desprevenido", custo: "2",
      desc: "Aplique ao alvo do ataque (1×/cena por criatura; Vontade CD For/Des evita)" }] },

  "frenetica": { nome: "Frenética", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "A cada acerto, 1 PM: +1 no ataque e dano com ela até o fim da cena (acumulável até +5)",
    efeitos: [{ custo: "1", changes: [{ key: "ataque", value: "1" }, { key: "dano", value: "1" }], cena: true,
      desc: "Acumulável a cada acerto (máx. +5): marque múltiplas vezes conforme as cargas" }] },

  "gargula": { nome: "Gárgula", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "2 PM: convoca uma pequena gárgula parceira (combatente iniciante) até o fim da cena", efeitos: [] },

  "horrenda": { nome: "Horrenda", tipo: "encanto", cats: ["arma"], fonte: "HA p.256",
    beneficio: "+2 em Intimidação; custo de habilidades de medo −1 PM",
    efeitos: [
      { passivo: true, changes: [{ key: "system.pericias.inti.bonus", value: "2" }] },
      { custo: "-1", nome: "Medo", desc: "Reduz em −1 PM o custo de habilidades de medo" }
    ] },

  "infestada": { nome: "Infestada", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "A cada acerto, 2 PM: enxame causa 2d6 de veneno e deixa enjoado por 1d4 rodadas",
    efeitos: [{ changes: [{ key: "dano", value: "2d6" }], condicao: "enjoado", custo: "2",
      desc: "O alvo perde 2d6 PV por veneno e fica enjoado por 1d4 rodadas (Fortitude evita a condição)" }] },

  "manafaga": { nome: "Manáfaga", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "Ao acertar: Vontade (CD For/Des) ou o alvo perde 1d4 PM e você ganha 1 PM temporário",
    prereqs: ["formidavel"], efeitos: [] },

  "indignada": { nome: "Indignada", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "Errou o ataque: +2 no próximo teste de ataque até o fim da cena (acumulável)",
    efeitos: [{ nome: "Indignação", changes: [{ key: "ataque", value: "2" }],
      opcional: true, desc: "Marque no próximo ataque após ter errado (acumulável)" }] },

  "rebote": { nome: "Rebote", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.256",
    beneficio: "Erro acumula carga (máx. 3); acerto gasta todas: +1d6 por carga",
    efeitos: [{ nome: "Cargas", changes: [{ key: "dano", value: "1d6" }],
      opcional: true, desc: "Marque uma vez por carga acumulada (máx. 3); as cargas são gastas no acerto" }] },

  "reflexiva": { nome: "Reflexiva", tipo: "encanto", cats: ["arma"], fonte: "HA p.257",
    beneficio: "1×/rodada, ao ser alvo de magia, gaste PM igual ao círculo para refleti-la",
    prereqs: ["cristalina"], efeitos: [] },

  "ressonante": { nome: "Ressonante", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.257",
    beneficio: "Ao acertar, 2 PM: onda de choque psíquica em outra criatura em alcance curto (metade do dano)",
    efeitos: [{ nome: "Onda de choque", custo: "2",
      desc: "Compare o ataque com a Defesa de outra criatura em alcance curto; se acertar, dano psíquico igual à metade do dano causado" }] },

  "sepulcral": { nome: "Sepulcral", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.257",
    beneficio: "Junto do efeito de Tumular: a criatura atingida não recupera PV por 1d4 rodadas",
    prereqs: ["tumular"], efeitos: [] },

  "sombria": { nome: "Sombria", tipo: "encanto", cats: ["arma"], fonte: "HA p.257",
    beneficio: "+2 em Furtividade; lança Escuridão (se já pode, custo −1 PM)",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.furt.bonus", value: "2" }] }] },

  "vampirica": { nome: "Vampírica", tipo: "encanto", cats: ["arma", "municao"], fonte: "HA p.257",
    beneficio: "1 PM ao atacar: +2d6 de trevas e você recupera PV igual ao dano de trevas causado",
    efeitos: [{ custo: "1", changes: [{ key: "dano", value: "2d6[trevas]" }],
      desc: "Recupere PV igual ao dano de trevas causado" }] },

  /* ---------------- Armaduras e Escudos — LB ---------------- */
  "abascanto": { nome: "Abascanto", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.337",
    beneficio: "Resistência a magia +5",
    efeitos: [{ passivo: true, changes: [{ key: "system.modificadores.pericias.resistencia", value: "+5" }],
      desc: "+5 em testes de resistência contra magia (o bônus geral inclui outras fontes — ajuste se necessário)" }] },

  "abencoado": { nome: "Abençoado", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.337",
    beneficio: "Redução de trevas 10 e +5 em resistências contra necromancia", efeitos: [] },

  "acrobatico": { nome: "Acrobático", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.337",
    beneficio: "+5 em Acrobacia e ignora a penalidade de armadura nesses testes",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.acro.bonus", value: "5" }] }] },

  "alado": { nome: "Alado", tipo: "encanto", cats: ["armadura"], fonte: "LB p.337",
    beneficio: "2 PM: asas emergem — deslocamento de voo 12m (sustentado)", efeitos: [] },

  "animado": { nome: "Animado", tipo: "encanto", cats: ["escudo"], fonte: "LB p.337",
    beneficio: "Ação de movimento + 1 PM: o escudo flutua e defende sozinho até o fim da cena", efeitos: [] },

  "assustador": { nome: "Assustador", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.337",
    beneficio: "Ação de movimento + 2 PM: inimigos em alcance curto ficam abalados (Vontade CD Car evita)",
    efeitos: [{ condicao: "abalado", custo: "2",
      desc: "Aplique aos inimigos em alcance curto que falharem na Vontade (até o fim da cena)" }] },

  "caustica": { nome: "Cáustica", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.337",
    beneficio: "Redução de ácido 10; ação de movimento + 2 PM: seus ataques causam +1d4 de ácido até o fim da cena",
    efeitos: [{ nome: "Gotejar ácido", custo: "2", cena: true, changes: [{ key: "dano", value: "1d4[acido]" }],
      desc: "Seus ataques causam +1d4 de ácido até o fim da cena" }] },

  "defensor": { nome: "Defensor", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "+2 na Defesa",
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.bonus", value: "2" }] }] },

  "escorregadio": { nome: "Escorregadio", tipo: "encanto", cats: ["armadura"], fonte: "LB p.337",
    beneficio: "+10 em Acrobacia para escapar e em manobras contra agarrar", efeitos: [] },

  "esmagador": { nome: "Esmagador", tipo: "encanto", cats: ["escudo"], fonte: "LB p.338",
    beneficio: "+2 em ataques e dano com o escudo e o dano dele aumenta um passo",
    efeitos: [{ changes: [
      { key: "ataque", value: "2" }, { key: "dano", value: "2" },
      { key: "passos", value: "1", mode: 0 }
    ], opcional: true, desc: "Use ao atacar com o escudo" }] },

  "fantasmagorico": { nome: "Fantasmagórico", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Lança Manto de Sombras", efeitos: [] },

  "fortificado": { nome: "Fortificado", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Chance de ignorar dano extra de crítico/furtivo: 25% (escudos), 50% (armaduras)", efeitos: [] },

  "gelido": { nome: "Gélido", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Redução de frio 10; ação de movimento + 2 PM: 10 PV temporários até o fim da cena",
    efeitos: [{ nome: "Cobertura de gelo", custo: "2", desc: "Recebe 10 PV temporários" }] },

  "guardiao": { nome: "Guardião", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "+4 na Defesa (substitui Defensor — bônus não acumulam)",
    prereqs: ["defensor"], substitui: ["defensor"], dois: true,
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.defesa.bonus", value: "4" }] }] },

  "hipnotico": { nome: "Hipnótico", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Ação padrão + 3 PM: inimigos em alcance curto ficam fascinados por 1d6 rodadas (Vontade CD Car evita)",
    efeitos: [{ condicao: "fascinado", custo: "3",
      desc: "Aplique aos inimigos em alcance curto que falharem na Vontade (1d6 rodadas)" }] },

  "ilusorio": { nome: "Ilusório", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Ação de movimento + 1 PM: o item parece roupa comum, mantendo as propriedades", efeitos: [] },

  "incandescente": { nome: "Incandescente", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Redução de fogo 10; ação de movimento + 2 PM: 1d6 de fogo em adjacentes no início dos seus turnos",
    efeitos: [{ nome: "Labaredas", custo: "2", cena: true,
      desc: "No início de cada turno seu, criaturas adjacentes sofrem 1d6 de fogo" }] },

  "invulneravel": { nome: "Invulnerável", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "RD 2 (escudos) ou RD 5 (armaduras)", efeitos: [] },

  "opaco": { nome: "Opaco", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Redução de ácido, eletricidade, fogo e frio 10", efeitos: [] },

  "protetor": { nome: "Protetor", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "+2 em testes de resistência",
    efeitos: [{ passivo: true, changes: [{ key: "system.modificadores.pericias.resistencia", value: "+2" }] }] },

  "refletor": { nome: "Refletor", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "1×/rodada, ao ser alvo de magia, gaste PM igual ao custo dela para refleti-la", efeitos: [] },

  "relampejante": { nome: "Relampejante", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Redução de eletricidade 10; ação de movimento + 2 PM: quem o atacar corpo a corpo sofre 2d6 de eletricidade",
    efeitos: [{ nome: "Arcos voltaicos", custo: "2", cena: true,
      desc: "Quem o atacar corpo a corpo sofre 2d6 de eletricidade até o fim da cena" }] },

  "reluzente": { nome: "Reluzente", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "Ação de movimento + 2 PM: clarão cega inimigos em alcance curto por 1 rodada (Reflexos CD Car evita)",
    efeitos: [{ condicao: "cego", custo: "2",
      desc: "Aplique aos inimigos em alcance curto que falharem em Reflexos (1 rodada)" }] },

  "sombrio": { nome: "Sombrio", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "+5 em Furtividade e ignora a penalidade de armadura nesses testes",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.furt.bonus", value: "5" }] }] },

  "zeloso": { nome: "Zeloso", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "LB p.338",
    beneficio: "1×/rodada, quando aliado adjacente é alvo de ataque, 1 PM para se tornar o alvo", efeitos: [] },

  /* ---------------- Armaduras e Escudos — HA ---------------- */
  "abissal": { nome: "Abissal", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "Redução de ácido e fogo 10; 1×/rodada, 1 PM: 2d6 de ácido ou fogo em criatura adjacente",
    efeitos: [{ nome: "Chamas abissais", custo: "1", desc: "2d6 de ácido ou fogo em uma criatura adjacente" }] },

  "ancorada": { nome: "Ancorada", tipo: "encanto", cats: ["armadura"], fonte: "HA p.259",
    beneficio: "+5 em Atletismo para escalar; 1 PM: deslocamento de escalada 12m (sustentado)", efeitos: [] },

  "anulador": { nome: "Anulador", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "1×/rodada, ao ser alvo de magia, 3 PM por círculo para anulá-la", prereqs: ["abascanto"], efeitos: [] },

  "arboreo": { nome: "Arbóreo", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "Resistência a magia divina +5; lança Controlar Plantas", efeitos: [] },

  "astuto": { nome: "Astuto", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "+5 em Intuição e Percepção; 1×/rodada, 3 PM: detecta escondidos/invisíveis em alcance curto",
    efeitos: [{ passivo: true, changes: [
      { key: "system.pericias.intu.bonus", value: "5" },
      { key: "system.pericias.perc.bonus", value: "5" }
    ] }] },

  "densa": { nome: "Densa", tipo: "encanto", cats: ["armadura"], fonte: "HA p.259",
    beneficio: "Deslocamento de inimigos em alcance curto −3m; 2 PM: abalados e lentos por 1d4 rodadas",
    efeitos: [{ condicao: ["abalado", "lento"], custo: "2",
      desc: "Inimigos em alcance curto ficam abalados e lentos por 1d4 rodadas (CD For/Des evita)" }] },

  "egide": { nome: "Égide", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "+5 na Defesa contra ataques à distância; 1×/cena, 3 PM: ignora um dano à distância", efeitos: [] },

  "enraizada": { nome: "Enraizada", tipo: "encanto", cats: ["armadura"], fonte: "HA p.259",
    beneficio: "+5 contra derrubar e empurrar; 2 PM: +5 contra outro efeito de movimento", efeitos: [] },

  "esmerico": { nome: "Esmérico", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "Redução de ácido 10, resistência a veneno +5; 1 PM: estende a proteção a aliados próximos", efeitos: [] },

  "estigio": { nome: "Estígio", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.259",
    beneficio: "1×/cena, se reduzido a 0 PV, 5 PM para ficar com 1 PV", prereqs: ["abencoado"], efeitos: [] },

  "etereo": { nome: "Etéreo", tipo: "encanto", cats: ["armadura"], fonte: "HA p.260",
    beneficio: "1×/cena, 3 PM: incorpóreo por 1 rodada", efeitos: [] },

  "geomantico": { nome: "Geomântico", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "RD 10 contra impacto e fortificação 25%; lança Controlar Terra", efeitos: [] },

  "ligeira": { nome: "Ligeira", tipo: "encanto", cats: ["armadura"], fonte: "HA p.260",
    beneficio: "Pode ser vestida/removida como ação livre", efeitos: [] },

  "luminescente": { nome: "Luminescente", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "Lança Luz como clérigo; sensíveis à luz podem ficar cegos", efeitos: [] },

  "pristino": { nome: "Prístino", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "Resistência a necromancia e veneno +5; 2 PM: remove doente/enjoado/envenenado de adjacente",
    efeitos: [{ nome: "Purificar", custo: "2", desc: "Remove Doente, Enjoado ou Envenenado de uma criatura adjacente" }] },

  "purificador": { nome: "Purificador", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "Resistência a medo e mental +5; 2 PM: aliado repete resistência contra esses efeitos", efeitos: [] },

  "reanimador": { nome: "Reanimador", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "Lança Curar Ferimentos (CD Sab; se já conhece, −1 PM)", efeitos: [] },

  "replicante": { nome: "Replicante", tipo: "encanto", cats: ["armadura"], fonte: "HA p.260",
    beneficio: "Ao ser atingido corpo a corpo, 1 PM: causa 2d6 do mesmo tipo ao atacante e reduz o dano sofrido",
    efeitos: [{ nome: "Replicar", custo: "1",
      desc: "Causa 2d6 do mesmo tipo ao atacante e reduz 2d6 do dano sofrido" }] },

  "resiliente": { nome: "Resiliente", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "Resistência a atordoamento/paralisia/petrificação +5; 1 PM: repete resistência contra essas condições",
    efeitos: [] },

  "vortice": { nome: "Vórtice", tipo: "encanto", cats: ["armadura", "escudo"], fonte: "HA p.260",
    beneficio: "1 PM: puxa criatura em alcance curto para adjacente (Fortitude CD For evita)",
    efeitos: [{ nome: "Puxar", custo: "1", desc: "Puxa uma criatura em alcance curto para adjacente a você" }] },

  /* ---------------- Esotéricos — HA ---------------- */
  "abafador": { nome: "Abafador", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Criatura que falha na resistência contra sua magia: CD das habilidades dela −2 por 1 rodada", efeitos: [] },

  "belico": { nome: "Bélico", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Magias de dano causam +1d10 de essência",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d10[essencia]" }] }] },

  "caridoso": { nome: "Caridoso", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Magia benéfica em aliado (≥1 PM) gera 1 PM temporário para a próxima magia", efeitos: [] },

  "chocante": { nome: "Chocante", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Magias de eletricidade: +1 dado do mesmo tipo e ofuscam por 1 rodada",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d" }], condicao: "ofuscado",
      desc: "Use em magias de eletricidade: +1 dado e os alvos ficam ofuscados por 1 rodada" }] },

  "clemente": { nome: "Clemente", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Magias de cura curam +1 dado do mesmo tipo",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d" }], desc: "Use em magias de cura" }] },

  "contido": { nome: "Contido", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.260",
    beneficio: "Magia de dano: +1 PM para causar dano não letal",
    efeitos: [{ spell: true, custo: "1", desc: "O dano da magia se torna não letal" }] },

  "embusteiro": { nome: "Embusteiro", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Usa Magia Discreta (se já possui, −1 PM e soma Carisma na CD para perceber)", efeitos: [] },

  "emergencial": { nome: "Emergencial", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "1×/rodada, ao você ou aliado sofrer dano, 4 PM: lança magia de cura como reação", efeitos: [] },

  "encadeado": { nome: "Encadeado", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "1×/cena, ao reduzir inimigo a 0 PV com magia, causa metade do dano a outro inimigo", efeitos: [] },

  "escultor": { nome: "Escultor", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "1 PM: troca área de cone para linha ou vice-versa",
    efeitos: [{ spell: true, custo: "1", desc: "Cone→linha dobra o comprimento; linha→cone reduz a um terço" }] },

  "frugal": { nome: "Frugal", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magia de resistência contra inimigos: −2 na CD e −2 PM",
    efeitos: [{ spell: true, custo: "-2", desc: "−2 na CD da magia e −2 PM no custo" }] },

  "glacial": { nome: "Glacial", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magias de frio: +1 dado do mesmo tipo e deixam vulnerável por 1 rodada",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d" }], condicao: "vulneravel",
      desc: "Use em magias de frio: +1 dado e os alvos ficam vulneráveis por 1 rodada" }] },

  "imperioso": { nome: "Imperioso", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Ações de comando de magias diminuem em uma categoria", efeitos: [] },

  "implacavel": { nome: "Implacável", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "+2 PM: afeta alvo sem linha de efeito (visto no último turno)", prereqs: ["*"],
    efeitos: [{ spell: true, custo: "2", desc: "Afeta um alvo sem linha de efeito, ainda dentro do alcance" }] },

  "incriminador": { nome: "Incriminador", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "1×/cena, 3 PM: ilusão mostra a magia sendo lançada por outra criatura", efeitos: [] },

  "inflamavel": { nome: "Inflamável", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magias de fogo: +1 dado do mesmo tipo e deixam em chamas",
    efeitos: [{ spell: true, changes: [{ key: "dano", value: "1d" }], condicao: "em-chamas",
      desc: "Use em magias de fogo: +1 dado e os alvos ficam em chamas" }] },

  "inquisidor": { nome: "Inquisidor", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magia divina contra não-devoto: +1 na CD (+2 com Devoto Fiel)", efeitos: [] },

  "insistente": { nome: "Insistente", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Efeitos aplicados só ao lançar valem também para a 2ª rodada da magia", efeitos: [] },

  "khalmyrita": { nome: "Khalmyrita", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magia de efeito variável: escolha o valor médio em vez de rolar", conflita: ["nimbico"], efeitos: [] },

  "majestoso": { nome: "Majestoso", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "+1 na CD para resistir a magias arcanas (+2 com a habilidade Magias)", prereqs: ["*"],
    efeitos: [{ passivo: true, changes: [{ key: "system.attributes.cd", value: "1" }],
      desc: "Válido apenas para magias arcanas" }] },

  "nimbico": { nome: "Nímbico", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Magia variável: rola novamente dados (perde 1 PM por par obtido)", conflita: ["khalmyrita"], efeitos: [] },

  "pulverizante": { nome: "Pulverizante", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "2 PM: desintegra criatura reduzida a 0 PV pela magia", prereqs: ["*"], conflita: ["contido"],
    efeitos: [] },

  "retaliador": { nome: "Retaliador", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "+1 na CD da próxima magia por 10 pontos de dano evitados com RD de magia sua", efeitos: [] },

  "sanguessuga": { nome: "Sanguessuga", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Inimigo falhou na resistência contra sua magia: você recebe 10 PV temporários", efeitos: [] },

  "traicoeiro": { nome: "Traiçoeiro", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "Se a magia hostil afeta um aliado, todas as criaturas afetadas sofrem −2 na resistência", efeitos: [] },

  "verdugo": { nome: "Verdugo", tipo: "encanto", cats: ["esoterico"], fonte: "HA p.261",
    beneficio: "1ª vez na cena que reduz inimigo a 0 PV com magia: +1 de dano por dado até o fim da cena",
    efeitos: [{ nome: "Execução", cena: true, changes: [{ key: "dano", value: "d*1", mode: 0 }],
      opcional: true, desc: "Ative após reduzir um inimigo a 0 PV com magia deste esotérico" }] },

  /* ---------------- Acessórios — HA ---------------- */
  "aconchegante": { nome: "Aconchegante", tipo: "encanto", cats: ["vestuario", "acessorio"], fonte: "HA p.263",
    beneficio: "Melhora o descanso em uma categoria", efeitos: [] },

  "ajudante": { nome: "Ajudante", tipo: "encanto", cats: ["ferramenta", "acessorio"], fonte: "HA p.263",
    beneficio: "+2 no bônus de perícia fornecido pela ferramenta", escolhePericia: true,
    efeitos: [{ skill: true, changes: [{ key: "roll", value: "2" }],
      desc: "+2 na rolagem da perícia da ferramenta" }] },

  "autoritario": { nome: "Autoritário", tipo: "encanto", cats: ["vestuario", "acessorio"], fonte: "HA p.263",
    beneficio: "+2 em Intimidação e +2 na CD de efeitos de medo",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.inti.bonus", value: "2" }] }] },

  "compacto": { nome: "Compacto", tipo: "encanto", cats: ["geral", "acessorio"], fonte: "HA p.263",
    beneficio: "O equipamento não ocupa espaços", efeitos: [] },

  "imaculado": { nome: "Imaculado", tipo: "encanto", cats: ["vestuario", "acessorio"], fonte: "HA p.263",
    beneficio: "+2 em Diplomacia e +2 na CD de Aparência Inofensiva e similares",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.dipl.bonus", value: "2" }] }] },

  "insinuante": { nome: "Insinuante", tipo: "encanto", cats: ["vestuario", "acessorio"], fonte: "HA p.263",
    beneficio: "+2 em Enganação e +2 na CD de efeitos mentais",
    efeitos: [{ passivo: true, changes: [{ key: "system.pericias.enga.bonus", value: "2" }] }] },

  "ligeiro": { nome: "Ligeiro", tipo: "encanto", cats: ["geral", "acessorio"], fonte: "HA p.263",
    beneficio: "Pode ser vestido ou removido como ação livre", efeitos: [] },

  "prontidao": { nome: "Prontidão", tipo: "encanto", cats: ["geral", "acessorio"], fonte: "HA p.263",
    beneficio: "Em alcance curto, empunhar/guardar o item é ação livre", efeitos: [] }
};

/* ================================================================== */
/* MATERIAIS ESPECIAIS                                                */
/* precos por categoria de item; 0 = raro (não vendido; edite o custo)*/
/* ================================================================== */

export const MATERIAIS = {
  "aco-rubi": { nome: "Aço-Rubi", fonte: "LB p.165",
    precos: { arma: 6000, armaduraLeve: 3000, armaduraPesada: 6000, escudo: 3000, esoterico: 6000 },
    beneficio: "Arma: ignora 10 de RD e a imunidade a crítico de lefeu. Armadura/escudo: chance de ignorar dano extra de crítico/furtivo. Esotérico: magias ignoram 10 de RD de lefeu",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "ignoraRD", value: "10" }] }] },

  "adamante": { nome: "Adamante", fonte: "LB p.165",
    precos: { arma: 3000, armaduraLeve: 6000, armaduraPesada: 18000, escudo: 6000, esoterico: 3000 },
    beneficio: "Arma: dano +1 passo. Armadura/escudo: RD 2 (leves/escudos) ou 5 (pesadas). Esotérico: +1 PM para rerrolar 1s no dano",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "passos", value: "1", mode: 0 }] }] },

  "gelo-eterno": { nome: "Gelo Eterno", fonte: "LB p.165",
    precos: { arma: 600, armaduraLeve: 1500, armaduraPesada: 3000, escudo: 1500, esoterico: 3000 },
    beneficio: "Arma: +2 de dano por frio. Armadura/escudo: redução de fogo 5/10. Esotérico: rerrola 1s no dano de frio",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "dano", value: "2[frio]" }] }] },

  "madeira-tollon": { nome: "Madeira Tollon", fonte: "LB p.166",
    precos: { arma: 1500, escudo: 1500, esoterico: 1500 },
    beneficio: "Arma: conta como mágica para RD; habilidades de ataque custam −1 PM. Escudo/esotérico: resistência a magia +2",
    efeitos: [{ soCats: ["arma", "municao"], custo: "-1", desc: "Reduz em −1 PM habilidades de ataque/agredir" }] },

  "materia-vermelha": { nome: "Matéria Vermelha", fonte: "LB p.166",
    precos: { arma: 1500, armaduraLeve: 6000, armaduraPesada: 18000, escudo: 6000, esoterico: 3000 },
    beneficio: "Arma: +1d6 de dano, mas você perde 1 PV a cada acerto (lefou imunes). Impõe −2 em perícias de Carisma (exceto Intimidação)",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "dano", value: "1d6" }],
      opcional: true, desc: "Você perde 1 PV a cada acerto" }] },

  "mitral": { nome: "Mitral", fonte: "LB p.166",
    precos: { arma: 1500, armaduraLeve: 1500, armaduraPesada: 12000, escudo: 1500, esoterico: 3000 },
    beneficio: "Ocupa −1 espaço. Arma: +1 na margem de ameaça. Armadura/escudo: penalidade −2 (pesadas aplicam até 2 de Des). Esotérico: +2 PM para +2 na CD",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "criticoM", value: "-1" }] }] },

  "casco-de-monstro": { nome: "Casco de Monstro", fonte: "AA p.399",
    precos: { arma: 750, armaduraLeve: 750, armaduraPesada: 6000, escudo: 750, esoterico: 6000 },
    beneficio: "Arma: conta como primitiva para Armamento da Natureza. Armadura/escudo: penalidade −1. Esotérico: RD 5 após lançar magia",
    efeitos: [] },

  "lanajuste": { nome: "Lanajuste", fonte: "AA p.400",
    precos: { arma: 3000, armaduraLeve: 1500, armaduraPesada: 600, escudo: 3000, esoterico: 1500 },
    beneficio: "Arma: ignora penalidades de combate submerso. Armadura/escudo: redução de corte 5/10. Esotérico: rerrola 1s em dano de corte",
    efeitos: [] },

  "prata": { nome: "Prata", fonte: "AA p.400",
    precos: { arma: 3000, armaduraLeve: 1500, armaduraPesada: 600, escudo: 400, esoterico: 1500 },
    beneficio: "Arma: +2 de dano contra espíritos e mortos-vivos, considerada mágica contra eles. Pode combinar com outro material",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "dano", value: "2" }],
      opcional: true, desc: "Use somente contra espíritos e mortos-vivos" }] },

  "couraca-de-kaiju": { nome: "Couraça de Kaiju", fonte: "AA p.400",
    precos: {}, raro: true,
    beneficio: "Arma: dano +1 passo; 2 PM ignora efeitos que reduzem dano. Armadura: RD 10/20 contra tudo (mágico)",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "passos", value: "1", mode: 0 }] }] },

  "couro-de-bulette": { nome: "Couro de Bulette", fonte: "AA p.400",
    precos: {}, raro: true,
    beneficio: "Armadura: deslocamento de escavação e redução de ácido 5/10. Esotérico: rerrola 1s em dano de ácido",
    efeitos: [] },

  "cristal-de-sol": { nome: "Cristal de Sol", fonte: "AA p.400",
    precos: {}, raro: true,
    beneficio: "Arma (corte/perfuração): +2 de dano por fogo. Armadura: resistência a frio com dois dados. Esotérico: 1 PM deixa em chamas",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "dano", value: "2[fogo]" }] }] },

  "pena-de-kraken": { nome: "Pena de Kraken", fonte: "AA p.400",
    precos: {}, raro: true,
    beneficio: "Arma: acerto crítico aumenta o dano em dois passos (antes de multiplicar). Armadura: atacantes que erram perdem 5/10 PV",
    efeitos: [] },

  "quitina-razza": { nome: "Quitina Razza", fonte: "AA p.401",
    precos: {}, raro: true,
    beneficio: "Arma: dados máximos do dano básico explodem (role um dado extra a cada máximo). Armadura: +Percepção e Defesa",
    efeitos: [{ soCats: ["arma", "municao"], changes: [{ key: "dano", value: "x", mode: 0 }],
      desc: "O dado de dano básico explode em resultados máximos" }] }
};

/* ================================================================== */
/* Ícones                                                             */
/* ================================================================== */

export const ICONES = {
  melhoria: "icons/skills/trades/smithing-anvil-silver-red.webp",
  encanto: "icons/magic/symbols/runes-star-pentagon-blue.webp",
  material: "icons/commodities/metal/ingot-stamped-silver.webp"
};

/* ================================================================== */
/* Conversão: entrada do catálogo → dados de ActiveEffect             */
/* ================================================================== */

/**
 * Monta os ActiveEffects de uma entrada do catálogo.
 * @param {string} key         chave da entrada
 * @param {object} entrada     definição (catálogo ou homebrew)
 * @param {string} entradaId   id da instância no item
 * @param {Item} item          o item que recebe (para efeitos especiais)
 * @param {object} opcoes      { pericia: "luta" } — escolhas do usuário
 */
export function montarEfeitosAE(key, entrada, entradaId, item, opcoes = {}) {
  const lista = [];
  const catsItem = categoriasDoItem(item);

  for (const ef of entrada.efeitos ?? []) {
    if (ef.soCats && !ef.soCats.some(c => catsItem.includes(c))) continue;

    const nome = ef.nome ? `${entrada.nome} — ${ef.nome}` : entrada.nome;
    const passivo = !!ef.passivo;
    const skill = !!ef.skill;

    // Condições viram changes { key: "condicao", mode: CUSTOM } no mesmo
    // efeito de uso — o sistema aplica a condição oficial pelo chat.
    const condicoes = ef.condicao ? (Array.isArray(ef.condicao) ? ef.condicao : [ef.condicao]) : [];
    const changes = [
      ...(ef.changes ?? []).map(c => ({
        key: c.key, value: String(c.value), mode: c.mode ?? 2, priority: 0
      })),
      ...condicoes.map(c => ({ key: "condicao", value: c, mode: 0, priority: 0 }))
    ];

    const nomesCond = condicoes.map(c => CONDICOES[c] ?? c).join(", ");
    const descCond = nomesCond ? ` Aplica: ${nomesCond}.` : "";

    /* Efeitos passivos, de perícia (skill) e de magia (spell) precisam
     * viver NO ATOR: o motor do sistema só os enxerga lá (a transferência
     * nativa não acontece para itens já possuídos). Efeitos de uso do
     * próprio item (ataque/dano/condição) ficam no item. */
    const alvoAtor = passivo || skill || !!ef.spell;

    /* Efeitos situacionais (só valem sob certa condição — "somente
     * contra construtos", "em manobras", crítico…), com custo em PM, ou
     * de perícia (Aprimorado: só na perícia escolhida) vêm SUSPENSOS:
     * aparecem desmarcados na janela de configuração de uso e o jogador
     * habilita quando se aplica. Passivos nunca são suspensos (ficariam
     * inertes no ator). */
    const suspenso = !passivo && (skill || !!ef.opcional || (ef.custo !== undefined && ef.custo !== ""));

    const dados = {
      name: nome,
      img: ICONES[entrada.tipo] ?? ICONES.melhoria,
      description: `<p>${ef.desc ?? entrada.beneficio}.${descCond}</p><p><em>${entrada.nome} (${entrada.fonte ?? "homebrew"})</em></p>`,
      changes,
      disabled: suspenso,
      transfer: false,
      flags: {
        tormenta20: {
          onuse: !passivo,
          durationScene: !!ef.cena,
          upgrade: `hayd-${key}`,
          self: !passivo && !skill && !ef.spell,
          ...(skill ? { skill: true } : {}),
          ...(ef.spell ? { spell: true } : {}),
          ...(ef.custo !== undefined && ef.custo !== "" ? { custo: String(ef.custo) } : {})
        },
        [MODULO]: { entradaId, key, alvo: alvoAtor ? "ator" : "item" }
      }
    };

    if (ef.condicaoLivre) dados.duration = { rounds: ef.rodadas ?? 1 };

    /* Perícia escolhida pelo usuário (Aprimorado, Ajudante…): entra em
     * "Itens específicos" (flags.tormenta20.items) — o efeito só aparece
     * no diálogo de uso da perícia escolhida. */
    if (skill && opcoes.pericia) {
      const rotulo = CONFIG.T20?.pericias?.[opcoes.pericia]?.label ?? opcoes.pericia;
      dados.name = `${nome} (${rotulo})`;
      dados.flags.tormenta20.items = rotulo;
    }

    lista.push(dados);
  }
  return lista;
}

/* ================================================================== */
/* Acesso unificado (catálogo + homebrews do mundo)                   */
/* ================================================================== */

let _homebrews = () => [];
/** Registrado por homebrew.mjs para evitar dependência circular. */
export function registrarFonteHomebrew(fn) { _homebrews = fn; }

export function obterMelhorias() {
  const extra = {};
  for (const hb of _homebrews()) if (hb.tipo === "melhoria") extra[hb.key] = hb;
  return { ...MELHORIAS, ...extra };
}

export function obterEncantos() {
  const extra = {};
  for (const hb of _homebrews()) if (hb.tipo === "encanto") extra[hb.key] = hb;
  return { ...ENCANTOS, ...extra };
}

export function obterMateriais() {
  const extra = {};
  for (const hb of _homebrews()) if (hb.tipo === "material") extra[hb.key] = hb;
  return { ...MATERIAIS, ...extra };
}

export function obterEntrada(key) {
  return obterMelhorias()[key] ?? obterEncantos()[key] ?? obterMateriais()[key] ?? null;
}
