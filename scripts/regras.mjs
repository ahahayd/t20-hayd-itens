/**
 * t20-hayd-itens | regras.mjs
 * Regras puras (sem Foundry) usadas pelas automações: transformações de
 * fórmula, texto e custo. Ficam isoladas para poderem ser testadas no Node.
 */

/** Minúsculas, sem acentos e sem espaços repetidos — para comparar nomes. */
export function normalizarNome(texto) {
  return String(texto ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Entre os nomes dados, o que corresponde à sugestão: primeiro o nome
 * idêntico (ignorando acentos), depois o que a contém.
 */
export function acharSugestao(nomes, sugestao) {
  const alvo = normalizarNome(sugestao);
  if (!alvo) return null;
  return nomes.find(n => normalizarNome(n) === alvo)
    ?? nomes.find(n => normalizarNome(n).includes(alvo))
    ?? null;
}

/** Troca marcadores {arma}, {ator}, {objeto} pelos valores do contexto. */
export function preencherMarcadores(texto, ctx = {}) {
  return String(texto ?? "").replace(/\{(\w+)\}/g, (todo, chave) => ctx[chave] ?? todo);
}

/** O texto tem marcadores a preencher? */
export function temMarcadores(texto) {
  return /\{\w+\}/.test(String(texto ?? ""));
}

/**
 * "2[fogo]" → { valor: "2", tipo: "fogo" }. O motor do sistema só
 * reconhece o tipo quando há dados ("2d6[fogo]"); um número fixo tipado
 * virava "2[fogo][corte]" e quebrava a rolagem.
 */
export function separarNumeroTipado(formula) {
  const m = String(formula ?? "").match(/^\s*\+?\s*(\d+)\s*\[(\w+)\]\s*$/);
  return m ? { valor: m[1], tipo: m[2] } : null;
}

/** Conversões de dado base antes de consultar a tabela de passos (T20). */
const CONVERSOES_PASSO = { "2d4": "1d8", "2d6": "1d12", "3d4": "1d12" };

/** Sobe (ou desce) o dado base da fórmula em N passos da tabela do sistema. */
export function subirPassos(dano, passos, tabela) {
  const texto = String(dano ?? "");
  const m = texto.match(/^(\d+d\d+)/);
  if (!m || !passos || !Array.isArray(tabela)) return texto;
  const base = CONVERSOES_PASSO[m[1]] ?? m[1];
  const linha = tabela.find(l => l.includes(base));
  if (!linha) return texto;
  const i = linha.indexOf(base);
  const j = Math.max(0, Math.min(i + passos, linha.length - 1));
  return texto.replace(/^\d+d\d+/, linha[j]);
}

/**
 * Dados do Ataque Furtivo com a Assassina: viram d8 e, com os 2 PM,
 * rolam novamente todo resultado 1 — inclusive os 1s das novas rolagens.
 */
export function dadosAssassina(formula, rolarDeNovo) {
  return String(formula ?? "").replace(/(\d+|\))\s*d\s*\d+(?:rr?\d+)?/g,
    (_todo, qtd) => `${qtd}d8${rolarDeNovo ? "rr1" : ""}`);
}

/** Sangramento cumulativo: "1d6[perda]" → "2d6[perda]". */
export function agravarSangramento(valor) {
  const texto = String(valor ?? "");
  const m = texto.match(/(\d+)d6/);
  if (!m) return "2d6[perda]";
  return texto.replace(/(\d+)d6/, `${Number(m[1]) + 1}d6`);
}

/** Limita um número a um intervalo. */
export function limitar(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || 0));
}

/**
 * Custo final em PM de uma magia configurada, na mesma ordem do sistema:
 * ajuste manual, mínimo de 1 PM, modificador de custo do ator, truque e
 * redução à metade.
 */
export function custoDeConjuracao({ custoTotal, custoBase, truque, metade, extra = 0, ajuste = 0 }) {
  if (truque) return 0;
  let custo = (Number(custoTotal) || 0) + (Number(ajuste) || 0);
  if (custo <= 0 && !(Number(custoBase) > 0)) return 0;
  custo = Math.max(custo, 1) + (Number(extra) || 0);
  if (metade) custo = Math.floor(custo / 2);
  return Math.max(custo, 0);
}

/**
 * Quais efeitos de uso foram aplicados, a partir das opções do diálogo de
 * uso do sistema: { aprs: { id: { aplica } } } ou chaves "aprs.id.aplica".
 * Devolve Map id → quantidade (checkbox marcado = 1).
 */
export function aplicacoesDoFormulario(opcoes) {
  const saida = new Map();
  const somar = (id, v) => {
    const n = Number(v) || 0;
    if (n > 0) saida.set(id, n);
  };
  const aprs = opcoes?.aprs;
  if (aprs && typeof aprs === "object") {
    for (const [id, v] of Object.entries(aprs)) somar(id, v?.aplica);
  }
  for (const [chave, v] of Object.entries(opcoes ?? {})) {
    const m = chave.match(/^aprs\.([^.]+)\.aplica$/);
    if (m) somar(m[1], v);
  }
  return saida;
}

/** As opções vieram do diálogo de uso (com a lista de aprimoramentos)? */
export function temFormulario(opcoes) {
  if (!opcoes || typeof opcoes !== "object") return false;
  if (opcoes.aprs && typeof opcoes.aprs === "object") return true;
  return Object.keys(opcoes).some(k => k.startsWith("aprs."));
}

/**
 * Houve dano de verdade, mesmo que a RD tenha comido tudo?
 *
 * As parcelas chegam ANTES da redução; cura entra pelo mesmo caminho, com
 * multiplicador negativo.
 */
export function houveDano(partes, multiplicador) {
  if (!(Number(multiplicador) > 0)) return false;
  return Object.values(partes ?? {}).some(p => Number(p?.value) > 0);
}
