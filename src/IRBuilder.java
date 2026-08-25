import java.util.*;

/**
 * Lowers a Vox parse tree into the flat, line-oriented IR that IRExecutor runs.
 *
 * Every visit* method for an expression returns an operand: a literal, a
 * variable name, or the name of a freshly allocated temporary.
 */
public class IRBuilder extends VoxBaseVisitor<String> {

    private final List<String> instructions = new ArrayList<>();
    private int tempCounter = 0;
    private int labelCounter = 0;

    public List<String> getInstructions() { return instructions; }

    private String newTemp()             { return "t" + (tempCounter++); }
    private String newLabel(String kind) { return "L_" + kind + "_" + (labelCounter++); }
    private void emit(String instruction) { instructions.add(instruction); }

    // ------------------------------------------------------------ program --

    @Override
    public String visitProgram(VoxParser.ProgramContext ctx) {
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

        if (ctx.elseBlock == null) {
            String end = newLabel("endif");
            emit("if_false " + cond + " goto " + end);
            visit(ctx.thenBlock);
            emit("label " + end);
        } else {
            String otherwise = newLabel("else");
            String end = newLabel("endif");
            emit("if_false " + cond + " goto " + otherwise);
            visit(ctx.thenBlock);
            emit("goto " + end);
            emit("label " + otherwise);
            visit(ctx.elseBlock);
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
        visit(ctx.block());
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        String start = newLabel("for");
        String end = newLabel("endfor");
        visit(ctx.variableDeclaration());
        emit("label " + start);
        String cond = visit(ctx.expression());
        emit("if_false " + cond + " goto " + end);
        visit(ctx.block());
        visit(ctx.assignment());
        emit("goto " + start);
        emit("label " + end);
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
        List<String> args = new ArrayList<>();
        for (VoxParser.ExpressionContext e : ctx.expression()) args.add(visit(e));

        String dest = newTemp();
        StringBuilder sb = new StringBuilder("call ").append(ctx.ID().getText());
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
