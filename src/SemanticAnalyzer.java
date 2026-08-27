import java.util.*;
import org.antlr.v4.runtime.ParserRuleContext;
import org.antlr.v4.runtime.Token;

/**
 * Name resolution and type checking.
 *
 * These checks used to live as Java actions embedded in Vox.g4. Actions fire
 * during ANTLR's adaptive prediction, so they could run more than once or not
 * at all; running them as a separate pass over the finished parse tree is both
 * correct and keeps the grammar target-independent.
 */
public class SemanticAnalyzer extends VoxBaseVisitor<String> {

    /** A declared function: return type plus the types of its parameters. */
    private static final class Signature {
        final String returnType;
        final List<String> paramTypes;
        Signature(String returnType, List<String> paramTypes) {
            this.returnType = returnType;
            this.paramTypes = paramTypes;
        }
    }

    private final Map<String, Signature> functions = new LinkedHashMap<>();
    private final Deque<Map<String, String>> scopes = new ArrayDeque<>();
    private final List<String> errors = new ArrayList<>();
    private final List<String> warnings = new ArrayList<>();

    public List<String> getErrors()   { return errors; }
    public List<String> getWarnings() { return warnings; }

    private void error(ParserRuleContext ctx, String msg) {
        errors.add(at(ctx.getStart()) + " error: " + msg);
    }

    private void warn(ParserRuleContext ctx, String msg) {
        warnings.add(at(ctx.getStart()) + " warning: " + msg);
    }

    private static String at(Token t) {
        return "line " + t.getLine() + ":" + t.getCharPositionInLine();
    }

    // ------------------------------------------------------------- scopes --

    private void enterScope() { scopes.push(new LinkedHashMap<>()); }
    private void exitScope()  { if (!scopes.isEmpty()) scopes.pop(); }

    /** Declared in the innermost scope only, so shadowing an outer name is legal. */
    private boolean declaredHere(String name) {
        return !scopes.isEmpty() && scopes.peek().containsKey(name);
    }

    private boolean isVisible(String name) {
        for (Map<String, String> s : scopes) {
            if (s.containsKey(name)) return true;
        }
        return false;
    }

    private String typeOf(String name) {
        for (Map<String, String> s : scopes) {
            String t = s.get(name);
            if (t != null) return t;
        }
        return null;
    }

    private void define(String name, String type) {
        if (!scopes.isEmpty()) scopes.peek().put(name, type);
    }

    // ------------------------------------------------------------ program --

    @Override
    public String visitProgram(VoxParser.ProgramContext ctx) {
        // Collect every signature up front so a function may call one that is
        // defined later in the file.
        for (VoxParser.FunctionContext f : ctx.function()) {
            if (f.prototype() != null) {
                declareFunction(f.prototype().ID().getText(),
                        canonical(f.prototype().returnType().getText()),
                        paramTypes(f.prototype().parameterList()), f.prototype());
            } else if (f.definition() != null) {
                declareFunction(f.definition().ID().getText(),
                        canonical(f.definition().returnType().getText()),
                        paramTypes(f.definition().parameterList()), f.definition());
            }
        }

        for (VoxParser.FunctionContext f : ctx.function()) visit(f);
        visit(ctx.mainFunction());
        return null;
    }

    private void declareFunction(String name, String returnType,
                                 List<String> params, ParserRuleContext ctx) {
        Signature existing = functions.get(name);
        if (existing != null) {
            // A definition matching an earlier prototype is fine; anything else is not.
            boolean sameShape = existing.returnType.equals(returnType)
                    && existing.paramTypes.equals(params);
            if (!sameShape) {
                error(ctx, "function '" + name + "' redeclared with a different signature");
            }
            return;
        }
        functions.put(name, new Signature(returnType, params));
    }

    private static List<String> paramTypes(VoxParser.ParameterListContext ctx) {
        List<String> out = new ArrayList<>();
        if (ctx != null) {
            for (VoxParser.ParameterContext p : ctx.parameter()) {
                out.add(canonical(p.datatype().getText()));
            }
        }
        return out;
    }

    @Override
    public String visitPrototype(VoxParser.PrototypeContext ctx) {
        return null; // nothing to check beyond the signature already recorded
    }

    @Override
    public String visitDefinition(VoxParser.DefinitionContext ctx) {
        enterScope();
        if (ctx.parameterList() != null) {
            for (VoxParser.ParameterContext p : ctx.parameterList().parameter()) {
                String name = p.ID().getText();
                if (declaredHere(name)) {
                    error(p, "duplicate parameter '" + name + "'");
                } else {
                    define(name, canonical(p.datatype().getText()));
                }
            }
        }
        // The body's own scope, so a local may shadow a parameter.
        visit(ctx.block());
        exitScope();
        return null;
    }

    @Override
    public String visitMainFunction(VoxParser.MainFunctionContext ctx) {
        enterScope();
        visit(ctx.block());
        exitScope();
        return null;
    }

    @Override
    public String visitBlock(VoxParser.BlockContext ctx) {
        enterScope();
        for (VoxParser.StatementContext s : ctx.statement()) visit(s);
        exitScope();
        return null;
    }

    // -------------------------------------------------------- declarations --

    @Override
    public String visitDeclForward(VoxParser.DeclForwardContext ctx) {
        String declared = ctx.datatype().getText();
        String name = ctx.ID().getText();
        String valueType = null;
        if (ctx.expression() != null) valueType = visit(ctx.expression());
        declareVariable(ctx, name, declared, valueType);
        return null;
    }

    @Override
    public String visitDeclReverse(VoxParser.DeclReverseContext ctx) {
        String valueType = visit(ctx.expression());
        declareVariable(ctx, ctx.ID().getText(), ctx.datatype().getText(), valueType);
        return null;
    }

    private void declareVariable(ParserRuleContext ctx, String name,
                                 String declaredType, String valueType) {
        if (declaredHere(name)) {
            error(ctx, "variable '" + name + "' is already declared in this scope");
        } else {
            define(name, canonical(declaredType));
        }
        if (valueType != null) checkAssignable(ctx, canonical(declaredType), valueType, name);
    }

    // --------------------------------------------------------- assignments --

    @Override
    public String visitAssignForward(VoxParser.AssignForwardContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    }

    @Override
    public String visitAssignReverse(VoxParser.AssignReverseContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    }

    private void checkAssignTarget(ParserRuleContext ctx, String name, String valueType) {
        if (!isVisible(name)) {
            error(ctx, "variable '" + name + "' is not declared");
            return;
        }
        checkAssignable(ctx, typeOf(name), valueType, name);
    }

    /** Reports a narrowing or otherwise lossy assignment as a warning, not an error. */
    private void checkAssignable(ParserRuleContext ctx, String target,
                                 String value, String name) {
        if (target == null || value == null) return;
        if (value.equals("error") || target.equals(value)) return;
        if (value.equals("any") || target.equals("any")) return;

        boolean targetNum = isNumeric(target);
        boolean valueNum = isNumeric(value);
        if (targetNum && valueNum) {
            if (target.equals("integer") && value.equals("float")) {
                warn(ctx, "implicit cast float -> integer assigning to '" + name + "' loses precision");
            }
            return; // integer -> float widens silently
        }
        error(ctx, "cannot assign " + value + " to " + target + " '" + name + "'");
    }

    private static boolean isNumeric(String t) {
        return "integer".equals(t) || "float".equals(t);
    }

    // ------------------------------------------------------------ control --

    @Override
    public String visitIfStatement(VoxParser.IfStatementContext ctx) {
        requireCondition(ctx.expression());
        visit(ctx.thenBlock);
        if (ctx.elseBlock != null) visit(ctx.elseBlock);
        return null;
    }

    @Override
    public String visitWhileLoop(VoxParser.WhileLoopContext ctx) {
        requireCondition(ctx.expression());
        visit(ctx.block());
        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        // The loop variable belongs to a scope enclosing the body.
        enterScope();
        visit(ctx.variableDeclaration());
        requireCondition(ctx.expression());
        visit(ctx.assignment());
        visit(ctx.block());
        exitScope();
        return null;
    }

    private void requireCondition(VoxParser.ExpressionContext ctx) {
        String t = visit(ctx);
        if ("string".equals(t)) {
            warn(ctx, "condition has type string; it is true when non-empty");
        }
    }

    // -------------------------------------------------------- expressions --

    @Override
    public String visitParenExpr(VoxParser.ParenExprContext ctx) {
        return visit(ctx.expression());
    }

    @Override
    public String visitNotExpr(VoxParser.NotExprContext ctx) {
        visit(ctx.expression());
        return "boolean";
    }

    @Override
    public String visitPowExpr(VoxParser.PowExprContext ctx) {
        return arithmetic(ctx, visit(ctx.expression(0)), visit(ctx.expression(1)), "^");
    }

    @Override
    public String visitMulExpr(VoxParser.MulExprContext ctx) {
        return arithmetic(ctx, visit(ctx.expression(0)), visit(ctx.expression(1)),
                ctx.op.getText());
    }

    @Override
    public String visitAddExpr(VoxParser.AddExprContext ctx) {
        String l = visit(ctx.expression(0));
        String r = visit(ctx.expression(1));
        boolean isAdd = ctx.op.getType() == VoxParser.ADD;
        // '+' doubles as string concatenation.
        if (isAdd && ("string".equals(l) || "string".equals(r))) return "string";
        return arithmetic(ctx, l, r, ctx.op.getText());
    }

    @Override
    public String visitSubFromExpr(VoxParser.SubFromExprContext ctx) {
        return arithmetic(ctx, visit(ctx.expression(0)), visit(ctx.expression(1)),
                "subtracted from");
    }

    private String arithmetic(ParserRuleContext ctx, String l, String r, String op) {
        if ("error".equals(l) || "error".equals(r)) return "error";
        if ("any".equals(l) || "any".equals(r)) return "any";
        if (isNumeric(l) && isNumeric(r)) {
            return ("float".equals(l) || "float".equals(r)) ? "float" : "integer";
        }
        error(ctx, "operator '" + op + "' cannot be applied to " + l + " and " + r);
        return "error";
    }

    @Override
    public String visitRelExpr(VoxParser.RelExprContext ctx) {
        return comparison(ctx, visit(ctx.expression(0)), visit(ctx.expression(1)),
                ctx.op.getText(), true);
    }

    @Override
    public String visitEqExpr(VoxParser.EqExprContext ctx) {
        return comparison(ctx, visit(ctx.expression(0)), visit(ctx.expression(1)),
                ctx.op.getText(), false);
    }

    private String comparison(ParserRuleContext ctx, String l, String r,
                              String op, boolean ordered) {
        if ("error".equals(l) || "error".equals(r)) return "error";
        if ("any".equals(l) || "any".equals(r)) return "boolean";
        boolean ok = (isNumeric(l) && isNumeric(r))
                || (l.equals(r) && (!ordered || !"boolean".equals(l)));
        if (!ok) {
            error(ctx, "operator '" + op + "' cannot compare " + l + " and " + r);
            return "error";
        }
        return "boolean";
    }

    @Override
    public String visitAndExpr(VoxParser.AndExprContext ctx) {
        visit(ctx.expression(0));
        visit(ctx.expression(1));
        return "boolean";
    }

    @Override
    public String visitOrExpr(VoxParser.OrExprContext ctx) {
        visit(ctx.expression(0));
        visit(ctx.expression(1));
        return "boolean";
    }

    @Override
    public String visitIdExpr(VoxParser.IdExprContext ctx) {
        String name = ctx.ID().getText();
        if (!isVisible(name)) {
            error(ctx, "variable '" + name + "' is not declared");
            return "error";
        }
        return typeOf(name);
    }

    @Override public String visitIntExpr(VoxParser.IntExprContext ctx)       { return "integer"; }
    @Override public String visitFloatExpr(VoxParser.FloatExprContext ctx)   { return "float"; }
    @Override public String visitStringExpr(VoxParser.StringExprContext ctx) { return "string"; }
    @Override public String visitBoolExpr(VoxParser.BoolExprContext ctx)     { return "boolean"; }
    // input() is dynamically typed: the runtime coerces "12" to an integer,
    // "true" to a boolean, and anything else to a string. Reporting it as a
    // fixed type would make every realistic use of it a type error.
    @Override public String visitInputExpr(VoxParser.InputExprContext ctx)   { return "any"; }

    @Override
    public String visitCallExpr(VoxParser.CallExprContext ctx) {
        return visit(ctx.functionCall());
    }

    @Override
    public String visitFunctionCall(VoxParser.FunctionCallContext ctx) {
        String name = ctx.ID().getText();
        List<String> argTypes = new ArrayList<>();
        for (VoxParser.ExpressionContext e : ctx.expression()) argTypes.add(visit(e));

        Signature sig = functions.get(name);
        if (sig == null) {
            error(ctx, "function '" + name + "' is not declared");
            return "error";
        }
        if (sig.paramTypes.size() != argTypes.size()) {
            error(ctx, "function '" + name + "' expects " + sig.paramTypes.size()
                    + " argument(s) but got " + argTypes.size());
            return sig.returnType;
        }
        for (int i = 0; i < argTypes.size(); i++) {
            String want = sig.paramTypes.get(i);
            String got = argTypes.get(i);
            if (got == null || "error".equals(got) || "any".equals(got) || want.equals(got)) continue;
            if (isNumeric(want) && isNumeric(got)) {
                if (want.equals("integer") && got.equals("float")) {
                    warn(ctx, "argument " + (i + 1) + " of '" + name
                            + "': implicit cast float -> integer loses precision");
                }
                continue;
            }
            error(ctx, "argument " + (i + 1) + " of '" + name + "' expects "
                    + want + " but got " + got);
        }
        return sig.returnType;
    }

    @Override
    public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
        for (VoxParser.ExpressionContext e : ctx.expression()) visit(e);
        return null;
    }

    @Override
    public String visitReturnStatement(VoxParser.ReturnStatementContext ctx) {
        if (ctx.expression() != null) visit(ctx.expression());
        return null;
    }

    /** Maps every spelling of a type onto one canonical name. */
    static String canonical(String written) {
        String t = written.trim().replaceAll("\\s+", " ");
        switch (t) {
            case "int": case "integer": case "number": case "whole number":
                return "integer";
            case "float": case "floating point number":
                return "float";
            case "bool": case "boolean": case "boolean number":
                return "boolean";
            case "char": case "character":
                return "character";
            case "string": case "character string": case "varchar":
                return "string";
            default:
                return t;
        }
    }
}
