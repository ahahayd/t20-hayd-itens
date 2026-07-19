/**
 * t20-hayd-itens | editor.mjs
 * Editor de Efeitos (GM): janela nas configurações do módulo para
 * modificar individualmente o que cada melhoria/encanto/material concede
 * e como concede — no estilo do editor de Efeitos Ativos do sistema.
 * Overrides ficam salvos no mundo e sobrepõem o catálogo padrão.
 */

import {
  MODULO, CONDICOES, registrarFonteOverrides,
  obterEntrada, obterEntradaBase, obterTodasEntradas
} from "./catalogo.mjs";

const SETTING = "overrides";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/* ------------------------------------------------------------------ */
/* Armazenamento                                                      */
/* ------------------------------------------------------------------ */

export function obterOverrides() {
  try { return game.settings.get(MODULO, SETTING) ?? {}; }
  catch { return {}; }
}

async function salvarOverride(key, ov) {
  const all = foundry.utils.deepClone(obterOverrides());
  all[key] = ov;
  await game.settings.set(MODULO, SETTING, all);
}

async function removerOverride(key) {
  const all = foundry.utils.deepClone(obterOverrides());
  delete all[key];
  await game.settings.set(MODULO, SETTING, all);
}

export function registrarEditor() {
  game.settings.register(MODULO, SETTING, {
    name: "Overrides de efeitos",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  registrarFonteOverrides(obterOverrides);

  game.settings.registerMenu(MODULO, "editorEfeitos", {
    name: "Editor de Efeitos",
    label: "Abrir Editor de Efeitos",
    hint: "Modifique individualmente o que cada melhoria, encanto e material concede e como concede.",
    icon: "fa-solid fa-sliders",
    type: class extends FormApplication {
      render() { abrirEditor(); return this; }
      async _updateObject() {}
    },
    restricted: true
  });

  if (!Handlebars.helpers.sum) {
    Handlebars.registerHelper("sum", (a, b) => Number(a) + Number(b));
  }
}

export function abrirEditor() {
  new EditorManagerApp().render(true);
}

/* ------------------------------------------------------------------ */
/* Caminhos e modos (reaproveitados do editor de efeitos)             */
/* ------------------------------------------------------------------ */

function caminhosSugeridos() {
  const pericias = CONFIG?.T20?.pericias ?? {};
  return [
    { key: "ataque", rotulo: "Ataque (rolagem)" },
    { key: "dano", rotulo: "Dano — use 2 ou 2d6[frio]" },
    { key: "danoCritico", rotulo: "Dano só em crítico (ex.: 10)" },
    { key: "criticoM", rotulo: "Margem de ameaça (−1 = +1 de margem)" },
    { key: "criticoX", rotulo: "Multiplicador de crítico (+1)" },
    { key: "ignoraRD", rotulo: "Ignora redução de dano (ex.: 5)" },
    { key: "passos", rotulo: "Passos de dano (modo Personalizado; ex.: 1)" },
    { key: "tipoDano", rotulo: "Substituir tipo de dano (modo Sobrepor)" },
    { key: "system.attributes.defesa.bonus", rotulo: "Defesa (bônus)" },
    { key: "system.attributes.pv.max", rotulo: "PV máximos" },
    { key: "system.attributes.pm.max", rotulo: "PM máximos" },
    { key: "system.attributes.cd", rotulo: "CD de habilidades" },
    { key: "system.modificadores.pericias.resistencia", rotulo: "Resistências (use +N)" },
    { key: "system.modificadores.pericias.geral", rotulo: "Todas as perícias (use +N)" },
    { key: "system.modificadores.dano.geral", rotulo: "Todo dano (use +N)" },
    { key: "system.tracos.resistencias.fogo.bonus", rotulo: "Redução de fogo" },
    { key: "system.tracos.resistencias.frio.bonus", rotulo: "Redução de frio" },
    { key: "system.tracos.resistencias.acido.bonus", rotulo: "Redução de ácido" },
    { key: "system.tracos.resistencias.eletricidade.bonus", rotulo: "Redução de eletricidade" },
    ...Object.entries(pericias).map(([k, v]) => ({ key: `system.pericias.${k}.bonus`, rotulo: `Perícia: ${v.label ?? k}` }))
  ];
}

const MODOS = [
  { v: 2, l: "Somar (+)" },
  { v: 0, l: "Personalizado (passos, kh…)" },
  { v: 5, l: "Sobrepor (=)" },
  { v: 1, l: "Multiplicar (×)" },
  { v: 4, l: "Aumentar (mín.)" },
  { v: 3, l: "Reduzir (máx.)" }
];

const TIPOS = [
  { v: "uso", l: "Uso da própria arma (ataque/dano)" },
  { v: "ataque", l: "Rider de ataque (arma que modifica ataques)" },
  { v: "passivo", l: "Passivo (sempre ativo no personagem)" },
  { v: "pericia", l: "Perícia (aparece no teste da perícia)" },
  { v: "magia", l: "Magia (aparece ao conjurar)" }
];

function modoValido(m) {
  const n = Number(m);
  return [0, 1, 2, 3, 4, 5].includes(n) ? n : 2;
}

/* Converte um efeito do catálogo → forma editável na UI. */
function efeitoParaUI(ef) {
  const tipo = ef.passivo ? "passivo"
    : ef.skill ? "pericia"
    : ef.spell ? "magia"
    : ef.ataque ? "ataque"
    : "uso";
  const conds = ef.condicao ? (Array.isArray(ef.condicao) ? ef.condicao : [ef.condicao]) : [];
  return {
    tipo,
    custo: ef.custo ?? "",
    opcional: !!ef.opcional,
    cena: !!ef.cena,
    nome: ef.nome ?? "",
    desc: ef.desc ?? "",
    conds,
    changes: (ef.changes ?? []).map(c => ({ key: c.key, mode: c.mode ?? 2, value: String(c.value) }))
  };
}

/* Converte a forma da UI → efeito do catálogo. */
function uiParaEfeito(u) {
  const ef = {};
  if (u.tipo === "passivo") ef.passivo = true;
  else if (u.tipo === "pericia") ef.skill = true;
  else if (u.tipo === "magia") ef.spell = true;
  else if (u.tipo === "ataque") ef.ataque = true;
  if (u.custo !== "" && u.custo != null) ef.custo = String(u.custo).trim();
  if (u.opcional) ef.opcional = true;
  if (u.cena) ef.cena = true;
  if (u.nome) ef.nome = u.nome.trim();
  if (u.desc) ef.desc = u.desc.trim();
  const conds = (u.conds ?? []).filter(Boolean);
  if (conds.length) ef.condicao = conds.length === 1 ? conds[0] : conds;
  const changes = (u.changes ?? [])
    .filter(c => c.key?.trim() && String(c.value).trim() !== "")
    .map(c => ({ key: c.key.trim(), value: String(c.value).trim(), mode: modoValido(c.mode) }));
  if (changes.length) ef.changes = changes;
  return ef;
}

/* ================================================================== */
/* Janela gerenciadora (lista)                                        */
/* ================================================================== */

class EditorManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "hayd-itens-editor",
    classes: ["t20-hayd-itens-editor"],
    window: { title: "Editor de Efeitos — Itens Superiores e Mágicos", icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 720, height: 640 }
  };
  static PARTS = { main: { template: `modules/${MODULO}/templates/editor-lista.hbs` } };

  _busca = "";
  _grupo = "";

  async _prepareContext() {
    const overrides = obterOverrides();
    const busca = this._busca.trim().toLowerCase();
    let entradas = obterTodasEntradas().map(e => ({
      key: e.key,
      nome: e.nome,
      grupo: e.grupo,
      fonte: e.fonte ?? "homebrew",
      beneficio: e.beneficio ?? "",
      especial: e.especial === "alquimica",
      modificado: !!overrides[e.key]
    }));
    if (this._grupo) entradas = entradas.filter(e => e.grupo === this._grupo);
    if (busca) entradas = entradas.filter(e =>
      e.nome.toLowerCase().includes(busca) || e.key.toLowerCase().includes(busca)
    );
    entradas.sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));

    const grupos = [...new Set(obterTodasEntradas().map(e => e.grupo))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return { entradas, grupos, busca: this._busca, grupoSel: this._grupo };
  }

  _onRender() {
    const el = this.element;
    el.querySelector(".hayd-editor-busca")?.addEventListener("input", ev => {
      this._busca = ev.currentTarget.value;
      this.render();
      requestAnimationFrame(() => {
        const inp = this.element.querySelector(".hayd-editor-busca");
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
      });
    });
    el.querySelector(".hayd-editor-grupo")?.addEventListener("change", ev => {
      this._grupo = ev.currentTarget.value;
      this.render();
    });
    el.querySelectorAll(".hayd-editar").forEach(b => b.addEventListener("click", () => {
      new EditorEntradaApp(b.dataset.key, () => this.render()).render(true);
    }));
    el.querySelectorAll(".hayd-restaurar").forEach(b => b.addEventListener("click", async () => {
      const nome = obterEntrada(b.dataset.key)?.nome ?? b.dataset.key;
      const ok = await DialogV2.confirm({
        window: { title: "Restaurar padrão" },
        content: `<p>Descartar suas modificações em <strong>${nome}</strong> e voltar ao padrão do módulo?</p>`
      });
      if (!ok) return;
      await removerOverride(b.dataset.key);
      this.render();
    }));
  }
}

/* ================================================================== */
/* Editor de uma entrada                                              */
/* ================================================================== */

class EditorEntradaApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["t20-hayd-itens-editor", "editor-entrada"],
    window: { title: "Editar efeito", icon: "fa-solid fa-pen", resizable: true },
    position: { width: 640, height: 700 }
  };
  static PARTS = { main: { template: `modules/${MODULO}/templates/editor-entrada.hbs` } };

  constructor(key, aoSalvar) {
    super();
    this.key = key;
    this._aoSalvar = aoSalvar;
    const def = obterEntrada(key) ?? {};
    this._base = obterEntradaBase(key) ?? {};
    this._beneficio = def.beneficio ?? "";
    // Só automações exclusivas de fato são desabilitáveis pelo GM. Hoje,
    // apenas a Injeção Alquímica (carregar/injetar preparados). As marcações
    // "ameacadora"/"lancinante" são internas (como o efeito é montado).
    const NOMES_ESPECIAL = { alquimica: "Injeção Alquímica — carregar/injetar preparados" };
    this._temEspecial = this._base.especial === "alquimica";
    this._especialNome = NOMES_ESPECIAL[this._base.especial] ?? this._base.especial ?? "";
    this._especialDesabilitado = !!obterOverrides()[key]?.especialDesabilitado;
    this._efeitos = (def.efeitos ?? []).map(efeitoParaUI);
  }

  get title() { return `Editar: ${obterEntrada(this.key)?.nome ?? this.key}`; }

  async _prepareContext() {
    const condicoes = Object.entries(CONDICOES).map(([id, nome]) => ({ id, nome }));
    return {
      fonte: this._base.fonte ?? "homebrew",
      beneficio: this._beneficio,
      temEspecial: this._temEspecial,
      especialNome: this._especialNome,
      especialDesabilitado: this._especialDesabilitado,
      efeitos: this._efeitos.map(e => ({
        ...e,
        changes: e.changes.map(c => ({ ...c })),
        condicoes: condicoes.map(cc => ({ ...cc, marcada: e.conds.includes(cc.id) }))
      })),
      condicoes,
      tipos: TIPOS,
      modos: MODOS,
      caminhos: caminhosSugeridos()
    };
  }

  /** Lê o formulário para o estado interno (antes de re-render/salvar). */
  _lerForm() {
    const form = this.element.querySelector("form");
    if (!form) return;
    const dados = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    this._beneficio = dados.beneficio ?? this._beneficio;
    this._especialDesabilitado = !!dados.especialDesabilitado;

    const efArr = dados.ef ? Object.values(dados.ef) : [];
    this._efeitos = efArr.map(e => {
      const changes = e.ch ? Object.values(e.ch).map(c => ({ key: c.key ?? "", mode: modoValido(c.mode), value: c.value ?? "" })) : [];
      const conds = e.cond ? Object.entries(e.cond).filter(([, v]) => v).map(([k]) => k) : [];
      return {
        tipo: e.tipo ?? "uso",
        custo: e.custo ?? "",
        opcional: !!e.opcional,
        cena: !!e.cena,
        nome: e.nome ?? "",
        desc: e.desc ?? "",
        conds,
        changes
      };
    });
  }

  _onRender() {
    const el = this.element;
    el.querySelector(".hayd-add-efeito")?.addEventListener("click", () => {
      this._lerForm();
      this._efeitos.push({ tipo: "uso", custo: "", opcional: false, cena: false, nome: "", desc: "", conds: [], changes: [] });
      this.render();
    });
    el.querySelectorAll(".hayd-rem-efeito").forEach(b => b.addEventListener("click", () => {
      this._lerForm();
      this._efeitos.splice(Number(b.dataset.idx), 1);
      this.render();
    }));
    el.querySelectorAll(".hayd-add-change").forEach(b => b.addEventListener("click", () => {
      this._lerForm();
      this._efeitos[Number(b.dataset.idx)]?.changes.push({ key: "", mode: 2, value: "" });
      this.render();
    }));
    el.querySelectorAll(".hayd-rem-change").forEach(b => b.addEventListener("click", () => {
      this._lerForm();
      this._efeitos[Number(b.dataset.idx)]?.changes.splice(Number(b.dataset.cidx), 1);
      this.render();
    }));
    el.querySelector(".hayd-salvar")?.addEventListener("click", () => this._salvar());
    el.querySelector(".hayd-restaurar-editor")?.addEventListener("click", () => this._restaurar());
  }

  async _salvar() {
    this._lerForm();
    const efeitos = this._efeitos.map(uiParaEfeito);
    const ov = { efeitos };
    if (this._beneficio && this._beneficio !== this._base.beneficio) ov.beneficio = this._beneficio;
    if (this._temEspecial && this._especialDesabilitado) ov.especialDesabilitado = true;
    await salvarOverride(this.key, ov);
    ui.notifications.info(`"${obterEntrada(this.key)?.nome ?? this.key}" atualizado. Itens que já usam esta entrada mantêm os efeitos antigos — remova e readicione para atualizar.`);
    this._aoSalvar?.();
    this.close();
  }

  async _restaurar() {
    const ok = await DialogV2.confirm({
      window: { title: "Restaurar padrão" },
      content: `<p>Descartar as modificações e voltar ao padrão do módulo?</p>`
    });
    if (!ok) return;
    await removerOverride(this.key);
    ui.notifications.info("Voltou ao padrão do módulo.");
    this._aoSalvar?.();
    this.close();
  }
}
