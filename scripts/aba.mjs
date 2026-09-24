/**
 * t20-hayd-itens | aba.mjs
 * Substitui a aba de Aprimoramentos do sistema pela aba
 * "Melhorias & Encantos" do módulo, sem limite de slots.
 *
 * Cada entrada aplicada pode ser desligada individualmente, escolher o
 * poder/magia que recebe o efeito (Devotado, Sombria, Horrenda…), trocar
 * a variante do material e controlar a automação própria (doses da
 * Injeção Alquímica, magia da Conjuradora, Dançarina, Frenética, Piedosa).
 */

import {
  MODULO, CATEGORIAS, VARIANTES, categoriasDoItem, itemElegivel, categoriaMaterialDoItem,
  obterMelhorias, obterEncantos, obterMateriais, obterEntrada, versaoCatalogo,
  variantesDoMaterial, varianteInicial, beneficioDaVariante
} from "./catalogo.mjs";
import {
  dadosDoItem, ehMunicao, calcularPreco, definirPrecoBase,
  adicionarEntrada, adicionarMaterial, removerEntrada, atualizarCustoMaterial,
  alternarEntrada, definirAlvos, definirVariante, nomesParaEscolha, registroPorId, MAX_FRENETICA
} from "./efeitos.mjs";
import { abrirGerenciadorHomebrew } from "./homebrew.mjs";
import { carregarAlquimico, descarregarAlquimico, carregarInjetora, descarregarInjetora } from "./alquimica.mjs";
import {
  carregarConjuradora, descartarConjuradora, dispararConjuradora,
  ativarDancarina, desativarDancarina, gastarFrenetica, ajustarFrenetica, alternarPiedosa
} from "./automacoes.mjs";
import { acharSugestao } from "./regras.mjs";

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

/** Seletor de poder/magia de uma entrada (Devotado, Sombria, Horrenda…). */
function montarEscolha(item, escolha, alvos) {
  const tipos = escolha.tipos ?? ["poder"];
  const rotulo = escolha.rotulo
    ?? (tipos.length > 1 ? "Poderes e magias" : tipos[0] === "magia" ? "Magia" : "Poder");
  const base = {
    rotulo,
    multipla: !!escolha.multipla,
    selecionados: alvos.map(nome => ({ nome }))
  };
  if (!item.actor) return { ...base, semAtor: true };

  const nomes = nomesParaEscolha(item.actor, escolha).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const semOpcoes = !nomes.length;
  // Escolhido que sumiu da ficha: quase sempre um poder renomeado. A sugestão
  // é o nome mais parecido entre os que sobraram, para revincular num clique.
  const ausentes = alvos
    .filter(n => !nomes.includes(n))
    .map(nome => ({ nome, sugestao: (!semOpcoes && acharSugestao(nomes, nome)) || "" }));
  const nomesAusentes = ausentes.map(a => a.nome);

  let aviso = "";
  if (semOpcoes) aviso = `O personagem não tem ${tipos.includes("magia") && tipos.includes("poder") ? "poderes nem magias" : tipos[0] === "magia" ? "magias" : "poderes"} na ficha.`;
  else if (!alvos.length) aviso = "Nada escolhido: a automação desta entrada ainda não se aplica.";

  const plural = ausentes.length > 1;
  const avisoQuebrado = ausentes.length
    ? `${ausentes.map(a => `“${a.nome}”`).join(", ")} ${plural ? "não estão" : "não está"} mais na ficha — renomeado ou removido. A automação desta entrada não se aplica até revincular.`
    : "";

  return {
    ...base,
    selecionados: alvos.map(nome => ({
      nome,
      ausente: nomesAusentes.includes(nome),
      sugestao: ausentes.find(a => a.nome === nome)?.sugestao ?? ""
    })),
    opcoes: nomes
      .filter(n => !escolha.multipla || !alvos.includes(n))
      .map(n => ({ nome: n, sel: !escolha.multipla && alvos[0] === n })),
    ausentes,
    quebrado: !!ausentes.length,
    avisoQuebrado,
    aviso
  };
}

/** Painel da automação própria de uma entrada (ou null). */
function montarPainel(item, reg, def, d, editavel) {
  const estado = d.estado[reg.id] ?? {};
  const temAtor = !!item.actor;
  const podeUsar = temAtor && editavel;

  const carga = (doses, max, acao, dica) => ({
    carga: true, max, acao,
    doses: doses.map((a, i) => ({ nome: a.name, img: a.img, indice: i, acao, podeUsar })),
    podeCarregar: podeUsar && doses.length < max,
    dica: temAtor ? dica : "Coloque o item na ficha de um personagem para carregar."
  });

  switch (def.especial) {
    case "alquimica":
      return carga(d.alquimicos, 2, "injecao",
        "Carregar exige ação completa. Ao atacar, o cartão da arma no chat oferece a injeção.");
    case "injetora":
      return carga(d.injetora, 1, "injetora",
        "Carregar exige ação completa; ingerir (ação de movimento) pelo clique direito na armadura.");
    case "conjuradora": {
      const m = estado.magia;
      return {
        conjuradora: true, podeUsar, semAtor: !temAtor,
        magia: m ? { nome: m.dados?.name, img: m.dados?.img, resumo: (m.resumo ?? []).join(", "), custo: m.custo ?? 0 } : null
      };
    }
    case "dancarina":
      return { dancarina: true, podeUsar, ativa: !!estado.ativa };
    case "frenetica": {
      const bonus = Number(estado.bonus) || 0;
      return {
        frenetica: true, podeUsar, podeEditar: editavel, bonus, max: MAX_FRENETICA,
        podeMais: bonus < MAX_FRENETICA, podeMenos: bonus > 0
      };
    }
    case "piedosa":
      return { piedosa: true, podeUsar, ativa: !estado.inativa };
  }
  return null;
}

function montarLista(item, lista, entradas, d, editavel, todasEntradas = null) {
  const todas = todasEntradas ?? entradas;
  const porId = new Map(todas.map(x => [x.id, x]));
  return entradas.map(e => {
    const def = obterEntrada(e.key) ?? {};
    const supressor = e.suprimidaPor ? porId.get(e.suprimidaPor) : null;
    const rotuloPericia = e.pericia ? (CONFIG?.T20?.pericias?.[e.pericia]?.label ?? e.pericia) : "";
    const linha = {
      id: e.id,
      key: e.key,
      lista,
      ehMaterial: lista === "materiais",
      nome: def.nome ?? e.key,
      pericia: rotuloPericia,
      beneficio: def.beneficio ?? "",
      fonte: def.fonte ?? "homebrew",
      nota: def.nota ?? "",
      homebrew: !!def.homebrew,
      nEfeitos: (def.efeitos ?? []).length || (def.especial ? 1 : 0),
      suprimida: !!e.suprimidaPor,
      suprimidaTexto: lista === "encantos" ? "substituído por" : "substituída por",
      suprimidaNome: supressor ? (obterEntrada(supressor.key)?.nome ?? supressor.key) : "",
      desativada: !!e.desativada,
      custo: e.custo
    };

    if (lista === "materiais") {
      const variante = e.variante ?? varianteInicial(def, item);
      const possiveis = variantesDoMaterial(def);
      linha.beneficio = beneficioDaVariante(def, variante);
      linha.nEfeitos = (def.efeitos ?? []).filter(ef => !ef.variantes || ef.variantes.includes(variante)).length
        || (def.especial && variante === "arma" ? 1 : 0);
      if (possiveis.length > 1) linha.variantes = possiveis.map(v => ({ key: v, rotulo: VARIANTES[v], sel: v === variante }));
      else linha.varianteNome = VARIANTES[variante] ?? "";
    }

    if (def.escolha) {
      linha.escolha = montarEscolha(item, def.escolha, e.alvos ?? []);
      linha.quebrada = !!linha.escolha.quebrado;
    }
    if (!e.desativada && !e.suprimidaPor) linha.painel = montarPainel(item, e, def, d, editavel);
    return linha;
  });
}

async function montarContexto(app, item) {
  const d = dadosDoItem(item);
  const editavel = app.isEditable;
  const todas = !!app._haydTodasCategorias;
  const cats = categoriasDoItem(item);
  const catPreco = categoriaMaterialDoItem(item);
  const mult = ehMunicao(item) ? 0.5 : 1;

  // Só materiais com variante para a categoria do item (salvo "todas").
  const opcoesMateriais = memoOpcoes(`materiais|${catPreco}|${mult}|${todas}`, () =>
    Object.entries(obterMateriais())
      .filter(([, def]) => todas || variantesDoMaterial(def).includes(catPreco))
      .map(([key, def]) => {
        const preco = (def.precos?.[catPreco] ?? 0) * mult;
        return {
          key,
          nome: def.nome,
          beneficio: beneficioDaVariante(def, catPreco),
          raro: !!def.raro,
          homebrew: !!def.homebrew,
          custoFmt: preco ? `T$ ${preco.toLocaleString("pt-BR")}` : "custo manual"
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));

  const chaveCats = todas ? "*" : cats.join(",");
  const aplicadas = [...d.melhorias, ...d.encantos];

  return {
    editavel,
    municao: ehMunicao(item),
    todasCategorias: todas,
    // Item já sob gestão do módulo (tem preço base capturado)
    gerenciado: d.precoBase !== null,
    preco: calcularPreco(item),
    melhorias: montarLista(item, "melhorias", d.melhorias, d, editavel, aplicadas),
    encantos: montarLista(item, "encantos", d.encantos, d, editavel, aplicadas),
    materiais: montarLista(item, "materiais", d.materiais, d, editavel),
    opcoesMelhorias: memoOpcoes(`melhorias|${chaveCats}`, () => agruparPorCategoria(obterMelhorias(), cats, todas)),
    opcoesEncantos: memoOpcoes(`encantos|${chaveCats}`, () => agruparPorCategoria(obterEncantos(), cats, todas)),
    opcoesMateriais,
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

/** Entrada (lista e id) da linha em que o controle está. */
function linhaDe(el) {
  const li = el.closest("[data-entrada-id]");
  return { id: li?.dataset.entradaId, lista: li?.dataset.lista };
}

/* Botões [data-acao] das linhas: (item, {id, lista}, elemento) → Promise */
const ACOES = {
  "alternar": (item, l) => alternarEntrada(item, l.lista, l.id),
  "escolha-remover": (item, l, el) => {
    const alvos = registroPorId(item, l.id)?.reg.alvos ?? [];
    return definirAlvos(item, l.lista, l.id, alvos.filter(n => n !== el.dataset.nome));
  },
  "escolha-revincular": (item, l, el) => {
    const alvos = registroPorId(item, l.id)?.reg.alvos ?? [];
    const { nome, sugestao } = el.dataset;
    if (!sugestao) return null;
    return definirAlvos(item, l.lista, l.id, alvos.map(n => (n === nome ? sugestao : n)));
  },
  "injecao-carregar": item => carregarAlquimico(item),
  "injecao-descarregar": (item, l, el) => descarregarAlquimico(item, Number(el.dataset.indice)),
  "injetora-carregar": item => carregarInjetora(item),
  "injetora-descarregar": (item, l, el) => descarregarInjetora(item, Number(el.dataset.indice)),
  "conjuradora-carregar": (item, l) => carregarConjuradora(item, l.id),
  "conjuradora-disparar": (item, l) => dispararConjuradora(item, l.id),
  "conjuradora-descartar": (item, l) => descartarConjuradora(item, l.id),
  "dancarina-ativar": (item, l) => ativarDancarina(item, l.id, { pagar: true }),
  "dancarina-desativar": (item, l) => desativarDancarina(item, l.id),
  "frenetica-gastar": (item, l) => gastarFrenetica(item, l.id),
  "frenetica-mais": (item, l) => ajustarFrenetica(item, l.id, 1),
  "frenetica-menos": (item, l) => ajustarFrenetica(item, l.id, -1),
  "piedosa-alternar": (item, l) => alternarPiedosa(item, l.id)
};

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

  // Botões das linhas (ligar/desligar, doses, Conjuradora, Dançarina…)
  $aba.find("[data-acao]").on("click", acao(app, ev => {
    const el = ev.currentTarget;
    return ACOES[el.dataset.acao]?.(item, linhaDe(el), el);
  }));

  // Escolha de poder/magia
  $aba.find(".hayd-escolha-unica").on("change", acao(app, ev => {
    const l = linhaDe(ev.currentTarget);
    const valor = ev.currentTarget.value;
    return definirAlvos(item, l.lista, l.id, valor ? [valor] : []);
  }));
  $aba.find(".hayd-escolha-add").on("change", acao(app, ev => {
    const l = linhaDe(ev.currentTarget);
    const valor = ev.currentTarget.value;
    if (!valor) return;
    const alvos = registroPorId(item, l.id)?.reg.alvos ?? [];
    return definirAlvos(item, l.lista, l.id, [...alvos, valor]);
  }));

  // Variante do material
  $aba.find(".hayd-variante").on("change", acao(app, ev =>
    definirVariante(item, linhaDe(ev.currentTarget).id, ev.currentTarget.value)));
}
