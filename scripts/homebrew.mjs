/**
 * t20-hayd-itens | homebrew.mjs
 * Criação de melhorias, encantos e materiais personalizados.
 * As definições ficam em uma configuração de mundo e entram no
 * catálogo unificado (marcadas com ★).
 */

import { MODULO, CATEGORIAS, registrarFonteHomebrew } from "./catalogo.mjs";

const SETTING = "homebrews";
const { DialogV2 } = foundry.applications.api;

export function registrarHomebrew() {
  game.settings.register(MODULO, SETTING, {
    name: "Definições homebrew",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  registrarFonteHomebrew(obterHomebrews);
}

export function obterHomebrews() {
  try { return game.settings.get(MODULO, SETTING) ?? []; }
  catch { return []; }
}

async function salvarHomebrews(lista) {
  await game.settings.set(MODULO, SETTING, lista);
}

/* ------------------------------------------------------------------ */
/* Caminhos sugeridos para efeitos                                    */
/* ------------------------------------------------------------------ */

function caminhosSugeridos() {
  const pericias = CONFIG?.T20?.pericias ?? {};
  return [
    { key: "ataque", rotulo: "Bônus de ataque (rolagem)" },
    { key: "dano", rotulo: "Bônus de dano — use 2 ou 2d6[frio]" },
    { key: "danoCritico", rotulo: "Dano só em críticos (ex.: 10)" },
    { key: "criticoM", rotulo: "Margem de ameaça (use -1 para +1 de margem)" },
    { key: "criticoX", rotulo: "Multiplicador de crítico (+1)" },
    { key: "ignoraRD", rotulo: "Ignora redução de dano (ex.: 5)" },
    { key: "passos", rotulo: "Passos de dano (modo Personalizado; ex.: 1)" },
    { key: "system.attributes.defesa.bonus", rotulo: "Defesa (bônus)" },
    { key: "system.attributes.pv.max", rotulo: "PV máximos" },
    { key: "system.attributes.pm.max", rotulo: "PM máximos" },
    { key: "system.attributes.cd", rotulo: "CD de habilidades" },
    { key: "system.modificadores.pericias.resistencia", rotulo: "Testes de resistência (use +N)" },
    { key: "system.modificadores.pericias.geral", rotulo: "Todas as perícias (use +N)" },
    { key: "system.modificadores.dano.geral", rotulo: "Todo dano (use +N)" },
    ...Object.entries(pericias).map(([k, v]) => ({
      key: `system.pericias.${k}.bonus`, rotulo: `Perícia: ${v.label ?? k}`
    }))
  ];
}

const CONDICOES_OPCOES = [
  "abalado", "atordoado", "cego", "debilitado", "desprevenido", "em-chamas",
  "enjoado", "enredado", "envenenado", "fascinado", "fraco", "lento",
  "ofuscado", "sangrando", "vulneravel"
];

/* ------------------------------------------------------------------ */
/* Diálogo de criação/edição                                          */
/* ------------------------------------------------------------------ */

async function dialogoEntrada(existente = null) {
  const datalist = caminhosSugeridos()
    .map(c => `<option value="${c.key}">${c.rotulo}</option>`)
    .join("");
  const catsChecks = Object.entries(CATEGORIAS)
    .map(([k, v]) => `<label class="hayd-inline"><input type="checkbox" name="cat-${k}"
      ${existente?.cats?.includes(k) ? "checked" : (!existente && k === "arma") ? "checked" : ""}> ${v}</label>`)
    .join("");
  const condOpcoes = CONDICOES_OPCOES
    .map(c => `<option value="${c}">${c}</option>`)
    .join("");

  const linhaEfeito = (i) => {
    const ef = existente?.efeitos?.[i];
    const ch = ef?.changes?.[0];
    return `
    <fieldset class="hayd-fieldset">
      <legend>Efeito ${i + 1}</legend>
      <div class="hayd-linha-efeito">
        <select name="efTipo${i}">
          <option value="" ${!ef ? "selected" : ""}>— nenhum —</option>
          <option value="uso" ${ef && !ef.passivo && !ef.condicao ? "selected" : ""}>Efeito de uso (aparece ao usar o item)</option>
          <option value="passivo" ${ef?.passivo ? "selected" : ""}>Passivo (sempre ativo no personagem)</option>
          <option value="condicao" ${ef?.condicao ? "selected" : ""}>Condição (anexada ao uso; aplicada ao alvo pelo chat)</option>
        </select>
        <input type="number" name="efCusto${i}" placeholder="PM" style="width:52px"
          value="${ef?.custo ?? ""}" data-tooltip="Custo em PM (negativo = redução)">
      </div>
      <div class="hayd-linha-efeito">
        <input type="text" name="efChave${i}" list="hayd-caminhos" placeholder="ataque, dano, system.pericias.luta.bonus…"
          value="${ch?.key ?? ""}">
        <select name="efModo${i}">
          <option value="2" ${!ch || ch.mode === 2 ? "selected" : ""}>Somar (+)</option>
          <option value="0" ${ch?.mode === 0 ? "selected" : ""}>Personalizado (passos, kh, x)</option>
          <option value="5" ${ch?.mode === 5 ? "selected" : ""}>Sobrepor (=)</option>
        </select>
        <input type="text" name="efValor${i}" placeholder="1 ou 2d6[frio]" style="width:90px"
          value="${ch?.value ?? ""}">
      </div>
      <div class="hayd-linha-efeito">
        <select name="efCondicao${i}" data-tooltip="Usado apenas quando o tipo é Condição">
          <option value="">— condição —</option>${condOpcoes}
        </select>
        <input type="text" name="efDesc${i}" placeholder="Descrição exibida no efeito (opcional)"
          value="${ef?.desc ?? ""}" style="flex:1">
      </div>
    </fieldset>`;
  };

  const conteudo = `
    <div class="hayd-scroll">
    <datalist id="hayd-caminhos">${datalist}</datalist>
    <div class="form-group"><label>Nome</label>
      <input type="text" name="nome" value="${existente?.nome ?? ""}" placeholder="Encanto do Trovão"></div>
    <div class="form-group"><label>Tipo</label>
      <select name="tipo">
        <option value="melhoria" ${existente?.tipo === "melhoria" ? "selected" : ""}>Melhoria</option>
        <option value="encanto" ${!existente || existente?.tipo === "encanto" ? "selected" : ""}>Encanto</option>
        <option value="material" ${existente?.tipo === "material" ? "selected" : ""}>Material especial</option>
      </select></div>
    <div class="form-group"><label>Benefício (texto exibido)</label>
      <input type="text" name="beneficio" value="${existente?.beneficio ?? ""}" placeholder="+1d6 de dano de trovão…"></div>
    <div class="form-group"><label>Categorias de item</label>
      <div class="hayd-cats">${catsChecks}</div></div>
    <div class="form-group"><label class="hayd-inline">
      <input type="checkbox" name="dois" ${existente?.dois ? "checked" : ""}>
      Conta como dois encantos (para o preço)</label></div>
    <div class="form-group"><label>Custo do material (T$; só para materiais)</label>
      <input type="number" name="custoMaterial" min="0" value="${existente?.custoBase ?? 0}"></div>
    ${[0, 1, 2].map(linhaEfeito).join("")}
    <p class="notes">Dano tipado: use valores como <code>2d6[frio]</code> — tipos: acido, corte,
      eletricidade, essencia, fogo, frio, impacto, luz, psiquico, perfuracao, trevas.
      Chave <code>danoCritico</code> só entra em acertos críticos; <code>passos</code> usa o modo Personalizado.</p>
    </div>`;

  const dados = await DialogV2.prompt({
    window: { title: existente ? `Editar ${existente.nome}` : "Criar Homebrew" },
    position: { width: 620 },
    content: conteudo,
    ok: {
      label: existente ? "Salvar" : "Criar",
      callback: (ev, btn) => new foundry.applications.ux.FormDataExtended(btn.form).object
    }
  }).catch(() => null);
  if (!dados?.nome) return null;

  const cats = Object.keys(CATEGORIAS).filter(k => dados[`cat-${k}`]);
  const efeitos = [];
  for (let i = 0; i < 3; i++) {
    const tipoEf = dados[`efTipo${i}`];
    if (!tipoEf) continue;
    const chave = String(dados[`efChave${i}`] ?? "").trim();
    const valor = String(dados[`efValor${i}`] ?? "").trim();
    const custo = String(dados[`efCusto${i}`] ?? "").trim();
    const desc = String(dados[`efDesc${i}`] ?? "").trim();
    const ef = {};
    if (tipoEf === "passivo") ef.passivo = true;
    if (tipoEf === "condicao") {
      const cond = dados[`efCondicao${i}`];
      if (!cond) continue;
      ef.condicao = cond;
    }
    if (chave && valor) ef.changes = [{ key: chave, value: valor, mode: Number(dados[`efModo${i}`]) || 2 }];
    if (custo) ef.custo = custo;
    if (desc) ef.desc = desc;
    if (!ef.changes && !ef.condicao && !ef.custo) continue;
    efeitos.push(ef);
  }

  const entrada = {
    key: existente?.key ?? `hb-${foundry.utils.randomID(8)}`,
    homebrew: true,
    nome: dados.nome,
    tipo: dados.tipo,
    cats: cats.length ? cats : ["geral"],
    fonte: "Homebrew",
    beneficio: dados.beneficio || dados.nome,
    dois: !!dados.dois,
    efeitos
  };
  if (dados.tipo === "material") {
    const custoBase = Math.max(0, Number(dados.custoMaterial) || 0);
    entrada.custoBase = custoBase;
    entrada.precos = {
      arma: custoBase, armaduraLeve: custoBase, armaduraPesada: custoBase,
      escudo: custoBase, esoterico: custoBase
    };
  }
  return entrada;
}

/* ------------------------------------------------------------------ */
/* Gerenciador                                                        */
/* ------------------------------------------------------------------ */

export async function abrirGerenciadorHomebrew(aoMudar = null) {
  if (!game.user.isGM) {
    return ui.notifications.warn("Apenas o mestre pode criar/editar homebrews (são salvos no mundo).");
  }

  const lista = obterHomebrews();
  const linhas = lista.map(hb => `
    <li class="hayd-hb-linha">
      <div class="hayd-info">
        <strong>${hb.nome} ★</strong>
        <small>${hb.tipo}${hb.dois ? " · conta como 2" : ""} · ${(hb.cats ?? []).map(c => CATEGORIAS[c] ?? c).join(", ")}</small>
        <span>${hb.beneficio}</span>
      </div>
      <a data-acao="editar" data-key="${hb.key}" data-tooltip="Editar"><i class="fa-solid fa-pen"></i></a>
      <a data-acao="excluir" data-key="${hb.key}" data-tooltip="Excluir"><i class="fa-solid fa-trash"></i></a>
    </li>`).join("");

  const dialog = new DialogV2({
    window: { title: "Homebrews — Melhorias, Encantos e Materiais", resizable: true },
    position: { width: 560, height: 500 },
    content: `<div class="hayd-hb-gerenciador">
      ${lista.length ? `<ul class="hayd-lista">${linhas}</ul>` : `<p class="hayd-vazio">Nenhum homebrew criado.</p>`}
    </div>`,
    buttons: [
      { action: "criar", label: "Criar novo", icon: "fa-solid fa-plus" },
      { action: "fechar", label: "Fechar", default: true }
    ],
    submit: async (result) => {
      if (result === "criar") {
        const entrada = await dialogoEntrada();
        if (entrada) {
          const todas = obterHomebrews();
          todas.push(entrada);
          await salvarHomebrews(todas);
          ui.notifications.info(`Homebrew "${entrada.nome}" criado — disponível nos catálogos (★).`);
          aoMudar?.();
        }
        abrirGerenciadorHomebrew(aoMudar);
      }
    }
  });
  await dialog.render(true);

  dialog.element.querySelectorAll("[data-acao]").forEach(el => {
    el.addEventListener("click", async () => {
      const key = el.dataset.key;
      const todas = obterHomebrews();
      const hb = todas.find(h => h.key === key);
      if (!hb) return;

      if (el.dataset.acao === "editar") {
        await dialog.close();
        const editado = await dialogoEntrada(hb);
        if (editado) {
          const idx = todas.findIndex(h => h.key === key);
          todas[idx] = editado;
          await salvarHomebrews(todas);
          ui.notifications.info(`Homebrew "${editado.nome}" atualizado. Itens que já o usam mantêm os efeitos antigos — remova e adicione novamente para atualizar.`);
          aoMudar?.();
        }
        abrirGerenciadorHomebrew(aoMudar);
      } else if (el.dataset.acao === "excluir") {
        const ok = await DialogV2.confirm({
          window: { title: "Excluir Homebrew" },
          content: `<p>Excluir <strong>${hb.nome}</strong>? Itens que já o usam mantêm os efeitos, mas a definição sai dos catálogos.</p>`
        });
        if (!ok) return;
        await salvarHomebrews(todas.filter(h => h.key !== key));
        await dialog.close();
        aoMudar?.();
        abrirGerenciadorHomebrew(aoMudar);
      }
    });
  });
}
