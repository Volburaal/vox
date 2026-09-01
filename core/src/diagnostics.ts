import type { ParserRuleContext, Token } from "antlr4";

/**
 * A compile-time message with a source range, so editors can underline it.
 * Lines are 1-based, columns 0-based and the end is exclusive.
 */
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Where a token ends, allowing for multi-word tokens that span lines. */
export function tokenEnd(t: Token): { line: number; column: number } {
  const text = t.text ?? "";
  const nl = text.lastIndexOf("\n");
  if (nl === -1)
    return { line: t.line, column: t.column + Math.max(1, text.length) };
  const lines = text.split("\n").length - 1;
  return { line: t.line + lines, column: text.length - nl - 1 };
}

/** A diagnostic covering the whole source range of a parse-tree node. */
export function diagnosticFor(
  ctx: ParserRuleContext,
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic {
  const start = ctx.start;
  let stop = ctx.stop ?? start;
  // An empty rule can have its stop before its start; fall back to the start token.
  if (
    stop.line < start.line ||
    (stop.line === start.line && stop.column < start.column)
  ) {
    stop = start;
  }
  const end = tokenEnd(stop);
  return {
    severity,
    message,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}

/** The one-line form the CLIs print: "line 3:4 error: ...". */
export function formatDiagnostic(d: Diagnostic): string {
  return `line ${d.line}:${d.column} ${d.severity}: ${d.message}`;
}
