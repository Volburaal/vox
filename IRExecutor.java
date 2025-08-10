import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.*;
/*
    IRExecutor - executes the IR produced by the IRBuilder.
    Supported instructions:
    - func_start <name>
    - func_end <name>
    - set <var> <value>
    - input <tmp>
    - print <value>
    - not <dest> <value>
    - added_to <dest> <left> <right>
    - minus <dest> <left> <right>
    - multiplied_by <dest> <left> <right>
    - divided_by <dest> <left> <right>
    - is_equal_to <dest> <left> <right>
    - is_less_than <dest> <left> <right>
    - is_greater_than <dest> <left> <right>
    - and <dest> <left> <right>
    - or <dest> <left> <right>
    - if_false <cond> goto <LABEL>
    - goto <LABEL>
    - label <LABEL>
    - call <funcName> [arg1 arg2 ...] -> <tmp>
    - return <value>
    Storage model:
    - A stack of variable scopes (Map<String, Object>) is used. Each call gets a fresh scope.
    - Temporary varoables like "t0" are just variable names in the scope.
    - Values are Java Objects: Integer, Double, Boolean, String.
*/
public class IRExecutor {
    private final List<String> instructions;
    private final Map<String, Integer> labelToIndex = new HashMap<>();
    private final Map<String, Integer> functionToIndex = new HashMap<>();
    private final BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
    private static class Frame {
        int returnPc;
        String destVar;
        Frame(int returnPc, String destVar) { this.returnPc = returnPc; this.destVar = destVar; }
    }
    private final Deque<Map<String, Object>> scopes = new ArrayDeque<>();
    private final Deque<Frame> callStack = new ArrayDeque<>();
    public IRExecutor(List<String> instructions) {
        this.instructions = new ArrayList<>(instructions);
        preprocess();
        pushScope();
    }
    private void preprocess() {
        for (int i = 0; i < instructions.size(); i++) {
            String line = instructions.get(i).trim();
            if (line.isEmpty()) continue;
            String tok = firstToken(line);
            if ("label".equals(tok)) {
                String label = nthToken(line, 1);
                labelToIndex.put(label, i);
            } else if ("func_start".equals(tok)) {
                String fn = nthToken(line, 1);
                functionToIndex.put(fn, i);
            }
        }
    }
    private static String firstToken(String line) {
        String[] t = splitKeepingQuotes(line);
        return t.length > 0 ? t[0] : "";
    }
    private static String nthToken(String line, int n) {
        String[] t = splitKeepingQuotes(line);
        if (n < t.length) return t[n];
        return "";
    }
    private static String[] splitKeepingQuotes(String line) {
        List<String> out = new ArrayList<>();
        boolean inQuote = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                cur.append(c);
                inQuote = !inQuote;
                continue;
            }
            if (!inQuote && Character.isWhitespace(c)) {
                if (cur.length() > 0) {
                    out.add(cur.toString());
                    cur.setLength(0);
                }
            } else {
                cur.append(c);
            }
        }
        if (cur.length() > 0) out.add(cur.toString());
        return out.toArray(new String[0]);
    }
    private Object resolveValue(String token) {
        if (token == null) return null;
        token = token.trim();
        if (token.isEmpty()) return null;
        if (token.startsWith("\"") && token.endsWith("\"") && token.length() >= 2) {
            String inner = token.substring(1, token.length() - 1);
            inner = inner.replace("\\n", "\n").replace("\\t", "\t").replace("\\\"", "\"").replace("\\\\", "\\");
            return inner;
        }
        if ("true".equalsIgnoreCase(token)) return Boolean.TRUE;
        if ("false".equalsIgnoreCase(token)) return Boolean.FALSE;
        if (token.matches("-?\\d+")) {
            try { return Integer.parseInt(token); } catch (NumberFormatException e) { /* fall through */ }
        }
        if (token.matches("-?\\d*\\.\\d+")) {
            try { return Double.parseDouble(token); } catch (NumberFormatException e) { /* fall through */ }
        }
        for (Map<String, Object> scope : scopes) {
            if (scope.containsKey(token)) return scope.get(token);
        }
        return null;
    }
    private void storeVariable(String name, Object value) {
        if (scopes.isEmpty()) pushScope();
        scopes.peek().put(name, value);
    }
    private Object getVariable(String name) {
        for (Map<String, Object> scope : scopes) {
            if (scope.containsKey(name)) return scope.get(name);
        }
        return null;
    }
    private void pushScope() {
        scopes.push(new HashMap<>());
    }
    private void popScope() {
        if (!scopes.isEmpty()) scopes.pop();
        if (scopes.isEmpty()) pushScope();
    }
    private static boolean isNumber(Object o) {
        return o instanceof Integer || o instanceof Double;
    }
    private static double toDouble(Object o) {
        if (o instanceof Integer) return ((Integer)o).doubleValue();
        if (o instanceof Double) return (Double)o;
        throw new IllegalArgumentException("Not a number: " + o);
    }
    private static int toInt(Object o) {
        if (o instanceof Integer) return (Integer)o;
        if (o instanceof Double) return (int)Math.floor((Double)o);
        throw new IllegalArgumentException("Not a number: " + o);
    }
    public void execute() {
        int pc = 0;
        while (pc < instructions.size()) {
            String raw = instructions.get(pc).trim();
            if (raw.isEmpty()) { pc++; continue; }
            String[] toks = splitKeepingQuotes(raw);
            String op = toks[0];
            switch (op) {
                case "func_start": {
                    pc++;
                    break;
                }
                case "func_end": {
                    pc++;
                    break;
                }
                case "label": {
                    pc++;
                    break;
                }
                case "set": {
                    if (toks.length < 3) throw new RuntimeException("Malformed set: " + raw);
                    String var = toks[1];
                    String valToken = toks[2];
                    Object val = resolveValue(valToken);
                    storeVariable(var, val);
                    pc++;
                    break;
                }
                case "input": {
                    if (toks.length < 2) throw new RuntimeException("Malformed input: " + raw);
                    String dest = toks[1];
                    try {
                        System.out.print("> ");
                        String line = reader.readLine();
                        if (line == null) line = "";
                        Object val;
                        if (line.matches("-?\\d+")) {
                            val = Integer.parseInt(line);
                        } else if (line.matches("-?\\d*\\.\\d+")) {
                            val = Double.parseDouble(line);
                        } else if ("true".equalsIgnoreCase(line) || "false".equalsIgnoreCase(line)) {
                            val = Boolean.parseBoolean(line);
                        } else {
                            val = line;
                        }
                        storeVariable(dest, val);
                    } catch (Exception e) {
                        throw new RuntimeException("Input failed: " + e.getMessage(), e);
                    }
                    pc++;
                    break;
                }
                case "print": {
                    if (toks.length < 2) throw new RuntimeException("Malformed print: " + raw);
                    StringBuilder sb = new StringBuilder();
                    for (int i = 1; i < toks.length; i++) {
                        String token = toks[i];
                        Object val = resolveValue(token);
                        if (val == null) {
                            sb.append("null");
                        } else {
                            sb.append(val);
                        }
                        /*
                        if (i < toks.length - 1) { // this adds space between the print entries, im not a big fan of it in python and js
                            sb.append(" ");
                        }
                        */
                    }
                    System.out.println(sb.toString());
                    pc++;
                    break;
                }
                case "not": {
                    if (toks.length < 3) throw new RuntimeException("Malformed not: " + raw);
                    String dest = toks[1], token = toks[2];
                    Object val = resolveValue(token);
                    boolean b = false;
                    if (val instanceof Boolean) b = !(Boolean)val;
                    else if (val == null) b = true;
                    else b = !truthy(val);
                    storeVariable(dest, b);
                    pc++;
                    break;
                }
                case "add":
                case "sub":
                case "mul":
                case "div":
                case "power":
                case "mod":
                {
                    if (toks.length < 4) throw new RuntimeException("Malformed op: " + raw);
                    String dest = toks[1], leftTok = toks[2], rightTok = toks[3];
                    Object leftVal = resolveValue(leftTok);
                    Object rightVal = resolveValue(rightTok);
                    Object result = arithmetic(op, leftVal, rightVal);
                    storeVariable(dest, result);
                    pc++;
                    break;
                }
                case "eq":
                case "ne":
                case "gt":
                case "lt":
                case "ge":
                case "le":
                {
                    if (toks.length < 4) throw new RuntimeException("Malformed cmp: " + raw);
                    String dest = toks[1], leftTok = toks[2], rightTok = toks[3];
                    Object leftVal = resolveValue(leftTok);
                    Object rightVal = resolveValue(rightTok);
                    boolean cmp = compare(op, leftVal, rightVal);
                    storeVariable(dest, cmp);
                    pc++;
                    break;
                }
                case "and":
                case "or": {
                    if (toks.length < 4) throw new RuntimeException("Malformed logic: " + raw);
                    String dest = toks[1], leftTok = toks[2], rightTok = toks[3];
                    Object leftVal = resolveValue(leftTok);
                    Object rightVal = resolveValue(rightTok);
                    boolean lv = truthy(leftVal);
                    boolean rv = truthy(rightVal);
                    boolean out = "and".equals(op) ? (lv && rv) : (lv || rv);
                    storeVariable(dest, out);
                    pc++;
                    break;
                }
                case "if_false": {
                    if (toks.length < 4) throw new RuntimeException("Malformed if_false: " + raw);
                    String condTok = toks[1];
                    String keyword = toks[2];
                    String label = toks[3];
                    if (!"goto".equals(keyword)) throw new RuntimeException("if_false missing goto: " + raw);
                    Object condVal = resolveValue(condTok);
                    boolean condBool = !truthy(condVal);
                    if (condBool) {
                        Integer target = labelToIndex.get(label);
                        if (target == null) throw new RuntimeException("Unknown label: " + label);
                        pc = target + 1;
                    } else {
                        pc++;
                    }
                    break;
                }
                case "goto": {
                    if (toks.length < 2) throw new RuntimeException("Malformed goto: " + raw);
                    String label = toks[1];
                    Integer target = labelToIndex.get(label);
                    if (target == null) throw new RuntimeException("Unknown label: " + label);
                    pc = target + 1;
                    break;
                }
                case "call": {
                    int arrowIdx = -1;
                    for (int i = 0; i < toks.length; i++) if (">".equals(toks[i]) || "->".equals(toks[i])) arrowIdx = i;
                    if (arrowIdx == -1 || arrowIdx < 2) {
                        throw new RuntimeException("Malformed call: missing -> " + raw);
                    }
                    String funcName = toks[1];
                    List<String> argTokens = new ArrayList<>();
                    for (int i = 2; i < arrowIdx; i++) argTokens.add(toks[i]);
                    String destTmp = toks[arrowIdx + 1];
                    List<Object> argValues = new ArrayList<>();
                    for (String at : argTokens) argValues.add(resolveValue(at));
                    callStack.push(new Frame(pc + 1, destTmp));
                    pushScope();
                    for (int i = 0; i < argValues.size(); i++) {
                        storeVariable("arg" + i, argValues.get(i));
                    }
                    Integer funcIdx = functionToIndex.get(funcName);
                    if (funcIdx == null) throw new RuntimeException("Unknown function: " + funcName);
                    pc = funcIdx + 1;
                    break;
                }
                case "return": {
                    if (toks.length < 2) throw new RuntimeException("Malformed return: " + raw);
                    String valTok = toks[1];
                    Object retval = resolveValue(valTok);
                    if (callStack.isEmpty()) {
                        return;
                    } else {
                        Frame f = callStack.pop();
                        popScope();
                        storeVariable(f.destVar, retval);
                        pc = f.returnPc;
                    }
                    break;
                }
                default:
                    throw new RuntimeException("Unknown instruction: " + op + " (full: " + raw + ")");
            }
        }
    }
    private static boolean truthy(Object o) {
        if (o == null) return false;
        if (o instanceof Boolean) return (Boolean)o;
        if (o instanceof Integer) return ((Integer)o) != 0;
        if (o instanceof Double) return ((Double)o) != 0.0;
        if (o instanceof String) return !((String)o).isEmpty();
        return true;
    }
    private static Object arithmetic(String op, Object leftVal, Object rightVal) {
        if (leftVal == null) leftVal = 0;
        if (rightVal == null) rightVal = 0;
        boolean leftIsNum = isNumber(leftVal);
        boolean rightIsNum = isNumber(rightVal);
        if (leftIsNum || rightIsNum) {
            boolean isDouble = (leftVal instanceof Double) || (rightVal instanceof Double);
            if (isDouble) {
                double l = toDouble(leftVal);
                double r = toDouble(rightVal);
                switch (op) {
                    case "power":
                        double result = 1.0;
                        if (l == 0 && r == 0) {
                            result = 1.0; 
                        } else if (l < 0 && r != (int)r) {
                            result = Double.NaN; //something imaginary
                        } else {
                            result = Math.exp(r * Math.log(l));
                        }
                        return result;
                    case "mul": return l * r;
                    case "div": return (r == 0) ? 0 : (l / r);
                    case "mod": return (r == 0) ? l : Math.IEEEremainder(l, r);
                    case "add": return l + r;
                    case "sub": return l - r;
                    default: throw new RuntimeException("Unknown numeric op: " + op);
                }
            } else {
                int l = toInt(leftVal);
                int r = toInt(rightVal);
                switch (op) {
                    case "power":
                        int base = l;
                        int exp = r;
                        int result = 1;
                        for (int i = 0; i < exp; i++) {
                            result *= base;
                        }
                        return result;
                    case "mul": return l * r;
                    case "div": return (r == 0) ? 0 : (l / r);
                    case "mod": return (r == 0) ? l : (l % r);
                    case "add": return l + r;
                    case "sub": return l - r;
                    default: throw new RuntimeException("Unknown numeric op: " + op);
                }
            }
        }
        if (leftVal instanceof String || rightVal instanceof String) {
            String ls = leftVal == null ? "null" : leftVal.toString();
            String rs = rightVal == null ? "null" : rightVal.toString();
            if (op.startsWith("add")) return ls + rs;
            throw new RuntimeException("Non-numeric operands for op " + op + ": " + leftVal + ", " + rightVal);
        }
        throw new RuntimeException("Unsupported operands for arithmetic op " + op + ": " + leftVal + ", " + rightVal);
    }
    private static boolean compare(String op, Object leftVal, Object rightVal) {
        if (leftVal == null && rightVal == null) return true;
        if (leftVal == null || rightVal == null) {
            if ("eq".equals(op)) return false;
            if ("ne".equals(op)) return false;
            if ("lt".equals(op)) return leftVal == null;
            if ("gt".equals(op)) return rightVal == null;
            if ("le".equals(op)) return leftVal == null;
            if ("ge".equals(op)) return rightVal == null;
            return false;
        }
        if (isNumber(leftVal) && isNumber(rightVal)) {
            double l = toDouble(leftVal);
            double r = toDouble(rightVal);
            switch (op) {
                case "eq": return l == r;
                case "ne": return l != r;
                case "lt": return l < r;
                case "gt": return l > r;
                case "le": return l <= r;
                case "ge": return l >= r;
                default: throw new RuntimeException("Unknown cmp op: " + op);
            }
        }
        if (leftVal instanceof String && rightVal instanceof String) {
            String ls = (String) leftVal;
            String rs = (String) rightVal;
            switch (op) {
                case "eq": return ls.equals(rs);
                case "ne": return !(ls.equals(rs));
                case "lt": return ls.compareTo(rs) < 0;
                case "gt": return ls.compareTo(rs) > 0;
                case "le": return ls.compareTo(rs) <= 0;
                case "ge": return ls.compareTo(rs) >= 0;
                default: throw new RuntimeException("Unknown cmp op: " + op);
            }
        }
        if (leftVal instanceof Boolean && rightVal instanceof Boolean) {
            boolean lb = (Boolean)leftVal, rb = (Boolean)rightVal;
            switch (op) {
                case "eq": return lb == rb;
                case "ne": return lb != rb;
                case "lt": return (!lb && rb);
                case "gt": return (lb && !rb);
                case "le": return (!lb);
                case "ge": return (lb);
                default: throw new RuntimeException("Unknown cmp op: " + op);
            }
        }
        String ls = leftVal.toString();
        String rs = rightVal.toString();
        switch (op) {
            case "eq": return ls.equals(rs);
            case "ne": return !(ls.equals(rs));
            case "lt": return ls.compareTo(rs) < 0;
            case "gt": return ls.compareTo(rs) > 0;
            case "le": return ls.compareTo(rs) <= 0;
            case "ge": return ls.compareTo(rs) >= 0;
        }
        return false;
    }
}
