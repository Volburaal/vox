import java.util.*;
import org.antlr.v4.runtime.tree.*;

public class IRBuilder extends VoxBaseVisitor<String> {
    private final List<String> instructions = new ArrayList<>();
    private int tempCounter = 0;

    private String newTemp() {
        return "t" + (tempCounter++);
    }

    public List<String> getInstructions() {
        return instructions;
    }

    @Override
    public String visitProgram(VoxParser.ProgramContext ctx) {
        for (var f : ctx.function()) visit(f);
        visit(ctx.mainFunction());
        return null;
    }

    @Override
    public String visitDefinition(VoxParser.DefinitionContext ctx) {
        instructions.add("func_start " + ctx.ID().getText());
        for (var stmt : ctx.statement()) visit(stmt);
        instructions.add("func_end " + ctx.ID().getText());
        return null;
    }

    @Override
    public String visitMainFunction(VoxParser.MainFunctionContext ctx) {
        instructions.add("func_start main");
        for (var stmt : ctx.statement()) visit(stmt);
        instructions.add("func_end main");
        return null;
    }

    @Override
    public String visitVariableDeclaration(VoxParser.VariableDeclarationContext ctx) {
        String varName = ctx.ID().getText();
        String value = visit(ctx.expression());
        instructions.add("set " + varName + " " + value);
        return null;
    }

    @Override
    public String visitAssignment(VoxParser.AssignmentContext ctx) {
        String varName = ctx.ID().getText();
        String value = visit(ctx.expression());
        instructions.add("set " + varName + " " + value);
        return null;
    }

    @Override
    public String visitExpression(VoxParser.ExpressionContext ctx) {
        if (ctx.ID() != null) return ctx.ID().getText();
        if (ctx.INT() != null) return ctx.INT().getText();
        if (ctx.FLOAT() != null) return ctx.FLOAT().getText();
        if (ctx.STRING() != null) return ctx.STRING().getText();
        if (ctx.BOOL() != null) return ctx.BOOL().getText();
        if (ctx.functionCall() != null) return visit(ctx.functionCall());
        if (ctx.inputExpression() != null) {
            String tmp = newTemp();
            instructions.add("input " + tmp);
            return tmp;
        }
        if (ctx.expression().size() == 1 && ctx.getChild(0).getText().equals("not")) {
            String val = visit(ctx.expression(0));
            String tmp = newTemp();
            instructions.add("not " + tmp + " " + val);
            return tmp;
        }
        if (ctx.expression().size() == 2) {
            String left = visit(ctx.expression(0));
            String right = visit(ctx.expression(1));
            String op = ctx.operator().getText().replace(" ", "_");
            String tmp = newTemp();
            instructions.add(op + " " + tmp + " " + left + " " + right);
            return tmp;
        }
        if (ctx.expression().size() == 1) {
            return visit(ctx.expression(0));
        }
        return null;
    }

    @Override
    public String visitIfStatement(VoxParser.IfStatementContext ctx) {
        String cond = visit(ctx.expression());
        String labelElse = "L_else_" + tempCounter;
        String labelEnd = "L_end_" + tempCounter;
        tempCounter++;

        instructions.add("if_false " + cond + " goto " + labelElse);
        for (var stmt : ctx.statement()) visit(stmt);
        instructions.add("goto " + labelEnd);
        instructions.add("label " + labelElse);
        instructions.add("label " + labelEnd);
        return null;
    }

    @Override
    public String visitIfElse(VoxParser.IfElseContext ctx) {
        String cond = visit(ctx.expression());
        String labelElse = "L_else_" + tempCounter;
        String labelEnd = "L_end_" + tempCounter;
        tempCounter++;

        int totalStmts = ctx.statement().size();
        int mid = totalStmts / 2;

        instructions.add("if_false " + cond + " goto " + labelElse);

        for (int i = 0; i < mid; i++) {
            visit(ctx.statement(i));
        }

        instructions.add("goto " + labelEnd);
        instructions.add("label " + labelElse);

        for (int i = mid; i < totalStmts; i++) {
            visit(ctx.statement(i));
        }

        instructions.add("label " + labelEnd);
        return null;
    }


    @Override
    public String visitWhileLoop(VoxParser.WhileLoopContext ctx) {
        String labelStart = "L_start_" + tempCounter;
        String labelEnd = "L_end_" + tempCounter;
        tempCounter++;

        instructions.add("label " + labelStart);
        String cond = visit(ctx.expression());
        instructions.add("if_false " + cond + " goto " + labelEnd);
        for (var stmt : ctx.statement()) visit(stmt);
        instructions.add("goto " + labelStart);
        instructions.add("label " + labelEnd);
        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        String labelStart = "L_start_" + tempCounter;
        String labelEnd = "L_end_" + tempCounter;
        tempCounter++;

        visit(ctx.variableDeclaration());
        instructions.add("label " + labelStart);
        String cond = visit(ctx.expression());
        instructions.add("if_false " + cond + " goto " + labelEnd);
        for (var stmt : ctx.statement()) visit(stmt);
        visit(ctx.assignment());
        instructions.add("goto " + labelStart);
        instructions.add("label " + labelEnd);
        return null;
    }

    @Override
    public String visitFunctionCall(VoxParser.FunctionCallContext ctx) {
        List<String> args = new ArrayList<>();
        if (ctx.argumentList() != null) {
            for (var expr : ctx.argumentList().expression()) {
                args.add(visit(expr));
            }
        }
        String tmp = newTemp();
        instructions.add("call " + ctx.ID().getText() + " " + String.join(" ", args) + " -> " + tmp);
        return tmp;
    }

@Override
public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
    StringBuilder printArgs = new StringBuilder();
    for (var expr : ctx.printArgs().expression()) {
        String val = visit(expr);
        if (printArgs.length() > 0) {
            printArgs.append(" ");
        }
        printArgs.append(val);
    }
    instructions.add("print " + printArgs.toString());
    return null;
}

    @Override
    public String visitReturnStatement(VoxParser.ReturnStatementContext ctx) {
        String val = visit(ctx.expression());
        instructions.add("return " + val);
        return null;
    }
}
