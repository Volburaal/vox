import java.util.*;

/**
 * Lowers a Vox parse tree into the flat, line-oriented IR that IRExecutor runs.
 * The TypeScript IRBuilder is a direct port: both engines must emit identical
 * IR for the same source.
 *
 * Every visit* method for an expression returns an operand: a literal, a
 * variable name or the name of a freshly allocated temporary.
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

    /**
     * A resolved assignment target: a variable (name set), or an item of a
     * list whose base and index operands have already been evaluated.
     */
    private static final class Place {
        final String name;
        final String list;
        final String index;
        Place(String name, String list, String index) {
            this.name = name;
            this.list = list;
            this.index = index;
        }
        boolean isName() { return name != null; }
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
            emitDefault(name, SemanticAnalyzer.typeName(ctx.datatype()));
        }
        return null;
    }

    @Override
    public String visitDeclReverse(VoxParser.DeclReverseContext ctx) {
        emit("set " + ctx.ID().getText() + " " + visit(ctx.expression()));
        return null;
    }

    @Override
    public String visitDeclLet(VoxParser.DeclLetContext ctx) {
        emit("set " + ctx.ID().getText() + " " + visit(ctx.expression()));
        return null;
    }

    /** `integer xs[5]` fills five defaults; `integer xs[]` is a new empty list. */
    @Override
    public String visitDeclSized(VoxParser.DeclSizedContext ctx) {
        String name = ctx.ID().getText();
        if (ctx.init != null) {
            emit("set " + name + " " + visit(ctx.init));
        } else if (ctx.size != null) {
            emit("list_fill " + name + " " + visit(ctx.size) + " "
                    + irType(SemanticAnalyzer.typeName(ctx.datatype())));
        } else {
            emit("list " + name);
        }
        return null;
    }

    @Override
    public String visitDeclListIs(VoxParser.DeclListIsContext ctx) {
        String name = ctx.ID().getText();
        if (ctx.init != null) emit("set " + name + " " + visit(ctx.init));
        else emit("list " + name);
        return null;
    }

    /** A variable declared without a value starts at its type's default. */
    private void emitDefault(String name, String type) {
        if (SemanticAnalyzer.isList(type)) emit("list " + name);
        else emit("set " + name + " " + defaultLiteral(type));
    }

    /** The literal a scalar variable starts with when declared without a value. */
    private static String defaultLiteral(String type) {
        switch (type) {
            case "integer":   return "0";
            case "float":     return "0.0";
            case "boolean":   return "false";
            case "string":
            case "character": return "\"\"";
            default:          return "0";
        }
    }

    /** The IR spells list types without spaces: `list<list<integer>>`. */
    private static String irType(String type) {
        return SemanticAnalyzer.isList(type)
                ? "list<" + irType(SemanticAnalyzer.elementOf(type)) + ">"
                : type;
    }

    // --------------------------------------------------------- assignments --

    @Override
    public String visitAssignForward(VoxParser.AssignForwardContext ctx) {
        String value = visit(ctx.expression());
        store(place(ctx.target()), value);
        return null;
    }

    @Override
    public String visitAssignReverse(VoxParser.AssignReverseContext ctx) {
        String value = visit(ctx.expression());
        store(place(ctx.target()), value);
        return null;
    }

    @Override
    public String visitSetTo(VoxParser.SetToContext ctx) {
        String value = visit(ctx.expression());
        store(place(ctx.target()), value);
        return null;
    }

    /**
     * Evaluates a target down to somewhere a value can be read or written:
     * a variable name, or a list operand plus an index operand. `2nd item of
     * xs` is xs with index 1.
     */
    private Place place(VoxParser.TargetContext target) {
        if (target instanceof VoxParser.NameTargetContext) {
            return new Place(((VoxParser.NameTargetContext) target).ID().getText(), null, null);
        }
        if (target instanceof VoxParser.IndexTargetContext) {
            VoxParser.IndexTargetContext indexed = (VoxParser.IndexTargetContext) target;
            String list = load(place(indexed.target()));
            String index = visit(indexed.expression());
            return new Place(null, list, index);
        }
        VoxParser.OrdinalTargetContext ordinal = (VoxParser.OrdinalTargetContext) target;
        String list = load(place(ordinal.target()));
        return new Place(null, list, String.valueOf(ordinalIndex(ordinal.ORDINAL().getText())));
    }

    /** Reads a place; a variable is its own operand, an item needs a fetch. */
    private String load(Place p) {
        if (p.isName()) return p.name;
        String dest = newTemp();
        emit("list_get " + dest + " " + p.list + " " + p.index);
        return dest;
    }

    private void store(Place p, String value) {
        if (p.isName()) emit("set " + p.name + " " + value);
        else emit("list_set " + p.list + " " + p.index + " " + value);
    }

    // ------------------------------------------------------------ updates --
    // `n += x` and every spoken spelling of it become one instruction whose
    // destination is also its first operand: `add n n x`. An item update
    // fetches, updates the temporary, and stores it back.

    @Override
    public String visitIncStmt(VoxParser.IncStmtContext ctx) {
        return update("add", ctx.target(), "1");
    }

    @Override
    public String visitDecStmt(VoxParser.DecStmtContext ctx) {
        return update("sub", ctx.target(), "1");
    }

    @Override
    public String visitOpAssign(VoxParser.OpAssignContext ctx) {
        String op;
        switch (ctx.op.getType()) {
            case VoxParser.ADD_ASSIGN: op = "add"; break;
            case VoxParser.SUB_ASSIGN: op = "sub"; break;
            case VoxParser.MUL_ASSIGN: op = "mul"; break;
            case VoxParser.DIV_ASSIGN: op = "div"; break;
            case VoxParser.MOD_ASSIGN: op = "mod"; break;
            default:                   op = "power"; break;
        }
        return update(op, ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitIncreaseBy(VoxParser.IncreaseByContext ctx) {
        return update("add", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitDecreaseBy(VoxParser.DecreaseByContext ctx) {
        return update("sub", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitAddTo(VoxParser.AddToContext ctx) {
        return update("add", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitTakeFrom(VoxParser.TakeFromContext ctx) {
        return update("sub", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitMultiplyBy(VoxParser.MultiplyByContext ctx) {
        return update("mul", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitDivideBy(VoxParser.DivideByContext ctx) {
        return update("div", ctx.target(), visit(ctx.expression()));
    }

    @Override
    public String visitDoubleStmt(VoxParser.DoubleStmtContext ctx) {
        return update("mul", ctx.target(), "2");
    }

    @Override
    public String visitHalveStmt(VoxParser.HalveStmtContext ctx) {
        return update("div", ctx.target(), "2");
    }

    private String update(String op, VoxParser.TargetContext target, String operand) {
        Place p = place(target);
        if (p.isName()) {
            emit(op + " " + p.name + " " + p.name + " " + operand);
            return null;
        }
        String current = load(p);
        emit(op + " " + current + " " + current + " " + operand);
        store(p, current);
        return null;
    }

    /** Swap through a temporary: three moves, no arithmetic. */
    @Override
    public String visitSwapStmt(VoxParser.SwapStmtContext ctx) {
        Place a = place(ctx.target(0));
        Place b = place(ctx.target(1));
        String first = load(a);
        String second = load(b);
        String t = newTemp();
        emit("set " + t + " " + first);
        store(a, second);
        store(b, t);
        return null;
    }

    // -------------------------------------------------------------- lists --

    @Override
    public String visitPushTo(VoxParser.PushToContext ctx) {
        String value = visit(ctx.expression(0));
        String list = visit(ctx.expression(1));
        if (ctx.AT() != null) {
            emit("list_insert " + list + " " + visit(ctx.expression(2)) + " " + value);
        } else {
            emit("list_push " + list + " " + value);
        }
        return null;
    }

    @Override
    public String visitInsertInto(VoxParser.InsertIntoContext ctx) {
        String value = visit(ctx.expression(0));
        String list = visit(ctx.expression(1));
        String index = visit(ctx.expression(2));
        emit("list_insert " + list + " " + index + " " + value);
        return null;
    }

    @Override
    public String visitPopExpr(VoxParser.PopExprContext ctx) {
        String list = visit(ctx.expression(0));
        String index = ctx.AT() != null ? " " + visit(ctx.expression(1)) : "";
        String dest = newTemp();
        emit("list_pop " + dest + " " + list + index);
        return dest;
    }

    // The call spellings: push(xs, v), insert(xs, i, v), pop(xs), pop(xs, i).

    @Override
    public String visitPushCall(VoxParser.PushCallContext ctx) {
        String list = visit(ctx.expression(0));
        String value = visit(ctx.expression(1));
        emit("list_push " + list + " " + value);
        return null;
    }

    @Override
    public String visitInsertCall(VoxParser.InsertCallContext ctx) {
        String list = visit(ctx.expression(0));
        String index = visit(ctx.expression(1));
        String value = visit(ctx.expression(2));
        emit("list_insert " + list + " " + index + " " + value);
        return null;
    }

    @Override
    public String visitPopCall(VoxParser.PopCallContext ctx) {
        String list = visit(ctx.expression(0));
        String index = ctx.expression().size() > 1 ? " " + visit(ctx.expression(1)) : "";
        String dest = newTemp();
        emit("list_pop " + dest + " " + list + index);
        return dest;
    }

    @Override
    public String visitIndexExpr(VoxParser.IndexExprContext ctx) {
        String list = visit(ctx.expression(0));
        String index = visit(ctx.expression(1));
        String dest = newTemp();
        emit("list_get " + dest + " " + list + " " + index);
        return dest;
    }

    @Override
    public String visitOrdinalExpr(VoxParser.OrdinalExprContext ctx) {
        String list = visit(ctx.expression());
        String dest = newTemp();
        emit("list_get " + dest + " " + list + " " + ordinalIndex(ctx.ORDINAL().getText()));
        return dest;
    }

    @Override
    public String visitListExpr(VoxParser.ListExprContext ctx) {
        List<String> items = new ArrayList<>();
        for (VoxParser.ExpressionContext e : ctx.expression()) items.add(visit(e));
        String dest = newTemp();
        StringBuilder sb = new StringBuilder("list ").append(dest);
        for (String item : items) sb.append(' ').append(item);
        emit(sb.toString());
        return dest;
    }

    @Override
    public String visitInExpr(VoxParser.InExprContext ctx) {
        String value = visit(ctx.expression(0));
        String list = visit(ctx.expression(1));
        String dest = newTemp();
        emit("list_has " + dest + " " + list + " " + value);
        if (ctx.op.getType() != VoxParser.NE) return dest;
        String inverted = newTemp();
        emit("not " + inverted + " " + dest);
        return inverted;
    }

    @Override
    public String visitContainsExpr(VoxParser.ContainsExprContext ctx) {
        String list = visit(ctx.expression(0));
        String value = visit(ctx.expression(1));
        String dest = newTemp();
        emit("list_has " + dest + " " + list + " " + value);
        return dest;
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
            visit(otherwise); // a block or the next `if` in the chain
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
        visit(ctx.forUpdate());
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    /**
     * `for i from a to b step s` is the classic loop with the condition and
     * update chosen by the direction word: `le`/`add` for `to`, `lt`/`add` for
     * `until`, `ge`/`sub` for `down to`.
     */
    @Override
    public String visitRangeLoop(VoxParser.RangeLoopContext ctx) {
        VoxParser.RangeClauseContext rc = ctx.rangeClause();
        String name = rc.ID().getText();
        String start = newLabel("for");
        String end = newLabel("endfor");
        String cont = newLabel("forcont");
        boolean down = rc.dir.getType() == VoxParser.DOWN_TO;
        String compare = down ? "ge" : rc.dir.getType() == VoxParser.UNTIL ? "lt" : "le";

        // Every bound is evaluated before the loop variable is assigned.
        String first = visit(rc.start);
        String limit = frozen(rc.limit);
        String step = rc.step != null ? frozen(rc.step) : "1";
        emit("set " + name + " " + first);

        emit("label " + start);
        String cond = newTemp();
        emit(compare + " " + cond + " " + name + " " + limit);
        emit("if_false " + cond + " goto " + end);
        loops.push(new LoopLabels(end, cont));
        visit(ctx.block());
        loops.pop();
        emit("label " + cont);
        emit((down ? "sub" : "add") + " " + name + " " + name + " " + step);
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    /**
     * `for each x in xs` walks the list by index. The length is re-read every
     * turn, so items pushed inside the body are visited too.
     */
    @Override
    public String visitForEachLoop(VoxParser.ForEachLoopContext ctx) {
        String name = ctx.ID().getText();
        String start = newLabel("foreach");
        String end = newLabel("endforeach");
        String cont = newLabel("foreachcont");

        String list = frozen(ctx.expression());
        String index = newTemp();
        emit("set " + index + " 0");

        emit("label " + start);
        String length = newTemp();
        emit("builtin " + length + " length " + list);
        String cond = newTemp();
        emit("lt " + cond + " " + index + " " + length);
        emit("if_false " + cond + " goto " + end);
        emit("list_get " + name + " " + list + " " + index);
        loops.push(new LoopLabels(end, cont));
        visit(ctx.block());
        loops.pop();
        emit("label " + cont);
        emit("add " + index + " " + index + " 1");
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    /**
     * Evaluates a loop bound once. A bound that is a plain variable is copied
     * into a temporary so the body cannot move the goalposts by reassigning
     * it; a literal or a computed temporary is already fixed.
     */
    private String frozen(VoxParser.ExpressionContext expr) {
        String value = visit(expr);
        VoxParser.ExpressionContext inner = expr;
        while (inner instanceof VoxParser.ParenExprContext) {
            inner = ((VoxParser.ParenExprContext) inner).expression();
        }
        if (!(inner instanceof VoxParser.IdExprContext)) return value;
        String copy = newTemp();
        emit("set " + copy + " " + value);
        return copy;
    }

    /** `repeat n times` counts a hidden temporary down from n to 1. */
    @Override
    public String visitRepeatTimes(VoxParser.RepeatTimesContext ctx) {
        String start = newLabel("repeat");
        String end = newLabel("endrepeat");
        String cont = newLabel("repcont");
        String counter = newTemp();
        emit("set " + counter + " " + visit(ctx.expression()));
        emit("label " + start);
        String cond = newTemp();
        emit("gt " + cond + " " + counter + " 0");
        emit("if_false " + cond + " goto " + end);
        loops.push(new LoopLabels(end, cont));
        visit(ctx.block());
        loops.pop();
        emit("label " + cont);
        emit("sub " + counter + " " + counter + " 1");
        emit("goto " + start);
        emit("label " + end);
        return null;
    }

    /** `repeat { } until (c)`: the body runs, then c decides whether to loop back. */
    @Override
    public String visitRepeatUntil(VoxParser.RepeatUntilContext ctx) {
        String start = newLabel("repeat");
        String end = newLabel("endrepeat");
        String cont = newLabel("repcont");
        emit("label " + start);
        loops.push(new LoopLabels(end, cont));
        visit(ctx.block());
        loops.pop();
        emit("label " + cont);
        String cond = visit(ctx.expression());
        emit("if_false " + cond + " goto " + start);
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

    /**
     * `print` writes exactly its arguments - no newline. `say` is the
     * line-form: it appends a "\n" operand, so both stay one IR instruction.
     */
    @Override
    public String visitPrintStatement(VoxParser.PrintStatementContext ctx) {
        StringBuilder sb = new StringBuilder("print");
        for (VoxParser.ExpressionContext e : ctx.expression()) {
            sb.append(' ').append(visit(e));
        }
        if (ctx.SAY() != null) sb.append(" \"\\n\"");
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
        emit("cast " + dest + " " + value + " " + SemanticAnalyzer.typeName(ctx.datatype()));
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

    /** `x squared` and `x cubed` are just powers with a literal exponent. */
    @Override
    public String visitSquaredExpr(VoxParser.SquaredExprContext ctx) {
        String value = visit(ctx.expression());
        String dest = newTemp();
        emit("power " + dest + " " + value + " " + (ctx.op.getType() == VoxParser.SQUARED ? 2 : 3));
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

    // ---- predicates lower to the comparisons they abbreviate; `is not` flips the test.

    @Override
    public String visitPredicateExpr(VoxParser.PredicateExprContext ctx) {
        String value = visit(ctx.expression());
        boolean negated = ctx.op.getType() == VoxParser.NE;
        int pred = ctx.pred.getType();
        if (pred == VoxParser.EVEN || pred == VoxParser.ODD) {
            boolean wantZero = (pred == VoxParser.EVEN) != negated;
            String m = newTemp();
            emit("mod " + m + " " + value + " 2");
            String dest = newTemp();
            emit((wantZero ? "eq" : "ne") + " " + dest + " " + m + " 0");
            return dest;
        }
        if (pred == VoxParser.EMPTY) {
            // Strings and lists alike: empty means length zero.
            String length = newTemp();
            emit("builtin " + length + " length " + value);
            String dest = newTemp();
            emit((negated ? "ne" : "eq") + " " + dest + " " + length + " 0");
            return dest;
        }
        String dest = newTemp();
        if (pred == VoxParser.POSITIVE) {
            emit((negated ? "le" : "gt") + " " + dest + " " + value + " 0");
        } else { // NEGATIVE
            emit((negated ? "ge" : "lt") + " " + dest + " " + value + " 0");
        }
        return dest;
    }

    @Override
    public String visitDivisibleExpr(VoxParser.DivisibleExprContext ctx) {
        String value = visit(ctx.expression(0));
        String divisor = visit(ctx.expression(1));
        String m = newTemp();
        emit("mod " + m + " " + value + " " + divisor);
        String dest = newTemp();
        emit((ctx.op.getType() == VoxParser.NE ? "ne" : "eq") + " " + dest + " " + m + " 0");
        return dest;
    }

    @Override
    public String visitBetweenExpr(VoxParser.BetweenExprContext ctx) {
        String value = visit(ctx.expression(0));
        String low = visit(ctx.low);
        String high = visit(ctx.high);
        String aboveLow = newTemp();
        emit("ge " + aboveLow + " " + value + " " + low);
        String belowHigh = newTemp();
        emit("le " + belowHigh + " " + value + " " + high);
        String dest = newTemp();
        emit("and " + dest + " " + aboveLow + " " + belowHigh);
        if (ctx.op.getType() != VoxParser.NE) return dest;
        String inverted = newTemp();
        emit("not " + inverted + " " + dest);
        return inverted;
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

    /** ask = print the prompt, then input. */
    @Override
    public String visitAskExpr(VoxParser.AskExprContext ctx) {
        emit("print " + visit(ctx.expression()));
        String dest = newTemp();
        emit("input " + dest);
        return dest;
    }

    @Override public String visitIdExpr(VoxParser.IdExprContext ctx)         { return ctx.getText(); }
    @Override public String visitIntExpr(VoxParser.IntExprContext ctx)       { return ctx.getText(); }
    @Override public String visitFloatExpr(VoxParser.FloatExprContext ctx)   { return ctx.getText(); }
    @Override public String visitBoolExpr(VoxParser.BoolExprContext ctx)     { return ctx.getText(); }
    @Override public String visitStringExpr(VoxParser.StringExprContext ctx) { return normalizeString(ctx.getText()); }

    /** `1st` is index 0, `2nd` is 1, and so on. The checker validated the suffix. */
    private static int ordinalIndex(String text) {
        return Integer.parseInt(text.replaceAll("[a-z]+$", "")) - 1;
    }

    /**
     * The IR spells every string double-quoted, so a single-quoted source
     * literal is re-emitted with double quotes (escaping any it contains).
     */
    private static String normalizeString(String text) {
        if (text.startsWith("\"")) return text;
        StringBuilder out = new StringBuilder("\"");
        for (int i = 1; i < text.length() - 1; i++) {
            char c = text.charAt(i);
            if (c == '\\') { out.append(c).append(text.charAt(++i)); continue; }
            if (c == '"') { out.append("\\\""); continue; }
            out.append(c);
        }
        return out.append('"').toString();
    }
}
