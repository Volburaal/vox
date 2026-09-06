import { ParserRuleContext, TerminalNode } from 'antlr4';
import VoxVisitor from './gen/VoxVisitor.js';
import {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, ParameterListContext, ReturnTypeContext, DatatypeContext,
    ListTypeContext, DeclForwardContext, DeclReverseContext, DeclLetContext,
    DeclSizedContext, DeclListIsContext, DeclConstantContext,
    DeclConstantLetContext, AssignForwardContext,
    AssignReverseContext, SetToContext, SwapStmtContext, TargetContext,
    NameTargetContext, IndexTargetContext, OrdinalTargetContext,
    IfStatementContext, WhileLoopContext, ForLoopContext, RangeLoopContext,
    ForEachLoopContext, RepeatTimesContext, RepeatUntilContext,
    BreakStmtContext, ContinueStmtContext, ExprStmtContext, IncStmtContext,
    DecStmtContext, OpAssignContext, IncreaseByContext, DecreaseByContext,
    AddToContext, TakeFromContext, MultiplyByContext, DivideByContext,
    DoubleStmtContext, HalveStmtContext, PushToContext, InsertIntoContext,
    PushCallContext, InsertCallContext, PopCallContext, ListStatementContext,
    MethodCallContext, PositionExprContext,
    ExpressionContext, ParenExprContext, IndexExprContext, CastExprContext,
    BuiltinExprContext, BuiltinNameContext, OrdinalExprContext, PopExprContext,
    AskExprContext, NegExprContext, SquaredExprContext, NotExprContext,
    PowExprContext, MulExprContext, AddExprContext, SubFromExprContext,
    PredicateExprContext, DivisibleExprContext, BetweenExprContext,
    InExprContext, ContainsExprContext, RelExprContext, EqExprContext,
    AndExprContext, OrExprContext, IdExprContext, IntExprContext,
    FloatExprContext, StringExprContext, BoolExprContext, ListExprContext,
    InputExprContext, CallExprContext, FunctionCallContext,
    PrintStatementContext, ReturnStatementContext,
} from './gen/VoxParser.js';
import VoxParser from './gen/VoxParser.js';
import { Diagnostic, diagnosticFor, formatDiagnostic } from './diagnostics.js';

/** A declared function: return type plus the types of its parameters. */
interface Signature {
    returnType: string;
    paramTypes: string[];
}

/** A variable in scope: its type, and whether assignment to it is forbidden. */
interface Binding {
    type: string;
    constant: boolean;
}

/**
 * What a builtin accepts per parameter, and what it returns.
 *   params: 'num' | 'string' | 'sized' (string or list) | 'list'
 *         | 'sortable' (a list of scalars) | 'numlist' (a list of numbers)
 *         | 'item' (something that fits the first argument's item type)
 *   result: a fixed type, 'numeric' (float if any float), 'same' (the first
 *           argument's type), 'element' (its item type) or 'void'
 */
interface BuiltinSpec {
    params: ('num' | 'string' | 'sized' | 'list' | 'sortable' | 'numlist' | 'item')[];
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
    ['length',    { params: ['sized'],      result: 'integer' }],
    ['uppercase', { params: ['string'],     result: 'string' }],
    ['lowercase', { params: ['string'],     result: 'string' }],
    ['copy',      { params: ['list'],       result: 'same' }],
    // list switches and their questions
    ['lock',      { params: ['list'],       result: 'void' }],
    ['unlock',    { params: ['list'],       result: 'void' }],
    ['wrap',      { params: ['list'],       result: 'void' }],
    ['unwrap',    { params: ['list'],       result: 'void' }],
    ['locked',    { params: ['list'],       result: 'boolean' }],
    ['wrapping',  { params: ['list'],       result: 'boolean' }],
    // ordering and aggregates
    ['sort',      { params: ['sortable'],   result: 'void' }],
    ['reverse',   { params: ['list'],       result: 'void' }],
    ['sum',       { params: ['numlist'],    result: 'element' }],
    ['largest',   { params: ['sortable'],   result: 'element' }],
    ['smallest',  { params: ['sortable'],   result: 'element' }],
    ['position',  { params: ['list', 'item'], result: 'integer' }],
]);

/** Maps a spoken builtin token onto its symbolic name. */
export function builtinNameOf(ctx: BuiltinNameContext): string {
    if (ctx.SQRT_OF()) return 'sqrt';
    if (ctx.ABS_OF()) return 'abs';
    if (ctx.LENGTH_OF()) return 'length';
    if (ctx.FLOOR_OF()) return 'floor';
    if (ctx.CEIL_OF()) return 'ceiling';
    if (ctx.UPPER_OF()) return 'uppercase';
    if (ctx.COPY_OF()) return 'copy';
    if (ctx.SUM_OF()) return 'sum';
    if (ctx.LARGEST_OF()) return 'largest';
    if (ctx.SMALLEST_OF()) return 'smallest';
    return 'lowercase';
}

/**
 * Name resolution and type checking. A direct port of the Java
 * SemanticAnalyzer; diagnostic messages are kept byte-for-byte identical so
 * the shared regression suite can assert on them for both engines.
 *
 * Types are strings: the five scalars, `list of <type>` (nesting freely),
 * 'any' for values only known at run time (input), 'void' and 'error'.
 */
export class SemanticAnalyzer extends VoxVisitor<string | null> {
    private readonly functions = new Map<string, Signature>();
    /** Innermost scope is the LAST element. */
    private readonly scopes: Map<string, Binding>[] = [];
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

    private declaredHere(name: string): boolean {
        return this.scopes.length > 0 && this.scopes[this.scopes.length - 1].has(name);
    }

    private isVisible(name: string): boolean {
        return this.scopes.some(s => s.has(name));
    }

    private binding(name: string): Binding | null {
        for (let i = this.scopes.length - 1; i >= 0; i--) {
            const b = this.scopes[i].get(name);
            if (b !== undefined) return b;
        }
        return null;
    }

    private typeOf(name: string): string | null {
        return this.binding(name)?.type ?? null;
    }

    private define(name: string, type: string, constant = false): void {
        if (this.scopes.length > 0) this.scopes[this.scopes.length - 1].set(name, { type, constant });
    }

    /**
     * Declares a variable. A name cannot be reused while one is visible - in
     * this scope or any enclosing one - so no variable is ever shadowed.
     */
    private declareVariable(ctx: ParserRuleContext, name: string, type: string,
                            valueType: string | null, constant = false): void {
        if (this.declaredHere(name)) {
            this.error(ctx, `variable '${name}' is already declared in this scope`);
        } else if (this.isVisible(name)) {
            this.error(ctx, `variable '${name}' is already declared in an enclosing scope`);
        } else {
            this.define(name, type, constant);
        }
        if (valueType !== null) this.checkAssignable(ctx, type, valueType, name);
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
                    this.define(pname, typeName(p.datatype()));
                }
            }
        }
        // The body's own scope; its locals cannot reuse a parameter's name.
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
        const type = typeName(ctx.datatype());
        if (ctx.FIXED() && !isList(type)) {
            this.error(ctx, `'fixed' applies to lists, not ${type}`);
        }
        const valueType = ctx.expression() ? this.visit(ctx.expression()) : null;
        this.declareVariable(ctx, ctx.ID().getText(), type, valueType);
        return null;
    };

    visitDeclReverse = (ctx: DeclReverseContext): null => {
        const valueType = this.visit(ctx.expression());
        this.declareVariable(ctx, ctx.ID().getText(), typeName(ctx.datatype()), valueType);
        return null;
    };

    /** `let x be 5` declares x with the type of its value. */
    visitDeclLet = (ctx: DeclLetContext): null => {
        let valueType = this.visit(ctx.expression());
        if (valueType === listOf('any')) {
            this.error(ctx, 'the type of [] cannot be inferred; declare the list with a type instead');
        }
        if (valueType === null || valueType === 'error') valueType = 'any';
        this.declareVariable(ctx, ctx.ID().getText(), valueType, null);
        return null;
    };

    /** `integer xs[5]`: a list of that many defaults; `integer xs[]`: empty. */
    visitDeclSized = (ctx: DeclSizedContext): null => {
        const type = listOf(typeName(ctx.datatype()));
        if (ctx._size) {
            const sizeType = this.visit(ctx._size);
            if (sizeType !== null && sizeType !== 'error' && sizeType !== 'any' && sizeType !== 'integer') {
                this.error(ctx._size, `list size must be an integer but got ${sizeType}`);
            }
        }
        const valueType = ctx._init ? this.visit(ctx._init) : null;
        if (ctx._size && ctx._init) {
            this.error(ctx, 'give a list a size or an initial value, not both');
        }
        this.declareVariable(ctx, ctx.ID().getText(), type, valueType);
        return null;
    };

    /** `xs is a list of integers`. */
    visitDeclListIs = (ctx: DeclListIsContext): null => {
        const type = listOf(typeName(ctx.datatype()));
        const valueType = ctx._init ? this.visit(ctx._init) : null;
        this.declareVariable(ctx, ctx.ID().getText(), type, valueType);
        return null;
    };

    /** `constant integer MAX <- 10`: assigning to MAX later is a compile error. */
    visitDeclConstant = (ctx: DeclConstantContext): null => {
        const valueType = this.visit(ctx.expression());
        this.declareVariable(ctx, ctx.ID().getText(), typeName(ctx.datatype()), valueType, true);
        return null;
    };

    /** `let TAX always be 0.2`: a constant with an inferred type. */
    visitDeclConstantLet = (ctx: DeclConstantLetContext): null => {
        let valueType = this.visit(ctx.expression());
        if (valueType === listOf('any')) {
            this.error(ctx, 'the type of [] cannot be inferred; declare the list with a type instead');
        }
        if (valueType === null || valueType === 'error') valueType = 'any';
        this.declareVariable(ctx, ctx.ID().getText(), valueType, null, true);
        return null;
    };

    // --------------------------------------------------------- assignments --

    visitAssignForward = (ctx: AssignForwardContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    };

    visitAssignReverse = (ctx: AssignReverseContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    };

    visitSetTo = (ctx: SetToContext): null => {
        const valueType = this.visit(ctx.expression());
        this.checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    };

    private checkAssignTarget(ctx: ParserRuleContext, target: TargetContext,
                              valueType: string | null): void {
        const targetType = this.typeOfTarget(target);
        if (targetType === null) return; // already reported
        this.checkAssignable(ctx, targetType, valueType, target.getText());
    }

    /**
     * The type a target holds: a variable's declared type, or a list's item
     * type for `xs[i]` and `2nd item of xs`. Null once a problem is reported.
     * A constant cannot be the whole target, but its items may be (the name
     * is fixed, the list it refers to is not).
     */
    private typeOfTarget(target: TargetContext, writing = true): string | null {
        if (target instanceof NameTargetContext) {
            const name = target.ID().getText();
            const b = this.binding(name);
            if (b === null) {
                this.error(target, `variable '${name}' is not declared`);
                return null;
            }
            if (writing && b.constant) {
                this.error(target, `'${name}' is a constant and cannot be changed`);
                return null;
            }
            return b.type;
        }
        if (target instanceof IndexTargetContext) {
            const base = this.typeOfTarget(target.target(), false);
            this.requireIndex(target.expression(), this.visit(target.expression()));
            return this.itemTypeOf(target, base);
        }
        const ordinal = target as OrdinalTargetContext;
        this.checkOrdinal(ordinal, ordinal.ORDINAL());
        return this.itemTypeOf(ordinal, this.typeOfTarget(ordinal.target(), false));
    }

    /** The item type of a list type; reports when the base is not a list. */
    private itemTypeOf(ctx: ParserRuleContext, base: string | null): string | null {
        if (base === null || base === 'error') return null;
        if (base === 'any') return 'any';
        if (!isList(base)) {
            this.error(ctx, `cannot index ${base}; only lists have items`);
            return null;
        }
        return elementOf(base);
    }

    private requireIndex(ctx: ParserRuleContext, t: string | null): void {
        if (t === null || t === 'error' || t === 'any' || t === 'integer') return;
        this.error(ctx, `index must be an integer but got ${t}`);
    }

    /** `1st`, `2nd`, `3rd`, `4th`...: the suffix must be the English one. */
    private checkOrdinal(ctx: ParserRuleContext, token: TerminalNode): void {
        const text = token.getText();
        const n = Number(text.replace(/[a-z]+$/, ''));
        if (n === 0) {
            this.error(ctx, 'there is no 0th item; the first is the 1st, or index 0');
            return;
        }
        const want = ordinalSuffix(n);
        if (!text.endsWith(want)) {
            this.error(ctx, `'${text}' should be '${n}${want}'`);
        }
    }

    /** Reports a narrowing or otherwise lossy assignment as a warning, not an error. */
    private checkAssignable(ctx: ParserRuleContext, target: string | null,
                            value: string | null, name: string): void {
        if (target === null || value === null) return;
        switch (fits(target, value)) {
            case 'ok': return;
            case 'narrow':
                this.warn(ctx, `implicit cast float -> integer assigning to '${name}' loses precision`);
                return;
            default:
                this.error(ctx, `cannot assign ${value} to ${target} '${name}'`);
        }
    }

    /** Each value must fit the other variable's declared type. */
    visitSwapStmt = (ctx: SwapStmtContext): null => {
        const a = ctx.target(0);
        const b = ctx.target(1);
        const ta = this.typeOfTarget(a);
        const tb = this.typeOfTarget(b);
        if (ta === null || tb === null) return null;
        this.checkAssignable(ctx, ta, tb, a.getText());
        this.checkAssignable(ctx, tb, ta, b.getText());
        return null;
    };

    // ------------------------------------------------------------ updates --
    // Every spoken form is checked as its symbolic twin: `add 3 to n` is `n += 3`.

    visitIncStmt = (ctx: IncStmtContext): null =>
        this.checkUpdate(ctx, ctx.target(), '++', 'integer');

    visitDecStmt = (ctx: DecStmtContext): null =>
        this.checkUpdate(ctx, ctx.target(), '--', 'integer');

    visitOpAssign = (ctx: OpAssignContext): null =>
        this.checkUpdate(ctx, ctx.target(), ctx._op.text!, this.visit(ctx.expression()));

    visitIncreaseBy = (ctx: IncreaseByContext): null =>
        this.checkUpdate(ctx, ctx.target(), '+=', this.visit(ctx.expression()));

    visitDecreaseBy = (ctx: DecreaseByContext): null =>
        this.checkUpdate(ctx, ctx.target(), '-=', this.visit(ctx.expression()));

    visitAddTo = (ctx: AddToContext): null =>
        this.checkUpdate(ctx, ctx.target(), '+=', this.visit(ctx.expression()));

    visitTakeFrom = (ctx: TakeFromContext): null =>
        this.checkUpdate(ctx, ctx.target(), '-=', this.visit(ctx.expression()));

    visitMultiplyBy = (ctx: MultiplyByContext): null =>
        this.checkUpdate(ctx, ctx.target(), '*=', this.visit(ctx.expression()));

    visitDivideBy = (ctx: DivideByContext): null =>
        this.checkUpdate(ctx, ctx.target(), '/=', this.visit(ctx.expression()));

    visitDoubleStmt = (ctx: DoubleStmtContext): null =>
        this.checkUpdate(ctx, ctx.target(), 'double', 'integer');

    visitHalveStmt = (ctx: HalveStmtContext): null =>
        this.checkUpdate(ctx, ctx.target(), 'halve', 'integer');

    /** `x op= value` is checked exactly like `x = x op value`. */
    private checkUpdate(ctx: ParserRuleContext, target: TargetContext, op: string,
                        valueType: string | null): null {
        const targetType = this.typeOfTarget(target);
        if (targetType === null) return null;
        const name = target.getText();
        let result: string;
        if (op === '++' || op === '--' || op === 'double' || op === 'halve') {
            if (!isNumeric(targetType)) {
                this.error(ctx, `operator '${op}' cannot be applied to ${targetType}`);
                return null;
            }
            result = targetType;
        } else if (op === '+=' && isList(targetType)) {
            this.error(ctx, `to add an item to a list, use 'push ... to ${name}'`);
            return null;
        } else if (op === '+=' && (targetType === 'string' || valueType === 'string')) {
            result = 'string'; // '+' doubles as string concatenation
        } else {
            result = this.arithmetic(ctx, targetType, valueType, op);
        }
        this.checkAssignable(ctx, targetType, result, name);
        return null;
    }

    // -------------------------------------------------------------- lists --

    visitPushTo = (ctx: PushToContext): null => {
        const valueType = this.visit(ctx.expression(0));
        const listType = this.visit(ctx.expression(1));
        if (ctx.AT()) this.requireIndex(ctx.expression(2), this.visit(ctx.expression(2)));
        this.checkListOp(ctx, 'push', listType, valueType);
        return null;
    };

    visitInsertInto = (ctx: InsertIntoContext): null => {
        const valueType = this.visit(ctx.expression(0));
        const listType = this.visit(ctx.expression(1));
        this.requireIndex(ctx.expression(2), this.visit(ctx.expression(2)));
        this.checkListOp(ctx, 'insert', listType, valueType);
        return null;
    };

    /** push(xs, v) and insert(xs, i, v): the call spellings of the statements above. */
    visitPushCall = (ctx: PushCallContext): null => {
        const listType = this.visit(ctx.expression(0));
        const valueType = this.visit(ctx.expression(1));
        this.checkListOp(ctx, 'push', listType, valueType);
        return null;
    };

    visitInsertCall = (ctx: InsertCallContext): null => {
        const listType = this.visit(ctx.expression(0));
        this.requireIndex(ctx.expression(1), this.visit(ctx.expression(1)));
        const valueType = this.visit(ctx.expression(2));
        this.checkListOp(ctx, 'insert', listType, valueType);
        return null;
    };

    /** The list operand must be a list, and the value must fit its items. */
    private checkListOp(ctx: ParserRuleContext, op: string,
                        listType: string | null, valueType: string | null): void {
        if (listType === null || listType === 'error' || listType === 'any') return;
        if (!isList(listType)) {
            this.error(ctx, `'${op}' needs a list but got ${listType}`);
            return;
        }
        if (valueType !== null && fits(elementOf(listType), valueType) !== 'ok') {
            this.error(ctx, `cannot ${op} ${valueType} into ${listType}`);
        }
    }

    visitPopExpr = (ctx: PopExprContext): string => {
        const listType = this.visit(ctx.expression(0));
        if (ctx.AT()) this.requireIndex(ctx.expression(1), this.visit(ctx.expression(1)));
        return this.popResult(ctx, listType);
    };

    /** pop(xs) and pop(xs, i): the call spelling. */
    visitPopCall = (ctx: PopCallContext): string => {
        const listType = this.visit(ctx.expression(0));
        if (ctx.expression_list().length > 1) {
            this.requireIndex(ctx.expression(1), this.visit(ctx.expression(1)));
        }
        return this.popResult(ctx, listType);
    };

    /** `lock xs;`, `sort the scores;` - a one-list verb, checked as its builtin. */
    visitListStatement = (ctx: ListStatementContext): null => {
        this.checkBuiltin(ctx, ctx._verb.text!, [this.visit(ctx.expression())]);
        return null;
    };

    /** `position of x in xs` is position(xs, x). */
    visitPositionExpr = (ctx: PositionExprContext): string => {
        const valueType = this.visit(ctx.expression(0));
        const listType = this.visit(ctx.expression(1));
        return this.checkBuiltin(ctx, 'position', [listType, valueType]);
    };

    private popResult(ctx: ParserRuleContext, listType: string | null): string {
        if (listType === null || listType === 'error') return 'error';
        if (listType === 'any') return 'any';
        if (!isList(listType)) {
            this.error(ctx, `'pop' needs a list but got ${listType}`);
            return 'error';
        }
        return elementOf(listType);
    }

    visitIndexExpr = (ctx: IndexExprContext): string => {
        const base = this.visit(ctx.expression(0));
        this.requireIndex(ctx.expression(1), this.visit(ctx.expression(1)));
        return this.itemTypeOf(ctx, base) ?? 'error';
    };

    visitOrdinalExpr = (ctx: OrdinalExprContext): string => {
        this.checkOrdinal(ctx, ctx.ORDINAL());
        return this.itemTypeOf(ctx, this.visit(ctx.expression())) ?? 'error';
    };

    /** `[1, 2, 3]` is a list of integer; `[]` is a list of any until it is given a type. */
    visitListExpr = (ctx: ListExprContext): string => {
        let element: string | null = null;
        for (const e of ctx.expression_list()) {
            const t = this.visit(e);
            if (t === null || t === 'error') return 'error';
            if (t === 'any') continue;
            if (element === null || t === element) {
                element = t;
            } else if (fits(element, t) === 'ok' && fits(t, element) === 'ok') {
                // `[[], [1]]`: an empty inner list takes the type of a full one.
                if (element.includes('any')) element = t;
            } else {
                this.error(e, `list items must all have the same type; got ${element} and ${t}`);
                return 'error';
            }
        }
        return listOf(element ?? 'any');
    };

    visitInExpr = (ctx: InExprContext): string => {
        const valueType = this.visit(ctx.expression(0));
        const listType = this.visit(ctx.expression(1));
        this.checkContains(ctx, ctx._op.type === VoxParser.NE ? 'is not in' : 'is in', listType, valueType);
        return 'boolean';
    };

    visitContainsExpr = (ctx: ContainsExprContext): string => {
        const listType = this.visit(ctx.expression(0));
        const valueType = this.visit(ctx.expression(1));
        this.checkContains(ctx, 'contains', listType, valueType);
        return 'boolean';
    };

    private checkContains(ctx: ParserRuleContext, op: string,
                          listType: string | null, valueType: string | null): void {
        if (listType === null || listType === 'error' || listType === 'any') return;
        if (!isList(listType)) {
            this.error(ctx, `operator '${op}' needs a list but got ${listType}`);
            return;
        }
        if (valueType !== null && valueType !== 'error' && valueType !== 'any'
            && fits(elementOf(listType), valueType) === 'no') {
            this.error(ctx, `operator '${op}' cannot look for ${valueType} in ${listType}`);
        }
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
        const varType = rc.datatype() ? typeName(rc.datatype()!) : 'integer';
        // The bounds are evaluated before the loop variable exists.
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
        this.declareVariable(rc, name, varType, null);
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

    /** `for each x in xs`: x is a fresh variable holding a copy of each item. */
    visitForEachLoop = (ctx: ForEachLoopContext): null => {
        const listType = this.visit(ctx.expression());
        let element = 'any';
        if (listType !== null && listType !== 'error' && listType !== 'any') {
            if (isList(listType)) {
                element = elementOf(listType);
            } else {
                this.error(ctx.expression(), `for each needs a list but got ${listType}`);
            }
        }

        const name = ctx.ID().getText();
        const declared = ctx.datatype();
        const varType = declared ? typeName(declared) : element;
        if (declared && element !== 'any' && fits(varType, element) !== 'ok') {
            this.error(declared, `loop variable '${name}' is ${varType} but the list holds ${element}`);
        }

        this.enterScope();
        this.declareVariable(ctx, name, varType, null);
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
        } else if (!(e instanceof CallExprContext) && !(e instanceof InputExprContext)
            && !(e instanceof PopExprContext) && !(e instanceof PopCallContext)
            && !(e instanceof MethodCallContext)) {
            this.warn(e, 'expression has no effect');
        }
        return null;
    };

    private requireCondition(ctx: ExpressionContext): void {
        const t = this.visit(ctx);
        if (t === 'string' || (t !== null && isList(t))) {
            this.warn(ctx, `condition has type ${t}; it is true when non-empty`);
        }
    }

    // -------------------------------------------------------- expressions --

    visitParenExpr = (ctx: ParenExprContext): string | null => this.visit(ctx.expression());

    visitCastExpr = (ctx: CastExprContext): string => {
        const source = this.visit(ctx.expression());
        const target = typeName(ctx.datatype());
        if (source === 'error') return 'error';
        if (isList(target)) {
            this.error(ctx, `cannot convert to ${target}`);
            return 'error';
        }
        if (source !== null && isList(source) && target !== 'string') {
            this.error(ctx, `cannot convert ${source} to ${target}`);
            return 'error';
        }
        return target;
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
            ctx._op.text!);

    visitAddExpr = (ctx: AddExprContext): string => {
        const l = this.visit(ctx.expression(0));
        const r = this.visit(ctx.expression(1));
        const isAdd = ctx._op.type === VoxParser.ADD;
        // '+' doubles as string concatenation.
        if (isAdd && (l === 'string' || r === 'string')) return 'string';
        return this.arithmetic(ctx, l, r, ctx._op.text!);
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

    // ---- predicates: `is even`, `is not positive`, `is divisible by`, ... ----

    visitPredicateExpr = (ctx: PredicateExprContext): string => {
        const t = this.visit(ctx.expression());
        if (t !== null && t !== 'error' && t !== 'any') {
            const pred = ctx._pred.type;
            const ok = pred === VoxParser.EMPTY
                ? t === 'string' || t === 'character' || isList(t)
                : pred === VoxParser.LOCKED || pred === VoxParser.WRAPPING
                    ? isList(t)
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

    visitRelExpr = (ctx: RelExprContext): string =>
        this.comparison(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            ctx._op.text!, true);

    visitEqExpr = (ctx: EqExprContext): string =>
        this.comparison(ctx, this.visit(ctx.expression(0)), this.visit(ctx.expression(1)),
            ctx._op.text!, false);

    private comparison(ctx: ParserRuleContext, l: string | null,
                       r: string | null, op: string, ordered: boolean): string {
        if (l === 'error' || r === 'error') return 'error';
        if (l === 'any' || r === 'any') return 'boolean';
        const ok = l !== null && r !== null
            && ((isNumeric(l) && isNumeric(r))
                || (l === r && (!ordered || (l !== 'boolean' && !isList(l)))));
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
        const args = ctx.expression_list();
        return this.checkCall(ctx, ctx.ID().getText(), args, args.map(e => this.visit(e)));
    };

    /** `a.f(b)` is `f(a, b)`: the receiver is checked as the first argument. */
    visitMethodCall = (ctx: MethodCallContext): string => {
        const name = ctx.methodName().getText();
        const args = ctx.expression_list();
        const t = this.checkCall(ctx, name, args, args.map(e => this.visit(e)));
        if (t === 'void' && !(ctx.parentCtx instanceof ExprStmtContext)) {
            this.error(ctx, `procedure '${name}' returns nothing and cannot be used as a value`);
            return 'error';
        }
        return t;
    };

    /** A call by name, however it was spelled: user function, builtin, or list operation. */
    private checkCall(ctx: ParserRuleContext, name: string, args: ExpressionContext[],
                      argTypes: (string | null)[]): string {
        if (name === 'push' || name === 'insert' || name === 'pop') {
            return this.checkListCall(ctx, name, args, argTypes);
        }
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
            if (got === null) continue;
            switch (fits(want, got)) {
                case 'ok': break;
                case 'narrow':
                    this.warn(ctx, `argument ${i + 1} of '${name}':`
                        + ' implicit cast float -> integer loses precision');
                    break;
                default:
                    this.error(ctx, `argument ${i + 1} of '${name}' expects ${want} but got ${got}`);
            }
        }
        return sig.returnType;
    }

    /** push(xs, v), insert(xs, i, v), pop(xs), pop(xs, i) - reached through a dot. */
    private checkListCall(ctx: ParserRuleContext, name: string, args: ExpressionContext[],
                          argTypes: (string | null)[]): string {
        const [min, max] = name === 'push' ? [2, 2] : name === 'insert' ? [3, 3] : [1, 2];
        if (argTypes.length < min || argTypes.length > max) {
            const want = min === max ? String(min) : `${min} or ${max}`;
            this.error(ctx, `function '${name}' expects ${want} argument(s) but got ${argTypes.length}`);
            return name === 'pop' ? 'error' : 'void';
        }
        switch (name) {
            case 'push':
                this.checkListOp(ctx, 'push', argTypes[0], argTypes[1]);
                return 'void';
            case 'insert':
                this.requireIndex(args[1], argTypes[1]);
                this.checkListOp(ctx, 'insert', argTypes[0], argTypes[2]);
                return 'void';
            default:
                if (argTypes.length === 2) this.requireIndex(args[1], argTypes[1]);
                return this.popResult(ctx, argTypes[0]);
        }
    }

    /** Arity and type checks for a builtin; returns its result type. */
    private checkBuiltin(ctx: ParserRuleContext, name: string,
                         argTypes: (string | null)[]): string {
        const spec = BUILTINS.get(name)!;
        const first = argTypes[0];
        const result = (): string => {
            switch (spec.result) {
                case 'same':
                    return first === null || first === undefined || first === 'error' ? 'any' : first;
                case 'element':
                    return first !== null && first !== undefined && isList(first) ? elementOf(first) : 'any';
                case 'numeric':
                    if (argTypes.some(t => t === 'float')) return 'float';
                    if (argTypes.some(t => t === 'any')) return 'any';
                    return 'integer';
                default:
                    return spec.result;
            }
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
            let ok: boolean;
            let want: string;
            switch (kind) {
                case 'num':    ok = isNumeric(got); want = 'a number'; break;
                case 'string': ok = got === 'string' || got === 'character'; want = 'string'; break;
                case 'list':   ok = isList(got); want = 'a list'; break;
                case 'sized':  ok = got === 'string' || got === 'character' || isList(got); want = 'a string or a list'; break;
                case 'sortable':
                    ok = isList(got) && !isList(elementOf(got));
                    want = 'a list of numbers or strings';
                    break;
                case 'numlist': {
                    const element = isList(got) ? elementOf(got) : '';
                    ok = isList(got) && (isNumeric(element) || element === 'any');
                    want = 'a list of numbers';
                    break;
                }
                default: { // item: must fit the first argument's item type
                    const element = first !== null && first !== undefined && isList(first) ? elementOf(first) : 'any';
                    ok = fits(element, got) !== 'no';
                    want = element;
                }
            }
            if (!ok) {
                this.error(ctx, `argument ${i + 1} of '${name}' expects ${want} but got ${got}`);
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
        if (valueType === null) return null;
        switch (fits(fn.returnType, valueType)) {
            case 'ok': return null;
            case 'narrow':
                this.warn(ctx, `implicit cast float -> integer in return from '${fn.name}' loses precision`);
                return null;
            default:
                this.error(ctx, `cannot return ${valueType} from function '${fn.name}' which returns ${fn.returnType}`);
                return null;
        }
    };
}

// ---------------------------------------------------------------- types --

function isNumeric(t: string): boolean {
    return t === 'integer' || t === 'float';
}

export function isList(t: string): boolean {
    return t.startsWith('list of ');
}

export function listOf(element: string): string {
    return 'list of ' + element;
}

export function elementOf(listType: string): string {
    return listType.slice('list of '.length);
}

/**
 * Whether a value of type `value` may be stored where `target` is expected:
 * 'ok', 'narrow' (float into integer - legal with a warning) or 'no'. Lists
 * must match item for item; only 'any' (an empty literal, or input) is a
 * wildcard.
 */
export function fits(target: string, value: string): 'ok' | 'narrow' | 'no' {
    if (value === 'error') return 'ok'; // already reported elsewhere
    if (target === value) return 'ok';
    if (target === 'any' || value === 'any') return 'ok';
    if (isList(target) && isList(value)) {
        return fits(elementOf(target), elementOf(value)) === 'ok' ? 'ok' : 'no';
    }
    if (isNumeric(target) && isNumeric(value)) {
        return target === 'integer' && value === 'float' ? 'narrow' : 'ok';
    }
    return 'no';
}

/** The English suffix for an ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st... */
export function ordinalSuffix(n: number): string {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return 'th';
    switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
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
    return ctx.parameter_list().map(p => typeName(p.datatype()));
}

/** 'void' for procedures, otherwise the type written. */
function returnTypeOf(ctx: ReturnTypeContext): string {
    return ctx.VOID() ? 'void' : typeName(ctx.datatype());
}

/** The type a `datatype` node spells: a scalar, or `list of <type>`. */
export function typeName(ctx: DatatypeContext): string {
    if (ctx instanceof ListTypeContext) return listOf(typeName(ctx.datatype()));
    return canonical(ctx.getText());
}

/** Maps every spelling of a scalar type onto one canonical name. */
export function canonical(written: string): string {
    const t = written.trim().replace(/\s+/g, ' ');
    switch (t) {
        case 'int': case 'integer': case 'integers': case 'number': case 'numbers':
        case 'whole number': case 'whole numbers':
            return 'integer';
        case 'float': case 'floats': case 'floating point number': case 'floating point numbers':
            return 'float';
        case 'bool': case 'bools': case 'boolean': case 'booleans':
        case 'boolean number': case 'boolean numbers':
            return 'boolean';
        case 'char': case 'chars': case 'character': case 'characters':
            return 'character';
        case 'string': case 'strings': case 'character string': case 'character strings':
        case 'varchar':
            return 'string';
        default:
            return t;
    }
}
