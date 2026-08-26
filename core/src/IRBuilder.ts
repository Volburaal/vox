import VoxVisitor from './gen/VoxVisitor.js';
import VoxParser, {
    ProgramContext, PrototypeContext, DefinitionContext, MainFunctionContext,
    BlockContext, DeclForwardContext, DeclReverseContext, AssignForwardContext,
    AssignReverseContext, IfStatementContext, WhileLoopContext, ForLoopContext,
    PrintStatementContext, ReturnStatementContext, ParenExprContext,
    NotExprContext, PowExprContext, MulExprContext, AddExprContext,
    SubFromExprContext, RelExprContext, EqExprContext, AndExprContext,
    OrExprContext, IdExprContext, IntExprContext, FloatExprContext,
    StringExprContext, BoolExprContext, InputExprContext, CallExprContext,
    FunctionCallContext, ExpressionContext,
} from './gen/VoxParser.js';
import { canonical } from './SemanticAnalyzer.js';

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

    private newTemp(): string { return 't' + this.tempCounter++; }
    private newLabel(kind: string): string { return `L_${kind}_${this.labelCounter++}`; }
    private emit(instruction: string): void { this.instructions.push(instruction); }

    // ------------------------------------------------------------ program --

    visitProgram = (ctx: ProgramContext): null => {
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

    visitAssignForward = (ctx: AssignForwardContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    visitAssignReverse = (ctx: AssignReverseContext): null => {
        this.emit(`set ${ctx.ID().getText()} ${this.visit(ctx.expression())}`);
        return null;
    };

    // ------------------------------------------------------------ control --

    visitIfStatement = (ctx: IfStatementContext): null => {
        const cond = this.visit(ctx.expression());

        if (!ctx._elseBlock) {
            const end = this.newLabel('endif');
            this.emit(`if_false ${cond} goto ${end}`);
            this.visit(ctx._thenBlock);
            this.emit('label ' + end);
        } else {
            const otherwise = this.newLabel('else');
            const end = this.newLabel('endif');
            this.emit(`if_false ${cond} goto ${otherwise}`);
            this.visit(ctx._thenBlock);
            this.emit('goto ' + end);
            this.emit('label ' + otherwise);
            this.visit(ctx._elseBlock);
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
        this.visit(ctx.block());
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    visitForLoop = (ctx: ForLoopContext): null => {
        const start = this.newLabel('for');
        const end = this.newLabel('endfor');
        this.visit(ctx.variableDeclaration());
        this.emit('label ' + start);
        const cond = this.visit(ctx.expression());
        this.emit(`if_false ${cond} goto ${end}`);
        this.visit(ctx.block());
        this.visit(ctx.assignment());
        this.emit('goto ' + start);
        this.emit('label ' + end);
        return null;
    };

    visitPrintStatement = (ctx: PrintStatementContext): null => {
        let line = 'print';
        for (const e of ctx.expression_list()) {
            line += ' ' + this.visit(e);
        }
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
        const args = ctx.expression_list().map(e => this.visit(e));

        const dest = this.newTemp();
        let line = 'call ' + ctx.ID().getText();
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

    visitIdExpr = (ctx: IdExprContext): string => ctx.getText();
    visitIntExpr = (ctx: IntExprContext): string => ctx.getText();
    visitFloatExpr = (ctx: FloatExprContext): string => ctx.getText();
    visitBoolExpr = (ctx: BoolExprContext): string => ctx.getText();
    visitStringExpr = (ctx: StringExprContext): string => ctx.getText();
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
