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

## Components

| Path | Purpose |
| --- | --- |
| `Vox.g4` | Grammar definition for the Vox language |
| `src/VoxMain.java` | Entry point (parse -> check -> lower -> run) |
| `src/SemanticAnalyzer.java` | Name resolution and type checking |
| `src/IRBuilder.java` | Converts the parse tree into IR instructions |
| `src/IRExecutor.java` | Executes IR instructions on a custom runtime |
| `build.bat` / `build.sh` | Build script; produces `build/vox.jar` |
| `vox.bat` | CLI launcher |
| `tests/run.sh` | Regression suite |
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

## Tests

```bash
./tests/run.sh
```

`tests/run/` holds programs with expected output, `tests/fail/` holds programs
that must be rejected with a given exit code and message.

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
