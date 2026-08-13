/**
 * t20-hayd-itens | aba.mjs
 * Substitui a aba de Aprimoramentos do sistema pela aba
 * "Melhorias & Encantos" do módulo, sem limite de slots.
 */

import {
  MODULO, CATEGORIAS, categoriasDoItem, itemElegivel, categoriaMaterialDoItem,
  obterMelhorias, obterEncantos, obterMateriais, obterEntrada, versaoCatalogo
} from "./catalogo.mjs";
import {
  dadosDoItem, ehMunicao, calcularPreco, definirPrecoBase,
  adicionarEntrada, adicionarMaterial, removerEntrada, atualizarCustoMaterial
} from "./efeitos.mjs";
import { abrirGerenciadorHomebrew } from "./homebrew.mjs";
import { descarregarAlquimico, descarregarInjetora } from "./alquimica.mjs";

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

/* Listas de opções dos <select> — iguais para todo item da mesma
 * categoria e caras de montar (~190 entradas, agrupadas e ordenadas com
 * localeCompare). Memoizadas por categoria e invalidadas quando o
 * catálogo muda (homebrew/override). */
let _cacheOpcoes = { versao: -1, mapa: new Map() };

function memoOpcoes(chave, montar) {
  const versao = versaoCatalogo();
  if (_cacheOpcoes.versao !== versao) _cacheOpcoes = { versao, mapa: new Map() };
  let valor = _cacheOpcoes.mapa.get(chave);
  if (valor === undefined) {
    valor = montar();
    _cacheOpcoes.mapa.set(chave, valor);
  }
  return valor;
}

function montarLista(entradas, todasEntradas = null) {
  const todas = todasEntradas ?? entradas;
  const porId = new Map(todas.map(x => [x.id, x]));
  return entradas.map(e => {
    const def = obterEntrada(e.key) ?? {};
    const supressor = e.suprimidaPor ? porId.get(e.suprimidaPor) : null;
    const rotuloPericia = e.pericia ? (CONFIG?.T20?.pericias?.[e.pericia]?.label ?? e.pericia) : "";
    return {
      id: e.id,
      key: e.key,
      nome: def.nome ?? e.key,
      pericia: rotuloPericia,
      beneficio: def.beneficio ?? "",
      fonte: def.fonte ?? "homebrew",
      nota: def.nota ?? "",
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

  const opcoesMateriais = memoOpcoes(`materiais|${catPreco}|${mult}`, () =>
    Object.entries(obterMateriais()).map(([key, def]) => {
      const preco = (def.precos?.[catPreco] ?? 0) * mult;
      return {
        key,
        nome: def.nome,
        beneficio: def.beneficio ?? "",
        raro: !!def.raro,
        homebrew: !!def.homebrew,
        custoFmt: preco ? `T$ ${preco.toLocaleString("pt-BR")}` : "custo manual"
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));

  const chaveCats = todas ? "*" : cats.join(",");
  const aplicadas = [...d.melhorias, ...d.encantos];

  return {
    editavel: app.isEditable,
    municao: ehMunicao(item),
    todasCategorias: todas,
    // Item já sob gestão do módulo (tem preço base capturado)
    gerenciado: d.precoBase !== null,
    preco: calcularPreco(item),
    melhorias: montarLista(d.melhorias, aplicadas),
    encantos: montarLista(d.encantos, aplicadas),
    materiais: montarLista(d.materiais),
    opcoesMelhorias: memoOpcoes(`melhorias|${chaveCats}`, () => agruparPorCategoria(obterMelhorias(), cats, todas)),
    opcoesEncantos: memoOpcoes(`encantos|${chaveCats}`, () => agruparPorCategoria(obterEncantos(), cats, todas)),
    opcoesMateriais,
    temInjecao: d.melhorias.some(m => m.key === "injecao-alquimica"),
    alquimicos: d.alquimicos.map(a => ({ name: a.name, img: a.img })),
    temInjetora: d.melhorias.some(m => m.key === "injetora"),
    dosesInjetora: d.injetora.map(a => ({ name: a.name, img: a.img })),
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
  const $aba = $(`<div class="tab ${ABA_ID}" data-group="primary" data-tab="${ABA_ID}"></div>`);

  const $corpo = $html.find(".sheet-body").first();
  if ($corpo.length) $corpo.append($aba);
  else $html.find(".tab").last().after($aba);

  /* Toda mudança feita pela aba redesenha SÓ a aba, em vez de chamar
   * app.render(): o render completo da ficha reconstrói todas as abas do
   * sistema e recria os editores de texto ricos da Descrição — o que
   * custava centenas de milissegundos a cada melhoria adicionada. */
  app._haydAtualizar = () => desenharAba(app, item, $aba, $html);
  await desenharAba(app, item, $aba, $html);

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
}

/**
 * Redesenha o conteúdo da aba no lugar, preservando a rolagem, e mantém
 * o campo de preço da ficha do sistema em dia (ele vive fora da aba e,
 * sem o render completo, não se atualizaria sozinho).
 */
async function desenharAba(app, item, $aba, $html) {
  const contexto = await montarContexto(app, item);
  const conteudo = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULO}/templates/aba.hbs`, contexto
  );

  const anterior = $aba.find(".hayd-itens-aba").scrollTop();
  if (anterior) app._haydScroll = anterior;

  $aba.html(conteudo);

  const $rolagem = $aba.find(".hayd-itens-aba");
  $rolagem.on("scroll", () => { app._haydScroll = $rolagem.scrollTop(); });
  if (app._haydScroll) requestAnimationFrame(() => $rolagem.scrollTop(app._haydScroll));

  // Campo de preço da ficha nativa: fica fora da aba e, sem o render
  // completo, não se atualizaria sozinho. Só é tocado em itens que o
  // módulo já gerencia, para não mexer no preço de itens comuns.
  if (contexto.gerenciado) $html.find('[name="system.preco"]').val(contexto.preco.total);

  ativarListeners(app, item, $aba);
}

/**
 * Encapsula uma ação da aba: ignora cliques repetidos enquanto a
 * anterior não terminou (evitava filas de renders sobrepostos) e
 * redesenha a aba ao final.
 */
function acao(app, fn) {
  return async (...args) => {
    if (app._haydOcupado) return;
    app._haydOcupado = true;
    try {
      await fn(...args);
      await app._haydAtualizar?.();
    } catch (err) {
      console.error(`${MODULO} | Falha na ação da aba`, err);
    } finally {
      app._haydOcupado = false;
    }
  };
}

function ativarListeners(app, item, $aba) {
  // Alternar filtro de categorias
  $aba.find(".hayd-todas-categorias").on("change", acao(app, ev => {
    app._haydTodasCategorias = ev.currentTarget.checked;
  }));

  if (!app.isEditable) return;

  // Preço base
  $aba.find(".hayd-preco-base").on("change", acao(app, ev =>
    definirPrecoBase(item, ev.currentTarget.value)));

  // Adicionar melhoria/encanto
  $aba.find(".hayd-add-melhoria").on("click", acao(app, () => {
    const key = $aba.find(".hayd-select-melhoria").val();
    if (key) return adicionarComEscolha(item, key);
  }));
  $aba.find(".hayd-add-encanto").on("click", acao(app, () => {
    const key = $aba.find(".hayd-select-encanto").val();
    if (key) return adicionarComEscolha(item, key);
  }));

  // Adicionar material
  $aba.find(".hayd-add-material").on("click", acao(app, () => {
    const key = $aba.find(".hayd-select-material").val();
    if (key) return adicionarMaterial(item, key);
  }));

  // Remover
  $aba.find(".hayd-remover").on("click", acao(app, async ev => {
    const { lista, id } = ev.currentTarget.dataset;
    const nome = obterEntrada((item.getFlag(MODULO, lista) ?? []).find(e => e.id === id)?.key)?.nome ?? "entrada";
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Remover" },
      content: `<p>Remover <strong>${nome}</strong> deste item? Os efeitos correspondentes serão excluídos e o preço será reajustado.</p>`
    });
    if (!ok) return;
    await removerEntrada(item, lista, id);
  }));

  // Custo manual de material
  $aba.find(".hayd-custo-material").on("change", acao(app, ev =>
    atualizarCustoMaterial(item, ev.currentTarget.dataset.id, ev.currentTarget.value)));

  // Homebrew
  $aba.find(".hayd-abrir-homebrew").on("click", () =>
    abrirGerenciadorHomebrew(() => app._haydAtualizar?.()));

  // Descarregar alquímico / injetora
  $aba.find(".hayd-descarregar").on("click", acao(app, ev =>
    descarregarAlquimico(item, Number(ev.currentTarget.dataset.indice))));
  $aba.find(".hayd-descarregar-injetora").on("click", acao(app, ev =>
    descarregarInjetora(item, Number(ev.currentTarget.dataset.indice))));
}
