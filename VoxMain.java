import org.antlr.v4.runtime.*;
import org.antlr.v4.runtime.tree.*;
import java.io.IOException;
import java.util.List;

public class VoxMain {
    public static void main(String[] args) throws IOException {
        if (args.length < 1) {
            System.err.println("Usage: java VoxMain <source.vox>");
            return;
        }

        CharStream input = CharStreams.fromFileName(args[0]);
        VoxLexer lexer = new VoxLexer(input);

        CommonTokenStream tokens = new CommonTokenStream(lexer);
        VoxParser parser = new VoxParser(tokens);
        ParseTree tree = parser.program();

        IRBuilder irBuilder = new IRBuilder();
        irBuilder.visit(tree);
        List<String> instructions = irBuilder.getInstructions();
        
        IRExecutor executor = new IRExecutor(instructions);
        executor.execute();
    }
}
