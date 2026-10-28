import { test } from "node:test";
import assert from "node:assert/strict";
import { resumoDoItem, resumoParaColuna, chipsHtml, PIPS_VISIVEIS } from "../scripts/badges.mjs";

// O Foundry fornece o Handlebars; aqui basta o escape de HTML que ele faz.
globalThis.Handlebars ??= {
  escapeExpression: (s) => String(s).replace(/[&<>"'`=]/g, (c) => `&#${c.charCodeAt(0)};`)
};

const arma = (flags) => ({
  type: "arma",
  system: { preco: 100, tipo: "" },
  flags: { "t20-hayd-itens": { precoBase: 100, ...flags } }
});

test("item sem aprimoramentos não tem resumo nem chips", () => {
  assert.equal(resumoDoItem(arma({})), null);
  assert.equal(chipsHtml(null), "");
});

test("melhoria substituída continua contando (Cruel + Atroz são duas)", () => {
  const resumo = resumoDoItem(arma({
    melhorias: [{ id: "c", key: "cruel", suprimidaPor: "a" }, { id: "a", key: "atroz" }]
  }));
  assert.equal(resumo.nMelhorias, 2);
  const cruel = resumo.melhorias.find(m => m.key === "cruel");
  assert.equal(cruel.ativa, false);
  assert.equal(cruel.suprimidaPor, "Atroz");
});

test("melhoria desativada também conta, como no preço", () => {
  const resumo = resumoDoItem(arma({ melhorias: [{ id: "c", key: "cruel", desativada: true }] }));
  assert.equal(resumo.nMelhorias, 1);
  assert.equal(resumo.melhorias[0].ativa, false);
});

test("encantos são contados à parte das melhorias", () => {
  const resumo = resumoDoItem(arma({
    melhorias: [{ id: "c", key: "certeira" }],
    encantos: [{ id: "f", key: "flamejante" }, { id: "v", key: "veloz" }]
  }));
  assert.equal(resumo.nMelhorias, 1);
  assert.equal(resumo.nEncantos, 2);
});

const mat = (h = 22) => ({ h, c: .1, nome: "Material" });

test("a coluna da Ficha Hayd mostra no máximo 4 marcas e o resto vira +N", () => {
  const col = resumoParaColuna({ nMelhorias: 7, nEncantos: 0 });
  assert.equal(col.marcas.length, PIPS_VISIVEIS);
  assert.equal(col.mais, 3);
  assert.equal(col.encanto, false);
  assert.equal(col.estrelas.length, 0);

  const poucas = resumoParaColuna({ nMelhorias: 2, nEncantos: 1 });
  assert.equal(poucas.marcas.length, 2);
  assert.equal(poucas.mais, 0);
  assert.equal(poucas.encanto, true);
});

test("a coluna mostra uma estrela por encanto, também com limite de 4", () => {
  assert.equal(resumoParaColuna({ nMelhorias: 0, nEncantos: 3 }).estrelas.length, 3);
  const muitos = resumoParaColuna({ nMelhorias: 1, nEncantos: 6 });
  assert.equal(muitos.estrelas.length, PIPS_VISIVEIS);
  assert.equal(muitos.maisEncantos, 2);
});

test("o material especial conta como aprimoramento e é a primeira marca (1, 2 ou 4)", () => {
  const um = resumoParaColuna({ nMelhorias: 0, nEncantos: 0, materiais: [mat()] });
  assert.deepEqual(um.marcas.map(m => m.material), [true]);
  const dois = resumoParaColuna({ nMelhorias: 1, nEncantos: 0, materiais: [mat()] });
  assert.deepEqual(dois.marcas.map(m => m.material), [true, false]);
  const quatro = resumoParaColuna({ nMelhorias: 3, nEncantos: 0, materiais: [mat()] });
  assert.deepEqual(quatro.marcas.map(m => m.material), [true, false, false, false]);
});

test("com 3 marcas o material é a ponta do triângulo (a última)", () => {
  const tres = resumoParaColuna({ nMelhorias: 2, nEncantos: 0, materiais: [mat()] });
  assert.deepEqual(tres.marcas.map(m => m.material), [false, false, true]);
});

test("passando de 4 aprimoramentos, o material continua visível e o resto vira +N", () => {
  const col = resumoParaColuna({ nMelhorias: 5, nEncantos: 0, materiais: [mat()] });
  assert.equal(col.marcas.length, PIPS_VISIVEIS);
  assert.equal(col.marcas[0].material, true);
  assert.equal(col.mais, 2);
});

test("os chips trazem contadores e o tooltip, e escapam nomes do homebrew", () => {
  const html = chipsHtml(resumoDoItem(arma({
    melhorias: [{ id: "c", key: "certeira" }, { id: "x", key: "<img onerror=1>" }]
  })));
  assert.match(html, /hbdg-mel/);
  assert.ok(!html.includes("<img onerror"));
});

test("item com encanto conta como mágico por padrão, e a marca do usuário vence", () => {
  const comEncanto = { encantos: [{ id: "f", key: "flamejante" }] };
  assert.equal(resumoDoItem(arma(comEncanto)).magico, true);
  assert.equal(resumoDoItem(arma({ ...comEncanto, magico: false })).magico, false);
  assert.equal(resumoDoItem(arma({ melhorias: [{ id: "c", key: "certeira" }] })).magico, false);
});

test("item marcado como mágico à mão tem resumo mesmo sem nenhum aprimoramento", () => {
  const resumo = resumoDoItem(arma({ magico: true }));
  assert.equal(resumo.magico, true);
  assert.equal(resumo.nMelhorias + resumo.nEncantos, 0);
  assert.equal(resumoDoItem(arma({ magico: false })), null);
});
