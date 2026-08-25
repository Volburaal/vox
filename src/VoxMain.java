import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.tree.ParseTree;

/**
 * Command line entry point: parse, check, lower to IR, run.
 *
 * Exit codes: 0 success, 1 compile error, 2 runtime error, 64 bad usage.
 */
public class VoxMain {

    private static final String USAGE =
            "Usage: vox <source.vox> [options]\n"
          + "  --emit-ir     print the generated IR\n"
          + "  --check       parse and type-check only, do not run\n"
          + "  --steps <n>   change the execution step limit\n";

    /** Collects diagnostics instead of writing them straight to the console. */
    private static final class ErrorCollector extends BaseErrorListener {
        final List<String> messages = new ArrayList<>();
        @Override
        public void syntaxError(Recognizer<?, ?> recognizer, Object offendingSymbol,
                                int line, int charPositionInLine, String msg,
                                RecognitionException e) {
            messages.add("line " + line + ":" + charPositionInLine + " error: " + msg);
        }
    }

    public static void main(String[] args) {
        String sourcePath = null;
        boolean emitIr = false;
        boolean checkOnly = false;
        long stepLimit = -1;

        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if ("--emit-ir".equals(a))      emitIr = true;
            else if ("--check".equals(a))   checkOnly = true;
            else if ("--steps".equals(a) && i + 1 < args.length) {
                try {
                    stepLimit = Long.parseLong(args[++i]);
                } catch (NumberFormatException e) {
                    System.err.println("vox: --steps needs a number");
                    System.exit(64);
                }
            } else if (a.startsWith("-")) {
                System.err.println("vox: unknown option " + a + "\n\n" + USAGE);
                System.exit(64);
            } else if (sourcePath == null) {
                sourcePath = a;
            } else {
                System.err.println("vox: more than one source file given\n\n" + USAGE);
                System.exit(64);
            }
        }

        if (sourcePath == null) {
            System.err.println(USAGE);
            System.exit(64);
        }

        String source;
        try {
            source = new String(Files.readAllBytes(Path.of(sourcePath)),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException e) {
            System.err.println("vox: cannot read " + sourcePath + ": " + e.getMessage());
            System.exit(64);
            return;
        }

        // ---- parse ----------------------------------------------------------
        ErrorCollector collector = new ErrorCollector();

        VoxLexer lexer = new VoxLexer(CharStreams.fromString(source, sourcePath));
        lexer.removeErrorListeners();
        lexer.addErrorListener(collector);

        VoxParser parser = new VoxParser(new CommonTokenStream(lexer));
        parser.removeErrorListeners();
        parser.addErrorListener(collector);

        ParseTree tree = parser.program();

        // The old driver skipped this check and built IR from a broken tree,
        // which silently produced wrong programs.
        if (!collector.messages.isEmpty()) {
            report(sourcePath, collector.messages);
            System.exit(1);
        }

        // ---- check ----------------------------------------------------------
        SemanticAnalyzer analyzer = new SemanticAnalyzer();
        analyzer.visit(tree);

        for (String w : analyzer.getWarnings()) {
            System.err.println(sourcePath + ":" + w);
        }
        if (!analyzer.getErrors().isEmpty()) {
            report(sourcePath, analyzer.getErrors());
            System.exit(1);
        }

        // ---- lower ----------------------------------------------------------
        IRBuilder builder = new IRBuilder();
        builder.visit(tree);
        List<String> ir = builder.getInstructions();

        if (emitIr) {
            for (int i = 0; i < ir.size(); i++) {
                System.out.println(String.format("%4d  %s", i, ir.get(i)));
            }
        }
        if (checkOnly) return;

        // ---- run ------------------------------------------------------------
        IRExecutor executor = new IRExecutor(ir);
        if (stepLimit > 0) executor.withStepLimit(stepLimit);
        try {
            executor.execute();
        } catch (IRExecutor.VoxRuntimeError e) {
            System.err.println(sourcePath + ": runtime error: " + e.getMessage());
            System.exit(2);
        }
    }

    private static void report(String path, List<String> messages) {
        for (String m : messages) System.err.println(path + ":" + m);
        int n = messages.size();
        System.err.println(n + (n == 1 ? " error" : " errors"));
    }
}
