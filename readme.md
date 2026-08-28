# Vox Programming Language

**Vox** is a custom programming language built using ANTLR and Java, designed with a focus on natural-language-like syntax and a simplified execution model.
[Read more about it](https://chaotiz.vercel.app/journal/vox)

## Features

- Natural language-inspired syntax (e.g., `added to`, `is greater than`)
- Custom-built compiler pipeline using ANTLR
- Intermediate Representation (IR) generation via `IRBuilder`
- Fully custom runtime using `IRExecutor` (no LLVM dependency)

### Supported Features

- Variables and data types
- Arithmetic and logical expressions, with real operator precedence
- Conditionals (`if`, `if-else`)
- Loops (`while`, `for`)
- Functions, forward declarations, and recursion
- Input/Output operations

## Architecture Overview

```
Source Code (.vox)
        |
        v
ANTLR Lexer & Parser        (generated from Vox.g4)
        |
        v
    Parse Tree
        |
        +--> SemanticAnalyzer   (name resolution + type checking)
        |
        v
     IRBuilder                  (parse tree -> IR instructions)
        |
        v
     IRExecutor                 (executes IR on a custom VM)
```

The grammar contains **no embedded Java**. It describes syntax only, so the
same `Vox.g4` can generate a parser for any ANTLR target. All checking lives in
`SemanticAnalyzer.java`.

Vox has **two engines** built from that one grammar:

- **Java** (`src/`) - the reference implementation and CLI.
- **TypeScript** (`core/`) - the same pipeline ported for the browser; it
  powers the web demo. Its parser is generated from `Vox.g4` at build time and
  is not committed.

Both engines emit identical IR and pass the same regression suite. The one
deliberate difference: TypeScript integers are **exact** (arbitrary precision),
while Java ints wrap at 32 bits - so programs that overflow, like
`factorial(13)`, give the mathematically correct answer in TypeScript and a
wrapped one in Java.

## Components

| Path | Purpose |
| --- | --- |
| `Vox.g4` | Grammar definition for the Vox language (shared by both engines) |
| `src/VoxMain.java` | Java entry point (parse -> check -> lower -> run) |
| `src/SemanticAnalyzer.java` | Name resolution and type checking |
| `src/IRBuilder.java` | Converts the parse tree into IR instructions |
| `src/IRExecutor.java` | Executes IR instructions on a custom runtime |
| `core/` | TypeScript engine (`@vox/core`): same pipeline, browser-ready |
| `core/src/cli.ts` | Node CLI mirroring the Java one, for testing parity |
| `build.bat` / `build.sh` | Java build; produces `build/vox.jar` |
| `vox.bat` | CLI launcher |
| `tests/run.sh` | Regression suite (drives either engine) |
| `tools/antlr-4.13.2-complete.jar` | ANTLR dependency |

## Installation & Setup

### 1. Install Java

Install Java 11 or higher:
https://adoptium.net/

### 2. Build

From the project folder:

```bat
build.bat
```

or, in a POSIX shell:

```bash
./build.sh
```

This generates the parser, compiles everything, and packages a self-contained
`build/vox.jar`.

### 3. Put Vox on your PATH (optional)

Add the project folder itself to your `PATH`. `vox.bat` locates its own jar, so
no `VOX_HOME` variable is needed.

## Usage

```bash
vox <filename.vox>
```

Options:

| Option | Effect |
| --- | --- |
| `--emit-ir` | Print the generated IR |
| `--check` | Parse and type-check only, do not run |
| `--steps N` | Change the execution step limit (default 50,000,000) |

Exit codes: `0` success, `1` compile error, `2` runtime error, `64` bad usage.

You can also run the jar directly:

```bash
java -jar build/vox.jar examples/factorial.vox
```

### TypeScript engine

Requires Node 18+ (and Java, to generate the parser):

```bash
npm install
npm run build -w core  # generates the parser from Vox.g4, compiles core/
node core/dist/cli.js examples/factorial.vox
```

### Web playground

`web/` is a React + Vite + Tailwind site with three routes: `/` introduces the
language, `/playground` runs it, and covers the language's purpose and
its mascot. There is no backend: the TypeScript engine runs in a Web Worker, so
a runaway program can be stopped without freezing the page, and `input()`
prompts inline in the console. The editor runs the real compiler as you type
and underlines syntax and semantic errors; the code, console and IR panes are
resizable by dragging their dividers.

`docs/portfolio/` holds the journal entry and project card for the author's
portfolio site, kept in sync with the project.

```bash
npm run dev            # builds core, then starts the dev server
npm run build          # builds core, then web/dist (static, deploy anywhere)
```

Deploying to Vercel: set the root directory to `web`. `web/vercel.json` does
the rest: its `installCommand` installs a JDK (ANTLR needs Java to generate the
parser, and Vercel's build image has none), `web`'s `prebuild` builds `core`
first, and every route is rewritten to `index.html` for client-side routing.

If Java cannot be installed in your build environment, the alternative is to
generate the parser locally and commit `core/src/gen` (remove it from
`.gitignore`); the generate step then skips itself wherever Java is missing.

## Tests

```bash
./tests/run.sh                                     # Java engine
VOX_CMD="node core/dist/cli.js" ./tests/run.sh     # TypeScript engine
```

`tests/run/` holds programs with expected output (plus optional `.in` stdin),
`tests/fail/` holds programs that must be rejected with a given exit code and
message. The same suite drives both engines, which keeps them in lockstep.

## Examples

Runnable copies of these live in [examples/](examples/).

### Example # 1

```java
integer hailstone(integer n) {

    while (n is greater than 1) {
        print(n);

        if ((n % 2) == 0) {
            n = n divided by 2;
        }
        else {
            n = n times 3 + 1;
        }
    }

    print(1);
    return n;

}

main {
    consider an integer start which is equal to 13;
    hailstone(start);
}
```

### Example # 2

```java
integer factorial(integer n) {

    integer result <- 1;
    integer i <- 2;

    while (i <= n) {
        result <- result multiplied by i;
        i <- i + 1;
    }
    return result;
}

main {

    consider an integer value which is equal to 6;
    integer answer <- factorial(value);
    print(answer);

}
```

## Language notes

### Operators, highest precedence first

| Level | Operators |
| --- | --- |
| 1 | `( )` |
| 2 | `^` / `to the power of` (right associative) |
| 3 | `not` / `!` / `~` |
| 4 | `*` `/` `%` / `multiplied by` / `times` / `divided by` / `remainder from` |
| 5 | `+` `-` / `added to` / `minus` |
| 6 | `subtracted from` |
| 7 | `<` `>` `<=` `>=` / `is less than` / `is greater than` / ... |
| 8 | `==` `!=` / `equals to` / `is` / `is not` |
| 9 | `&&` `&` / `and` |
| 10 | `\|\|` `\|` / `or` |

`a subtracted from b` evaluates to `b - a`.

Multi-word operators and declaration starters may span newlines, so this is
valid:

```java
if (total is greater
    than 15) { ... }
```

### Assignment

Assignment is `=`, `<-`, `which is equal to`, or `which equals`. Reverse
assignment is `->`.

`<=` and `=>` are **comparisons only**. They previously doubled as assignment
operators, which made the grammar ambiguous.

### Declarations

```java
integer x;                                  // defaults to 0
integer y <- 5;
consider an integer z which is equal to 7;
let there be a whole number w which equals 9;
5 -> integer v;                             // reverse declaration
```

Defaults are `0` for `integer`, `0.0` for `float`, `false` for `boolean`, and
the empty string for `string` and `character`.

### input()

`input()` reads one line and coerces it: digits become an `integer`,
`12.5` becomes a `float`, `true`/`false` become a `boolean`, anything else
stays a `string`. It is accepted wherever a value is expected.

### Negation, casts and builtins

Unary minus works on any number: `-x`, `-(a + b)`, `2 ^ -1`. It binds looser
than `^`, so `-2 ^ 2` is `-4`.

`value as type` converts explicitly and fails loudly when it cannot:

```java
integer n <- an input as integer;      // "42" -> 42; "abc" is a runtime error
float half <- (7 as float) / 2;        // 3.5
string label <- 5 as string + "!";     // "5!"
```

Builtin functions have a spoken and a symbolic form; a user-defined function
with the same name takes precedence:

| Spoken | Symbolic | Result |
| --- | --- | --- |
| `square root of x` | `sqrt(x)` | float |
| `absolute value of x` | `abs(x)` | same type as `x` |
| `floor of x`, `ceiling of x` | `floor(x)`, `ceiling(x)` | integer |
| - | `round(x)` | integer |
| - | `min(a, b)`, `max(a, b)` | float if either is a float |
| `length of s` | `length(s)` | integer |
| `uppercase of s`, `lowercase of s` | `uppercase(s)`, `lowercase(s)` | string |

Spoken builtins apply to the term right after them: `length of s + 1` is
`length(s) + 1`.

### Control flow

- `else if` chains, with `otherwise` as a synonym for `else`.
- `stop;` (or `break;`) leaves the innermost loop; `skip;` (or `continue;`)
  moves to its next iteration. Both are compile errors outside a loop.

### Procedures

A function that returns nothing is declared with `procedure`, `void` or
`nothing`. It may `return;` early but cannot return a value, and calling it
where a value is expected is a compile error.

```java
procedure greet(string who) {
    print("hello, ", who);
}
```
