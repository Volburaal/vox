import {
  CharStream,
  CommonTokenStream,
  ErrorListener,
  Recognizer,
  RecognitionException,
  Token,
} from "antlr4";
import VoxLexer from "./gen/VoxLexer.js";
import VoxParser from "./gen/VoxParser.js";
import { SemanticAnalyzer } from "./SemanticAnalyzer.js";
import { IRBuilder } from "./IRBuilder.js";
import { Diagnostic, formatDiagnostic } from "./diagnostics.js";

export interface CompileResult {
  /** Empty when compilation succeeded. Messages look like "line 3:4 error: ...". */
  errors: string[];
  /** Non-fatal diagnostics, same shape as errors. */
  warnings: string[];
  /** Every error and warning with its source range, for editors. */
  diagnostics: Diagnostic[];
  /** The IR program or null when there were errors. */
  ir: string[] | null;
}

/** Collects syntax errors, with the offending token's range, instead of printing them. */
class Collector extends ErrorListener<unknown> {
  readonly diagnostics: Diagnostic[] = [];

  override syntaxError(
    _recognizer: Recognizer<unknown>,
    offendingSymbol: unknown,
    line: number,
    column: number,
    msg: string,
    _e: RecognitionException | undefined,
  ): void {
    // Parser errors carry the token; lexer errors carry nothing usable.
    const token = offendingSymbol as Token | null | undefined;
    const text = token && token.type !== Token.EOF ? (token.text ?? "") : "";
    const length = Math.max(1, text.length);
    this.diagnostics.push({
      severity: "error",
      message: msg,
      line,
      column,
      endLine: line,
      endColumn: column + length,
    });
  }
}

/**
 * The front half of the pipeline: parse, check, lower. Pure - no I/O - so it
 * runs identically in Node, a browser or a worker.
 */
export function compile(source: string): CompileResult {
  const collector = new Collector();

  const lexer = new VoxLexer(new CharStream(source));
  lexer.removeErrorListeners();
  lexer.addErrorListener(collector);

  const parser = new VoxParser(new CommonTokenStream(lexer));
  parser.removeErrorListeners();
  parser.addErrorListener(collector);

  const tree = parser.program();

  // Never build IR from a broken tree; it silently produces wrong programs.
  if (collector.diagnostics.length > 0) {
    return {
      errors: collector.diagnostics.map(formatDiagnostic),
      warnings: [],
      diagnostics: collector.diagnostics,
      ir: null,
    };
  }

  const analyzer = new SemanticAnalyzer();
  analyzer.visit(tree);
  if (analyzer.errors.length > 0) {
    return {
      errors: analyzer.errors,
      warnings: analyzer.warnings,
      diagnostics: [...analyzer.diagnostics],
      ir: null,
    };
  }

  const builder = new IRBuilder();
  builder.visit(tree);
  return {
    errors: [],
    warnings: analyzer.warnings,
    diagnostics: [...analyzer.diagnostics],
    ir: builder.instructions,
  };
}
