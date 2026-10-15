// ─── Runtime de estratégias (código colado pelo utilizador) ──────────────────
// O utilizador cola código (TS ou JS) que define um objeto de estratégia.
// O servidor compila TS→CommonJS com esbuild (/api/strategies/compile) e aqui
// avaliamos esse código no browser com `new Function`, injetando os indicadores
// via um `require` de sandbox. O `id` e o `name` são lidos do próprio objeto.

import * as indicators from "@/lib/indicators";

/** Formato mínimo aceite (as estratégias reais têm mais campos). */
export interface LoadedStrategy {
  id: string;
  name?: string;
  description?: string;
  minCandles?: number;
  defaults?: { stopGainPct?: number; stopLossPct?: number; trailingPct?: number };
  timeframes?: string[];
  params?: unknown[];
  indicators?: string[];
  onSignal: (ctx: unknown) => unknown;
  [k: string]: unknown;
}

/** `require` de sandbox: só os indicadores são resolvidos; o resto é vazio. */
function sandboxRequire(id: string): unknown {
  if (id.includes("indicators") || id.includes("/lib/market")) return indicators;
  return {};
}

/** Avalia o CommonJS compilado e devolve o objeto de estratégia. */
export function evalStrategy(js: string): { strategy?: LoadedStrategy; error?: string } {
  const isStrategy = (o: unknown): o is LoadedStrategy =>
    !!o && typeof o === "object" && typeof (o as LoadedStrategy).id === "string" && typeof (o as LoadedStrategy).onSignal === "function";
  try {
    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const fn = new Function("module", "exports", "require", js);
    fn(moduleObj, moduleObj.exports, sandboxRequire);
    const ex = moduleObj.exports ?? {};
    // Aceita: export default, module.exports = estrategia, ou qualquer export
    // nomeado que seja uma estratégia (ex.: export const minha = {...}).
    let out: unknown = (ex as { default?: unknown }).default;
    if (!isStrategy(out) && isStrategy(ex)) out = ex;
    if (!isStrategy(out)) {
      for (const v of Object.values(ex)) {
        if (isStrategy(v)) { out = v; break; }
      }
    }
    if (isStrategy(out)) return { strategy: out };
    return { error: "O código não devolveu uma estratégia válida (falta 'id' ou 'onSignal'). Usa `export default { ... }`." };
  } catch (e) {
    return { error: `Erro ao executar o código: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Transformação mínima de JS simples (fallback quando o servidor está offline). */
function clientTransform(code: string): string {
  let js = code
    .replace(/^\s*import\s[^\n]*\n/gm, "")
    .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
    .replace(/\bexport\s+(const|let|var|function|class)\s+/g, "$1 ");
  if (!/module\.exports/.test(js)) js += "\n;try{module.exports.default=(typeof strategy!=='undefined'?strategy:undefined);}catch(e){}";
  return js;
}

/**
 * Compila o código colado. Tenta o servidor (esbuild, suporta TS); se estiver
 * offline, usa a transformação mínima de JS.
 */
export async function compileStrategy(code: string): Promise<{ js?: string; error?: string }> {
  try {
    const r = await fetch("/api/strategies/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const text = await r.text();
    let data: { js?: string; error?: string } | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Resposta não-JSON (ex.: servido por estático) → fallback de JS.
      return { js: clientTransform(code) };
    }
    if (!r.ok) return { error: data?.error || `Falha de compilação (${r.status}).` };
    if (typeof data?.js === "string") return { js: data.js };
    return { js: clientTransform(code) };
  } catch {
    // Servidor offline → fallback de JS simples.
    return { js: clientTransform(code) };
  }
}

/** Extrai id/nome/descrição do código para pré-visualização (sem executar). */
export function peekStrategyMeta(code: string): { id?: string; name?: string; description?: string } {
  const id = code.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
  const name = code.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
  const description = code.match(/\bdescription\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
  return { id: id?.trim(), name: name?.trim(), description: description?.trim() };
}
