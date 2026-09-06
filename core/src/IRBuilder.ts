import VoxVisitor from './gen/VoxVisitor.js';
import VoxParser, {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, DeclForwardContext, DeclReverseContext, DeclLetContext,
    DeclSizedContext, DeclListIsContext, DeclConstantContext,
    DeclConstantLetContext, AssignForwardContext,
    AssignReverseContext, SetToContext, SwapStmtContext, TargetContext,
    NameTargetContext, IndexTargetContext, OrdinalTargetContext,
    IfStatementContext, WhileLoopContext, ForLoopContext, RangeLoopContext,
    ForEachLoopContext, RepeatTimesContext, RepeatUntilContext,
    BreakStmtContext, ContinueStmtContext, IncStmtContext, DecStmtContext,
    OpAssignContext, IncreaseByContext, DecreaseByContext, AddToContext,
    TakeFromContext, MultiplyByContext, DivideByContext, DoubleStmtContext,
    HalveStmtContext, PushToContext, InsertIntoContext, PushCallContext,
    InsertCallContext, PopCallContext, ListStatementContext, MethodCallContext,
    PositionExprContext, PrintStatementContext,
    ReturnStatementContext, ParenExprContext, IndexExprContext,
    CastExprContext, BuiltinExprContext, OrdinalExprContext, PopExprContext,
    AskExprContext, NegExprContext, SquaredExprContext, NotExprContext,
    PowExprContext, MulExprContext, AddExprContext, SubFromExprContext,
    PredicateExprContext, DivisibleExprContext, BetweenExprContext,
    InExprContext, ContainsExprContext, RelExprContext, EqExprContext,
    AndExprContext, OrExprContext, IdExprContext, IntExprContext,
    FloatExprContext, StringExprContext, BoolExprContext, ListExprContext,
    InputExprContext, CallExprContext, FunctionCallContext, ExpressionContext,
} from './gen/VoxParser.js';
import { BUILTINS, builtinNameOf, typeName, isList, elementOf } from './SemanticAnalyzer.js';

/** Where `stop` and `skip` jump to inside the innermost loop. */
interface LoopLabels {
    breakLabel: string;
    continueLabel: string;
}

/**
 * A resolved assignment target: a variable, or an item of a list whose base
 * and index operands have already been evaluated.
 */
type Place =
    | { kind: 'name'; name: string }
    | { kind: 'item'; list: string; index: string };

/**
 * Lowers a Vox parse tree into the flat, line-oriented IR that IRExecutor
 * runs. A direct port of the Java IRBuilder: both engines must emit identical
 * IR for the same source.
 *
 * Every expression visitor returns an operand: a literal, a variable name, or
 * the name of a freshly allocated temporary.
 */
export class IRBuilder extends VoxVisitor<string | null> {
    readonly instructions: string[] = [];
    private tempCounter = 0;
    private labelCounter = 0;
    /** Names of user-defined functions; anything else is looked up as a builtin. */
    private readonly userFunctions = new Set<string>();
    private readonly loops: LoopLabels[] = [];

    private newTemp(): string { return 't' + this.tempCounter++; }
    private newLabel(kind: string): string { return `L_${kind}_${this.labelCounter++}`; }
    private emit(instruction: string): void { this.instructions.push(instruction); }

    // ------------------------------------------------------------ program --

    visitProgram = (ctx: ProgramContext): null => {
        for (const f of ctx.function__list()) {
            const p = f.prototype();
            const d = f.definition();
            if (p) this.userFunctions.add(p.ID().getText());
            if (d) this.userFunctions.add(d.ID().getText());
        }
        for (const f of ctx.function__list()) this.visit(f);
        this.visit(ctx.mainFunction());
        return null;
    };

    visitPrototype = (_ctx: PrototypeContext): null => {
        return null; // forward declarations produce no code
    };

    visitDefinition = (ctx: DefinitionContext): null => {
        const name = ctx.ID().getText();
        this.emit('func_start ' + name);
        // Bind each incoming argument to its declared parameter name. Without
        // these the body would look up names the caller never stored.
        const params = ctx.parameterList();
        if (params) {
            params.parameter_list().forEach((p, i) => {
                this.emit(`param ${i} ${p.ID().getText()}`);
            });
        }
        this.visit(ctx.block());
        this.emit('func_end ' + name);
        return null;
    };

    visitMainFunction = (ctx: MainFunctionContext): null => {
        this.emit('func_start main');
        this.visit(ctx.block());
        this.emit('func_end main');
        return null;
    };

    visitBlock = (ctx: BlockContext): null => {
        for (const s of ctx.statement_list()) this.visit(s);
        return null;
    };

    // -------------------------------------------------------- declarations --

    visitDeclForward = (ctx: DeclForwardContext): null => {
        const name = ctx.ID().getText();
        if (ctx.expression()) {
            this.emit(`set ${name} ${this.visit(ctx.expression())}`);
        } else {
            this.emitDefault(name, typeName(ctx.datatype()));
        }
        if (ctx.FIXED()) this.emit(`builtin ${this.newTemp()} lock ${name}`);
        return null;
    };

    visitDeclReverse = (ctx: DeclReverseContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    visitDeclLet = (ctx: DeclLetContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    /** `integer xs[5]` fills five defaults; `integer xs[]` is a new empty list. */
    visitDeclSized = (ctx: DeclSizedContext): null => {
        const name = ctx.ID().getText();
        if (ctx._init) {
            this.emit(`set ${name} ${this.visit(ctx._init)}`);
        } else if (ctx._size) {
            this.emit(`list_fill ${name} ${this.visit(ctx._size)} ${irType(typeName(ctx.datatype()))}`);
        } else {
            this.emit('list ' + name);
        }
        if (ctx.FIXED()) this.emit(`builtin ${this.newTemp()} lock ${name}`);
        return null;
    };

    visitDeclListIs = (ctx: DeclListIsContext): null => {
        const name = ctx.ID().getText();
        if (ctx._init) this.emit(`set ${name} ${this.visit(ctx._init)}`);
        else this.emit('list ' + name);
        return null;
    };

    // Constants are ordinary variables at run time; the checker guards them.
    visitDeclConstant = (ctx: DeclConstantContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    visitDeclConstantLet = (ctx: DeclConstantLetContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    /** A variable declared without a value starts at its type's default. */
    private emitDefault(name: string, type: string): void {
        if (isList(type)) this.emit('list ' + name);
        else this.emit(`set ${name} ${defaultLiteral(type)}`);
    }

    // --------------------------------------------------------- assignments --

    visitAssignForward = (ctx: AssignForwardContext): null => {
        const value = this.visit(ctx.expression())!;
        this.store(this.place(ctx.target()), value);
        return null;
    };

    visitAssignReverse = (ctx: AssignReverseContext): null => {
        const value = this.visit(ctx.expression())!;
        this.store(this.place(ctx.target()), value);
        return null;
    };

    visitSetTo = (ctx: SetToContext): null => {
        const value = this.visit(ctx.expression())!;
        this.store(this.place(ctx.target()), value);
        return null;
    };

    /**
     * Evaluates a target down to somewhere a value can be read or written:
     * a variable name, or a list operand plus an index operand. `2nd item of
     * xs` is xs with index 1.
     */
    private place(target: TargetContext): Place {
        if (target instanceof NameTargetContext) {
            return { kind: 'name', name: target.ID().getText() };
        }
        if (target instanceof IndexTargetContext) {
            const list = this.load(this.place(target.target()));
            const index = this.visit(target.expression())!;
            return { kind: 'item', list, index };
        }
        const ordinal = target as OrdinalTargetContext;
        const list = this.load(this.place(ordinal.target()));
        return { kind: 'item', list, index: String(ordinalIndex(ordinal.ORDINAL().getText())) };
    }

    /** Reads a place; a variable is its own operand, an item needs a fetch. */
    private load(p: Place): string {
        if (p.kind === 'name') return p.name;
        const dest = this.newTemp();
        this.emit(`list_get ${dest} ${p.list} ${p.index}`);
        return dest;
    }

    private store(p: Place, value: string): void {
        if (p.kind === 'name') this.emit(`set ${p.name} ${value}`);
        else this.emit(`list_set ${p.list} ${p.index} ${value}`);
    }

    // ------------------------------------------------------------ updates --
    // `n += x` and every spoken spelling of it become one instruction whose
    // destination is also its first operand: `add n n x`. An item update
    // fetches, updates the temporary, and stores it back.

    visitIncStmt = (ctx: IncStmtContext): null => this.update('add', ctx.target(), '1');
    visitDecStmt = (ctx: DecStmtContext): null => this.update('sub', ctx.target(), '1');

    visitOpAssign = (ctx: OpAssignContext): null => {
        const op = ctx._op.type === VoxParser.ADD_ASSIGN ? 'add'
            : ctx._op.type === VoxParser.SUB_ASSIGN ? 'sub'
            : ctx._op.type === VoxParser.MUL_ASSIGN ? 'mul'
            : ctx._op.type === VoxParser.DIV_ASSIGN ? 'div'
            : ctx._op.type === VoxParser.MOD_ASSIGN ? 'mod' : 'power';
        return this.update(op, ctx.target(), this.visit(ctx.expression())!);
    };

    visitIncreaseBy = (ctx: IncreaseByContext): null =>
        this.update('add', ctx.target(), this.visit(ctx.expression())!);
    visitDecreaseBy = (ctx: DecreaseByContext): null =>
        this.update('sub', ctx.target(), this.visit(ctx.expression())!);
    visitAddTo = (ctx: AddToContext): null =>
        this.update('add', ctx.target(), this.visit(ctx.expression())!);
    visitTakeFrom = (ctx: TakeFromContext): null =>
        this.update('sub', ctx.target(), this.visit(ctx.expression())!);
    visitMultiplyBy = (ctx: MultiplyByContext): null =>
        this.update('mul', ctx.target(), this.visit(ctx.expression())!);
    visitDivideBy = (ctx: DivideByContext): null =>
        this.update('div', ctx.target(), this.visit(ctx.expression())!);
    visitDoubleStmt = (ctx: DoubleStmtContext): null => this.update('mul', ctx.target(), '2');
    visitHalveStmt = (ctx: HalveStmtContext): null => this.update('div', ctx.target(), '2');

    private update(op: string, target: TargetContext, operand: string): null {
        const p = this.place(target);
        if (p.kind === 'name') {
            this.emit(`${op} ${p.name} ${p.name} ${operand}`);
            return null;
        }
        const current = this.load(p);
        this.emit(`${op} ${current} ${current} ${operand}`);
        this.store(p, current);
        return null;
    }

    /** Swap through a temporary: three moves, no arithmetic. */
    visitSwapStmt = (ctx: SwapStmtContext): null => {
        const a = this.place(ctx.target(0));
        const b = this.place(ctx.target(1));
        const first = this.load(a);
        const second = this.load(b);
        const t = this.newTemp();
        this.emit(`set ${t} ${first}`);
        this.store(a, second);
        this.store(b, t);
        return null;
    };

    // -------------------------------------------------------------- lists --

    visitPushTo = (ctx: PushToContext): null => {
        const value = this.visit(ctx.expression(0));
        const list = this.visit(ctx.expression(1));
        if (ctx.AT()) {
            this.emit(`list_insert ${list} ${this.visit(ctx.expression(2))} ${value}`);
        } else {
            this.emit(`list_push ${list} ${value}`);
        }
        return null;
    };

    visitInsertInto = (ctx: InsertIntoContext): null => {
        const value = this.visit(ctx.expression(0));
        const list = this.visit(ctx.expression(1));
        const index = this.visit(ctx.expression(2));
        this.emit(`list_insert ${list} ${index} ${value}`);
        return null;
    };

    visitPopExpr = (ctx: PopExprContext): string => {
        const list = this.visit(ctx.expression(0));
        const index = ctx.AT() ? ' ' + this.visit(ctx.expression(1)) : '';
        const dest = this.newTemp();
        this.emit(`list_pop ${dest} ${list}${index}`);
        return dest;
    };

    // The call spellings: push(xs, v), insert(xs, i, v), pop(xs), pop(xs, i).

    visitPushCall = (ctx: PushCallContext): null => {
        const list = this.visit(ctx.expression(0));
        const value = this.visit(ctx.expression(1));
        this.emit(`list_push ${list} ${value}`);
        return null;
    };

    visitInsertCall = (ctx: InsertCallContext): null => {
        const list = this.visit(ctx.expression(0));
        const index = this.visit(ctx.expression(1));
        const value = this.visit(ctx.expression(2));
        this.emit(`list_insert ${list} ${index} ${value}`);
        return null;
    };

    visitPopCall = (ctx: PopCallContext): string => {
        const list = this.visit(ctx.expression(0));
        const index = ctx.expression_list().length > 1 ? ' ' + this.visit(ctx.expression(1)) : '';
        const dest = this.newTemp();
        this.emit(`list_pop ${dest} ${list}${index}`);
        return dest;
    };

    /** `lock xs;`, `sort the scores;` - the verb is a builtin with one operand. */
    visitListStatement = (ctx: ListStatementContext): null => {
        const list = this.visit(ctx.expression());
        this.emit(`builtin ${this.newTemp()} ${ctx._verb.text} ${list}`);
        return null;
    };

    /** `position of x in xs` is position(xs, x): the operands swap places. */
    visitPositionExpr = (ctx: PositionExprContext): string => {
        const value = this.visit(ctx.expression(0));
        const list = this.visit(ctx.expression(1));
        const dest = this.newTemp();
        this.emit(`builtin ${dest} position ${list} ${value}`);
        return dest;
    };

    visitIndexExpr = (ctx: IndexExprContext): string => {
        const list = this.visit(ctx.expression(0));
        const index = this.visit(ctx.expression(1));
        const dest = this.newTemp();
        this.emit(`list_get ${dest} ${list} ${index}`);
        return dest;
    };

    visitOrdinalExpr = (ctx: OrdinalExprContext): string => {
        const list = this.visit(ctx.expression());
        const dest = this.newTemp();
        this.emit(`list_get ${dest} ${list} ${ordinalIndex(ctx.ORDINAL().getText())}`);
        return dest;
    };

    visitListExpr = (ctx: ListExprContext): string => {
        const items = ctx.expression_list().map(e => this.visit(e));
        const dest = this.newTemp();
        let line = 'list ' + dest;
        for (const item of items) line += ' ' + item;
        this.emit(line);
        return dest;
    };

    visitInExpr = (ctx: InExprContext): string => {
        const value = this.visit(ctx.expression(0));
        const list = this.visit(ctx.expression(1));
        const dest = this.newTemp();
        this.emit(`list_has ${dest} ${list} ${value}`);
        if (ctx._op.type !== VoxParser.NE) return dest;
        const inverted = this.newTemp();
        this.emit(`not ${inverted} ${dest}`);
        return inverted;
    };

    visitContainsExpr = (ctx: ContainsExprContext): string => {
        const list = this.visit(ctx.expression(0));
        const value = this.visit(ctx.expression(1));
        const dest = this.newTemp();
        this.emit(`list_has ${dest} ${list} ${value}`);
        return dest;
    };

    // ------------------------------------------------------------ control --

    visitIfStatement = (ctx: IfStatementContext): null => {
        const cond = this.visit(ctx.expression());
        const otherwise = ctx._elseIf ?? ctx._elseBlock;

        if (!otherwise) {
            const end = this.newLabel('endif');
            this.emit(`if_false ${cond} goto ${end}`);
            this.visit(ctx._thenBlock);
            this.emit('label ' + end);
        } else {
            const elseLabel = this.newLabel('else');
            const end = this.newLabel('endif');
            this.emit(`if_false ${cond} goto ${elseLabel}`);
            this.visit(ctx._thenBlock);
            this.emit('goto ' + end);
            this.emit('label ' + elseLabel);
            this.visit(otherwise); // a block, or the next `if` in the chain
            this.emit('label ' + end);
        }
        return null;
    };

    visitWhileLoop = (ctx: WhileLoopContext): null => {
        const start = this.newLabel('while');
        const end = this.newLabel('endwhile');
        this.emit('label ' + start);
        const cond = this.visit(ctx.expression());
        this.emit(`if_false ${cond} goto ${end}`);
        this.loops.push({ breakLabel: end, continueLabel: start });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    visitForLoop = (ctx: ForLoopContext): null => {
        const start = this.newLabel('for');
        const end = this.newLabel('endfor');
        // `skip` must still run the update step, so it jumps here, not to start.
        const cont = this.newLabel('forcont');
        this.visit(ctx.variableDeclaration());
        this.emit('label ' + start);
        const cond = this.visit(ctx.expression());
        this.emit(`if_false ${cond} goto ${end}`);
        this.loops.push({ breakLabel: end, continueLabel: cont });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('label ' + cont);
        this.visit(ctx.forUpdate());
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    /**
     * `for i from a to b step s` is the classic loop with the condition and
     * update chosen by the direction word: `le`/`add` for `to`, `lt`/`add` for
     * `until`, `ge`/`sub` for `down to`.
     */
    visitRangeLoop = (ctx: RangeLoopContext): null => {
        const rc = ctx.rangeClause();
        const name = rc.ID().getText();
        const start = this.newLabel('for');
        const end = this.newLabel('endfor');
        const cont = this.newLabel('forcont');
        const down = rc._dir.type === VoxParser.DOWN_TO;
        const compare = down ? 'ge' : rc._dir.type === VoxParser.UNTIL ? 'lt' : 'le';

        // Every bound is evaluated before the loop variable is assigned.
        const first = this.visit(rc._start);
        const limit = this.frozen(rc._limit);
        const step = rc._step ? this.frozen(rc._step) : '1';
        this.emit(`set ${name} ${first}`);

        this.emit('label ' + start);
        const cond = this.newTemp();
        this.emit(`${compare} ${cond} ${name} ${limit}`);
        this.emit(`if_false ${cond} goto ${end}`);
        this.loops.push({ breakLabel: end, continueLabel: cont });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('label ' + cont);
        this.emit(`${down ? 'sub' : 'add'} ${name} ${name} ${step}`);
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    /**
     * `for each x in xs` walks the list by index. The length is re-read every
     * turn, so items pushed inside the body are visited too.
     */
    visitForEachLoop = (ctx: ForEachLoopContext): null => {
        const name = ctx.ID().getText();
        const start = this.newLabel('foreach');
        const end = this.newLabel('endforeach');
        const cont = this.newLabel('foreachcont');

        const list = this.frozen(ctx.expression());
        const index = this.newTemp();
        this.emit(`set ${index} 0`);

        this.emit('label ' + start);
        const length = this.newTemp();
        this.emit(`builtin ${length} length ${list}`);
        const cond = this.newTemp();
        this.emit(`lt ${cond} ${index} ${length}`);
        this.emit(`if_false ${cond} goto ${end}`);
        this.emit(`list_get ${name} ${list} ${index}`);
        this.loops.push({ breakLabel: end, continueLabel: cont });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('label ' + cont);
        this.emit(`add ${index} ${index} 1`);
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    /**
     * Evaluates a loop bound once. A bound that is a plain variable is copied
     * into a temporary so the body cannot move the goalposts by reassigning
     * it; a literal or a computed temporary is already fixed.
     */
    private frozen(expr: ExpressionContext): string {
        const value = this.visit(expr)!;
        let inner = expr;
        while (inner instanceof ParenExprContext) inner = inner.expression();
        if (!(inner instanceof IdExprContext)) return value;
        const copy = this.newTemp();
        this.emit(`set ${copy} ${value}`);
        return copy;
    }

    /** `repeat n times` counts a hidden temporary down from n to 1. */
    visitRepeatTimes = (ctx: RepeatTimesContext): null => {
        const start = this.newLabel('repeat');
        const end = this.newLabel('endrepeat');
        const cont = this.newLabel('repcont');
        const counter = this.newTemp();
        this.emit(`set ${counter} ${this.visit(ctx.expression())}`);
        this.emit('label ' + start);
        const cond = this.newTemp();
        this.emit(`gt ${cond} ${counter} 0`);
        this.emit(`if_false ${cond} goto ${end}`);
        this.loops.push({ breakLabel: end, continueLabel: cont });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('label ' + cont);
        this.emit(`sub ${counter} ${counter} 1`);
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    /** `repeat { } until (c)`: the body runs, then c decides whether to loop back. */
    visitRepeatUntil = (ctx: RepeatUntilContext): null => {
        const start = this.newLabel('repeat');
        const end = this.newLabel('endrepeat');
        const cont = this.newLabel('repcont');
        this.emit('label ' + start);
        this.loops.push({ breakLabel: end, continueLabel: cont });
        this.visit(ctx.block());
        this.loops.pop();
        this.emit('label ' + cont);
        const cond = this.visit(ctx.expression());
        this.emit(`if_false ${cond} goto ${start}`);
        this.emit('label ' + end);
        return null;
    };

    visitBreakStmt = (_ctx: BreakStmtContext): null => {
        this.emit('goto ' + this.loops[this.loops.length - 1].breakLabel);
        return null;
    };

    visitContinueStmt = (_ctx: ContinueStmtContext): null => {
        this.emit('goto ' + this.loops[this.loops.length - 1].continueLabel);
        return null;
    };

    /**
     * `print` writes exactly its arguments - no newline. `say` is the
     * line-form: it appends a "\n" operand, so both stay one IR instruction.
     */
    visitPrintStatement = (ctx: PrintStatementContext): null => {
        let line = 'print';
        for (const e of ctx.expression_list()) {
            line += ' ' + this.visit(e);
        }
        if (ctx.SAY()) line += ' "\\n"';
        this.emit(line);
        return null;
    };

    visitReturnStatement = (ctx: ReturnStatementContext): null => {
        if (!ctx.expression()) {
            this.emit('return');
        } else {
            this.emit('return ' + this.visit(ctx.expression()));
        }
        return null;
    };

    // -------------------------------------------------------- expressions --

    visitParenExpr = (ctx: ParenExprContext): string | null =>
        this.visit(ctx.expression());

    visitCastExpr = (ctx: CastExprContext): string => {
        const value = this.visit(ctx.expression());
        const dest = this.newTemp();
        this.emit(`cast ${dest} ${value} ${typeName(ctx.datatype())}`);
        return dest;
    };

    visitBuiltinExpr = (ctx: BuiltinExprContext): string => {
        const value = this.visit(ctx.expression());
        const dest = this.newTemp();
        this.emit(`builtin ${dest} ${builtinNameOf(ctx.builtinName())} ${value}`);
        return dest;
    };

    visitNegExpr = (ctx: NegExprContext): string => {
        const operand = ctx.expression();
        // A negated numeric literal is just a negative literal.
        if (operand instanceof IntExprContext || operand instanceof FloatExprContext) {
            return '-' + operand.getText();
        }
        const value = this.visit(operand);
        const dest = this.newTemp();
        this.emit(`neg ${dest} ${value}`);
        return dest;
    };

    /** `x squared` and `x cubed` are just powers with a literal exponent. */
    visitSquaredExpr = (ctx: SquaredExprContext): string => {
        const value = this.visit(ctx.expression());
        const dest = this.newTemp();
        this.emit(`power ${dest} ${value} ${ctx._op.type === VoxParser.SQUARED ? 2 : 3}`);
        return dest;
    };

    visitNotExpr = (ctx: NotExprContext): string => {
        const value = this.visit(ctx.expression());
        const dest = this.newTemp();
        this.emit(`not ${dest} ${value}`);
        return dest;
    };

    visitPowExpr = (ctx: PowExprContext): string =>
        this.binary('power', ctx.expression(0), ctx.expression(1));

    visitMulExpr = (ctx: MulExprContext): string => {
        const op = ctx._op.type === VoxParser.MUL ? 'mul'
            : ctx._op.type === VoxParser.DIV ? 'div' : 'mod';
        return this.binary(op, ctx.expression(0), ctx.expression(1));
    };

    visitAddExpr = (ctx: AddExprContext): string => {
        const op = ctx._op.type === VoxParser.ADD ? 'add' : 'sub';
        return this.binary(op, ctx.expression(0), ctx.expression(1));
    };

    /** `a subtracted from b` means b - a, so the operands are emitted reversed. */
    visitSubFromExpr = (ctx: SubFromExprContext): string => {
        const amount = this.visit(ctx.expression(0));
        const source = this.visit(ctx.expression(1));
        const dest = this.newTemp();
        this.emit(`sub ${dest} ${source} ${amount}`);
        return dest;
    };

    // ---- predicates lower to the comparisons they abbreviate; `is not` flips the test.

    visitPredicateExpr = (ctx: PredicateExprContext): string => {
        const value = this.visit(ctx.expression());
        const negated = ctx._op.type === VoxParser.NE;
        const pred = ctx._pred.type;
        if (pred === VoxParser.EVEN || pred === VoxParser.ODD) {
            const wantZero = (pred === VoxParser.EVEN) !== negated;
            const m = this.newTemp();
            this.emit(`mod ${m} ${value} 2`);
            const dest = this.newTemp();
            this.emit(`${wantZero ? 'eq' : 'ne'} ${dest} ${m} 0`);
            return dest;
        }
        if (pred === VoxParser.EMPTY) {
            // Strings and lists alike: empty means length zero.
            const length = this.newTemp();
            this.emit(`builtin ${length} length ${value}`);
            const dest = this.newTemp();
            this.emit(`${negated ? 'ne' : 'eq'} ${dest} ${length} 0`);
            return dest;
        }
        if (pred === VoxParser.LOCKED || pred === VoxParser.WRAPPING) {
            const flag = this.newTemp();
            this.emit(`builtin ${flag} ${pred === VoxParser.LOCKED ? 'locked' : 'wrapping'} ${value}`);
            if (!negated) return flag;
            const inverted = this.newTemp();
            this.emit(`not ${inverted} ${flag}`);
            return inverted;
        }
        const dest = this.newTemp();
        if (pred === VoxParser.POSITIVE) {
            this.emit(`${negated ? 'le' : 'gt'} ${dest} ${value} 0`);
        } else { // NEGATIVE
            this.emit(`${negated ? 'ge' : 'lt'} ${dest} ${value} 0`);
        }
        return dest;
    };

    visitDivisibleExpr = (ctx: DivisibleExprContext): string => {
        const value = this.visit(ctx.expression(0));
        const divisor = this.visit(ctx.expression(1));
        const m = this.newTemp();
        this.emit(`mod ${m} ${value} ${divisor}`);
        const dest = this.newTemp();
        this.emit(`${ctx._op.type === VoxParser.NE ? 'ne' : 'eq'} ${dest} ${m} 0`);
        return dest;
    };

    visitBetweenExpr = (ctx: BetweenExprContext): string => {
        const value = this.visit(ctx.expression(0));
        const low = this.visit(ctx._low);
        const high = this.visit(ctx._high);
        const aboveLow = this.newTemp();
        this.emit(`ge ${aboveLow} ${value} ${low}`);
        const belowHigh = this.newTemp();
        this.emit(`le ${belowHigh} ${value} ${high}`);
        const dest = this.newTemp();
        this.emit(`and ${dest} ${aboveLow} ${belowHigh}`);
        if (ctx._op.type !== VoxParser.NE) return dest;
        const inverted = this.newTemp();
        this.emit(`not ${inverted} ${dest}`);
        return inverted;
    };

    visitRelExpr = (ctx: RelExprContext): string => {
        const op = ctx._op.type === VoxParser.LE ? 'le'
            : ctx._op.type === VoxParser.GE ? 'ge'
            : ctx._op.type === VoxParser.LT ? 'lt' : 'gt';
        return this.binary(op, ctx.expression(0), ctx.expression(1));
    };

    visitEqExpr = (ctx: EqExprContext): string => {
        const op = ctx._op.type === VoxParser.EQ ? 'eq' : 'ne';
        return this.binary(op, ctx.expression(0), ctx.expression(1));
    };

    visitAndExpr = (ctx: AndExprContext): string =>
        this.binary('and', ctx.expression(0), ctx.expression(1));

    visitOrExpr = (ctx: OrExprContext): string =>
        this.binary('or', ctx.expression(0), ctx.expression(1));

    private binary(op: string, lhs: ExpressionContext, rhs: ExpressionContext): string {
        const left = this.visit(lhs);
        const right = this.visit(rhs);
        const dest = this.newTemp();
        this.emit(`${op} ${dest} ${left} ${right}`);
        return dest;
    }

    visitCallExpr = (ctx: CallExprContext): string | null =>
        this.visit(ctx.functionCall());

    visitFunctionCall = (ctx: FunctionCallContext): string =>
        this.emitCall(ctx.ID().getText(), ctx.expression_list().map(e => this.visit(e)!));

    /** `a.f(b)` is `f(a, b)`: the receiver simply becomes the first operand. */
    visitMethodCall = (ctx: MethodCallContext): string =>
        this.emitCall(ctx.methodName().getText(), ctx.expression_list().map(e => this.visit(e)!));

    /** A call by name: a list operation, a builtin, or the user's own function. */
    private emitCall(name: string, args: string[]): string {
        const dest = this.newTemp();
        if (name === 'push') {
            this.emit(`list_push ${args[0]} ${args[1]}`);
        } else if (name === 'insert') {
            this.emit(`list_insert ${args[0]} ${args[1]} ${args[2]}`);
        } else if (name === 'pop') {
            this.emit(`list_pop ${dest} ${args[0]}` + (args.length > 1 ? ' ' + args[1] : ''));
        } else if (!this.userFunctions.has(name) && BUILTINS.has(name)) {
            let line = `builtin ${dest} ${name}`;
            for (const a of args) line += ' ' + a;
            this.emit(line);
        } else {
            let line = 'call ' + name;
            for (const a of args) line += ' ' + a;
            line += ' -> ' + dest;
            this.emit(line);
        }
        return dest;
    }

    visitInputExpr = (_ctx: InputExprContext): string => {
        const dest = this.newTemp();
        this.emit('input ' + dest);
        return dest;
    };

    /** ask = print the prompt, then input. */
    visitAskExpr = (ctx: AskExprContext): string => {
        this.emit(`print ${this.visit(ctx.expression())}`);
        const dest = this.newTemp();
        this.emit('input ' + dest);
        return dest;
    };

    visitIdExpr = (ctx: IdExprContext): string => ctx.getText();
    visitIntExpr = (ctx: IntExprContext): string => ctx.getText();
    visitFloatExpr = (ctx: FloatExprContext): string => ctx.getText();
    visitBoolExpr = (ctx: BoolExprContext): string => ctx.getText();
    visitStringExpr = (ctx: StringExprContext): string => normalizeString(ctx.getText());
}

/** The literal a scalar variable starts with when declared without a value. */
function defaultLiteral(type: string): string {
    switch (type) {
        case 'integer': return '0';
        case 'float': return '0.0';
        case 'boolean': return 'false';
        case 'string':
        case 'character': return '""';
        default: return '0';
    }
}

/** The IR spells list types without spaces: `list<list<integer>>`. */
function irType(type: string): string {
    return isList(type) ? `list<${irType(elementOf(type))}>` : type;
}

/** `1st` is index 0, `2nd` is 1, and so on. The checker validated the suffix. */
function ordinalIndex(text: string): number {
    return Number(text.replace(/[a-z]+$/, '')) - 1;
}

/**
 * The IR spells every string double-quoted, so a single-quoted source literal
 * is re-emitted with double quotes (escaping any it contains).
 */
function normalizeString(text: string): string {
    if (text.startsWith('"')) return text;
    let out = '"';
    for (let i = 1; i < text.length - 1; i++) {
        const c = text[i];
        if (c === '\\') { out += c + text[++i]; continue; }
        out += c === '"' ? '\\"' : c;
    }
    return out + '"';
}
