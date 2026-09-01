import VoxVisitor from './gen/VoxVisitor.js';
import VoxParser, {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, DeclForwardContext, DeclReverseContext, AssignForwardContext,
    AssignReverseContext, IfStatementContext, WhileLoopContext, ForLoopContext,
    RangeLoopContext, RepeatTimesContext, RepeatUntilContext, SwapStmtContext,
    DeclLetContext, SetToContext, AskExprContext, PredicateExprContext,
    DivisibleExprContext, BetweenExprContext,
    BreakStmtContext, ContinueStmtContext, IncStmtContext,
    DecStmtContext, OpAssignContext, IncreaseByContext, DecreaseByContext,
    AddToContext, TakeFromContext, MultiplyByContext, DivideByContext,
    DoubleStmtContext, HalveStmtContext, PrintStatementContext,
    ReturnStatementContext, ParenExprContext, CastExprContext,
    BuiltinExprContext, NegExprContext, SquaredExprContext, NotExprContext, PowExprContext,
    MulExprContext, AddExprContext, SubFromExprContext, RelExprContext,
    EqExprContext andExprContext orExprContext, IdExprContext,
    IntExprContext, FloatExprContext, StringExprContext, BoolExprContext,
    InputExprContext, CallExprContext, FunctionCallContext, ExpressionContext,
} from './gen/VoxParser.js';
import { canonical, BUILTINS, builtinNameOf } from './SemanticAnalyzer.js';

/** Where `stop` and `skip` jump to inside the innermost loop. */
interface LoopLabels {
    breakLabel: string;
    continueLabel: string;
}

/**
 * Lowers a Vox parse tree into the flat, line-oriented IR that IRExecutor
 * runs. A direct port of the Java IRBuilder: both engines must emit identical
 * IR for the same source.
 *
 * Every expression visitor returns an operand: a literal, a variable name or
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
            this.emit(`set ${name} ${defaultValue(ctx.datatype().getText())}`);
        }
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

    visitAssignForward = (ctx: AssignForwardContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    visitAssignReverse = (ctx: AssignReverseContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    visitSetTo = (ctx: SetToContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    // ------------------------------------------------------------ updates --
    // `n += x` and every spoken spelling of it become one instruction whose
    // destination is also its first operand: `add n n x`.

    visitIncStmt = (ctx: IncStmtContext): null => this.update('add', ctx.ID().getText(), '1');
    visitDecStmt = (ctx: DecStmtContext): null => this.update('sub', ctx.ID().getText(), '1');

    visitOpAssign = (ctx: OpAssignContext): null => {
        const op = ctx._op.type === VoxParser.ADD_ASSIGN ? 'add'
            : ctx._op.type === VoxParser.SUB_ASSIGN ? 'sub'
            : ctx._op.type === VoxParser.MUL_ASSIGN ? 'mul'
            : ctx._op.type === VoxParser.DIV_ASSIGN ? 'div'
            : ctx._op.type === VoxParser.MOD_ASSIGN ? 'mod' : 'power';
        return this.update(op, ctx.ID().getText(), this.visit(ctx.expression())!);
    };

    visitIncreaseBy = (ctx: IncreaseByContext): null =>
        this.update('add', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitDecreaseBy = (ctx: DecreaseByContext): null =>
        this.update('sub', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitAddTo = (ctx: AddToContext): null =>
        this.update('add', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitTakeFrom = (ctx: TakeFromContext): null =>
        this.update('sub', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitMultiplyBy = (ctx: MultiplyByContext): null =>
        this.update('mul', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitDivideBy = (ctx: DivideByContext): null =>
        this.update('div', ctx.ID().getText(), this.visit(ctx.expression())!);
    visitDoubleStmt = (ctx: DoubleStmtContext): null => this.update('mul', ctx.ID().getText(), '2');
    visitHalveStmt = (ctx: HalveStmtContext): null => this.update('div', ctx.ID().getText(), '2');

    private update(op: string, name: string, operand: string): null {
        this.emit(`${op} ${name} ${name} ${operand}`);
        return null;
    }

    /** Swap through a temporary: three moves, no arithmetic. */
    visitSwapStmt = (ctx: SwapStmtContext): null => {
        const a = ctx.ID(0).getText();
        const b = ctx.ID(1).getText();
        const t = this.newTemp();
        this.emit(`set ${t} ${a}`);
        this.emit(`set ${a} ${b}`);
        this.emit(`set ${b} ${t}`);
        return null;
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
            this.visit(otherwise); // a block or the next `if` in the chain
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

        // Every bound is evaluated before the loop variable is assigned, so
        // `for i from 1 to i + 2` measures the outer i.
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
        this.emit(`cast ${dest} ${value} ${canonical(ctx.datatype().getText())}`);
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
        const dest = this.newTemp();
        if (pred === VoxParser.POSITIVE) {
            this.emit(`${negated ? 'le' : 'gt'} ${dest} ${value} 0`);
        } else if (pred === VoxParser.NEGATIVE) {
            this.emit(`${negated ? 'ge' : 'lt'} ${dest} ${value} 0`);
        } else { // EMPTY
            this.emit(`${negated ? 'ne' : 'eq'} ${dest} ${value} ""`);
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

    visitFunctionCall = (ctx: FunctionCallContext): string => {
        const name = ctx.ID().getText();
        const args = ctx.expression_list().map(e => this.visit(e));
        const dest = this.newTemp();

        if (!this.userFunctions.has(name) && BUILTINS.has(name)) {
            let line = `builtin ${dest} ${name}`;
            for (const a of args) line += ' ' + a;
            this.emit(line);
            return dest;
        }

        let line = 'call ' + name;
        for (const a of args) line += ' ' + a;
        line += ' -> ' + dest;
        this.emit(line);
        return dest;
    };

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

function defaultValue(datatype: string): string {
    switch (canonical(datatype)) {
        case 'integer': return '0';
        case 'float': return '0.0';
        case 'boolean': return 'false';
        case 'string':
        case 'character': return '""';
        default: return '0';
    }
}
