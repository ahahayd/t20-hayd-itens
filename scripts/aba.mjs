/**
 * t20-hayd-itens | aba.mjs
 * Substitui a aba de Aprimoramentos do sistema pela aba
 * "Melhorias & Encantos" do módulo, sem limite de slots.
 */

import {
  MODULO, CATEGORIAS, categoriasDoItem, itemElegivel, categoriaMaterialDoItem,
  obterMelhorias, obterEncantos, obterMateriais, obterEntrada
} from "./catalogo.mjs";
import {
  dadosDoItem, ehMunicao, calcularPreco, definirPrecoBase,
  adicionarEntrada, adicionarMaterial, removerEntrada, atualizarCustoMaterial
} from "./efeitos.mjs";
import { abrirGerenciadorHomebrew } from "./homebrew.mjs";
import { descarregarAlquimico } from "./alquimica.mjs";

const ABA_ID = "hayd-itens";

/**
 * Adiciona uma entrada; se ela exige escolha de perícia (Aprimorado,
 * Ajudante), pergunta qual perícia o item beneficia — a escolha entra em
 * "Itens específicos" do efeito de uso, restringindo-o a essa perícia.
 */
async function adicionarComEscolha(item, key) {
  const def = obterEntrada(key);
  if (def?.escolhePericia) {
    const pericias = CONFIG?.T20?.pericias ?? {};
    const opcoes = Object.entries(pericias)
      .sort((a, b) => (a[1].label ?? a[0]).localeCompare(b[1].label ?? b[0], "pt-BR"))
      .map(([k, v]) => `<option value="${k}">${v.label ?? k}</option>`)
      .join("");
    const dados = await foundry.applications.api.DialogV2.prompt({
      window: { title: `${def.nome} — escolher perícia` },
      content: `<p>Qual perícia este item modifica? O bônus só aparecerá nos testes dela.</p>
        <div class="form-group"><label>Perícia</label><select name="pericia">${opcoes}</select></div>`,
      ok: { label: "Adicionar", callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object }
    }).catch(() => null);
    if (!dados?.pericia) return;
    return adicionarEntrada(item, key, { pericia: dados.pericia });
  }
  return adicionarEntrada(item, key);
}

/* ------------------------------------------------------------------ */
/* Contexto do template                                               */
/* ------------------------------------------------------------------ */

function agruparPorCategoria(tabela, catsPermitidas, todas) {
  const grupos = new Map();
  for (const [key, def] of Object.entries(tabela)) {
    const cats = def.cats ?? ["geral"];
    if (!todas && !cats.some(c => catsPermitidas.includes(c))) continue;
    const catPrincipal = todas
      ? (cats[0] ?? "geral")
      : (cats.find(c => catsPermitidas.includes(c)) ?? cats[0]);
    const rotulo = CATEGORIAS[catPrincipal] ?? catPrincipal;
    if (!grupos.has(rotulo)) grupos.set(rotulo, []);
    grupos.get(rotulo).push({
      key,
      nome: def.nome,
      beneficio: def.beneficio ?? "",
      dois: !!def.dois,
      homebrew: !!def.homebrew
    });
  }
  return [...grupos.entries()]
    .map(([grupo, itens]) => ({
      grupo,
      itens: itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo, "pt-BR"));
}

function montarLista(entradas, todasEntradas = null) {
  const todas = todasEntradas ?? entradas;
  return entradas.map(e => {
    const def = obterEntrada(e.key) ?? {};
    const supressor = e.suprimidaPor ? todas.find(x => x.id === e.suprimidaPor) : null;
    const rotuloPericia = e.pericia ? (CONFIG?.T20?.pericias?.[e.pericia]?.label ?? e.pericia) : "";
    return {
      id: e.id,
      key: e.key,
      nome: def.nome ?? e.key,
      pericia: rotuloPericia,
      beneficio: def.beneficio ?? "",
      fonte: def.fonte ?? "homebrew",
      nota: def.nota ?? "",
      dois: !!def.dois,
      homebrew: !!def.homebrew,
      nEfeitos: (def.efeitos ?? []).length || (def.especial ? 1 : 0),
      suprimida: !!e.suprimidaPor,
      suprimidaNome: supressor ? (obterEntrada(supressor.key)?.nome ?? supressor.key) : "",
      custo: e.custo
    };
  });
}

async function montarContexto(app, item) {
  const d = dadosDoItem(item);
  const todas = !!app._haydTodasCategorias;
  const cats = categoriasDoItem(item);
  const catPreco = categoriaMaterialDoItem(item);
  const mult = ehMunicao(item) ? 0.5 : 1;

  const opcoesMateriais = Object.entries(obterMateriais()).map(([key, def]) => {
    const preco = (def.precos?.[catPreco] ?? 0) * mult;
    return {
      key,
      nome: def.nome,
      beneficio: def.beneficio ?? "",
      raro: !!def.raro,
      homebrew: !!def.homebrew,
      custoFmt: preco ? `T$ ${preco.toLocaleString("pt-BR")}` : "custo manual"
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    editavel: app.isEditable,
    municao: ehMunicao(item),
    todasCategorias: todas,
    preco: calcularPreco(item),
    melhorias: montarLista(d.melhorias, [...d.melhorias, ...d.encantos]),
    encantos: montarLista(d.encantos, [...d.melhorias, ...d.encantos]),
    materiais: montarLista(d.materiais),
    opcoesMelhorias: agruparPorCategoria(obterMelhorias(), cats, todas),
    opcoesEncantos: agruparPorCategoria(obterEncantos(), cats, todas),
    opcoesMateriais,
    temInjecao: d.melhorias.some(m => m.key === "injecao-alquimica"),
    alquimicos: d.alquimicos.map(a => ({ name: a.name, img: a.img })),
    temAtor: !!item.actor
  };
}

/* ------------------------------------------------------------------ */
/* Injeção na ficha (renderItemSheetT20 — Application V1)             */
/* ------------------------------------------------------------------ */

export async function aoRenderizarFichaItem(app, html) {
  const item = app.item ?? app.document;
  if (!item || !itemElegivel(item)) return;

  const $html = html instanceof jQuery ? html : $(html);

  // Remove a aba nativa de aprimoramentos (automação antiga do sistema)
  $html.find('nav.sheet-tabs a.item[data-tab="enhancements"]').remove();
  $html.find(".tab.enhancements").remove();

  // Nav da nossa aba
  const $nav = $(`<a class="item" data-tab="${ABA_ID}">Melhorias &amp; Encantos</a>`);
  $html.find("nav.sheet-tabs").first().append($nav);

  // Conteúdo
  const contexto = await montarContexto(app, item);
  const conteudo = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULO}/templates/aba.hbs`, contexto
  );
  const $aba = $(`<div class="tab ${ABA_ID}" data-group="primary" data-tab="${ABA_ID}"></div>`).html(conteudo);

  const $corpo = $html.find(".sheet-body").first();
  if ($corpo.length) $corpo.append($aba);
  else $html.find(".tab").last().after($aba);

  /* A aba é injetada DEPOIS do bind das tabs do Foundry: no re-render,
   * o controlador não encontra "hayd-itens" e volta para a aba inicial.
   * Rastreamos o estado por conta própria e reativamos após a injeção,
   * para a edição ser contínua sem voltar para a Descrição. */
  const tabs = app._tabs?.[0];

  $html.find("nav.sheet-tabs a.item").on("click", ev => {
    app._haydAbaAtiva = ev.currentTarget.dataset.tab === ABA_ID;
  });
  $nav.on("click", () => {
    app._haydAbaAtiva = true;
    tabs?.activate?.(ABA_ID);
  });

  if (app._haydAbaAtiva || tabs?.active === ABA_ID) {
    app._haydAbaAtiva = true;
    if (tabs) tabs.activate(ABA_ID);
    $html.find('nav.sheet-tabs a.item, .sheet-body > .tab').removeClass("active");
    $nav.addClass("active");
    $aba.addClass("active");
  }

  /* Campos do módulo não fazem parte do formulário da ficha: impede o
   * submit automático (submitOnChange) de disparar um segundo render. */
  $aba.on("change", ev => ev.stopPropagation());

  /* Preserva a rolagem da aba entre re-renders. */
  const $rolagem = $aba.find(".hayd-itens-aba");
  $rolagem.on("scroll", () => { app._haydScroll = $rolagem.scrollTop(); });
  if (app._haydScroll) requestAnimationFrame(() => $rolagem.scrollTop(app._haydScroll));

  ativarListeners(app, item, $aba);
}

function ativarListeners(app, item, $aba) {
  // Alternar filtro de categorias
  $aba.find(".hayd-todas-categorias").on("change", ev => {
    app._haydTodasCategorias = ev.currentTarget.checked;
    app.render();
  });

  if (!app.isEditable) return;

  // Preço base
  $aba.find(".hayd-preco-base").on("change", async ev => {
    await definirPrecoBase(item, ev.currentTarget.value);
    app.render();
  });

  // Adicionar melhoria/encanto
  $aba.find(".hayd-add-melhoria").on("click", async () => {
    const key = $aba.find(".hayd-select-melhoria").val();
    if (!key) return;
    await adicionarComEscolha(item, key);
    app.render();
  });
  $aba.find(".hayd-add-encanto").on("click", async () => {
    const key = $aba.find(".hayd-select-encanto").val();
    if (!key) return;
    await adicionarComEscolha(item, key);
    app.render();
  });

  // Adicionar material
  $aba.find(".hayd-add-material").on("click", async () => {
    const key = $aba.find(".hayd-select-material").val();
    if (!key) return;
    await adicionarMaterial(item, key);
    app.render();
  });

  // Remover
  $aba.find(".hayd-remover").on("click", async ev => {
    const { lista, id } = ev.currentTarget.dataset;
    const nome = obterEntrada((item.getFlag(MODULO, lista) ?? []).find(e => e.id === id)?.key)?.nome ?? "entrada";
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover" },
      content: `<p>Remover <strong>${nome}</strong> deste item? Os efeitos correspondentes serão excluídos e o preço será reajustado.</p>`
    });
    if (!ok) return;
    await removerEntrada(item, lista, id);
    app.render();
  });

  // Custo manual de material
  $aba.find(".hayd-custo-material").on("change", async ev => {
    await atualizarCustoMaterial(item, ev.currentTarget.dataset.id, ev.currentTarget.value);
    app.render();
  });

  // Homebrew
  $aba.find(".hayd-abrir-homebrew").on("click", () => abrirGerenciadorHomebrew(() => app.render()));

  // Descarregar alquímico
  $aba.find(".hayd-descarregar").on("click", async ev => {
    await descarregarAlquimico(item, Number(ev.currentTarget.dataset.indice));
    app.render();
  });
}
