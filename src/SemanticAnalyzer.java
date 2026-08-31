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
 *
 * Diagnostic messages are kept byte-for-byte identical to the TypeScript
 * engine's so the shared regression suite can assert on them for both.
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

    /** What a builtin accepts ("num" or "string" per parameter) and returns. */
    static final class BuiltinSpec {
        final String[] params;
        /** A fixed type, or "numeric" to follow the arguments (float if any float). */
        final String result;
        BuiltinSpec(String result, String... params) {
            this.result = result;
            this.params = params;
        }
    }

    /**
     * The builtin functions, by their symbolic name. The spoken forms in the
     * grammar ("square root of") map onto the same names. User-defined
     * functions take precedence over these, so no name is reserved.
     */
    static final Map<String, BuiltinSpec> BUILTINS = new LinkedHashMap<>();
    static {
        BUILTINS.put("sqrt",      new BuiltinSpec("float",   "num"));
        BUILTINS.put("abs",       new BuiltinSpec("numeric", "num"));
        BUILTINS.put("round",     new BuiltinSpec("integer", "num"));
        BUILTINS.put("floor",     new BuiltinSpec("integer", "num"));
        BUILTINS.put("ceiling",   new BuiltinSpec("integer", "num"));
        BUILTINS.put("min",       new BuiltinSpec("numeric", "num", "num"));
        BUILTINS.put("max",       new BuiltinSpec("numeric", "num", "num"));
        BUILTINS.put("length",    new BuiltinSpec("integer", "string"));
        BUILTINS.put("uppercase", new BuiltinSpec("string",  "string"));
        BUILTINS.put("lowercase", new BuiltinSpec("string",  "string"));
    }

    /** Maps a spoken builtin token onto its symbolic name. */
    static String builtinNameOf(VoxParser.BuiltinNameContext ctx) {
        if (ctx.SQRT_OF() != null) return "sqrt";
        if (ctx.ABS_OF() != null) return "abs";
        if (ctx.LENGTH_OF() != null) return "length";
        if (ctx.FLOOR_OF() != null) return "floor";
        if (ctx.CEIL_OF() != null) return "ceiling";
        if (ctx.UPPER_OF() != null) return "uppercase";
        return "lowercase";
    }

    private final Map<String, Signature> functions = new LinkedHashMap<>();
    private final Deque<Map<String, String>> scopes = new ArrayDeque<>();
    private final List<String> errors = new ArrayList<>();
    private final List<String> warnings = new ArrayList<>();
    /** The function being checked; null inside main. */
    private String currentName = null;
    private String currentReturnType = null;
    private int loopDepth = 0;

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
                        returnTypeOf(f.prototype().returnType()),
                        paramTypes(f.prototype().parameterList()), f.prototype());
            } else if (f.definition() != null) {
                declareFunction(f.definition().ID().getText(),
                        returnTypeOf(f.definition().returnType()),
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

    /** "void" for procedures, otherwise the canonical datatype. */
    private static String returnTypeOf(VoxParser.ReturnTypeContext ctx) {
        return ctx.VOID() != null ? "void" : canonical(ctx.datatype().getText());
    }

    @Override
    public String visitPrototype(VoxParser.PrototypeContext ctx) {
        return null; // nothing to check beyond the signature already recorded
    }

    @Override
    public String visitDefinition(VoxParser.DefinitionContext ctx) {
        currentName = ctx.ID().getText();
        currentReturnType = returnTypeOf(ctx.returnType());
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
        currentName = null;
        currentReturnType = null;
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

    /** `let x be 5` declares x with the type of its value. */
    @Override
    public String visitDeclLet(VoxParser.DeclLetContext ctx) {
        String valueType = visit(ctx.expression());
        String name = ctx.ID().getText();
        if (declaredHere(name)) {
            error(ctx, "variable '" + name + "' is already declared in this scope");
        } else {
            define(name, valueType == null || "error".equals(valueType) ? "any" : valueType);
        }
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

    @Override
    public String visitSetTo(VoxParser.SetToContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.ID().getText(), valueType);
        return null;
    }

    /** Each value must fit the other variable's declared type. */
    @Override
    public String visitSwapStmt(VoxParser.SwapStmtContext ctx) {
        String a = ctx.ID(0).getText();
        String b = ctx.ID(1).getText();
        boolean missing = false;
        for (String name : new String[] { a, b }) {
            if (!isVisible(name)) {
                error(ctx, "variable '" + name + "' is not declared");
                missing = true;
            }
        }
        if (missing) return null;
        checkAssignable(ctx, typeOf(a), typeOf(b), a);
        checkAssignable(ctx, typeOf(b), typeOf(a), b);
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
        // input() is dynamic: the runtime coerces it to whatever fits.
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

    // ------------------------------------------------------------ updates --
    // Every spoken form is checked as its symbolic twin: `add 3 to n` is `n += 3`.

    @Override
    public String visitIncStmt(VoxParser.IncStmtContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "++", "integer");
    }

    @Override
    public String visitDecStmt(VoxParser.DecStmtContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "--", "integer");
    }

    @Override
    public String visitOpAssign(VoxParser.OpAssignContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), ctx.op.getText(), visit(ctx.expression()));
    }

    @Override
    public String visitIncreaseBy(VoxParser.IncreaseByContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "+=", visit(ctx.expression()));
    }

    @Override
    public String visitDecreaseBy(VoxParser.DecreaseByContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "-=", visit(ctx.expression()));
    }

    @Override
    public String visitAddTo(VoxParser.AddToContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "+=", visit(ctx.expression()));
    }

    @Override
    public String visitTakeFrom(VoxParser.TakeFromContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "-=", visit(ctx.expression()));
    }

    @Override
    public String visitMultiplyBy(VoxParser.MultiplyByContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "*=", visit(ctx.expression()));
    }

    @Override
    public String visitDivideBy(VoxParser.DivideByContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "/=", visit(ctx.expression()));
    }

    @Override
    public String visitDoubleStmt(VoxParser.DoubleStmtContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "double", "integer");
    }

    @Override
    public String visitHalveStmt(VoxParser.HalveStmtContext ctx) {
        return checkUpdate(ctx, ctx.ID().getText(), "halve", "integer");
    }

    /** `name op= value` is checked exactly like `name = name op value`. */
    private String checkUpdate(ParserRuleContext ctx, String name, String op, String valueType) {
        if (!isVisible(name)) {
            error(ctx, "variable '" + name + "' is not declared");
            return null;
        }
        String target = typeOf(name);
        String result;
        if (op.equals("++") || op.equals("--") || op.equals("double") || op.equals("halve")) {
            if (!isNumeric(target)) {
                error(ctx, "operator '" + op + "' cannot be applied to " + target);
                return null;
            }
            result = target;
        } else if (op.equals("+=") && ("string".equals(target) || "string".equals(valueType))) {
            result = "string"; // '+' doubles as string concatenation
        } else {
            result = arithmetic(ctx, target, valueType, op);
        }
        checkAssignable(ctx, target, result, name);
        return null;
    }

    // ------------------------------------------------------------ control --

    @Override
    public String visitIfStatement(VoxParser.IfStatementContext ctx) {
        requireCondition(ctx.expression());
        visit(ctx.thenBlock);
        if (ctx.elseIf != null) visit(ctx.elseIf);
        else if (ctx.elseBlock != null) visit(ctx.elseBlock);
        return null;
    }

    @Override
    public String visitWhileLoop(VoxParser.WhileLoopContext ctx) {
        requireCondition(ctx.expression());
        loopDepth++;
        visit(ctx.block());
        loopDepth--;
        return null;
    }

    @Override
    public String visitForLoop(VoxParser.ForLoopContext ctx) {
        // The loop variable belongs to a scope enclosing the body.
        enterScope();
        visit(ctx.variableDeclaration());
        requireCondition(ctx.expression());
        visit(ctx.forUpdate());
        loopDepth++;
        visit(ctx.block());
        loopDepth--;
        exitScope();
        return null;
    }

    @Override
    public String visitRangeLoop(VoxParser.RangeLoopContext ctx) {
        VoxParser.RangeClauseContext rc = ctx.rangeClause();
        String name = rc.ID().getText();
        String varType = rc.datatype() != null ? canonical(rc.datatype().getText()) : "integer";
        // The bounds are evaluated before the loop variable exists, so
        // `for i from i to 10` refers to an outer i.
        String startType = visit(rc.start);
        String limitType = visit(rc.limit);
        String stepType = rc.step != null ? visit(rc.step) : null;

        if (!isNumeric(varType)) {
            error(rc.datatype(), "loop variable '" + name + "' must be a number, not " + varType);
        }
        requireNumber(rc.start, startType, "loop start");
        requireNumber(rc.limit, limitType, "loop end");
        if (rc.step != null) {
            requireNumber(rc.step, stepType, "loop step");
            Double literal = literalValue(rc.step);
            if (literal != null && literal <= 0) {
                error(rc.step, "loop step must be positive; use 'down to' to count down");
            }
        }

        // The loop variable belongs to a scope enclosing the body.
        enterScope();
        define(name, varType);
        if (isNumeric(varType)) {
            checkAssignable(rc, varType, startType, name);
            if (rc.step != null) checkAssignable(rc.step, varType, stepType, name);
        }
        loopDepth++;
        visit(ctx.block());
        loopDepth--;
        exitScope();
        return null;
    }

    private void requireNumber(ParserRuleContext ctx, String t, String what) {
        if (t == null || "error".equals(t) || "any".equals(t) || isNumeric(t)) return;
        error(ctx, what + " must be a number but got " + t);
    }

    @Override
    public String visitRepeatTimes(VoxParser.RepeatTimesContext ctx) {
        String t = visit(ctx.expression());
        if (t != null && !"error".equals(t) && !"any".equals(t) && !"integer".equals(t)) {
            error(ctx.expression(), "repeat count must be an integer but got " + t);
        }
        loopDepth++;
        visit(ctx.block());
        loopDepth--;
        return null;
    }

    @Override
    public String visitRepeatUntil(VoxParser.RepeatUntilContext ctx) {
        // The body runs before the condition is first tested.
        loopDepth++;
        visit(ctx.block());
        loopDepth--;
        requireCondition(ctx.expression());
        return null;
    }

    /** The value of a numeric literal (possibly negated or parenthesised), else null. */
    private static Double literalValue(VoxParser.ExpressionContext e) {
        while (e instanceof VoxParser.ParenExprContext) e = ((VoxParser.ParenExprContext) e).expression();
        if (e instanceof VoxParser.IntExprContext || e instanceof VoxParser.FloatExprContext) {
            return Double.parseDouble(e.getText());
        }
        if (e instanceof VoxParser.NegExprContext) {
            Double inner = literalValue(((VoxParser.NegExprContext) e).expression());
            return inner == null ? null : -inner;
        }
        return null;
    }

    @Override
    public String visitBreakStmt(VoxParser.BreakStmtContext ctx) {
        if (loopDepth == 0) {
            error(ctx, "'" + ctx.BREAK().getText() + "' can only be used inside a loop");
        }
        return null;
    }

    @Override
    public String visitContinueStmt(VoxParser.ContinueStmtContext ctx) {
        if (loopDepth == 0) {
            error(ctx, "'" + ctx.CONTINUE().getText() + "' can only be used inside a loop");
        }
        return null;
    }

    @Override
    public String visitExprStmt(VoxParser.ExprStmtContext ctx) {
        VoxParser.ExpressionContext e = ctx.expression();
        visit(e);
        // `x is equal to 5;` compares and throws the answer away. Say so,
        // because in a spoken language it reads like an assignment.
        if (e instanceof VoxParser.EqExprContext) {
            warn(e, "comparison has no effect; to assign, use 'set ... to', '<-' or '='");
        } else if (!(e instanceof VoxParser.CallExprContext) && !(e instanceof VoxParser.InputExprContext)) {
            warn(e, "expression has no effect");
        }
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
    public String visitCastExpr(VoxParser.CastExprContext ctx) {
        String source = visit(ctx.expression());
        String target = canonical(ctx.datatype().getText());
        return "error".equals(source) ? "error" : target;
    }

    @Override
    public String visitBuiltinExpr(VoxParser.BuiltinExprContext ctx) {
        String name = builtinNameOf(ctx.builtinName());
        List<String> argTypes = new ArrayList<>();
        argTypes.add(visit(ctx.expression()));
        return checkBuiltin(ctx, name, argTypes);
    }

    @Override
    public String visitNegExpr(VoxParser.NegExprContext ctx) {
        String t = visit(ctx.expression());
        if ("error".equals(t)) return "error";
        if ("any".equals(t) || (t != null && isNumeric(t))) return t;
        error(ctx, "operator '-' cannot be applied to " + t);
        return "error";
    }

    @Override
    public String visitSquaredExpr(VoxParser.SquaredExprContext ctx) {
        String t = visit(ctx.expression());
        if ("error".equals(t)) return "error";
        if ("any".equals(t) || (t != null && isNumeric(t))) return t;
        error(ctx, "operator '" + ctx.op.getText() + "' cannot be applied to " + t);
        return "error";
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

    // ---- predicates: `is even`, `is not positive`, `is divisible by`, ... ----

    /** "is even" or "is not even", regardless of how the operator was spelled. */
    private static String predicateName(int opType, String pred) {
        return (opType == VoxParser.NE ? "is not " : "is ") + pred;
    }

    @Override
    public String visitPredicateExpr(VoxParser.PredicateExprContext ctx) {
        String t = visit(ctx.expression());
        if (t != null && !"error".equals(t) && !"any".equals(t)) {
            int pred = ctx.pred.getType();
            boolean ok;
            if (pred == VoxParser.EMPTY) {
                ok = "string".equals(t) || "character".equals(t);
            } else if (pred == VoxParser.EVEN || pred == VoxParser.ODD) {
                ok = "integer".equals(t);
            } else {
                ok = isNumeric(t);
            }
            if (!ok) {
                error(ctx, "operator '" + predicateName(ctx.op.getType(), ctx.pred.getText())
                        + "' cannot be applied to " + t);
            }
        }
        return "boolean";
    }

    @Override
    public String visitDivisibleExpr(VoxParser.DivisibleExprContext ctx) {
        String l = visit(ctx.expression(0));
        String r = visit(ctx.expression(1));
        boolean badL = l != null && !"error".equals(l) && !"any".equals(l) && !"integer".equals(l);
        boolean badR = r != null && !"error".equals(r) && !"any".equals(r) && !"integer".equals(r);
        if (badL || badR) {
            error(ctx, "operator '" + predicateName(ctx.op.getType(), "divisible by")
                    + "' cannot be applied to " + l + " and " + r);
        }
        return "boolean";
    }

    @Override
    public String visitBetweenExpr(VoxParser.BetweenExprContext ctx) {
        String value = visit(ctx.expression(0));
        String low = visit(ctx.low);
        String high = visit(ctx.high);
        String op = predicateName(ctx.op.getType(), "between");
        comparison(ctx, value, low, op, true);
        comparison(ctx, value, high, op, true);
        return "boolean";
    }

    private String arithmetic(ParserRuleContext ctx, String l, String r, String op) {
        if ("error".equals(l) || "error".equals(r)) return "error";
        if ("any".equals(l) || "any".equals(r)) return "any";
        if (l != null && r != null && isNumeric(l) && isNumeric(r)) {
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
        boolean ok = l != null && r != null
                && ((isNumeric(l) && isNumeric(r))
                    || (l.equals(r) && (!ordered || !"boolean".equals(l))));
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

    // ask prints its prompt, then reads a line exactly like input().
    @Override
    public String visitAskExpr(VoxParser.AskExprContext ctx) {
        visit(ctx.expression());
        return "any";
    }

    @Override
    public String visitCallExpr(VoxParser.CallExprContext ctx) {
        VoxParser.FunctionCallContext call = ctx.functionCall();
        String t = visit(call);
        // A procedure call is fine as a statement on its own, but has no value.
        if ("void".equals(t) && !(ctx.getParent() instanceof VoxParser.ExprStmtContext)) {
            error(ctx, "procedure '" + call.ID().getText()
                    + "' returns nothing and cannot be used as a value");
            return "error";
        }
        return t;
    }

    @Override
    public String visitFunctionCall(VoxParser.FunctionCallContext ctx) {
        String name = ctx.ID().getText();
        List<String> argTypes = new ArrayList<>();
        for (VoxParser.ExpressionContext e : ctx.expression()) argTypes.add(visit(e));

        Signature sig = functions.get(name);
        if (sig == null) {
            if (BUILTINS.containsKey(name)) return checkBuiltin(ctx, name, argTypes);
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

    /** Arity and type checks for a builtin; returns its result type. */
    private String checkBuiltin(ParserRuleContext ctx, String name, List<String> argTypes) {
        BuiltinSpec spec = BUILTINS.get(name);
        String result = spec.result;
        if ("numeric".equals(result)) {
            result = "integer";
            if (argTypes.contains("float")) result = "float";
            else if (argTypes.contains("any")) result = "any";
        }
        if (spec.params.length != argTypes.size()) {
            error(ctx, "function '" + name + "' expects " + spec.params.length
                    + " argument(s) but got " + argTypes.size());
            return result;
        }
        for (int i = 0; i < argTypes.size(); i++) {
            String got = argTypes.get(i);
            if (got == null || "error".equals(got) || "any".equals(got)) continue;
            String kind = spec.params[i];
            boolean ok = "num".equals(kind) ? isNumeric(got)
                    : ("string".equals(got) || "character".equals(got));
            if (!ok) {
                error(ctx, "argument " + (i + 1) + " of '" + name + "' expects "
                        + ("num".equals(kind) ? "a number" : "string") + " but got " + got);
            }
        }
        return result;
    }

    @Override
    public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
        for (VoxParser.ExpressionContext e : ctx.expression()) visit(e);
        return null;
    }

    @Override
    public String visitReturnStatement(VoxParser.ReturnStatementContext ctx) {
        String valueType = ctx.expression() != null ? visit(ctx.expression()) : null;
        if (currentName == null) return null; // `return` in main just ends the program

        if ("void".equals(currentReturnType)) {
            if (ctx.expression() != null) {
                error(ctx, "procedure '" + currentName + "' cannot return a value");
            }
            return null;
        }
        if (ctx.expression() == null) {
            error(ctx, "function '" + currentName + "' must return a value of type " + currentReturnType);
            return null;
        }
        if (valueType == null || "error".equals(valueType) || "any".equals(valueType)
                || valueType.equals(currentReturnType)) return null;
        if (isNumeric(currentReturnType) && isNumeric(valueType)) {
            if ("integer".equals(currentReturnType) && "float".equals(valueType)) {
                warn(ctx, "implicit cast float -> integer in return from '" + currentName + "' loses precision");
            }
            return null;
        }
        error(ctx, "cannot return " + valueType + " from function '" + currentName
                + "' which returns " + currentReturnType);
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
