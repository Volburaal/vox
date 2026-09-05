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
- Conditionals (`if`, `else if`, `otherwise`) and spoken predicates (`is even`, `is between 1 and 10`)
- Loops: `while`, the classic `for`, range loops (`for i from 1 to 10`, `down to`, `step`) and `repeat 5 times` / `repeat ... until`
- In-place updates in both spellings: `n++` / `increment n`, `n += 3` / `add 3 to n`, `double n`
- The voice forms: `say`, `ask`, `set ... to`, `let ... be`, `swap ... and ...`
- `print` writes raw text - `'\n'` ends a line; `say` always ends the line
- Lists: `integer[] xs`, `list<integer>` or `xs is a list of integers`; `xs[i]` and `2nd item of xs`; `push`, `pop`, `insert`; `for each x in xs`
- Functions, procedures, forward declarations and recursion
- `main { }` may also be spelled `program { }` or `code { }`
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
  powers the web demo.

Both engines emit identical IR and pass the same regression suite. The one
deliberate difference: TypeScript integers are **exact** (arbitrary precision),
while Java ints wrap at 32 bits - so programs that overflow, like
`factorial(13)`, give the mathematically correct answer in TypeScript and a
wrapped one in Java.

## Components

| Path                              | Purpose                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `Vox.g4`                          | Grammar definition for the Vox language (shared by both engines) |
| `src/VoxMain.java`                | Java entry point (parse -> check -> lower -> run)                |
| `src/SemanticAnalyzer.java`       | Name resolution and type checking                                |
| `src/IRBuilder.java`              | Converts the parse tree into IR instructions                     |
| `src/IRExecutor.java`             | Executes IR instructions on a custom runtime                     |
| `core/`                           | TypeScript engine (`@vox/core`): same pipeline, browser-ready    |
| `core/src/cli.ts`                 | Node CLI mirroring the Java one, for testing parity              |
| `build.bat` / `build.sh`          | Java build; produces `build/vox.jar`                             |
| `vox.bat`                         | CLI launcher                                                     |
| `tests/run.sh`                    | Regression suite (drives either engine)                          |
| `tools/antlr-4.13.2-complete.jar` | ANTLR dependency                                                 |

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

This generates the parser, compiles everything and packages a self-contained
`build/vox.jar`.

### 3. Put Vox on your PATH (optional)

Add the project folder itself to your `PATH`. `vox.bat` locates its own jar, so
no `additional variable is needed.

## Usage

```bash
vox <filename.vox>
```

Options:

| Option      | Effect                                               |
| ----------- | ---------------------------------------------------- |
| `--emit-ir` | Print the generated IR                               |
| `--check`   | Parse and type-check only, do not run                |
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

`web/` is a React + Vite + Tailwind site. There is no backend: the TypeScript engine runs in a Web Worker, so
a runaway program can be stopped without freezing the page and `input()`
prompts inline in the console. The editor runs the real compiler as you type
and underlines syntax and semantic errors.

Three routes: `/` (the pitch), `/docs` (the language reference, every example
of which is a tested program from `docs/snippets/`) and `/playground`. The
playground accepts `?example=<id>` or `?code=<base64url>`, which is how the
"run it" links on the docs page work.

```bash
npm run dev            # builds core, then starts the dev server
npm run build          # builds core, then web/dist (static, deploy anywhere)
```

## Tests

```bash
./tests/run.sh                                     # Java engine
VOX_CMD="node core/dist/cli.js" ./tests/run.sh     # TypeScript engine
```

`tests/run/` holds programs with expected output (plus optional `.in` stdin),
`tests/fail/` holds programs that must be rejected with a given exit code and
message. The same suite drives both engines, which keeps them in lockstep.

`docs/snippets/` holds the examples shown on the website's documentation page,
and the suite runs those too:

| File       | Checked against                                    |
| ---------- | -------------------------------------------------- |
| `NAME.vox` | the program                                        |
| `NAME.out` | its exact stdout                                   |
| `NAME.err` | its exact diagnostics, with the file path stripped |
| `NAME.ir`  | its exact emitted IR                               |
| `NAME.in`  | optional stdin                                     |

The page displays those same files, so a documented example cannot drift from
the compiler: change the language and the docs fail the build.

## Examples

Runnable copies of these live in [examples/](examples/).

### Example # 1

```java
integer hailstone(integer n) {

    while (n is greater than 1) {
        say n;

        if ((n % 2) == 0) {
            n = n divided by 2;
        }
        else {
            n = n times 3 + 1;
        }
    }

    say 1;
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
    say answer;

}
```

## Language notes

### Operators, highest precedence first

| Level | Operators                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 1     | `( )`                                                                                                                  |
| 2     | `xs[i]` (an item of a list)                                                                                            |
| 3     | `as` (cast)                                                                                                            |
| 4     | `squared`, `cubed`                                                                                                     |
| 5     | spoken builtins (`square root of`, `length of`, ...), `Nth item of`, `pop`, `ask`                                      |
| 6     | `^` `**` / `to the power of` / `raised to the power of` (right associative)                                            |
| 7     | unary `-`                                                                                                              |
| 8     | `not` / `!` / `~`                                                                                                      |
| 9     | `*` `/` `%` / `multiplied by` / `times` / `divided by` / `remainder from`                                              |
| 10    | `+` `-` / `added to` / `plus` / `minus`                                                                                |
| 11    | `subtracted from`                                                                                                      |
| 12    | predicates: `is even`, `is odd`, `is positive`, `is negative`, `is empty`, `is divisible by`, `is between ... and ...`, `is in`, `contains` |
| 13    | `<` `>` `<=` `>=` / `is less than` / `is greater than` / ...                                                           |
| 14    | `==` `!=` / `is` / `is equal to` / `equals` / `equals to` / `is not`                                                   |
| 15    | `&&` `&` / `and`                                                                                                       |
| 16    | `\|\|` `\|` / `or`                                                                                                     |

`a subtracted from b` evaluates to `b - a`. Prefix and postfix forms apply to
the term next to them: `-x squared` is `-(x squared)`, `2 * x squared` is
`2 * (x squared)` and `square root of x squared` is `sqrt(x squared)`.

Multi-word operators and declaration starters may span newlines, so this is
valid:

```java
if (total is greater
    than 15) { ... }
```

### Assignment

Assignment is `=`, `<-`, `which is equal to` or `which equals`. Reverse
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

Defaults are `0` for `integer`, `0.0` for `float`, `false` for `boolean` and
the empty string for `string` and `character`.

A name cannot be declared again while one is visible - in the same block or an
enclosing one - so no variable is ever shadowed, and a local cannot reuse a
parameter's name. Sibling blocks may reuse a name, since neither can see the
other's.

### input()

`input()` reads one line and coerces it: digits become an `integer`,
`12.5` becomes a `float`, `true`/`false` become a `boolean`, anything else
stays a `string`. It is accepted wherever a value is expected.

### print, say and newlines

`print` writes exactly what you give it - **no newline is added**. Print
`'\n'` where a line should end. `say` is the spoken line-form: it prints its
arguments and then ends the line for you.

```java
print("loading");
print(".", ".", ".", '\n');   // loading...
print("a"); print("b");       // ab - still the same line
say "done";                   // done, newline included
```

String literals take either quote style (`"\n"` or `'\n'`); escapes are `\n`,
`\t`, `\r`, `\"`, `\'` and `\\`.

`ask` prints its prompt (no newline, so the answer lands on the same line) and
reads one line back, coerced exactly like `input()`:

```java
integer age <- ask "How old are you? ";
let name be ask "Who is this? ";
```

`ask` applies to the term right after it; parenthesise a longer prompt:
`ask ("Hello " + name + ", how old?")`.

### Spoken assignment: set, let and swap

`set total to 0;` is assignment, exactly as taught. `let x be 5;` declares a
new variable and infers its type from the value (`let line be an input;` stays
dynamic). `swap a and b;` exchanges two variables through a hidden temporary.

```java
let price be 12.5;            // float, inferred
set the price to price * 2;
swap price and limit;
```

`x is equal to 5;` on its own is a comparison, not an assignment; the compiler
warns that it has no effect and points you at `set`.

### Predicates

Conditions can be spoken and `is not` negates every predicate:

| Predicate                        | Meaning                |
| -------------------------------- | ---------------------- |
| `n is even`, `n is odd`          | parity, integers only  |
| `x is positive`, `x is negative` | sign of any number     |
| `n is divisible by k`            | `n % k == 0`           |
| `x is between a and b`           | inclusive on both ends |
| `s is empty`                     | the string is `""`     |

```java
if (year is divisible by 4 and year is not divisible by 100) { ... }
if (guess is between 1 and 100) { ... }
```

### Repeat loops

`repeat 5 times { ... }` runs a block a fixed number of times without naming a
counter; the count is any integer expression, evaluated once.
`repeat { ... } until (done)` runs the body at least once and stops when the
condition becomes true. `stop;` and `skip;` work inside both.

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

| Spoken                             | Symbolic                       | Result                     |
| ---------------------------------- | ------------------------------ | -------------------------- |
| `square root of x`                 | `sqrt(x)`                      | float                      |
| `absolute value of x`              | `abs(x)`                       | same type as `x`           |
| `floor of x`, `ceiling of x`       | `floor(x)`, `ceiling(x)`       | integer                    |
| -                                  | `round(x)`                     | integer                    |
| -                                  | `min(a, b)`, `max(a, b)`       | float if either is a float |
| `length of s`                      | `length(s)`                    | integer                    |
| `uppercase of s`, `lowercase of s` | `uppercase(s)`, `lowercase(s)` | string                     |

Spoken builtins apply to the term right after them: `length of s + 1` is
`length(s) + 1`.

### Control flow

- `else if` chains, with `otherwise` as a synonym for `else`.
- `stop;` (or `break;`) leaves the innermost loop; `skip;` (or `continue;`)
  moves to its next iteration. Both are compile errors outside a loop.

### In-place updates

An update changes a variable where it stands. Updates are statements, not
expressions: `i++` has no value, so `x <- i++` is a syntax error rather than a
trap. Every spoken form lowers to the same single IR instruction as its
symbolic twin.

| Symbolic               | Spoken                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `n++;` / `++n;`        | `increment n;`, `increment the n;`, `n is incremented;`                                                   |
| `n--;` / `--n;`        | `decrement n;`, `decrement the n;`, `n is decremented;`                                                   |
| `n += x;`              | `increase n by x;`, `add x to n;`, `x is added to n;`                                                     |
| `n -= x;`              | `decrease n by x;`, `subtract x from n;`, `take x from n;`, `remove x from n;`, `x is subtracted from n;` |
| `n *= x;`              | `multiply n by x;`                                                                                        |
| `n /= x;`              | `divide n by x;`                                                                                          |
| `n %= x;`              | -                                                                                                         |
| `n ^= x;` / `n **= x;` | -                                                                                                         |
| `n *= 2;`              | `double n;`, `n is doubled;`                                                                              |
| `n /= 2;`              | `halve n;`, `n is halved;`                                                                                |

`the` is optional after every verb (`add 3 to the total`). An update is
type-checked exactly like the assignment it stands for: `s += "!"` concatenates
when `s` is a string, `halve n` on an integer is integer division and
`increment name` on a string is a compile error. The classic `for` loop takes
an update as its third clause: `for (integer i <- 1; i <= 5; i++)`.

The verbs, the range-loop words, the voice words and the list words (`add`,
`double`, `to`, `from`, `by`, `the`, `step`, `until`, `say`, `ask`, `set`,
`let`, `be`, `swap`, `repeat`, `even`, `odd`, `list`, `in`, `at`, `push`,
`pop`, `insert`, `into`, `contains`, ...) are keywords, so they cannot name a
variable or a function.

### Range loops

```java
for i from 1 to 10 { ... }             // 1, 2, ..., 10
for i from 0 until 10 { ... }          // 0, 1, ..., 9
for i from 10 down to 1 { ... }        // 10, 9, ..., 1
for i from 0 to 100 step 5 { ... }     // also: by 5, in steps of 5
for float x from 0.0 to 1.0 step 0.25 { ... }
```

`to` is inclusive, `until` is exclusive and `down to` counts down. The loop
variable is a fresh `integer` (or the type given) scoped to the loop. The
start, end and step are evaluated once, before the first iteration, so
reassigning the bound inside the body does not change how many times it runs.
The step must be positive; to count down, say `down to`. Parentheses around the
clause are optional.

### Lists

```java
list<integer> a;                       // empty; also: integer[] a; integer a[];
b is a list of integers;               // spoken
integer zeros[3];                      // [0, 0, 0]
let primes be [2, 3, 5];               // inferred: list of integer
integer[][] grid <- [[1, 2], [3, 4]];  // lists nest

say primes[0], " ", 1st item of primes;   // 2 2 - subscripts count from 0, ordinals from 1
set the 2nd item of primes to 33;
primes[0]++;

push 7 to primes;                      // append; also push(primes, 7)
push 1 to primes at 0;                 // before item 0; also insert 1 into primes at 0
let last be pop primes;                // remove and return the last item; `pop primes at i` picks one
say length of primes, " ", primes contains 33, " ", primes is empty;

for each p in primes { say p; }        // also: for every p in primes; for (integer p : primes)
```

Lists are references: `ys <- xs` makes two names for one list, and a function
that receives a list works on the caller's list. `copy of xs` makes a separate
one. `is` compares lists item by item. Indexes run from `0` to `length - 1`;
anything else - including a negative index - is a runtime error, as is popping
an empty list. Ordinals are checked: `2th item` is a compile error that tells
you to write `2nd`. Inside `for each` the length is re-read every turn, so
pushing to the list extends the loop.

### Powers

`x ^ y`, `x ** y`, `x to the power of y` and `x raised to the power of y` are
the same operator. `x squared` and `x cubed` are postfix spellings of `x ^ 2`
and `x ^ 3`.

### Procedures

A function that returns nothing is declared with `procedure`, `void` or
`nothing`. It may `return;` early but cannot return a value and calling it
where a value is expected is a compile error.

```java
procedure greet(string who) {
    say "hello, ", who;
}
```
