import { CharStream, CommonTokenStream, ErrorListener, Recognizer, RecognitionException } from 'antlr4';
import VoxLexer from './gen/VoxLexer.js';
import VoxParser from './gen/VoxParser.js';
import { SemanticAnalyzer } from './SemanticAnalyzer.js';
import { IRBuilder } from './IRBuilder.js';

export interface CompileResult {
    /** Empty when compilation succeeded. Messages look like "line 3:4 error: ...". */
    errors: string[];
    /** Non-fatal diagnostics, same shape as errors. */
    warnings: string[];
    /** The IR program, or null when there were errors. */
    ir: string[] | null;
}

/** Collects diagnostics instead of writing them to the console. */
class Collector extends ErrorListener<unknown> {
    readonly messages: string[] = [];
    override syntaxError(_recognizer: Recognizer<unknown>, _offendingSymbol: unknown,
                         line: number, column: number, msg: string,
                         _e: RecognitionException | undefined): void {
        this.messages.push(`line ${line}:${column} error: ${msg}`);
    }
}

/**
 * The front half of the pipeline: parse, check, lower. Pure - no I/O - so it
 * runs identically in Node, a browser, or a worker.
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
    if (collector.messages.length > 0) {
        return { errors: collector.messages, warnings: [], ir: null };
    }

    const analyzer = new SemanticAnalyzer();
    analyzer.visit(tree);
    if (analyzer.errors.length > 0) {
        return { errors: [...analyzer.errors], warnings: [...analyzer.warnings], ir: null };
    }

    const builder = new IRBuilder();
    builder.visit(tree);
    return { errors: [], warnings: [...analyzer.warnings], ir: builder.instructions };
}
