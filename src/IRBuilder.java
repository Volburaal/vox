import java.util.*;

/**
 * Lowers a Vox parse tree into the flat, line-oriented IR that IRExecutor runs.
 * The TypeScript IRBuilder is a direct port: both engines must emit identical
 * IR for the same source.
 *
 * Every visit* method for an expression returns an operand: a literal, a
 * variable name, or the name of a freshly allocated temporary.
 */
public class IRBuilder extends VoxBaseVisitor<String> {

    /** Where `stop` and `skip` jump to inside the innermost loop. */
    private static final class LoopLabels {
        final String breakLabel;
        final String continueLabel;
        LoopLabels(String breakLabel, String continueLabel) {
            this.breakLabel = breakLabel;
            this.continueLabel = continueLabel;
        }
    }

    private final List<String> instructions = new ArrayList<>();
    private int tempCounter = 0;
    private int labelCounter = 0;
    /** Names of user-defined functions; anything else is looked up as a builtin. */
    private final Set<String> userFunctions = new HashSet<>();
    private final Deque<LoopLabels> loops = new ArrayDeque<>();

    public List<String> getInstructions() { return instructions; }

    private String newTemp()             { return "t" + (tempCounter++); }
    private String newLabel(String kind) { return "L_" + kind + "_" + (labelCounter++); }
    private void emit(String instruction) { instructions.add(instruction); }

    // ------------------------------------------------------------ program --

    @Override
    public String visitProgram(VoxParser.ProgramContext ctx) {
        for (VoxParser.FunctionContext f : ctx.function()) {
            if (f.prototype() != null) userFunctions.add(f.prototype().ID().getText());
            if (f.definition() != null) userFunctions.add(f.definition().ID().getText());
        }
        for (VoxParser.FunctionContext f : ctx.function()) visit(f);
        visit(ctx.mainFunction());
        return null;
    }

    @Override
    public String visitPrototype(VoxParser.PrototypeContext ctx) {
        return null; // forward declarations produce no code
    }

    @Override
    public String visitDefinition(VoxParser.DefinitionContext ctx) {
        String name = ctx.ID().getText();
        emit("func_start " + name);
        // Bind each incoming argument to its declared parameter name. Without
        // these the body would look up names the caller never stored.
        if (ctx.parameterList() != null) {
            List<VoxParser.ParameterContext> params = ctx.parameterList().parameter();
            for (int i = 0; i < params.size(); i++) {
                emit("param " + i + " " + params.get(i).ID().getText());
            }
        }
        visit(ctx.block());
        emit("func_end " + name);
        return null;
    }

    @Override
    public String visitMainFunction(VoxParser.MainFunctionContext ctx) {
        emit("func_start main");
        visit(ctx.block());
        emit("func_end main");
        return null;
    }

    @Override
    public String visitBlock(VoxParser.BlockContext ctx) {
        for (VoxParser.StatementContext s : ctx.statement()) visit(s);
        return null;
    }

    // -------------------------------------------------------- declarations --

    @Override
    public String visitDeclForward(VoxParser.DeclForwardContext ctx) {
        String name = ctx.ID().getText();
        if (ctx.expression() != null) {
            emit("set " + name + " " + visit(ctx.expression()));
        } else {
            emit("set " + name + " " + defaultValue(ctx.datatype().getText()));
        }
        return null;
    }

    @Override
    public String visitDeclReverse(VoxParser.DeclReverseContext ctx) {
        emit("set " + ctx.ID().getText() + " " + visit(ctx.expression()));
        return null;
    }

    private static String defaultValue(String datatype) {
        switch (SemanticAnalyzer.canonical(datatype)) {
            case "integer":   return "0";
            case "float":     return "0.0";
            case "boolean":   return "false";
            case "string":
            case "character": return "\"\"";
            default:          return "0";
        }
    }

    @Override
    public String visitAssignForward(VoxParser.AssignForwardContext ctx) {
        emit("set " + ctx.ID().getText() + " " + visit(ctx.expression()));
        return null;
    }

    @Override
    public String visitAssignReverse(VoxParser.AssignReverseContext ctx) {
        emit("set " + ctx.ID().getText() + " " + visit(ctx.expression()));
        return null;
    }

    // ------------------------------------------------------------ control --

    @Override
    public String visitIfStatement(VoxParser.IfStatementContext ctx) {
        String cond = visit(ctx.expression());
        org.antlr.v4.runtime.ParserRuleContext otherwise =
                ctx.elseIf != null ? ctx.elseIf : ctx.elseBlock;

        if (otherwise == null) {
            String end = newLabel("endif");
            emit("if_false " + cond + " goto " + end);
            visit(ctx.thenBlock);
            emit("label " + end);
        } else {
            String elseLabel = newLabel("else");
            String end = newLabel("endif");
            emit("if_false " + cond + " goto " + elseLabel);
            visit(ctx.thenBlock);
            emit("goto " + end);
            emit("label " + elseLabel);
            visit(otherwise); // a block, or the next `if` in the chain
            emit("label " + end);
        }
        return null;
    }

    @Override
    public String visitWhileLoop(VoxParser.WhileLoopContext ctx) {
        String start = newLabel("while");
        String end = newLabel("endwhile");
        emit("label " + start);
        String cond = visit(ctx.expression());
        emit("if_false " + cond + " goto " + end);
        loops.push(new LoopLabels(end, start));
        visit(ctx.block());
        loops.pop();
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        String start = newLabel("for");
        String end = newLabel("endfor");
        // `skip` must still run the update step, so it jumps here, not to start.
        String cont = newLabel("forcont");
        visit(ctx.variableDeclaration());
        emit("label " + start);
        String cond = visit(ctx.expression());
        emit("if_false " + cond + " goto " + end);
        loops.push(new LoopLabels(end, cont));
        visit(ctx.block());
        loops.pop();
        emit("label " + cont);
        visit(ctx.assignment());
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    @Override
    public String visitBreakStmt(VoxParser.BreakStmtContext ctx) {
        emit("goto " + loops.peek().breakLabel);
        return null;
    }

    @Override
    public String visitContinueStmt(VoxParser.ContinueStmtContext ctx) {
        emit("goto " + loops.peek().continueLabel);
        return null;
    }

    @Override
    public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
        StringBuilder sb = new StringBuilder("print");
        for (VoxParser.ExpressionContext e : ctx.expression()) {
            sb.append(' ').append(visit(e));
        }
        emit(sb.toString());
        return null;
    }

    @Override
    public String visitReturnStatement(VoxParser.ReturnStatementContext ctx) {
        if (ctx.expression() == null) {
            emit("return");
        } else {
            emit("return " + visit(ctx.expression()));
        }
        return null;
    }

    // -------------------------------------------------------- expressions --

    @Override
    public String visitParenExpr(VoxParser.ParenExprContext ctx) {
        return visit(ctx.expression());
    }

    @Override
    public String visitCastExpr(VoxParser.CastExprContext ctx) {
        String value = visit(ctx.expression());
        String dest = newTemp();
        emit("cast " + dest + " " + value + " " + SemanticAnalyzer.canonical(ctx.datatype().getText()));
        return dest;
    }

    @Override
    public String visitBuiltinExpr(VoxParser.BuiltinExprContext ctx) {
        String value = visit(ctx.expression());
        String dest = newTemp();
        emit("builtin " + dest + " " + SemanticAnalyzer.builtinNameOf(ctx.builtinName()) + " " + value);
        return dest;
    }

    @Override
    public String visitNegExpr(VoxParser.NegExprContext ctx) {
        VoxParser.ExpressionContext operand = ctx.expression();
        // A negated numeric literal is just a negative literal.
        if (operand instanceof VoxParser.IntExprContext || operand instanceof VoxParser.FloatExprContext) {
            return "-" + operand.getText();
        }
        String value = visit(operand);
        String dest = newTemp();
        emit("neg " + dest + " " + value);
        return dest;
    }

    @Override
    public String visitNotExpr(VoxParser.NotExprContext ctx) {
        String value = visit(ctx.expression());
        String dest = newTemp();
        emit("not " + dest + " " + value);
        return dest;
    }

    @Override
    public String visitPowExpr(VoxParser.PowExprContext ctx) {
        return binary("power", ctx.expression(0), ctx.expression(1));
    }

    @Override
    public String visitMulExpr(VoxParser.MulExprContext ctx) {
        String op;
        switch (ctx.op.getType()) {
            case VoxParser.MUL: op = "mul"; break;
            case VoxParser.DIV: op = "div"; break;
            default:            op = "mod"; break;
        }
        return binary(op, ctx.expression(0), ctx.expression(1));
    }

    @Override
    public String visitAddExpr(VoxParser.AddExprContext ctx) {
        String op = ctx.op.getType() == VoxParser.ADD ? "add" : "sub";
        return binary(op, ctx.expression(0), ctx.expression(1));
    }

    /** `a subtracted from b` means b - a, so the operands are emitted reversed. */
    @Override
    public String visitSubFromExpr(VoxParser.SubFromExprContext ctx) {
        String amount = visit(ctx.expression(0));
        String source = visit(ctx.expression(1));
        String dest = newTemp();
        emit("sub " + dest + " " + source + " " + amount);
        return dest;
    }

    @Override
    public String visitRelExpr(VoxParser.RelExprContext ctx) {
        String op;
        switch (ctx.op.getType()) {
            case VoxParser.LE: op = "le"; break;
            case VoxParser.GE: op = "ge"; break;
            case VoxParser.LT: op = "lt"; break;
            default:           op = "gt"; break;
        }
        return binary(op, ctx.expression(0), ctx.expression(1));
    }

    @Override
    public String visitEqExpr(VoxParser.EqExprContext ctx) {
        String op = ctx.op.getType() == VoxParser.EQ ? "eq" : "ne";
        return binary(op, ctx.expression(0), ctx.expression(1));
    }

    @Override
    public String visitAndExpr(VoxParser.AndExprContext ctx) {
        return binary("and", ctx.expression(0), ctx.expression(1));
    }

    @Override
    public String visitOrExpr(VoxParser.OrExprContext ctx) {
        return binary("or", ctx.expression(0), ctx.expression(1));
    }

    private String binary(String op, VoxParser.ExpressionContext lhs,
                          VoxParser.ExpressionContext rhs) {
        String left = visit(lhs);
        String right = visit(rhs);
        String dest = newTemp();
        emit(op + " " + dest + " " + left + " " + right);
        return dest;
    }

    @Override
    public String visitCallExpr(VoxParser.CallExprContext ctx) {
        return visit(ctx.functionCall());
    }

    @Override
    public String visitFunctionCall(VoxParser.FunctionCallContext ctx) {
        String name = ctx.ID().getText();
        List<String> args = new ArrayList<>();
        for (VoxParser.ExpressionContext e : ctx.expression()) args.add(visit(e));
        String dest = newTemp();

        if (!userFunctions.contains(name) && SemanticAnalyzer.BUILTINS.containsKey(name)) {
            StringBuilder sb = new StringBuilder("builtin ").append(dest).append(' ').append(name);
            for (String a : args) sb.append(' ').append(a);
            emit(sb.toString());
            return dest;
        }

        StringBuilder sb = new StringBuilder("call ").append(name);
        for (String a : args) sb.append(' ').append(a);
        sb.append(" -> ").append(dest);
        emit(sb.toString());
        return dest;
    }

    @Override
    public String visitInputExpr(VoxParser.InputExprContext ctx) {
        String dest = newTemp();
        emit("input " + dest);
        return dest;
    }

    @Override public String visitIdExpr(VoxParser.IdExprContext ctx)         { return ctx.getText(); }
    @Override public String visitIntExpr(VoxParser.IntExprContext ctx)       { return ctx.getText(); }
    @Override public String visitFloatExpr(VoxParser.FloatExprContext ctx)   { return ctx.getText(); }
    @Override public String visitBoolExpr(VoxParser.BoolExprContext ctx)     { return ctx.getText(); }
    @Override public String visitStringExpr(VoxParser.StringExprContext ctx) { return ctx.getText(); }
}
