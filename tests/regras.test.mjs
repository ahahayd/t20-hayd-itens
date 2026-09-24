import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNome, acharSugestao, preencherMarcadores, temMarcadores,
  separarNumeroTipado, subirPassos, dadosAssassina, agravarSangramento,
  limitar, custoDeConjuracao, aplicacoesDoFormulario, temFormulario, houveDano} from "../scripts/regras.mjs";

const PASSOS = [
  ["1", "1d2", "1d3", "1d4", "1d6", "1d8", "1d10", "1d12", "3d6", "4d6", "4d8", "4d10", "4d12"],
  ["1", "1d2", "1d3", "1d4", "1d6", "1d8", "1d10", "2d6", "2d8", "3d8", "4d8", "4d10", "4d12"],
  ["1", "1d2", "1d3", "1d4", "1d6", "1d8", "1d10", "2d6", "2d8", "2d10", "3d10", "4d10", "4d12"]
];

test("nomes são comparados sem acento e sem caixa", () => {
  assert.equal(normalizarNome("  Escuridão  "), "escuridao");
  assert.equal(acharSugestao(["Luz", "Escuridão"], "escuridao"), "Escuridão");
  assert.equal(acharSugestao(["Ataque Furtivo Aprimorado", "Ataque Furtivo"], "ataque furtivo"), "Ataque Furtivo");
  assert.equal(acharSugestao(["Abençoar Arma (Khalmyr)"], "Abençoar Arma"), "Abençoar Arma (Khalmyr)");
  assert.equal(acharSugestao(["Luz"], "Escuridão"), null);
});

test("marcadores de nome", () => {
  assert.equal(preencherMarcadores("Cantante: {arma} de {ator}", { arma: "Alaúde", ator: "Lia" }), "Cantante: Alaúde de Lia");
  assert.equal(preencherMarcadores("Sem {nada}", {}), "Sem {nada}");
  assert.ok(temMarcadores("Ocultar {objeto}"));
  assert.ok(!temMarcadores("Fixo"));
});

test("número fixo tipado é separado; dados não", () => {
  assert.deepEqual(separarNumeroTipado("2[fogo]"), { valor: "2", tipo: "fogo" });
  assert.deepEqual(separarNumeroTipado(" +1 [frio] "), { valor: "1", tipo: "frio" });
  assert.equal(separarNumeroTipado("2d6[fogo]"), null);
  assert.equal(separarNumeroTipado("2"), null);
});

test("passos de dano seguem a tabela do sistema", () => {
  assert.equal(subirPassos("1d8", 2, PASSOS), "1d12");
  assert.equal(subirPassos("2d6", 2, PASSOS), "4d6");     // 2d6 conta como 1d12
  assert.equal(subirPassos("1d6+2", 1, PASSOS), "1d8+2");
  assert.equal(subirPassos("4d12", 2, PASSOS), "4d12");   // topo da tabela
  assert.equal(subirPassos("@for", 2, PASSOS), "@for");
});

test("Assassina troca os dados do furtivo por d8 e rerrola 1s com 2 PM", () => {
  assert.equal(dadosAssassina("3d6", false), "3d8");
  assert.equal(dadosAssassina("3d6", true), "3d8rr1");
  assert.equal(dadosAssassina("(ceil(@nivel/2))d6", true), "(ceil(@nivel/2))d8rr1");
  assert.equal(dadosAssassina("2d8rr1", true), "2d8rr1");
});

test("sangramento cumulativo soma 1d6", () => {
  assert.equal(agravarSangramento("1d6[perda]"), "2d6[perda]");
  assert.equal(agravarSangramento("3d6[perda]"), "4d6[perda]");
  assert.equal(agravarSangramento(""), "2d6[perda]");
});

test("limitar", () => {
  assert.equal(limitar(7, 0, 5), 5);
  assert.equal(limitar(-1, 0, 5), 0);
  assert.equal(limitar("3", 0, 5), 3);
});

test("custo de conjuração", () => {
  assert.equal(custoDeConjuracao({ custoTotal: 3, custoBase: 3 }), 3);
  assert.equal(custoDeConjuracao({ custoTotal: 0, custoBase: 1 }), 1);   // mínimo 1 PM
  assert.equal(custoDeConjuracao({ custoTotal: 0, custoBase: 0 }), 0);
  assert.equal(custoDeConjuracao({ custoTotal: 5, custoBase: 3, truque: true }), 0);
  assert.equal(custoDeConjuracao({ custoTotal: 6, custoBase: 3, metade: true }), 3);
  assert.equal(custoDeConjuracao({ custoTotal: 3, custoBase: 3, extra: 1, ajuste: -1 }), 3);
});

test("aplicações do diálogo de uso", () => {
  const aninhado = { aprs: { a: { aplica: true }, b: { aplica: false }, c: { aplica: 3 } } };
  assert.deepEqual([...aplicacoesDoFormulario(aninhado)], [["a", 1], ["c", 3]]);
  const plano = { "aprs.x.aplica": true, "aprs.y.aplica": 0, bonus: "" };
  assert.deepEqual([...aplicacoesDoFormulario(plano)], [["x", 1]]);
  assert.ok(temFormulario(aninhado));
  assert.ok(temFormulario(plano));
  assert.ok(!temFormulario({ onUseEffects: [] }));
});

test("dano absorvido pela RD ainda conta como dano sofrido", () => {
  // É o caso da Cuidadora: RD 10 contra um golpe de 8 não tira PV nenhum,
  // mas a RD foi usada e tem de sair.
  assert.equal(houveDano({ corte: { value: 8 } }, 1), true);
  assert.equal(houveDano({ corte: { value: 8 }, fogo: { value: 0 } }, 1), true);
});

test("cura e mana não gastam a RD de uso único", () => {
  // Cura entra pelo mesmo caminho, com multiplicador negativo
  assert.equal(houveDano({ curapv: { value: 10 } }, -1), false);
  assert.equal(houveDano({}, 1), false);
  assert.equal(houveDano(undefined, 1), false);
});

test("parcela sem valor não conta como dano", () => {
  assert.equal(houveDano({ corte: { value: 0 } }, 1), false);
  assert.equal(houveDano({ corte: {} }, 1), false);
});
