import java.util.*;
import org.antlr.v4.runtime.ParserRuleContext;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.tree.TerminalNode;

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
 *
 * Types are strings: the five scalars, "list of <type>" (nesting freely),
 * "any" for values only known at run time (input), "void" and "error".
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

    /** What a builtin accepts per parameter, and what it returns. */
    static final class BuiltinSpec {
        /** "num", "string", "sized" (string or list) or "list", per parameter. */
        final String[] params;
        /** A fixed type, "numeric" (float if any float) or "same" (the argument's type). */
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
        BUILTINS.put("length",    new BuiltinSpec("integer", "sized"));
        BUILTINS.put("uppercase", new BuiltinSpec("string",  "string"));
        BUILTINS.put("lowercase", new BuiltinSpec("string",  "string"));
        BUILTINS.put("copy",      new BuiltinSpec("same",    "list"));
    }

    /** Maps a spoken builtin token onto its symbolic name. */
    static String builtinNameOf(VoxParser.BuiltinNameContext ctx) {
        if (ctx.SQRT_OF() != null) return "sqrt";
        if (ctx.ABS_OF() != null) return "abs";
        if (ctx.LENGTH_OF() != null) return "length";
        if (ctx.FLOOR_OF() != null) return "floor";
        if (ctx.CEIL_OF() != null) return "ceiling";
        if (ctx.UPPER_OF() != null) return "uppercase";
        if (ctx.COPY_OF() != null) return "copy";
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

    /**
     * Declares a variable. A name cannot be reused while one is visible - in
     * this scope or any enclosing one - so no variable is ever shadowed.
     */
    private void declareVariable(ParserRuleContext ctx, String name, String type, String valueType) {
        if (declaredHere(name)) {
            error(ctx, "variable '" + name + "' is already declared in this scope");
        } else if (isVisible(name)) {
            error(ctx, "variable '" + name + "' is already declared in an enclosing scope");
        } else {
            define(name, type);
        }
        if (valueType != null) checkAssignable(ctx, type, valueType, name);
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
                out.add(typeName(p.datatype()));
            }
        }
        return out;
    }

    /** "void" for procedures, otherwise the type written. */
    private static String returnTypeOf(VoxParser.ReturnTypeContext ctx) {
        return ctx.VOID() != null ? "void" : typeName(ctx.datatype());
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
                    define(name, typeName(p.datatype()));
                }
            }
        }
        // The body's own scope; its locals cannot reuse a parameter's name.
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
        String valueType = ctx.expression() != null ? visit(ctx.expression()) : null;
        declareVariable(ctx, ctx.ID().getText(), typeName(ctx.datatype()), valueType);
        return null;
    }

    @Override
    public String visitDeclReverse(VoxParser.DeclReverseContext ctx) {
        String valueType = visit(ctx.expression());
        declareVariable(ctx, ctx.ID().getText(), typeName(ctx.datatype()), valueType);
        return null;
    }

    /** `let x be 5` declares x with the type of its value. */
    @Override
    public String visitDeclLet(VoxParser.DeclLetContext ctx) {
        String valueType = visit(ctx.expression());
        if (listOf("any").equals(valueType)) {
            error(ctx, "the type of [] cannot be inferred; declare the list with a type instead");
        }
        if (valueType == null || "error".equals(valueType)) valueType = "any";
        declareVariable(ctx, ctx.ID().getText(), valueType, null);
        return null;
    }

    /** `integer xs[5]`: a list of that many defaults; `integer xs[]`: empty. */
    @Override
    public String visitDeclSized(VoxParser.DeclSizedContext ctx) {
        String type = listOf(typeName(ctx.datatype()));
        if (ctx.size != null) {
            String sizeType = visit(ctx.size);
            if (sizeType != null && !"error".equals(sizeType) && !"any".equals(sizeType)
                    && !"integer".equals(sizeType)) {
                error(ctx.size, "list size must be an integer but got " + sizeType);
            }
        }
        String valueType = ctx.init != null ? visit(ctx.init) : null;
        if (ctx.size != null && ctx.init != null) {
            error(ctx, "give a list a size or an initial value, not both");
        }
        declareVariable(ctx, ctx.ID().getText(), type, valueType);
        return null;
    }

    /** `xs is a list of integers`. */
    @Override
    public String visitDeclListIs(VoxParser.DeclListIsContext ctx) {
        String type = listOf(typeName(ctx.datatype()));
        String valueType = ctx.init != null ? visit(ctx.init) : null;
        declareVariable(ctx, ctx.ID().getText(), type, valueType);
        return null;
    }

    // --------------------------------------------------------- assignments --

    @Override
    public String visitAssignForward(VoxParser.AssignForwardContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    }

    @Override
    public String visitAssignReverse(VoxParser.AssignReverseContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    }

    @Override
    public String visitSetTo(VoxParser.SetToContext ctx) {
        String valueType = visit(ctx.expression());
        checkAssignTarget(ctx, ctx.target(), valueType);
        return null;
    }

    private void checkAssignTarget(ParserRuleContext ctx, VoxParser.TargetContext target, String valueType) {
        String targetType = typeOfTarget(target);
        if (targetType == null) return; // already reported
        checkAssignable(ctx, targetType, valueType, target.getText());
    }

    /**
     * The type a target holds: a variable's declared type, or a list's item
     * type for `xs[i]` and `2nd item of xs`. Null once a problem is reported.
     */
    private String typeOfTarget(VoxParser.TargetContext target) {
        if (target instanceof VoxParser.NameTargetContext) {
            String name = ((VoxParser.NameTargetContext) target).ID().getText();
            if (!isVisible(name)) {
                error(target, "variable '" + name + "' is not declared");
                return null;
            }
            return typeOf(name);
        }
        if (target instanceof VoxParser.IndexTargetContext) {
            VoxParser.IndexTargetContext indexed = (VoxParser.IndexTargetContext) target;
            String base = typeOfTarget(indexed.target());
            requireIndex(indexed.expression(), visit(indexed.expression()));
            return itemTypeOf(indexed, base);
        }
        VoxParser.OrdinalTargetContext ordinal = (VoxParser.OrdinalTargetContext) target;
        checkOrdinal(ordinal, ordinal.ORDINAL());
        return itemTypeOf(ordinal, typeOfTarget(ordinal.target()));
    }

    /** The item type of a list type; reports when the base is not a list. */
    private String itemTypeOf(ParserRuleContext ctx, String base) {
        if (base == null || "error".equals(base)) return null;
        if ("any".equals(base)) return "any";
        if (!isList(base)) {
            error(ctx, "cannot index " + base + "; only lists have items");
            return null;
        }
        return elementOf(base);
    }

    private void requireIndex(ParserRuleContext ctx, String t) {
        if (t == null || "error".equals(t) || "any".equals(t) || "integer".equals(t)) return;
        error(ctx, "index must be an integer but got " + t);
    }

    /** `1st`, `2nd`, `3rd`, `4th`...: the suffix must be the English one. */
    private void checkOrdinal(ParserRuleContext ctx, TerminalNode token) {
        String text = token.getText();
        int n = Integer.parseInt(text.replaceAll("[a-z]+$", ""));
        if (n == 0) {
            error(ctx, "there is no 0th item; the first is the 1st, or index 0");
            return;
        }
        String want = ordinalSuffix(n);
        if (!text.endsWith(want)) {
            error(ctx, "'" + text + "' should be '" + n + want + "'");
        }
    }

    /** Reports a narrowing or otherwise lossy assignment as a warning, not an error. */
    private void checkAssignable(ParserRuleContext ctx, String target, String value, String name) {
        if (target == null || value == null) return;
        switch (fits(target, value)) {
            case "ok": return;
            case "narrow":
                warn(ctx, "implicit cast float -> integer assigning to '" + name + "' loses precision");
                return;
            default:
                error(ctx, "cannot assign " + value + " to " + target + " '" + name + "'");
        }
    }

    /** Each value must fit the other variable's declared type. */
    @Override
    public String visitSwapStmt(VoxParser.SwapStmtContext ctx) {
        VoxParser.TargetContext a = ctx.target(0);
        VoxParser.TargetContext b = ctx.target(1);
        String ta = typeOfTarget(a);
        String tb = typeOfTarget(b);
        if (ta == null || tb == null) return null;
        checkAssignable(ctx, ta, tb, a.getText());
        checkAssignable(ctx, tb, ta, b.getText());
        return null;
    }

    private static boolean isNumeric(String t) {
        return "integer".equals(t) || "float".equals(t);
    }

    // ------------------------------------------------------------ updates --
    // Every spoken form is checked as its symbolic twin: `add 3 to n` is `n += 3`.

    @Override
    public String visitIncStmt(VoxParser.IncStmtContext ctx) {
        return checkUpdate(ctx, ctx.target(), "++", "integer");
    }

    @Override
    public String visitDecStmt(VoxParser.DecStmtContext ctx) {
        return checkUpdate(ctx, ctx.target(), "--", "integer");
    }

    @Override
    public String visitOpAssign(VoxParser.OpAssignContext ctx) {
        return checkUpdate(ctx, ctx.target(), ctx.op.getText(), visit(ctx.expression()));
    }

    @Override
    public String visitIncreaseBy(VoxParser.IncreaseByContext ctx) {
        return checkUpdate(ctx, ctx.target(), "+=", visit(ctx.expression()));
    }

    @Override
    public String visitDecreaseBy(VoxParser.DecreaseByContext ctx) {
        return checkUpdate(ctx, ctx.target(), "-=", visit(ctx.expression()));
    }

    @Override
    public String visitAddTo(VoxParser.AddToContext ctx) {
        return checkUpdate(ctx, ctx.target(), "+=", visit(ctx.expression()));
    }

    @Override
    public String visitTakeFrom(VoxParser.TakeFromContext ctx) {
        return checkUpdate(ctx, ctx.target(), "-=", visit(ctx.expression()));
    }

    @Override
    public String visitMultiplyBy(VoxParser.MultiplyByContext ctx) {
        return checkUpdate(ctx, ctx.target(), "*=", visit(ctx.expression()));
    }

    @Override
    public String visitDivideBy(VoxParser.DivideByContext ctx) {
        return checkUpdate(ctx, ctx.target(), "/=", visit(ctx.expression()));
    }

    @Override
    public String visitDoubleStmt(VoxParser.DoubleStmtContext ctx) {
        return checkUpdate(ctx, ctx.target(), "double", "integer");
    }

    @Override
    public String visitHalveStmt(VoxParser.HalveStmtContext ctx) {
        return checkUpdate(ctx, ctx.target(), "halve", "integer");
    }

    /** `x op= value` is checked exactly like `x = x op value`. */
    private String checkUpdate(ParserRuleContext ctx, VoxParser.TargetContext target,
                               String op, String valueType) {
        String targetType = typeOfTarget(target);
        if (targetType == null) return null;
        String name = target.getText();
        String result;
        if (op.equals("++") || op.equals("--") || op.equals("double") || op.equals("halve")) {
            if (!isNumeric(targetType)) {
                error(ctx, "operator '" + op + "' cannot be applied to " + targetType);
                return null;
            }
            result = targetType;
        } else if (op.equals("+=") && isList(targetType)) {
            error(ctx, "to add an item to a list, use 'push ... to " + name + "'");
            return null;
        } else if (op.equals("+=") && ("string".equals(targetType) || "string".equals(valueType))) {
            result = "string"; // '+' doubles as string concatenation
        } else {
            result = arithmetic(ctx, targetType, valueType, op);
        }
        checkAssignable(ctx, targetType, result, name);
        return null;
    }

    // -------------------------------------------------------------- lists --

    @Override
    public String visitPushTo(VoxParser.PushToContext ctx) {
        String valueType = visit(ctx.expression(0));
        String listType = visit(ctx.expression(1));
        if (ctx.AT() != null) requireIndex(ctx.expression(2), visit(ctx.expression(2)));
        checkListOp(ctx, "push", listType, valueType);
        return null;
    }

    @Override
    public String visitInsertInto(VoxParser.InsertIntoContext ctx) {
        String valueType = visit(ctx.expression(0));
        String listType = visit(ctx.expression(1));
        requireIndex(ctx.expression(2), visit(ctx.expression(2)));
        checkListOp(ctx, "insert", listType, valueType);
        return null;
    }

    /** push(xs, v) and insert(xs, i, v): the call spellings of the statements above. */
    @Override
    public String visitPushCall(VoxParser.PushCallContext ctx) {
        String listType = visit(ctx.expression(0));
        String valueType = visit(ctx.expression(1));
        checkListOp(ctx, "push", listType, valueType);
        return null;
    }

    @Override
    public String visitInsertCall(VoxParser.InsertCallContext ctx) {
        String listType = visit(ctx.expression(0));
        requireIndex(ctx.expression(1), visit(ctx.expression(1)));
        String valueType = visit(ctx.expression(2));
        checkListOp(ctx, "insert", listType, valueType);
        return null;
    }

    /** The list operand must be a list, and the value must fit its items. */
    private void checkListOp(ParserRuleContext ctx, String op, String listType, String valueType) {
        if (listType == null || "error".equals(listType) || "any".equals(listType)) return;
        if (!isList(listType)) {
            error(ctx, "'" + op + "' needs a list but got " + listType);
            return;
        }
        if (valueType != null && !"ok".equals(fits(elementOf(listType), valueType))) {
            error(ctx, "cannot " + op + " " + valueType + " into " + listType);
        }
    }

    @Override
    public String visitPopExpr(VoxParser.PopExprContext ctx) {
        String listType = visit(ctx.expression(0));
        if (ctx.AT() != null) requireIndex(ctx.expression(1), visit(ctx.expression(1)));
        return popResult(ctx, listType);
    }

    /** pop(xs) and pop(xs, i): the call spelling. */
    @Override
    public String visitPopCall(VoxParser.PopCallContext ctx) {
        String listType = visit(ctx.expression(0));
        if (ctx.expression().size() > 1) {
            requireIndex(ctx.expression(1), visit(ctx.expression(1)));
        }
        return popResult(ctx, listType);
    }

    private String popResult(ParserRuleContext ctx, String listType) {
        if (listType == null || "error".equals(listType)) return "error";
        if ("any".equals(listType)) return "any";
        if (!isList(listType)) {
            error(ctx, "'pop' needs a list but got " + listType);
            return "error";
        }
        return elementOf(listType);
    }

    @Override
    public String visitIndexExpr(VoxParser.IndexExprContext ctx) {
        String base = visit(ctx.expression(0));
        requireIndex(ctx.expression(1), visit(ctx.expression(1)));
        String t = itemTypeOf(ctx, base);
        return t == null ? "error" : t;
    }

    @Override
    public String visitOrdinalExpr(VoxParser.OrdinalExprContext ctx) {
        checkOrdinal(ctx, ctx.ORDINAL());
        String t = itemTypeOf(ctx, visit(ctx.expression()));
        return t == null ? "error" : t;
    }

    /** `[1, 2, 3]` is a list of integer; `[]` is a list of any until it is given a type. */
    @Override
    public String visitListExpr(VoxParser.ListExprContext ctx) {
        String element = null;
        for (VoxParser.ExpressionContext e : ctx.expression()) {
            String t = visit(e);
            if (t == null || "error".equals(t)) return "error";
            if ("any".equals(t)) continue;
            if (element == null || t.equals(element)) {
                element = t;
            } else if ("ok".equals(fits(element, t)) && "ok".equals(fits(t, element))) {
                // `[[], [1]]`: an empty inner list takes the type of a full one.
                if (element.contains("any")) element = t;
            } else {
                error(e, "list items must all have the same type; got " + element + " and " + t);
                return "error";
            }
        }
        return listOf(element == null ? "any" : element);
    }

    @Override
    public String visitInExpr(VoxParser.InExprContext ctx) {
        String valueType = visit(ctx.expression(0));
        String listType = visit(ctx.expression(1));
        checkContains(ctx, ctx.op.getType() == VoxParser.NE ? "is not in" : "is in", listType, valueType);
        return "boolean";
    }

    @Override
    public String visitContainsExpr(VoxParser.ContainsExprContext ctx) {
        String listType = visit(ctx.expression(0));
        String valueType = visit(ctx.expression(1));
        checkContains(ctx, "contains", listType, valueType);
        return "boolean";
    }

    private void checkContains(ParserRuleContext ctx, String op, String listType, String valueType) {
        if (listType == null || "error".equals(listType) || "any".equals(listType)) return;
        if (!isList(listType)) {
            error(ctx, "operator '" + op + "' needs a list but got " + listType);
            return;
        }
        if (valueType != null && !"error".equals(valueType) && !"any".equals(valueType)
                && "no".equals(fits(elementOf(listType), valueType))) {
            error(ctx, "operator '" + op + "' cannot look for " + valueType + " in " + listType);
        }
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
        String varType = rc.datatype() != null ? typeName(rc.datatype()) : "integer";
        // The bounds are evaluated before the loop variable exists.
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
        declareVariable(rc, name, varType, null);
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

    /** `for each x in xs`: x is a fresh variable holding a copy of each item. */
    @Override
    public String visitForEachLoop(VoxParser.ForEachLoopContext ctx) {
        String listType = visit(ctx.expression());
        String element = "any";
        if (listType != null && !"error".equals(listType) && !"any".equals(listType)) {
            if (isList(listType)) {
                element = elementOf(listType);
            } else {
                error(ctx.expression(), "for each needs a list but got " + listType);
            }
        }

        String name = ctx.ID().getText();
        VoxParser.DatatypeContext declared = ctx.datatype();
        String varType = declared != null ? typeName(declared) : element;
        if (declared != null && !"any".equals(element) && !"ok".equals(fits(varType, element))) {
            error(declared, "loop variable '" + name + "' is " + varType + " but the list holds " + element);
        }

        enterScope();
        declareVariable(ctx, name, varType, null);
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
        } else if (!(e instanceof VoxParser.CallExprContext) && !(e instanceof VoxParser.InputExprContext)
                && !(e instanceof VoxParser.PopExprContext) && !(e instanceof VoxParser.PopCallContext)) {
            warn(e, "expression has no effect");
        }
        return null;
    }

    private void requireCondition(VoxParser.ExpressionContext ctx) {
        String t = visit(ctx);
        if ("string".equals(t) || (t != null && isList(t))) {
            warn(ctx, "condition has type " + t + "; it is true when non-empty");
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
        String target = typeName(ctx.datatype());
        if ("error".equals(source)) return "error";
        if (isList(target)) {
            error(ctx, "cannot convert to " + target);
            return "error";
        }
        if (source != null && isList(source) && !"string".equals(target)) {
            error(ctx, "cannot convert " + source + " to " + target);
            return "error";
        }
        return target;
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

    private String arithmetic(ParserRuleContext ctx, String l, String r, String op) {
        if ("error".equals(l) || "error".equals(r)) return "error";
        if ("any".equals(l) || "any".equals(r)) return "any";
        if (l != null && r != null && isNumeric(l) && isNumeric(r)) {
            return ("float".equals(l) || "float".equals(r)) ? "float" : "integer";
        }
        error(ctx, "operator '" + op + "' cannot be applied to " + l + " and " + r);
        return "error";
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
                ok = "string".equals(t) || "character".equals(t) || isList(t);
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
                    || (l.equals(r) && (!ordered || (!"boolean".equals(l) && !isList(l)))));
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
            if (got == null) continue;
            switch (fits(want, got)) {
                case "ok": break;
                case "narrow":
                    warn(ctx, "argument " + (i + 1) + " of '" + name
                            + "': implicit cast float -> integer loses precision");
                    break;
                default:
                    error(ctx, "argument " + (i + 1) + " of '" + name + "' expects "
                            + want + " but got " + got);
            }
        }
        return sig.returnType;
    }

    /** Arity and type checks for a builtin; returns its result type. */
    private String checkBuiltin(ParserRuleContext ctx, String name, List<String> argTypes) {
        BuiltinSpec spec = BUILTINS.get(name);
        String result = spec.result;
        if ("same".equals(result)) {
            String t = argTypes.isEmpty() ? null : argTypes.get(0);
            result = (t == null || "error".equals(t)) ? "any" : t;
        } else if ("numeric".equals(result)) {
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
            boolean ok;
            String want;
            switch (kind) {
                case "num":    ok = isNumeric(got); want = "a number"; break;
                case "string": ok = "string".equals(got) || "character".equals(got); want = "string"; break;
                case "list":   ok = isList(got); want = "a list"; break;
                default:       ok = "string".equals(got) || "character".equals(got) || isList(got);
                               want = "a string or a list"; break;
            }
            if (!ok) {
                error(ctx, "argument " + (i + 1) + " of '" + name + "' expects " + want + " but got " + got);
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
        if (valueType == null) return null;
        switch (fits(currentReturnType, valueType)) {
            case "ok": return null;
            case "narrow":
                warn(ctx, "implicit cast float -> integer in return from '" + currentName + "' loses precision");
                return null;
            default:
                error(ctx, "cannot return " + valueType + " from function '" + currentName
                        + "' which returns " + currentReturnType);
                return null;
        }
    }

    // ---------------------------------------------------------------- types --

    static boolean isList(String t) {
        return t.startsWith("list of ");
    }

    static String listOf(String element) {
        return "list of " + element;
    }

    static String elementOf(String listType) {
        return listType.substring("list of ".length());
    }

    /**
     * Whether a value of type `value` may be stored where `target` is
     * expected: "ok", "narrow" (float into integer - legal with a warning) or
     * "no". Lists must match item for item; only "any" (an empty literal, or
     * input) is a wildcard.
     */
    static String fits(String target, String value) {
        if ("error".equals(value)) return "ok"; // already reported elsewhere
        if (target.equals(value)) return "ok";
        if ("any".equals(target) || "any".equals(value)) return "ok";
        if (isList(target) && isList(value)) {
            return "ok".equals(fits(elementOf(target), elementOf(value))) ? "ok" : "no";
        }
        if (isNumeric(target) && isNumeric(value)) {
            return "integer".equals(target) && "float".equals(value) ? "narrow" : "ok";
        }
        return "no";
    }

    /** The English suffix for an ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st... */
    static String ordinalSuffix(int n) {
        int tens = n % 100;
        if (tens >= 11 && tens <= 13) return "th";
        switch (n % 10) {
            case 1:  return "st";
            case 2:  return "nd";
            case 3:  return "rd";
            default: return "th";
        }
    }

    /** The type a `datatype` node spells: a scalar, or `list of <type>`. */
    static String typeName(VoxParser.DatatypeContext ctx) {
        if (ctx instanceof VoxParser.ListTypeContext) {
            return listOf(typeName(((VoxParser.ListTypeContext) ctx).datatype()));
        }
        return canonical(ctx.getText());
    }

    /** Maps every spelling of a scalar type onto one canonical name. */
    static String canonical(String written) {
        String t = written.trim().replaceAll("\\s+", " ");
        switch (t) {
            case "int": case "integer": case "integers": case "number": case "numbers":
            case "whole number": case "whole numbers":
                return "integer";
            case "float": case "floats": case "floating point number": case "floating point numbers":
                return "float";
            case "bool": case "bools": case "boolean": case "booleans":
            case "boolean number": case "boolean numbers":
                return "boolean";
            case "char": case "chars": case "character": case "characters":
                return "character";
            case "string": case "strings": case "character string": case "character strings":
            case "varchar":
                return "string";
            default:
                return t;
        }
    }
}
