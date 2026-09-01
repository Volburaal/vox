import { ParserRuleContext } from 'antlr4';
import VoxVisitor from './gen/VoxVisitor.js';
import {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, ParameterListContext, ReturnTypeContext, DeclForwardContext,
    DeclReverseContext, AssignForwardContext, AssignReverseContext,
    IfStatementContext, WhileLoopContext, ForLoopContext, RangeLoopContext,
    RepeatTimesContext, RepeatUntilContext, SwapStmtContext, DeclLetContext,
    SetToContext, AskExprContext, PredicateExprContext, DivisibleExprContext,
    BetweenExprContext,
    BreakStmtContext, ContinueStmtContext, ExprStmtContext, IncStmtContext,
    DecStmtContext, OpAssignContext, IncreaseByContext, DecreaseByContext,
    AddToContext, TakeFromContext, MultiplyByContext, DivideByContext,
    DoubleStmtContext, HalveStmtContext, ExpressionContext, ParenExprContext,
    CastExprContext, BuiltinExprContext, BuiltinNameContext, NegExprContext,
    SquaredExprContext, NotExprContext, PowExprContext, MulExprContext, AddExprContext,
    SubFromExprContext, RelExprContext, EqExprContext andExprContext,
    OrExprContext, IdExprContext, IntExprContext, FloatExprContext,
    StringExprContext, BoolExprContext, InputExprContext, CallExprContext,
    FunctionCallContext, PrintStatementContext, ReturnStatementContext,
} from './gen/VoxParser.js';
import VoxParser from './gen/VoxParser.js';
import { Diagnostic, diagnosticFor, formatDiagnostic } from './diagnostics.js';

/** A declared function: return type plus the types of its parameters. */
interface Signature {
    returnType: string;
    paramTypes: string[];
}

/** What a builtin accepts ('num' or 'string' per parameter) and returns. */
interface BuiltinSpec {
    params: ('num' | 'string')[];
    /** A fixed type or 'numeric' to follow the arguments (float if any float). */
    result: string;
}

/**
 * The builtin functions, by their symbolic name. The spoken forms in the
 * grammar ("square root of") map onto the same names. User-defined functions
 * take precedence over these, so no name is reserved.
 */
export const BUILTINS: ReadonlyMap<string, BuiltinSpec> = new Map<string, BuiltinSpec>([
    ['sqrt',      { params: ['num'],        result: 'float' }],
    ['abs',       { params: ['num'],        result: 'numeric' }],
    ['round',     { params: ['num'],        result: 'integer' }],
    ['floor',     { params: ['num'],        result: 'integer' }],
    ['ceiling',   { params: ['num'],        result: 'integer' }],
    ['min',       { params: ['num', 'num'], result: 'numeric' }],
    ['max',       { params: ['num', 'num'], result: 'numeric' }],
    ['length',    { params: ['string'],     result: 'integer' }],
    ['uppercase', { params: ['string'],     result: 'string' }],
    ['lowercase', { params: ['string'],     result: 'string' }],
]);

/** Maps a spoken builtin token onto its symbolic name. */
export function builtinNameOf(ctx: BuiltinNameContext): string {
    if (ctx.SQRT_OF()) return 'sqrt';
    if (ctx.ABS_OF()) return 'abs';
    if (ctx.LENGTH_OF()) return 'length';
    if (ctx.FLOOR_OF()) return 'floor';
    if (ctx.CEIL_OF()) return 'ceiling';
    if (ctx.UPPER_OF()) return 'uppercase';
    return 'lowercase';
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
    /** The function being checked; null inside main. */
    private currentFunction: { name: string; returnType: string } | null = null;
    private loopDepth = 0;
    /** Every message with its source range, in the order it was found. */
    readonly diagnostics: Diagnostic[] = [];

    /** The CLI-style "line L:C error: ..." strings, errors only. */
    get errors(): string[] {
        return this.diagnostics.filter(d => d.severity === 'error').map(formatDiagnostic);
    }

    /** The CLI-style "line L:C warning: ..." strings, warnings only. */
    get warnings(): string[] {
        return this.diagnostics.filter(d => d.severity === 'warning').map(formatDiagnostic);
    }

    private error(ctx: ParserRuleContext, msg: string): void {
        this.diagnostics.push(diagnosticFor(ctx, 'error', msg));
    }

    private warn(ctx: ParserRuleContext, msg: string): void {
        this.diagnostics.push(diagnosticFor(ctx, 'warning', msg));
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
                this.declareFunction(p.ID().getText(), returnTypeOf(p.returnType()),
                    paramTypes(p.parameterList()), p);
            } else if (d) {
                this.declareFunction(d.ID().getText(), returnTypeOf(d.returnType()),
                    paramTypes(d.parameterList()), d);
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
        const name = ctx.ID().getText();
        this.currentFunction = { name, returnType: returnTypeOf(ctx.returnType()) };
        this.enterScope();
        const params = ctx.parameterList();
        if (params) {
            for (const p of params.parameter_list()) {
                const pname = p.ID().getText();
                if (this.declaredHere(pname)) {
                    this.error(p, `duplicate parameter '${pname}'`);
                } else {
                    this.define(pname, canonical(p.datatype().getText()));
                }
            }
        }
        // The body's own scope, so a local may shadow a parameter.
        this.visit(ctx.block());
        this.exitScope();
        this.currentFunction = null;
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

    /** `let x be 5` declares x with the type of its value. */
    visitDeclLet = (ctx: DeclLetContext): null => {
        const valueType = this.visit(ctx.expression());
        const name = ctx.ID().getText();
        if (this.declaredHere(name)) {
            this.error(ctx, `variable '${name}' is already declared in this scope`);
        } else {
            this.define(name, valueType === null || valueType === 'error' ? 'any' : valueType);
        }
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

    visitSetTo = (ctx: SetToContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    };

    /** Each value must fit the other variable's declared type. */
    visitSwapStmt = (ctx: SwapStmtContext): null => {
        const a = ctx.ID(0).getText();
        const b = ctx.ID(1).getText();
        let missing = false;
        for (const name of [a, b]) {
            if (!this.isVisible(name)) {
                this.error(ctx, `variable '${name}' is not declared`);
                missing = true;
            }
        }
        if (missing) return null;
        this.checkAssignable(ctx, this.typeOf(a), this.typeOf(b), a);
        this.checkAssignable(ctx, this.typeOf(b), this.typeOf(a), b);
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

    // ------------------------------------------------------------ updates --
    // Every spoken form is checked as its symbolic twin: `add 3 to n` is `n += 3`.

    visitIncStmt = (ctx: IncStmtContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '++', 'integer');

    visitDecStmt = (ctx: DecStmtContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '--', 'integer');

    visitOpAssign = (ctx: OpAssignContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), ctx._op.text!, this.visit(ctx.expression()));

    visitIncreaseBy = (ctx: IncreaseByContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '+=', this.visit(ctx.expression()));

    visitDecreaseBy = (ctx: DecreaseByContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '-=', this.visit(ctx.expression()));

    visitAddTo = (ctx: AddToContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '+=', this.visit(ctx.expression()));

    visitTakeFrom = (ctx: TakeFromContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '-=', this.visit(ctx.expression()));

    visitMultiplyBy = (ctx: MultiplyByContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '*=', this.visit(ctx.expression()));

    visitDivideBy = (ctx: DivideByContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), '/=', this.visit(ctx.expression()));

    visitDoubleStmt = (ctx: DoubleStmtContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), 'double', 'integer');

    visitHalveStmt = (ctx: HalveStmtContext): null =>
        this.checkUpdate(ctx, ctx.ID().getText(), 'halve', 'integer');

    /** `name op= value` is checked exactly like `name = name op value`. */
    private checkUpdate(ctx: ParserRuleContext, name: string, op: string,
                        valueType: string | null): null {
        if (!this.isVisible(name)) {
            this.error(ctx, `variable '${name}' is not declared`);
            return null;
        }
        const target = this.typeOf(name)!;
        let result: string;
        if (op === '++' || op === '--' || op === 'double' || op === 'halve') {
            if (!isNumeric(target)) {
                this.error(ctx, `operator '${op}' cannot be applied to ${target}`);
                return null;
            }
            result = target;
        } else if (op === '+=' && (target === 'string' || valueType === 'string')) {
            result = 'string'; // '+' doubles as string concatenation
        } else {
            result = this.arithmetic(ctx, target, valueType, op);
        }
        this.checkAssignable(ctx, target, result, name);
        return null;
    }

    // ------------------------------------------------------------ control --

    visitIfStatement = (ctx: IfStatementContext): null => {
        this.requireCondition(ctx.expression());
        this.visit(ctx._thenBlock);
        if (ctx._elseIf) this.visit(ctx._elseIf);
        else if (ctx._elseBlock) this.visit(ctx._elseBlock);
        return null;
    };

    visitWhileLoop = (ctx: WhileLoopContext): null => {
        this.requireCondition(ctx.expression());
        this.loopDepth++;
        this.visit(ctx.block());
        this.loopDepth--;
        return null;
    };

    visitForLoop = (ctx: ForLoopContext): null => {
        // The loop variable belongs to a scope enclosing the body.
        this.enterScope();
        this.visit(ctx.variableDeclaration());
        this.requireCondition(ctx.expression());
        this.visit(ctx.forUpdate());
        this.loopDepth++;
        this.visit(ctx.block());
        this.loopDepth--;
        this.exitScope();
        return null;
    };

    visitRangeLoop = (ctx: RangeLoopContext): null => {
        const rc = ctx.rangeClause();
        const name = rc.ID().getText();
        const varType = rc.datatype() ? canonical(rc.datatype()!.getText()) : 'integer';
        // The bounds are evaluated before the loop variable exists, so
        // `for i from i to 10` refers to an outer i.
        const startType = this.visit(rc._start);
        const limitType = this.visit(rc._limit);
        const stepType = rc._step ? this.visit(rc._step) : null;

        if (!isNumeric(varType)) {
            this.error(rc.datatype()!, `loop variable '${name}' must be a number, not ${varType}`);
        }
        this.requireNumber(rc._start, startType, 'loop start');
        this.requireNumber(rc._limit, limitType, 'loop end');
        if (rc._step) {
            this.requireNumber(rc._step, stepType, 'loop step');
            const literal = literalValue(rc._step);
            if (literal !== null && literal <= 0) {
                this.error(rc._step, "loop step must be positive; use 'down to' to count down");
            }
        }

        // The loop variable belongs to a scope enclosing the body.
        this.enterScope();
        this.define(name, varType);
        if (isNumeric(varType)) {
            this.checkAssignable(rc, varType, startType, name);
            if (rc._step) this.checkAssignable(rc._step, varType, stepType, name);
        }
        this.loopDepth++;
        this.visit(ctx.block());
        this.loopDepth--;
        this.exitScope();
        return null;
    };

    private requireNumber(ctx: ParserRuleContext, t: string | null, what: string): void {
        if (t === null || t === 'error' || t === 'any' || isNumeric(t)) return;
        this.error(ctx, `${what} must be a number but got ${t}`);
    }

    visitRepeatTimes = (ctx: RepeatTimesContext): null => {
        const t = this.visit(ctx.expression());
        if (t !== null && t !== 'error' && t !== 'any' && t !== 'integer') {
            this.error(ctx.expression(), `repeat count must be an integer but got ${t}`);
        }
        this.loopDepth++;
        this.visit(ctx.block());
        this.loopDepth--;
        return null;
    };

    visitRepeatUntil = (ctx: RepeatUntilContext): null => {
        // The body runs before the condition is first tested.
        this.loopDepth++;
        this.visit(ctx.block());
        this.loopDepth--;
        this.requireCondition(ctx.expression());
        return null;
    };

    visitBreakStmt = (ctx: BreakStmtContext): null => {
        if (this.loopDepth === 0) {
            this.error(ctx, `'${ctx.BREAK().getText()}' can only be used inside a loop`);
        }
        return null;
    };

    visitContinueStmt = (ctx: ContinueStmtContext): null => {
        if (this.loopDepth === 0) {
            this.error(ctx, `'${ctx.CONTINUE().getText()}' can only be used inside a loop`);
        }
        return null;
    };

    visitExprStmt = (ctx: ExprStmtContext): null => {
        const e = ctx.expression();
        this.visit(e);
        // `x is equal to 5;` compares and throws the answer away. Say so,
        // because in a spoken language it reads like an assignment.
        if (e instanceof EqExprContext) {
            this.warn(e, "comparison has no effect; to assign, use 'set ... to', '<-' or '='");
        } else if (!(e instanceof CallExprContext) && !(e instanceof InputExprContext)) {
            this.warn(e, 'expression has no effect');
        }
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

    visitCastExpr = (ctx: CastExprContext): string => {
        const source = this.visit(ctx.expression());
        const target = canonical(ctx.datatype().getText());
        return source === 'error' ? 'error' : target;
    };

    visitBuiltinExpr = (ctx: BuiltinExprContext): string => {
        const name = builtinNameOf(ctx.builtinName());
        return this.checkBuiltin(ctx, name, [this.visit(ctx.expression())]);
    };

    visitNegExpr = (ctx: NegExprContext): string => {
        const t = this.visit(ctx.expression());
        if (t === 'error') return 'error';
        if (t === 'any' || (t !== null && isNumeric(t))) return t;
        this.error(ctx, `operator '-' cannot be applied to ${t}`);
        return 'error';
    };

    visitSquaredExpr = (ctx: SquaredExprContext): string => {
        const t = this.visit(ctx.expression());
        if (t === 'error') return 'error';
        if (t === 'any' || (t !== null && isNumeric(t))) return t;
        this.error(ctx, `operator '${ctx._op.text}' cannot be applied to ${t}`);
        return 'error';
    };

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

    // ---- predicates: `is even`, `is not positive`, `is divisible by`, ... ----

    visitPredicateExpr = (ctx: PredicateExprContext): string => {
        const t = this.visit(ctx.expression());
        if (t !== null && t !== 'error' && t !== 'any') {
            const pred = ctx._pred.type;
            const ok = pred === VoxParser.EMPTY
                ? t === 'string' || t === 'character'
                : pred === VoxParser.EVEN || pred === VoxParser.ODD
                    ? t === 'integer'
                    : isNumeric(t);
            if (!ok) {
                this.error(ctx, `operator '${predicateName(ctx._op.type, ctx._pred.text!)}'`
                    + ` cannot be applied to ${t}`);
            }
        }
        return 'boolean';
    };

    visitDivisibleExpr = (ctx: DivisibleExprContext): string => {
        const l = this.visit(ctx.expression(0));
        const r = this.visit(ctx.expression(1));
        const bad = (t: string | null): boolean =>
            t !== null && t !== 'error' && t !== 'any' && t !== 'integer';
        if (bad(l) || bad(r)) {
            this.error(ctx, `operator '${predicateName(ctx._op.type, 'divisible by')}'`
                + ` cannot be applied to ${l} and ${r}`);
        }
        return 'boolean';
    };

    visitBetweenExpr = (ctx: BetweenExprContext): string => {
        const value = this.visit(ctx.expression(0));
        const low = this.visit(ctx._low);
        const high = this.visit(ctx._high);
        const op = predicateName(ctx._op.type, 'between');
        this.comparison(ctx, value, low, op, true);
        this.comparison(ctx, value, high, op, true);
        return 'boolean';
    };

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
                       r: string | null, op: string ordered: boolean): string {
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
    // "true" to a boolean and anything else to a string. Reporting it as a
    // fixed type would make every realistic use of it a type error.
    visitInputExpr = (_ctx: InputExprContext): string => 'any';
    // ask prints its prompt, then reads a line exactly like input().
    visitAskExpr = (ctx: AskExprContext): string => {
        this.visit(ctx.expression());
        return 'any';
    };

    visitCallExpr = (ctx: CallExprContext): string | null => {
        const call = ctx.functionCall();
        const t = this.visit(call);
        // A procedure call is fine as a statement on its own, but has no value.
        if (t === 'void' && !(ctx.parentCtx instanceof ExprStmtContext)) {
            this.error(ctx, `procedure '${call.ID().getText()}' returns nothing and cannot be used as a value`);
            return 'error';
        }
        return t;
    };

    visitFunctionCall = (ctx: FunctionCallContext): string => {
        const name = ctx.ID().getText();
        const argTypes = ctx.expression_list().map(e => this.visit(e));

        const sig = this.functions.get(name);
        if (!sig) {
            if (BUILTINS.has(name)) return this.checkBuiltin(ctx, name, argTypes);
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

    /** Arity and type checks for a builtin; returns its result type. */
    private checkBuiltin(ctx: ParserRuleContext, name: string,
                         argTypes: (string | null)[]): string {
        const spec = BUILTINS.get(name)!;
        const result = (): string => {
            if (spec.result !== 'numeric') return spec.result;
            if (argTypes.some(t => t === 'float')) return 'float';
            if (argTypes.some(t => t === 'any')) return 'any';
            return 'integer';
        };
        if (spec.params.length !== argTypes.length) {
            this.error(ctx, `function '${name}' expects ${spec.params.length}`
                + ` argument(s) but got ${argTypes.length}`);
            return result();
        }
        for (let i = 0; i < argTypes.length; i++) {
            const got = argTypes[i];
            if (got === null || got === 'error' || got === 'any') continue;
            const kind = spec.params[i];
            const ok = kind === 'num' ? isNumeric(got) : (got === 'string' || got === 'character');
            if (!ok) {
                this.error(ctx, `argument ${i + 1} of '${name}' expects `
                    + (kind === 'num' ? 'a number' : 'string') + ` but got ${got}`);
            }
        }
        return result();
    }

    visitPrintStatement = (ctx: PrintStatementContext): null => {
        for (const e of ctx.expression_list()) this.visit(e);
        return null;
    };

    visitReturnStatement = (ctx: ReturnStatementContext): null => {
        const valueType = ctx.expression() ? this.visit(ctx.expression()) : null;
        const fn = this.currentFunction;
        if (fn === null) return null; // `return` in main just ends the program

        if (fn.returnType === 'void') {
            if (ctx.expression()) {
                this.error(ctx, `procedure '${fn.name}' cannot return a value`);
            }
            return null;
        }
        if (!ctx.expression()) {
            this.error(ctx, `function '${fn.name}' must return a value of type ${fn.returnType}`);
            return null;
        }
        if (valueType === null || valueType === 'error' || valueType === 'any'
            || valueType === fn.returnType) return null;
        if (isNumeric(fn.returnType) && isNumeric(valueType)) {
            if (fn.returnType === 'integer' && valueType === 'float') {
                this.warn(ctx, `implicit cast float -> integer in return from '${fn.name}' loses precision`);
            }
            return null;
        }
        this.error(ctx, `cannot return ${valueType} from function '${fn.name}' which returns ${fn.returnType}`);
        return null;
    };
}

function isNumeric(t: string): boolean {
    return t === 'integer' || t === 'float';
}

/** 'is even' or 'is not even', regardless of how the operator was spelled. */
function predicateName(opType: number, pred: string): string {
    return (opType === VoxParser.NE ? 'is not ' : 'is ') + pred;
}

/** The value of a numeric literal (possibly negated or parenthesised), else null. */
function literalValue(e: ExpressionContext): number | null {
    while (e instanceof ParenExprContext) e = e.expression();
    if (e instanceof IntExprContext || e instanceof FloatExprContext) return Number(e.getText());
    if (e instanceof NegExprContext) {
        const inner = literalValue(e.expression());
        return inner === null ? null : -inner;
    }
    return null;
}

function paramTypes(ctx: ParameterListContext | null): string[] {
    if (!ctx) return [];
    return ctx.parameter_list().map(p => canonical(p.datatype().getText()));
}

/** 'void' for procedures, otherwise the canonical datatype. */
function returnTypeOf(ctx: ReturnTypeContext): string {
    return ctx.VOID() ? 'void' : canonical(ctx.datatype().getText());
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
