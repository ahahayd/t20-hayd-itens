/**
 * t20-hayd-itens | rolagem.mjs
 * Ganchos no fluxo de uso de itens do sistema (ItemT20.rollDamage e
 * ItemT20.displayCard), para o que os Efeitos Ativos não expressam:
 *
 *  - dano fixo tipado ("2[fogo]"): o sistema só tipa dados; aqui a parte
 *    vira [2, "fogo"] antes da rolagem;
 *  - Pena de Kraken: no crítico, o dado da arma sobe dois passos;
 *  - Assassina: dados do Ataque Furtivo viram d8 e, com os 2 PM, rolam
 *    novamente os 1s;
 *  - rolagens extras de efeitos usados (raio da Elétrica, bola de fogo da
 *    Flamejante, PV temporários do Drenante…), no mesmo cartão;
 *  - cópias dos modelos oferecidas no chat saem limpas (o sistema mistura
 *    nelas as mudanças de todos os efeitos do ataque);
 *  - efeitos que agem ao serem usados (RD da Cuidadora aplicada no
 *    usuário, ativação da Dançarina).
 */

import { MODULO } from "./catalogo.mjs";
import { registroAtivo, opcoesDoRegistro } from "./efeitos.mjs";
import {
  separarNumeroTipado, subirPassos, dadosAssassina, acharSugestao,
  aplicacoesDoFormulario, temFormulario
} from "./regras.mjs";
import { ativarDancarina, especialLigado } from "./automacoes.mjs";

const TIPOS_USO = {
  atributo: "ability", pericia: "skill", arma: "attack", magia: "spell",
  poder: "power", consumivel: "consumable", equipamento: "equipment"
};

/* ------------------------------------------------------------------ */
/* Registro                                                           */
/* ------------------------------------------------------------------ */

export function registrarEnvoltorios() {
  envolver("rollDamage", aoRolarDano);
  envolver("displayCard", aoExibirCartao);
}

/** Envolve um método de ItemT20 (libWrapper, se ativo; senão, direto). */
function envolver(metodo, fn) {
  const classe = CONFIG.Item.documentClass;
  if (typeof classe?.prototype?.[metodo] !== "function") {
    console.warn(`${MODULO} | ItemT20.${metodo} não encontrado — automações de rolagem desligadas.`);
    return;
  }
  if (globalThis.libWrapper && game.modules.get("lib-wrapper")?.active) {
    libWrapper.register(MODULO, `CONFIG.Item.documentClass.prototype.${metodo}`,
      function (original, ...args) { return fn.call(this, original, ...args); }, "WRAPPER");
    return;
  }
  const original = classe.prototype[metodo];
  classe.prototype[metodo] = function (...args) {
    return fn.call(this, (...a) => original.apply(this, a), ...args);
  };
}

/* ------------------------------------------------------------------ */
/* Efeitos aplicados neste uso                                        */
/* ------------------------------------------------------------------ */

/**
 * Efeitos de uso aplicados no uso em curso: pelas marcações do diálogo
 * (aprs) ou, sem diálogo, todos os ativos que o sistema aplicou.
 * @returns {{efeito: ActiveEffect, qtd: number}[]}
 */
export function efeitosAplicados(item, opcoes = {}) {
  const ator = item.actor;
  if (!ator) return [];
  const saida = [];

  if (temFormulario(opcoes)) {
    for (const [id, qtd] of aplicacoesDoFormulario(opcoes)) {
      const efeito = item.effects.get(id) ?? ator.effects.get(id);
      if (efeito) saida.push({ efeito, qtd });
    }
    return saida;
  }

  // Sem diálogo, o sistema aplica todo efeito de uso não suspenso.
  if (!Array.isArray(opcoes.onUseEffects)) return saida;
  const tipo = TIPOS_USO[item.type];
  for (const efeito of item.effects) {
    const t = efeito.flags?.tormenta20 ?? {};
    if (t.onuse && !efeito.disabled && (t.self || t[tipo])) saida.push({ efeito, qtd: 1 });
  }
  for (const efeito of ator.effects) {
    const t = efeito.flags?.tormenta20 ?? {};
    if (t.onuse && !efeito.disabled && t[tipo]) saida.push({ efeito, qtd: 1 });
  }
  return saida;
}

/* ------------------------------------------------------------------ */
/* Modelos oferecidos no chat                                         */
/* ------------------------------------------------------------------ */

/**
 * Cópia de um modelo pronta para ir a um ator: mudanças, duração e estado
 * inicial do catálogo (o sistema forçaria "ativo", "cena" e as mudanças
 * de todos os efeitos usados no ataque).
 */
export function sanearCopiaDeModelo(dados) {
  const m = dados?.flags?.[MODULO];
  if (!m?.modelo) return dados;
  const saida = foundry.utils.deepClone(dados);
  saida.changes = foundry.utils.deepClone(m.changesModelo ?? []);

  // `onuse` da cópia sai do catálogo, não do item: um modelo destravado
  // (naoSuspenso) fica marcado como de uso NO ITEM só para o sistema não o
  // listar sozinho — no alvo ele tem de voltar ao que o catálogo pediu.
  const t = { ...(saida.flags.tormenta20 ?? {}), self: false, onuse: !!m.modeloUso };
  const duracao = m.duracaoModelo;
  if (duracao === "cena") {
    t.durationScene = true;
    saida.duration = {};
  } else {
    t.durationScene = false;
    saida.duration = { rounds: Number(duracao?.rounds) || 1 };
  }
  saida.flags.tormenta20 = t;
  saida.disabled = !!m.suspensoNoAlvo;
  saida.transfer = false;
  saida.flags[MODULO] = {
    copiaDeModelo: m.modelo,
    ...(m.expiraAoSofrerDano ? { expiraAoSofrerDano: true } : {})
  };
  delete saida._id;
  return saida;
}

function sanearEfeitosDoCartao(opcoes) {
  for (const grupo of opcoes.effects ?? []) {
    if (!Array.isArray(grupo)) continue;
    for (let i = 0; i < grupo.length; i++) {
      const bruto = grupo[i]?.toObject ? grupo[i].toObject() : grupo[i];
      if (bruto?.flags?.[MODULO]?.modelo) grupo[i] = sanearCopiaDeModelo(bruto);
    }
  }
}

/** Aplica um modelo do item direto no ator (ex.: RD da Cuidadora). */
async function aplicarModeloNoUsuario(item, ator, modeloId) {
  const modelo = item.effects.find(e => e.flags?.[MODULO]?.modelo === modeloId);
  if (!modelo) return;
  const dados = sanearCopiaDeModelo(modelo.toObject());
  dados.origin = item.uuid;
  await ator.createEmbeddedDocuments("ActiveEffect", [dados]);
  ui.notifications.info(`${dados.name}: aplicado em ${ator.name}.`);
}

/* ------------------------------------------------------------------ */
/* rollDamage                                                         */
/* ------------------------------------------------------------------ */

function ataqueCritico(item) {
  return Object.values(item.system?.rolled ?? {}).some(r => r?._critical);
}

/** Pena de Kraken (variante de arma) valendo nesta arma? */
function krakenAtivo(item) {
  if (!especialLigado("pena-de-kraken", "kraken")) return false;
  const achado = registroAtivo(item, "pena-de-kraken");
  return !!achado && opcoesDoRegistro(item, achado.lista, achado.reg).variante === "arma";
}

/** Poder de Ataque Furtivo escolhido na Assassina (ou achado pelo nome). */
function poderFurtivo(ator, alvos) {
  const poderes = ator.items.filter(i => i.type === "poder");
  const escolhido = poderes.find(p => alvos?.includes(p.name));
  if (escolhido) return escolhido;
  const nome = acharSugestao(poderes.map(p => p.name), "Ataque Furtivo");
  return nome ? poderes.find(p => p.name === nome) : null;
}

function prepararDano(item, opcoes) {
  const rolls = (item.system?.rolls ?? []).filter(r => r.type === "dano" && Array.isArray(r.parts));

  // "2[fogo]": o sistema montaria "2[fogo][corte]" e a rolagem quebraria.
  for (const r of rolls) {
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      const tipado = Array.isArray(p) ? separarNumeroTipado(p[0]) : null;
      if (tipado) r.parts[i] = [tipado.valor, tipado.tipo, p[2] ?? ""];
    }
  }

  if (item.type !== "arma" || !item.actor || !item.flags?.[MODULO]) return;

  // Pena de Kraken: crítico sobe o dado da arma em dois passos, antes de
  // o sistema multiplicar (o multiplicador age sobre o primeiro dado).
  if (ataqueCritico(item) && krakenAtivo(item)) {
    const tabela = CONFIG.T20?.passosDano;
    for (const r of rolls) {
      const base = r.parts[0];
      if (Array.isArray(base) && typeof base[0] === "string") r.parts[0] = [subirPassos(base[0], 2, tabela), ...base.slice(1)];
    }
  }

  // Assassina: o furtivo entra no dano como a rolagem do próprio poder
  // (mudança "dano: roll"); a parte é identificada por essa referência.
  const assassina = especialLigado("assassina") ? registroAtivo(item, "assassina") : null;
  if (assassina) {
    const poder = poderFurtivo(item.actor, assassina.reg.alvos);
    const ref = poder?.system?.rolls?.find(r => r.type === "dano")?.parts?.[0];
    const aplicados = efeitosAplicados(item, opcoes);
    const usouFurtivo = poder && aplicados.some(({ efeito }) => (efeito.origin ?? "").endsWith(`Item.${poder.id}`));
    if (ref && usouFurtivo) {
      const rerrolar = aplicados.some(({ efeito }) => efeito.flags?.[MODULO]?.gatilho === "assassina");
      for (const r of rolls) {
        for (let i = 1; i < r.parts.length; i++) {
          const p = r.parts[i];
          if (p === ref || (Array.isArray(p) && p[0] === ref[0] && p[1] === ref[1])) {
            r.parts[i] = [dadosAssassina(p[0], rerrolar), p[1], p[2] ?? ""];
          }
        }
      }
    }
  }
}

/** Rolagens à parte de efeitos usados, no mesmo cartão (após o dano). */
async function rolagensExtras(item, opcoes) {
  if (!item.actor || !item.system?.rolled) return;
  const critico = ataqueCritico(item);
  for (const { efeito } of efeitosAplicados(item, opcoes)) {
    const extra = efeito.flags?.[MODULO]?.rolagemExtra;
    if (!extra?.formula || (extra.soCritico && !critico)) continue;
    const titulo = extra.titulo || efeito.name;
    const roll = await new Roll(extra.formula, item.getRollData(), {
      type: "damage", haydExtra: true, ...(extra.receber ? { haydReceber: true } : {})
    }).evaluate();
    item.system.rolled[titulo] = roll;
  }
}

async function aoRolarDano(original, ...args) {
  const opcoes = args[0]?.options ?? {};
  try { prepararDano(this, opcoes); }
  catch (err) { console.error(`${MODULO} | Falha ao preparar o dano`, err); }

  const resultado = await original(...args);

  try { await rolagensExtras(this, opcoes); }
  catch (err) { console.error(`${MODULO} | Falha nas rolagens extras`, err); }
  return resultado;
}

/* ------------------------------------------------------------------ */
/* displayCard                                                        */
/* ------------------------------------------------------------------ */

/**
 * Efeitos que agem ao serem usados. O sistema rola uma CÓPIA do item
 * (sem id); o item de verdade vem de options.itemId.
 */
async function efeitosPosUso(item, opcoes) {
  const ator = item.actor;
  const real = ator?.items.get(opcoes.itemId ?? item.id);
  if (!real) return;
  for (const { efeito } of efeitosAplicados(item, opcoes)) {
    const m = efeito.flags?.[MODULO];
    if (!m) continue;
    if (m.aplicaNoUsuario) await aplicarModeloNoUsuario(real, ator, m.aplicaNoUsuario);
    if (m.gatilho === "dancarina" && especialLigado("dancarina") && registroAtivo(real, "dancarina")) {
      await ativarDancarina(real, m.entradaId, { pagar: false });
    }
  }
}

async function aoExibirCartao(original, ...args) {
  const opcoes = args[0]?.options ?? {};
  try { sanearEfeitosDoCartao(opcoes); }
  catch (err) { console.error(`${MODULO} | Falha ao preparar os efeitos do cartão`, err); }

  const resultado = await original(...args);

  // Só no uso de verdade (o "mostrar cartão" do menu não passa pelo
  // motor de efeitos e não traz onUseEffects).
  if (Array.isArray(opcoes.onUseEffects) && this.flags?.[MODULO]) {
    try { await efeitosPosUso(this, opcoes); }
    catch (err) { console.error(`${MODULO} | Falha nas automações de uso`, err); }
  }
  return resultado;
}
