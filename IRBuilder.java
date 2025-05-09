import java.util.*;

public class IRBuilder extends VoxBaseVisitor<String> {
    int tempCount = 0;
    int labelCount = 0;
    List<String> ir = new ArrayList<>();
    List<String> globalStrings = new ArrayList<>();

    String newTemp() {
        return "%t" + (tempCount++);
    }

    String newLabel(String base) {
        return base + "_" + (labelCount++);
    }

    @Override
    public String visitVariableDeclaration(VoxParser.VariableDeclarationContext ctx) {
        String varName = ctx.ID().getText();
        String varType = ctx.datatype().getText();

        VoxParser.symbolTable.define(varName, varType);

        String rhs = visit(ctx.expression());

        ir.add("%" + varName + " = alloca " + types(varType));

        if (rhs.equals("input")) {
            String fmtLabel = "@.in" + labelCount++;
            String formatStr;
            switch (varType) {
                case "integer": formatStr = "%d"; break;
                case "float":   formatStr = "%f"; break;
                case "string":  formatStr = "%s"; break;
                default:
                    System.err.println("Unsupported input type: " + varType);
                    formatStr = "%d";
            }

            int strLen = formatStr.length() + 1;
            globalStrings.add(fmtLabel + " = constant [" + strLen + " x i8] c\"" + formatStr + "\\00\"");
            ir.add("call i32 (i8*, ...) @scanf(i8* getelementptr inbounds ([" + strLen + " x i8], [" + strLen + " x i8]* " + fmtLabel + ", i32 0, i32 0), " + types(varType) + "* %" + varName + ")");
        } else {
            ir.add("store " + rhs + ", " + types(varType) + "* %" + varName);
        }

        return null;
    }


    @Override
    public String visitAssignment(VoxParser.AssignmentContext ctx) {
        String varName = ctx.ID().getText();
        String exprVal = visit(ctx.expression());
        String type = VoxParser.symbolTable.getType(varName);
        ir.add("store " + exprVal + ", " + types(type) + "* %" + varName);
        return null;
    }

    @Override
    public String visitExpression(VoxParser.ExpressionContext ctx) {
        if (ctx.INT() != null) return "i32 " + ctx.INT().getText();
        if (ctx.FLOAT() != null) return "float " + ctx.FLOAT().getText();
        if (ctx.BOOL() != null) return "i1 " + (ctx.BOOL().getText().equals("true") ? "1" : "0");
        if (ctx.STRING() != null) {
            String str = ctx.STRING().getText();
            str = str.substring(1, str.length() - 1);
            String strLabel = "@.str" + labelCount++; 
            int len = str.length() + 1;
            globalStrings.add(strLabel + " = constant [" + len + " x i8] c\"" + str + "\\00\"");
            return "i8* " + strLabel;
        }

        if (ctx.ID() != null) {
            String var = ctx.ID().getText();
            String tmp = newTemp();
            String type = VoxParser.symbolTable.getType(var);
            ir.add(tmp + " = load " + types(type) + ", " + types(type) + "* %" + var);
            return tmp;
        }

        if (ctx.operator() != null) {
            String left = visit(ctx.expression(0));
            String right = visit(ctx.expression(1));
            String tmp = newTemp();
            String op = ctx.operator().getText();
            switch (op) {
                case "added to":
                    ir.add(tmp + " = add i32 " + left + ", " + right); break;
                case "minus":
                    ir.add(tmp + " = sub i32 " + left + ", " + right); break;
                case "multiplied by":
                    ir.add(tmp + " = mul i32 " + left + ", " + right); break;
                case "divided by":
                    ir.add(tmp + " = sdiv i32 " + left + ", " + right); break;
                case "is equal to":
                    ir.add(tmp + " = icmp eq i32 " + left + ", " + right); break;
                case "is less than":
                    ir.add(tmp + " = icmp slt i32 " + left + ", " + right); break;
                case "is greater than":
                    ir.add(tmp + " = icmp sgt i32 " + left + ", " + right); break;
                case "and":
                    ir.add(tmp + " = and i1 " + left + ", " + right); break;
                case "or":
                    ir.add(tmp + " = or i1 " + left + ", " + right); break;
            }
            return tmp;
        }

        if (ctx.getChild(0).getText().equals("not")) {
            String val = visit(ctx.expression(0));
            String tmp = newTemp();
            ir.add(tmp + " = xor i1 " + val + ", true");
            return tmp;
        }

        if (ctx.functionCall() != null) {
            return visit(ctx.functionCall());
        }

        return null;
    }

    @Override
    public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
        StringBuilder fmt = new StringBuilder();
        List<String> args = new ArrayList<>();

        for (var expr : ctx.printArgs().expression()) {
            if (expr.STRING() != null) {
                String str = expr.STRING().getText();
                str = str.substring(1, str.length() - 1);
                fmt.append(str).append(" ");
            } else {
                String val = visit(expr);
                fmt.append("%d ");
                args.add(val);
            }
        }

        fmt.append("\\0A\\00");
        String fmtLabel = "@.fmt" + labelCount++;
        int len = fmt.toString().replaceAll("\\\\", "").length() + 1;

        globalStrings.add(fmtLabel + " = constant [" + len + " x i8] c\"" + fmt + "\"");

        StringBuilder call = new StringBuilder();
        call.append("call i32 (i8*, ...) @printf(i8* getelementptr inbounds ([").append(len)
            .append(" x i8], [").append(len).append(" x i8]* ").append(fmtLabel)
            .append(", i32 0, i32 0)");

        for (String arg : args) {
            call.append(", ").append(arg);
        }
        call.append(")");

        ir.add(call.toString());
        return null;
    }

    @Override
    public String visitInputExpression(VoxParser.InputExpressionContext ctx) {
        return "input";
    }


    @Override
    public String visitIfStatement(VoxParser.IfStatementContext ctx) {
        String condVal = visit(ctx.expression());
        String thenLabel = newLabel("if_then");
        String endLabel = newLabel("if_end");

        ir.add("br i1 " + condVal + ", label %" + thenLabel + ", label %" + endLabel);
        ir.add(thenLabel + ":");
        for (var stmt : ctx.statement()) visit(stmt);
        ir.add("br label %" + endLabel);
        ir.add(endLabel + ":");

        return null;
    }

    @Override
    public String visitIfElse(VoxParser.IfElseContext ctx) {
        String condVal = visit(ctx.expression());
        String thenLabel = newLabel("if_then");
        String elseLabel = newLabel("if_else");
        String endLabel = newLabel("if_end");

        ir.add("br i1 " + condVal + ", label %" + thenLabel + ", label %" + elseLabel);
        ir.add(thenLabel + ":");
        visit(ctx.statement(0));
        ir.add("br label %" + endLabel);

        ir.add(elseLabel + ":");
        visit(ctx.statement(1));
        ir.add("br label %" + endLabel);

        ir.add(endLabel + ":");

        return null;
    }

    @Override
    public String visitWhileLoop(VoxParser.WhileLoopContext ctx) {
        String loopCond = newLabel("while_cond");
        String loopBody = newLabel("while_body");
        String loopEnd = newLabel("while_end");

        ir.add("br label %" + loopCond);
        ir.add(loopCond + ":");
        String condVal = visit(ctx.expression());
        ir.add("br i1 " + condVal + ", label %" + loopBody + ", label %" + loopEnd);

        ir.add(loopBody + ":");
        for (var stmt : ctx.statement()) visit(stmt);
        ir.add("br label %" + loopCond);

        ir.add(loopEnd + ":");

        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        visit(ctx.variableDeclaration());
        String condLabel = newLabel("for_cond");
        String bodyLabel = newLabel("for_body");
        String endLabel = newLabel("for_end");

        ir.add("br label %" + condLabel);
        ir.add(condLabel + ":");
        String cond = visit(ctx.expression());
        ir.add("br i1 " + cond + ", label %" + bodyLabel + ", label %" + endLabel);

        ir.add(bodyLabel + ":");
        for (var stmt : ctx.statement()) visit(stmt);
        visit(ctx.assignment());
        ir.add("br label %" + condLabel);

        ir.add(endLabel + ":");

        return null;
    }

    @Override
    public String visitFunctionCall(VoxParser.FunctionCallContext ctx) {
        String funcName = ctx.ID().getText();
        List<String> args = new ArrayList<>();
        if (ctx.argumentList() != null) {
            for (var expr : ctx.argumentList().expression()) {
                args.add(visit(expr));
            }
        }
        String tmp = newTemp();
        ir.add(tmp + " = call i32 @" + funcName + "(" + String.join(", ", args) + ")");
        return tmp;
    }

    @Override
    public String visitReturnStatement(VoxParser.ReturnStatementContext ctx) {
        String val = visit(ctx.expression());
        ir.add("ret " + val);
        return null;
    }

    @Override
    public String visitDefinition(VoxParser.DefinitionContext ctx) {
        String funcName = ctx.ID().getText();
        ir.add("define i32 @" + funcName + "() {");

        for (var stmt : ctx.statement()) visit(stmt);

        ir.add("ret i32 0");
        ir.add("}");
        return null;
    }

    String types(String voxType) {
        if (voxType == null) {
            throw new IllegalArgumentException("Type is null (undefined variable?)");
        }
        switch (voxType) {
            case "integer": return "i32";
            case "float": return "float";
            case "boolean": return "i1";
            case "character": return "i8";
            case "string": return "i8*";
            default: return "i32";
        }
    }


    public void printIR() {
        System.out.println("declare i32 @printf(i8*, ...)");
        System.out.println("declare i32 @scanf(i8*, ...)");
        for (String global : globalStrings) {
            System.out.println(global);
        }
        for (String line : ir) {
            System.out.println(line);
        }
    }
}
