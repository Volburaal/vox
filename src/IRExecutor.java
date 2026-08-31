import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.*;

/**
 * Executes the IR produced by IRBuilder.
 *
 * Instruction set
 *   func_start <name>              marks a function entry
 *   func_end   <name>              implicit `return` with no value
 *   param <index> <name>           binds incoming argument #index to <name>
 *   set <var> <operand>
 *   input <dest>
 *   print <operand>...            writes the operands; no newline is added
 *   not|neg <dest> <operand>
 *   add|sub|mul|div|mod|power <dest> <left> <right>
 *   eq|ne|lt|gt|le|ge <dest> <left> <right>
 *   and|or <dest> <left> <right>
 *   cast <dest> <operand> <type>
 *   builtin <dest> <name> [operand...]
 *   if_false <cond> goto <label>
 *   goto <label>
 *   label <label>
 *   call <func> [arg...] -> <dest>
 *   return [operand]
 *
 * Storage model
 *   Each call gets its own frame holding its own locals. Lookups never walk
 *   into a caller's frame, so scoping is lexical and recursion works.
 *
 * Output and input go through the Sink/Source interfaces rather than straight
 * to System.out/System.in, so a non-console host (a browser, a test harness)
 * can supply its own.
 */
public class IRExecutor {

    /** Raised for anything the program does wrong at run time. */
    public static class VoxRuntimeError extends RuntimeException {
        public VoxRuntimeError(String message) { super(message); }
    }

    public interface Sink   { void write(String text); }
    public interface Source { String readLine(); }

    private static final long DEFAULT_STEP_LIMIT = 50_000_000L;

    private final List<String> instructions;
    private final Map<String, Integer> labelToIndex = new HashMap<>();
    private final Map<String, Integer> functionToIndex = new HashMap<>();

    // print adds no newline, so flush per write to keep prompts visible.
    private Sink output = text -> { System.out.print(text); System.out.flush(); };
    private Source input = new Source() {
        private BufferedReader reader;
        @Override public String readLine() {
            try {
                if (reader == null) reader = new BufferedReader(new InputStreamReader(System.in));
                // The prompt goes to stderr so redirecting stdout captures
                // only what the program actually printed.
                System.err.print("> ");
                System.err.flush();
                String line = reader.readLine();
                return line == null ? "" : line;
            } catch (Exception e) {
                throw new VoxRuntimeError("could not read input: " + e.getMessage());
            }
        }
    };
    private long stepLimit = DEFAULT_STEP_LIMIT;

    /** One activation record. Locals are private to this frame. */
    private static final class Frame {
        final int returnPc;
        final String destVar;
        final List<Object> args;
        final Map<String, Object> locals = new HashMap<>();
        Frame(int returnPc, String destVar, List<Object> args) {
            this.returnPc = returnPc;
            this.destVar = destVar;
            this.args = args;
        }
    }

    private final Deque<Frame> callStack = new ArrayDeque<>();

    public IRExecutor(List<String> instructions) {
        this.instructions = new ArrayList<>(instructions);
        preprocess();
    }

    public IRExecutor withOutput(Sink sink)     { this.output = sink; return this; }
    public IRExecutor withInput(Source source)  { this.input = source; return this; }
    public IRExecutor withStepLimit(long limit) { this.stepLimit = limit; return this; }

    private void preprocess() {
        for (int i = 0; i < instructions.size(); i++) {
            String[] t = tokenize(instructions.get(i));
            if (t.length < 2) continue;
            if ("label".equals(t[0]))           labelToIndex.put(t[1], i);
            else if ("func_start".equals(t[0])) functionToIndex.put(t[1], i);
        }
    }

    // ---------------------------------------------------------- execution --

    public void execute() {
        Integer mainIndex = functionToIndex.get("main");
        if (mainIndex == null) throw new VoxRuntimeError("program has no main function");

        // Start inside main rather than at instruction 0, which would otherwise
        // fall into whichever function happens to be emitted first.
        callStack.push(new Frame(-1, null, Collections.emptyList()));
        int pc = mainIndex + 1;
        long steps = 0;

        while (pc >= 0 && pc < instructions.size()) {
            if (++steps > stepLimit) {
                throw new VoxRuntimeError(
                        "execution step limit exceeded (" + stepLimit + "); the program is probably looping forever");
            }

            String raw = instructions.get(pc).trim();
            if (raw.isEmpty()) { pc++; continue; }
            String[] toks = tokenize(raw);

            switch (toks[0]) {
                case "func_start":
                case "label":
                    pc++;
                    break;

                case "func_end": {
                    // Falling off the end of a function returns nothing.
                    pc = doReturn(null);
                    if (pc == -1) return;
                    break;
                }

                case "param": {
                    require(toks, 3, raw);
                    int index = Integer.parseInt(toks[1]);
                    List<Object> args = frame().args;
                    frame().locals.put(toks[2], index < args.size() ? args.get(index) : null);
                    pc++;
                    break;
                }

                case "set": {
                    require(toks, 3, raw);
                    frame().locals.put(toks[1], resolve(toks[2]));
                    pc++;
                    break;
                }

                case "input": {
                    require(toks, 2, raw);
                    frame().locals.put(toks[1], coerceInput(input.readLine()));
                    pc++;
                    break;
                }

                case "print": {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i < toks.length; i++) sb.append(display(resolve(toks[i])));
                    output.write(sb.toString());
                    pc++;
                    break;
                }

                case "not": {
                    require(toks, 3, raw);
                    frame().locals.put(toks[1], !truthy(resolve(toks[2])));
                    pc++;
                    break;
                }

                case "neg": {
                    require(toks, 3, raw);
                    frame().locals.put(toks[1], negate(resolve(toks[2])));
                    pc++;
                    break;
                }

                case "add": case "sub": case "mul":
                case "div": case "mod": case "power": {
                    require(toks, 4, raw);
                    frame().locals.put(toks[1], arithmetic(toks[0], resolve(toks[2]), resolve(toks[3])));
                    pc++;
                    break;
                }

                case "eq": case "ne": case "lt":
                case "gt": case "le": case "ge": {
                    require(toks, 4, raw);
                    frame().locals.put(toks[1], compare(toks[0], resolve(toks[2]), resolve(toks[3])));
                    pc++;
                    break;
                }

                case "and": case "or": {
                    require(toks, 4, raw);
                    boolean l = truthy(resolve(toks[2]));
                    boolean r = truthy(resolve(toks[3]));
                    frame().locals.put(toks[1], "and".equals(toks[0]) ? (l && r) : (l || r));
                    pc++;
                    break;
                }

                case "cast": {
                    require(toks, 4, raw);
                    frame().locals.put(toks[1], cast(resolve(toks[2]), toks[3]));
                    pc++;
                    break;
                }

                case "builtin": {
                    require(toks, 3, raw);
                    List<Object> args = new ArrayList<>();
                    for (int i = 3; i < toks.length; i++) args.add(resolve(toks[i]));
                    frame().locals.put(toks[1], builtin(toks[2], args));
                    pc++;
                    break;
                }

                case "if_false": {
                    require(toks, 4, raw);
                    if (!"goto".equals(toks[2])) throw new VoxRuntimeError("malformed if_false: " + raw);
                    pc = truthy(resolve(toks[1])) ? pc + 1 : labelIndex(toks[3]);
                    break;
                }

                case "goto": {
                    require(toks, 2, raw);
                    pc = labelIndex(toks[1]);
                    break;
                }

                case "call": {
                    int arrow = -1;
                    for (int i = 2; i < toks.length; i++) if ("->".equals(toks[i])) arrow = i;
                    if (arrow == -1 || arrow + 1 >= toks.length) {
                        throw new VoxRuntimeError("malformed call: " + raw);
                    }
                    String name = toks[1];
                    Integer target = functionToIndex.get(name);
                    if (target == null) throw new VoxRuntimeError("unknown function: " + name);

                    List<Object> args = new ArrayList<>();
                    for (int i = 2; i < arrow; i++) args.add(resolve(toks[i]));

                    callStack.push(new Frame(pc + 1, toks[arrow + 1], args));
                    pc = target + 1;
                    break;
                }

                case "return": {
                    Object value = toks.length >= 2 ? resolve(toks[1]) : null;
                    pc = doReturn(value);
                    if (pc == -1) return;
                    break;
                }

                default:
                    throw new VoxRuntimeError("unknown instruction '" + toks[0] + "' in: " + raw);
            }
        }
    }

    /** Pops the current frame. Returns the resume pc, or -1 if the program is done. */
    private int doReturn(Object value) {
        Frame finished = callStack.pop();
        if (callStack.isEmpty()) return -1; // returned out of main
        if (finished.destVar != null) callStack.peek().locals.put(finished.destVar, value);
        return finished.returnPc;
    }

    private Frame frame() { return callStack.peek(); }

    private int labelIndex(String label) {
        Integer target = labelToIndex.get(label);
        if (target == null) throw new VoxRuntimeError("unknown label: " + label);
        return target + 1;
    }

    private static void require(String[] toks, int n, String raw) {
        if (toks.length < n) throw new VoxRuntimeError("malformed instruction: " + raw);
    }

    // ------------------------------------------------------------- values --

    /** Splits on whitespace, keeping quoted strings (and their escapes) intact. */
    static String[] tokenize(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuote = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuote && c == '\\' && i + 1 < line.length()) {
                cur.append(c).append(line.charAt(++i)); // keep the escape pair together
                continue;
            }
            if (c == '"') {
                cur.append(c);
                inQuote = !inQuote;
                continue;
            }
            if (!inQuote && Character.isWhitespace(c)) {
                if (cur.length() > 0) { out.add(cur.toString()); cur.setLength(0); }
                continue;
            }
            cur.append(c);
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out.toArray(new String[0]);
    }

    private Object resolve(String token) {
        if (token == null || token.isEmpty()) return null;

        if (token.length() >= 2 && token.charAt(0) == '"' && token.endsWith("\"")) {
            return unescape(token.substring(1, token.length() - 1));
        }
        if ("true".equals(token))  return Boolean.TRUE;
        if ("false".equals(token)) return Boolean.FALSE;

        char c0 = token.charAt(0);
        if (c0 == '-' || (c0 >= '0' && c0 <= '9')) {
            try {
                if (token.indexOf('.') >= 0) return Double.valueOf(token);
                return Integer.valueOf(token);
            } catch (NumberFormatException ignored) {
                // not a literal after all; fall through to a variable lookup
            }
        }
        return frame().locals.get(token);
    }

    private static String unescape(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c != '\\' || i + 1 >= s.length()) { sb.append(c); continue; }
            char next = s.charAt(++i);
            switch (next) {
                case 'n':  sb.append('\n'); break;
                case 't':  sb.append('\t'); break;
                case 'r':  sb.append('\r'); break;
                case '"':  sb.append('"');  break;
                case '\\': sb.append('\\'); break;
                default:   sb.append(next); break;
            }
        }
        return sb.toString();
    }

    private static Object coerceInput(String line) {
        if (line == null) return "";
        String t = line.trim();
        if (t.matches("-?\\d+")) {
            try { return Integer.valueOf(t); } catch (NumberFormatException ignored) { }
        }
        if (t.matches("-?\\d*\\.\\d+")) {
            try { return Double.valueOf(t); } catch (NumberFormatException ignored) { }
        }
        if ("true".equalsIgnoreCase(t) || "false".equalsIgnoreCase(t)) {
            return Boolean.parseBoolean(t);
        }
        return line;
    }

    private static String display(Object o) { return o == null ? "null" : String.valueOf(o); }

    private static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof Boolean) return (Boolean) o;
        if (o instanceof Integer) return (Integer) o != 0;
        if (o instanceof Double)  return (Double) o != 0.0;
        if (o instanceof String)  return !((String) o).isEmpty();
        return true;
    }

    private static boolean isNumber(Object o) { return o instanceof Integer || o instanceof Double; }
    private static double toDouble(Object o)  { return ((Number) o).doubleValue(); }

    private static Object negate(Object v) {
        if (v instanceof Integer) return -((Integer) v);
        if (v instanceof Double)  return -((Double) v);
        throw new VoxRuntimeError("operator '-' needs a number but got " + describe(v));
    }

    private static Object arithmetic(String op, Object left, Object right) {
        // '+' doubles as string concatenation.
        if ("add".equals(op) && (left instanceof String || right instanceof String)) {
            return display(left) + display(right);
        }
        if (!isNumber(left) || !isNumber(right)) {
            throw new VoxRuntimeError("operator '" + op + "' needs numbers but got "
                    + describe(left) + " and " + describe(right));
        }

        boolean useDouble = left instanceof Double || right instanceof Double;

        if ("power".equals(op)) {
            double result = Math.pow(toDouble(left), toDouble(right));
            if (Double.isNaN(result)) {
                throw new VoxRuntimeError("power produced an undefined result: "
                        + display(left) + " ^ " + display(right));
            }
            // An all-integer power with a non-negative exponent stays an integer.
            if (!useDouble && (Integer) right >= 0) return (int) result;
            return result;
        }

        if (useDouble) {
            double l = toDouble(left), r = toDouble(right);
            switch (op) {
                case "add": return l + r;
                case "sub": return l - r;
                case "mul": return l * r;
                case "div": if (r == 0.0) throw new VoxRuntimeError("division by zero"); return l / r;
                case "mod": if (r == 0.0) throw new VoxRuntimeError("modulo by zero");   return l % r;
                default: throw new VoxRuntimeError("unknown arithmetic op: " + op);
            }
        }

        int l = (Integer) left, r = (Integer) right;
        switch (op) {
            case "add": return l + r;
            case "sub": return l - r;
            case "mul": return l * r;
            case "div": if (r == 0) throw new VoxRuntimeError("division by zero"); return l / r;
            case "mod": if (r == 0) throw new VoxRuntimeError("modulo by zero");   return l % r;
            default: throw new VoxRuntimeError("unknown arithmetic op: " + op);
        }
    }

    private static boolean compare(String op, Object left, Object right) {
        // Equality is total; ordering against null is not meaningful.
        boolean equal;
        if (left == null || right == null) {
            equal = (left == null && right == null);
        } else if (isNumber(left) && isNumber(right)) {
            equal = toDouble(left) == toDouble(right);
        } else {
            equal = left.equals(right);
        }
        if ("eq".equals(op)) return equal;
        if ("ne".equals(op)) return !equal;

        if (left == null || right == null) {
            throw new VoxRuntimeError("cannot order-compare with an unset value using '" + op + "'");
        }

        int c;
        if (isNumber(left) && isNumber(right)) {
            c = Double.compare(toDouble(left), toDouble(right));
        } else if (left instanceof String && right instanceof String) {
            c = ((String) left).compareTo((String) right);
        } else if (left instanceof Boolean && right instanceof Boolean) {
            c = Boolean.compare((Boolean) left, (Boolean) right);
        } else {
            throw new VoxRuntimeError("cannot compare " + describe(left) + " with " + describe(right));
        }

        switch (op) {
            case "lt": return c < 0;
            case "gt": return c > 0;
            case "le": return c <= 0;
            case "ge": return c >= 0;
            default: throw new VoxRuntimeError("unknown comparison op: " + op);
        }
    }

    /** Explicit conversion, `x as integer`. Fails loudly instead of guessing. */
    private static Object cast(Object v, String type) {
        switch (type) {
            case "integer":
                if (v instanceof Integer) return v;
                if (v instanceof Double) {
                    double d = (Double) v;
                    if (Double.isNaN(d) || Double.isInfinite(d)) break;
                    return (int) d;
                }
                if (v instanceof Boolean) return (Boolean) v ? 1 : 0;
                if (v instanceof String && ((String) v).trim().matches("-?\\d+")) {
                    try { return Integer.valueOf(((String) v).trim()); } catch (NumberFormatException ignored) { }
                }
                break;
            case "float":
                if (v instanceof Double) return v;
                if (v instanceof Integer) return ((Integer) v).doubleValue();
                if (v instanceof Boolean) return (Boolean) v ? 1.0 : 0.0;
                if (v instanceof String && ((String) v).trim().matches("-?(\\d+|\\d*\\.\\d+)")) {
                    return Double.valueOf(((String) v).trim());
                }
                break;
            case "boolean":
                if (v instanceof Boolean) return v;
                if (v instanceof Integer) return (Integer) v != 0;
                if (v instanceof Double) return (Double) v != 0.0;
                if (v instanceof String) {
                    String t = ((String) v).trim().toLowerCase(Locale.ROOT);
                    if (t.equals("true")) return Boolean.TRUE;
                    if (t.equals("false")) return Boolean.FALSE;
                }
                break;
            case "string":
            case "character":
                if (v == null) break;
                return display(v);
            default:
                throw new VoxRuntimeError("unknown type in cast: " + type);
        }
        throw new VoxRuntimeError("cannot convert " + describe(v) + " to " + type);
    }

    /** The builtin functions. Spoken forms map onto the same names. */
    private static Object builtin(String name, List<Object> args) {
        switch (name) {
            case "sqrt": {
                arity(name, args, 1);
                double x = toDouble(num(name, args.get(0)));
                if (x < 0) throw new VoxRuntimeError("square root of a negative number: " + display(args.get(0)));
                return Math.sqrt(x);
            }
            case "abs": {
                arity(name, args, 1);
                Object x = num(name, args.get(0));
                return x instanceof Integer ? (Object) Math.abs((Integer) x) : (Object) Math.abs((Double) x);
            }
            case "round":   arity(name, args, 1); return (int) Math.round(toDouble(num(name, args.get(0))));
            case "floor":   arity(name, args, 1); return (int) Math.floor(toDouble(num(name, args.get(0))));
            case "ceiling": arity(name, args, 1); return (int) Math.ceil(toDouble(num(name, args.get(0))));
            case "min":
            case "max": {
                arity(name, args, 2);
                Object a = num(name, args.get(0)), b = num(name, args.get(1));
                boolean pickMin = "min".equals(name);
                if (a instanceof Integer && b instanceof Integer) {
                    return pickMin ? Math.min((Integer) a, (Integer) b) : Math.max((Integer) a, (Integer) b);
                }
                return pickMin ? Math.min(toDouble(a), toDouble(b)) : Math.max(toDouble(a), toDouble(b));
            }
            case "length":    arity(name, args, 1); return str(name, args.get(0)).length();
            case "uppercase": arity(name, args, 1); return str(name, args.get(0)).toUpperCase(Locale.ROOT);
            case "lowercase": arity(name, args, 1); return str(name, args.get(0)).toLowerCase(Locale.ROOT);
            default:
                throw new VoxRuntimeError("unknown builtin: " + name);
        }
    }

    private static void arity(String name, List<Object> args, int n) {
        if (args.size() != n) {
            throw new VoxRuntimeError("builtin '" + name + "' expects " + n
                    + " argument(s) but got " + args.size());
        }
    }

    private static Object num(String name, Object v) {
        if (!isNumber(v)) throw new VoxRuntimeError("'" + name + "' needs a number but got " + describe(v));
        return v;
    }

    private static String str(String name, Object v) {
        if (!(v instanceof String)) throw new VoxRuntimeError("'" + name + "' needs a string but got " + describe(v));
        return (String) v;
    }

    private static String describe(Object o) {
        if (o == null) return "an unset value";
        if (o instanceof Integer) return "integer " + o;
        if (o instanceof Double)  return "float " + o;
        if (o instanceof Boolean) return "boolean " + o;
        return "string \"" + o + "\"";
    }
}
