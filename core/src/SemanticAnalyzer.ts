import { ParserRuleContext, Token } from 'antlr4';
import VoxVisitor from './gen/VoxVisitor.js';
import {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, ParameterListContext, DeclForwardContext, DeclReverseContext,
    AssignForwardContext, AssignReverseContext, IfStatementContext,
    WhileLoopContext, ForLoopContext, ExpressionContext, ParenExprContext,
    NotExprContext, PowExprContext, MulExprContext, AddExprContext,
    SubFromExprContext, RelExprContext, EqExprContext, AndExprContext,
    OrExprContext, IdExprContext, IntExprContext, FloatExprContext,
    StringExprContext, BoolExprContext, InputExprContext, CallExprContext,
    FunctionCallContext, PrintStatementContext, ReturnStatementContext,
} from './gen/VoxParser.js';
import VoxParser from './gen/VoxParser.js';

/** A declared function: return type plus the types of its parameters. */
interface Signature {
    returnType: string;
    paramTypes: string[];
}

/**
 * Name resolution and type checking. A direct port of the Java
 * SemanticAnalyzer; diagnostic messages are kept byte-for-byte identical so
 * the shared regression suite can assert on them for both engines.
 */
export class SemanticAnalyzer extends VoxVisitor<string | null> {
    private readonly functions = new Map<string, Signature>();
    /** Innermost scope is the LAST element. */
    private readonly scopes: Map<string, string>[] = [];
    readonly errors: string[] = [];
    readonly warnings: string[] = [];

    private error(ctx: ParserRuleContext, msg: string): void {
        this.errors.push(at(ctx.start) + ' error: ' + msg);
    }

    private warn(ctx: ParserRuleContext, msg: string): void {
        this.warnings.push(at(ctx.start) + ' warning: ' + msg);
    }

    // ------------------------------------------------------------- scopes --

    private enterScope(): void { this.scopes.push(new Map()); }
    private exitScope(): void { this.scopes.pop(); }

    /** Declared in the innermost scope only, so shadowing an outer name is legal. */
    private declaredHere(name: string): boolean {
        return this.scopes.length > 0 && this.scopes[this.scopes.length - 1].has(name);
    }

    private isVisible(name: string): boolean {
        return this.scopes.some(s => s.has(name));
    }

    private typeOf(name: string): string | null {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const t = this.scopes[i].get(name);
            if (t !== undefined) return t;
        }
        return null;
    }

    private define(name: string, type: string): void {
        if (this.scopes.length > 0) this.scopes[this.scopes.length - 1].set(name, type);
    }

    // ------------------------------------------------------------ program --

    visitProgram = (ctx: ProgramContext): null => {
        // Collect every signature up front so a function may call one that is
        // defined later in the file.
        for (const f of ctx.function__list()) {
            const p = f.prototype();
            const d = f.definition();
            if (p) {
                this.declareFunction(p.ID().getText(),
                    canonical(p.returnType().getText()), paramTypes(p.parameterList()), p);
            } else if (d) {
                this.declareFunction(d.ID().getText(),
                    canonical(d.returnType().getText()), paramTypes(d.parameterList()), d);
            }
        }

        for (const f of ctx.function__list()) this.visit(f);
        this.visit(ctx.mainFunction());
        return null;
    };

    private declareFunction(name: string, returnType: string,
                            params: string[], ctx: ParserRuleContext): void {
        const existing = this.functions.get(name);
        if (existing) {
            // A definition matching an earlier prototype is fine; anything else is not.
            const sameShape = existing.returnType === returnType
                && existing.paramTypes.length === params.length
                && existing.paramTypes.every((t, i) => t === params[i]);
            if (!sameShape) {
                this.error(ctx, `function '${name}' redeclared with a different signature`);
            }
            return;
        }
        this.functions.set(name, { returnType, paramTypes: params });
    }

    visitPrototype = (_ctx: PrototypeContext): null => {
        return null; // nothing to check beyond the signature already recorded
    };

    visitDefinition = (ctx: DefinitionContext): null => {
        this.enterScope();
        const params = ctx.parameterList();
        if (params) {
            for (const p of params.parameter_list()) {
                const name = p.ID().getText();
                if (this.declaredHere(name)) {
                    this.error(p, `duplicate parameter '${name}'`);
                } else {
                    this.define(name, canonical(p.datatype().getText()));
                }
            }
        }
        // The body's own scope, so a local may shadow a parameter.
        this.visit(ctx.block());
        this.exitScope();
        return null;
    };

    visitMainFunction = (ctx: MainFunctionContext): null => {
        this.enterScope();
        this.visit(ctx.block());
        this.exitScope();
        return null;
    };

    visitBlock = (ctx: BlockContext): null => {
        this.enterScope();
        for (const s of ctx.statement_list()) this.visit(s);
        this.exitScope();
        return null;
    };

    // -------------------------------------------------------- declarations --

    visitDeclForward = (ctx: DeclForwardContext): null => {
        const declared = ctx.datatype().getText();
        const name = ctx.ID().getText();
        const valueType = ctx.expression() ? this.visit(ctx.expression()) : null;
        this.declareVariable(ctx, name, declared, valueType);
        return null;
    };

    visitDeclReverse = (ctx: DeclReverseContext): null => {
        const valueType = this.visit(ctx.expression());
        this.declareVariable(ctx, ctx.ID().getText(), ctx.datatype().getText(), valueType);
        return null;
    };

    private declareVariable(ctx: ParserRuleContext, name: string,
                            declaredType: string, valueType: string | null): void {
        if (this.declaredHere(name)) {
            this.error(ctx, `variable '${name}' is already declared in this scope`);
        } else {
            this.define(name, canonical(declaredType));
        }
        if (valueType !== null) {
            this.checkAssignable(ctx, canonical(declaredType), valueType, name);
        }
    }

    // --------------------------------------------------------- assignments --

    visitAssignForward = (ctx: AssignForwardContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    };

    visitAssignReverse = (ctx: AssignReverseContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    };

    private checkAssignTarget(ctx: ParserRuleContext, name: string,
                              valueType: string | null): void {
        if (!this.isVisible(name)) {
            this.error(ctx, `variable '${name}' is not declared`);
            return;
        }
        this.checkAssignable(ctx, this.typeOf(name), valueType, name);
    }

    /** Reports a narrowing or otherwise lossy assignment as a warning, not an error. */
    private checkAssignable(ctx: ParserRuleContext, target: string | null,
                            value: string | null, name: string): void {
        if (target === null || value === null) return;
        if (value === 'error' || target === value) return;
        // input() is dynamic: the runtime coerces it to whatever fits.
        if (value === 'any' || target === 'any') return;

        if (isNumeric(target) && isNumeric(value)) {
            if (target === 'integer' && value === 'float') {
                this.warn(ctx, `implicit cast float -> integer assigning to '${name}' loses precision`);
            }
            return; // integer -> float widens silently
        }
        this.error(ctx, `cannot assign ${value} to ${target} '${name}'`);
    }

    // ------------------------------------------------------------ control --

    visitIfStatement = (ctx: IfStatementContext): null => {
        this.requireCondition(ctx.expression());
        this.visit(ctx._thenBlock);
        if (ctx._elseBlock) this.visit(ctx._elseBlock);
        return null;
    };

    visitWhileLoop = (ctx: WhileLoopContext): null => {
        this.requireCondition(ctx.expression());
        this.visit(ctx.block());
        return null;
    };

    visitForLoop = (ctx: ForLoopContext): null => {
        // The loop variable belongs to a scope enclosing the body.
        this.enterScope();
        this.visit(ctx.variableDeclaration());
        this.requireCondition(ctx.expression());
        this.visit(ctx.assignment());
        this.visit(ctx.block());
        this.exitScope();
        return null;
    };

    private requireCondition(ctx: ExpressionContext): void {
        const t = this.visit(ctx);
        if (t === 'string') {
            this.warn(ctx, 'condition has type string; it is true when non-empty');
        }
    }

    // -------------------------------------------------------- expressions --

    visitParenExpr = (ctx: ParenExprContext): string | null => this.visit(ctx.expression());

    visitNotExpr = (ctx: NotExprContext): string => {
        this.visit(ctx.expression());
        return 'boolean';
    };

    visitPowExpr = (ctx: PowExprContext): string =>
        this.arithmetic(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)), '^');

    visitMulExpr = (ctx: MulExprContext): string =>
        this.arithmetic(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            ctx._op.text);

    visitAddExpr = (ctx: AddExprContext): string => {
        const l = this.visit(ctx.expression(0));
        const r = this.visit(ctx.expression(1));
        const isAdd = ctx._op.type === VoxParser.ADD;
        // '+' doubles as string concatenation.
        if (isAdd && (l === 'string' || r === 'string')) return 'string';
        return this.arithmetic(ctx, l, r, ctx._op.text);
    };

    visitSubFromExpr = (ctx: SubFromExprContext): string =>
        this.arithmetic(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            'subtracted from');

    private arithmetic(ctx: ParserRuleContext, l: string | null,
                       r: string | null, op: string): string {
        if (l === 'error' || r === 'error') return 'error';
        if (l === 'any' || r === 'any') return 'any';
        if (l !== null && r !== null && isNumeric(l) && isNumeric(r)) {
            return l === 'float' || r === 'float' ? 'float' : 'integer';
        }
        this.error(ctx, `operator '${op}' cannot be applied to ${l} and ${r}`);
        return 'error';
    }

    visitRelExpr = (ctx: RelExprContext): string =>
        this.comparison(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            ctx._op.text, true);

    visitEqExpr = (ctx: EqExprContext): string =>
        this.comparison(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            ctx._op.text, false);

    private comparison(ctx: ParserRuleContext, l: string | null,
                       r: string | null, op: string, ordered: boolean): string {
        if (l === 'error' || r === 'error') return 'error';
        if (l === 'any' || r === 'any') return 'boolean';
        const ok = l !== null && r !== null
            && ((isNumeric(l) && isNumeric(r))
                || (l === r && (!ordered || l !== 'boolean')));
        if (!ok) {
            this.error(ctx, `operator '${op}' cannot compare ${l} and ${r}`);
            return 'error';
        }
        return 'boolean';
    }

    visitAndExpr = (ctx: AndExprContext): string => {
        this.visit(ctx.expression(0));
        this.visit(ctx.expression(1));
        return 'boolean';
    };

    visitOrExpr = (ctx: OrExprContext): string => {
        this.visit(ctx.expression(0));
        this.visit(ctx.expression(1));
        return 'boolean';
    };

    visitIdExpr = (ctx: IdExprContext): string => {
        const name = ctx.ID().getText();
        if (!this.isVisible(name)) {
            this.error(ctx, `variable '${name}' is not declared`);
            return 'error';
        }
        return this.typeOf(name)!;
    };

    visitIntExpr = (_ctx: IntExprContext): string => 'integer';
    visitFloatExpr = (_ctx: FloatExprContext): string => 'float';
    visitStringExpr = (_ctx: StringExprContext): string => 'string';
    visitBoolExpr = (_ctx: BoolExprContext): string => 'boolean';
    // input() is dynamically typed: the runtime coerces "12" to an integer,
    // "true" to a boolean, and anything else to a string. Reporting it as a
    // fixed type would make every realistic use of it a type error.
    visitInputExpr = (_ctx: InputExprContext): string => 'any';

    visitCallExpr = (ctx: CallExprContext): string | null =>
        this.visit(ctx.functionCall());

    visitFunctionCall = (ctx: FunctionCallContext): string => {
        const name = ctx.ID().getText();
        const argTypes = ctx.expression_list().map(e => this.visit(e));

        const sig = this.functions.get(name);
        if (!sig) {
            this.error(ctx, `function '${name}' is not declared`);
            return 'error';
        }
        if (sig.paramTypes.length !== argTypes.length) {
            this.error(ctx, `function '${name}' expects ${sig.paramTypes.length}`
                + ` argument(s) but got ${argTypes.length}`);
            return sig.returnType;
        }
        for (let i = 0; i < argTypes.length; i++) {
            const want = sig.paramTypes[i];
            const got = argTypes[i];
            if (got === null || got === 'error' || got === 'any' || want === got) continue;
            if (isNumeric(want) && isNumeric(got)) {
                if (want === 'integer' && got === 'float') {
                    this.warn(ctx, `argument ${i + 1} of '${name}':`
                        + ' implicit cast float -> integer loses precision');
                }
                continue;
            }
            this.error(ctx, `argument ${i + 1} of '${name}' expects ${want} but got ${got}`);
        }
        return sig.returnType;
    };

    visitPrintStatement = (ctx: PrintStatementContext): null => {
        for (const e of ctx.expression_list()) this.visit(e);
        return null;
    };

    visitReturnStatement = (ctx: ReturnStatementContext): null => {
        if (ctx.expression()) this.visit(ctx.expression());
        return null;
    };
}

function at(t: Token): string {
    return `line ${t.line}:${t.column}`;
}

function isNumeric(t: string): boolean {
    return t === 'integer' || t === 'float';
}

function paramTypes(ctx: ParameterListContext | null): string[] {
    if (!ctx) return [];
    return ctx.parameter_list().map(p => canonical(p.datatype().getText()));
}

/** Maps every spelling of a type onto one canonical name. */
export function canonical(written: string): string {
    const t = written.trim().replace(/\s+/g, ' ');
    switch (t) {
        case 'int': case 'integer': case 'number': case 'whole number':
            return 'integer';
        case 'float': case 'floating point number':
            return 'float';
        case 'bool': case 'boolean': case 'boolean number':
            return 'boolean';
        case 'char': case 'character':
            return 'character';
        case 'string': case 'character string': case 'varchar':
            return 'string';
        default:
            return t;
    }
}
