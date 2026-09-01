/**
 * The documentation page's text. Code and output are not written here: each
 * section names a snippet in docs/snippets/ and the page shows that program
 * together with the output the compiler actually produced for it.
 *
 * In prose, `text between backticks` is rendered as inline code.
 */

export interface DocTable {
  head: string[];
  rows: string[][];
}

export interface DocSection {
  id: string;
  title: string;
  /** One or more paragraphs of prose. */
  body: string[];
  /** The snippet shown under the prose. */
  snippet?: string;
  /** Short rules worth pulling out of the prose. */
  notes?: string[];
  table?: DocTable;
  /** Rendered after the snippet rather than before it. */
  afterBody?: string[];
}

export interface DocCategory {
  id: string;
  title: string;
  intro: string;
  sections: DocSection[];
}

export const CATEGORIES: DocCategory[] = [
  {
    id: "first-steps",
    title: "First steps",
    intro: "The shape of a program and how it talks to you.",
    sections: [
      {
        id: "anatomy",
        title: "Anatomy of a program",
        body: [
          "A Vox program is one `main` block, optionally preceded by function definitions. Execution starts at `main` and ends when it falls off the end. If you prefer, `main` may be spelled `program` or `code`.",
          "Statements end with a semicolon. Blocks are wrapped in braces. Comments come in both C styles and multi-word keywords may span line breaks, so a long condition can wrap where it reads best.",
        ],
        snippet: "hello",
      },
      {
        id: "printing",
        title: "Printing",
        body: [
          "`print` writes exactly what you hand it and adds nothing. A line ends where you print `'\\n'`, which means you can build a line from several statements or lay out a row of values with separators of your choosing.",
          "`say` is the spoken form: it prints its arguments and finishes the line for you. It takes no parentheses. Both compile to the same single IR instruction - `say` simply appends a newline operand.",
        ],
        snippet: "printing",
        notes: [
          "String literals accept either quote style: `\"vox\"` and `'vox'` are the same value.",
          "Escapes are `\\n`, `\\t`, `\\r`, `\\\"`, `\\'` and `\\\\`.",
          "`print` takes parentheses and commas; `say` takes a bare comma-separated list.",
        ],
      },
      {
        id: "input",
        title: "Reading input",
        body: [
          "`ask` prints a prompt and reads one line back. Because `print` adds no newline, a prompt ending in a space leaves the cursor on the same line, exactly as a terminal program should.",
          "`input()` is the same reader without a prompt and `an input`, `a user input` and `some user input` are spoken spellings of it. Whatever is read is coerced: digits become an `integer`, `1.5` a `float`, `true`/`false` a `boolean` and anything else stays a `string`.",
        ],
        snippet: "input",
        afterBody: [
          "Because the coerced type is only known at run time, the checker treats input as dynamically typed and lets it flow anywhere. Use a cast when you want to insist: `an input as integer` fails loudly if the line was not a number.",
        ],
      },
    ],
  },

  {
    id: "values",
    title: "Values and variables",
    intro: "Five types, several ways to declare them and how conversion works.",
    sections: [
      {
        id: "declaring",
        title: "Declaring variables",
        body: [
          "A declaration is a type, a name and optionally a value. The assignment part can be a symbol or a phrase and a declaration can even be written backwards with `->`, putting the value first.",
          "A variable declared without a value gets its type's default, so it is never undefined.",
        ],
        snippet: "declaring",
        table: {
          head: ["Type", "Also spelled", "Default"],
          rows: [
            ["`integer`", "`int`, `number`, `whole number`", "`0`"],
            ["`float`", "`floating point number`", "`0.0`"],
            ["`boolean`", "`bool`, `boolean number`", "`false`"],
            ["`string`", "`character string`, `varchar`", '`""`'],
            ["`character`", "`char`", '`""`'],
          ],
        },
        notes: [
          "Integers are exact in the browser: they never overflow, so `factorial(25)` is the real answer.",
          "`/` between two integers truncates, as in most languages: `10 / 4` is `2`.",
        ],
      },
      {
        id: "inference",
        title: "Type inference",
        body: [
          "`let x be value` declares a variable and takes its type from the value, which keeps short programs free of ceremony. The inferred type is then enforced like any other: assigning a string to an inferred integer is a compile error.",
        ],
        snippet: "inference",
      },
      {
        id: "assignment",
        title: "Assignment and swap",
        body: [
          "Assignment has four spellings and they are interchangeable. `set x to value` is the textbook form; `<-` and `=` are the symbols; `->` writes the value first. The word `the` is optional after `set`, so `set the total to 0` reads naturally.",
          "`swap a and b` exchanges two variables through a hidden temporary - the classic pseudocode primitive, without the three-line dance.",
        ],
        snippet: "assignment",
        notes: [
          "`<=` and `=>` are comparisons only. They never assign.",
          "A bare comparison such as `x is equal to 5;` is a statement with no effect and the compiler warns you and points at `set`.",
        ],
      },
      {
        id: "casting",
        title: "Converting between types",
        body: [
          "`value as type` converts explicitly. Unlike a silent coercion, it fails loudly at run time when the value cannot be represented, which is what makes it safe to apply to user input.",
          'A cast binds tighter than any arithmetic, so `"3" as integer + 1` converts first and then adds.',
        ],
        snippet: "casting",
      },
      {
        id: "scope",
        title: "Scope and call frames",
        body: [
          "Every call gets its own frame. Parameters and locals belong to that frame alone, so a function cannot reach into its caller and a recursive function has a fresh copy of each variable at every depth.",
        ],
        snippet: "scope",
      },
    ],
  },

  {
    id: "expressions",
    title: "Expressions",
    intro:
      "Operators in both dialects, how they bind and conditions that read like sentences.",
    sections: [
      {
        id: "operators",
        title: "Operators, spoken and symbolic",
        body: [
          "Every arithmetic and comparison operator has a spoken form and a symbol and they compile to identical instructions. You can mix the two in one expression - nothing about the natural spelling is a preprocessor trick.",
          "One operator reads backwards on purpose: `a subtracted from b` is `b - a`, because that is what the English means.",
        ],
        snippet: "operators",
        table: {
          head: ["Symbol", "Spoken"],
          rows: [
            ["`+`", "`added to`, `plus`"],
            ["`-`", "`minus`"],
            ["`*`", "`multiplied by`, `times`"],
            ["`/`", "`divided by`"],
            ["`%`", "`remainder from`"],
            ["`^`, `**`", "`to the power of`, `raised to the power of`"],
            ["`<`, `>`", "`is less than`, `is greater than`"],
            ["`<=`, `>=`", "`is less or equal to`, `is greater or equal to`"],
            ["`==`", "`is`, `is equal to`, `equals`, `equals to`"],
            ["`!=`", "`is not`"],
            ["`&&`, `||`, `!`", "`and`, `or`, `not`"],
          ],
        },
      },
      {
        id: "precedence",
        title: "Precedence",
        body: [
          "Precedence is real, not left-to-right evaluation: multiplication binds tighter than addition, arithmetic binds tighter than comparison and powers are right associative.",
          "Prefix and postfix forms apply to the term next to them, which is the rule worth remembering: `length of s + 1` is `length(s) + 1` and `-2 ^ 2` is `-(2 ^ 2)`.",
        ],
        snippet: "precedence",
      },
      {
        id: "powers",
        title: "Powers",
        body: [
          "Four spellings of the same operator, plus two postfix words for the common cases. An all-integer power with a non-negative exponent stays an integer; a negative exponent or a float operand produces a float.",
        ],
        snippet: "powers",
      },
      {
        id: "predicates",
        title: "Predicates",
        body: [
          "Conditions can be written as sentences. Predicates are ordinary boolean expressions - they lower to the comparisons they abbreviate - and because they reuse `is` and `is not`, negating any of them is free.",
        ],
        snippet: "predicates",
        table: {
          head: ["Predicate", "Means", "Applies to"],
          rows: [
            ["`n is even`, `n is odd`", "`n % 2 == 0`, `!= 0`", "integers"],
            ["`x is positive`", "`x > 0`", "any number"],
            ["`x is negative`", "`x < 0`", "any number"],
            ["`n is divisible by k`", "`n % k == 0`", "integers"],
            [
              "`x is between a and b`",
              "`x >= a and x <= b`",
              "any ordered pair",
            ],
            ["`s is empty`", '`s == ""`', "strings"],
          ],
        },
      },
    ],
  },

  {
    id: "control",
    title: "Control flow",
    intro: "Branches, four kinds of loop and the two words that steer them.",
    sections: [
      {
        id: "branching",
        title: "Branching",
        body: [
          "`if`, `else if` and `else` behave as you expect and `otherwise` is a synonym for `else` that reads better in a spoken program. Chains nest properly - each branch is its own block, not a flattened statement list.",
        ],
        snippet: "branching",
      },
      {
        id: "while",
        title: "while",
        body: [
          "The condition is tested before each turn. Any expression works as a condition; a string condition is true when it is non-empty and the compiler warns when you rely on that by accident.",
        ],
        snippet: "while",
      },
      {
        id: "for",
        title: "The classic for loop",
        body: [
          "Three parts: a declaration, a condition and an update. The separators are flexible - `;`, `,`, `:` or the words `while` and `after iteration` - so the same loop can be written in symbols or spoken aloud.",
        ],
        snippet: "for",
      },
      {
        id: "range-loops",
        title: "Range loops",
        body: [
          "When you are just counting, name the range instead of assembling a loop from parts. `to` is inclusive, `until` is exclusive and `down to` counts down - the direction is decided by the word, not by comparing the bounds at run time.",
          "The start, end and step are each evaluated once, before the first turn, so reassigning a bound inside the body cannot change how many times the loop runs. The loop variable is a fresh `integer` unless you give it a type.",
        ],
        snippet: "range-loops",
        notes: [
          "The step must be positive; to count down, say `down to`.",
          "Parentheses around the clause are optional: `for (i from 1 to 10)` also works.",
          "`step 2`, `by 2` and `in steps of 2` are the same thing.",
        ],
      },
      {
        id: "repeat",
        title: "repeat",
        body: [
          "`repeat n times` runs a block a fixed number of times without naming a counter - the count is any integer expression, evaluated once. `repeat ... until` runs the body first and then tests, so it always runs at least once.",
        ],
        snippet: "repeat",
      },
      {
        id: "stop-skip",
        title: "stop and skip",
        body: [
          "`stop` leaves the innermost loop and `skip` moves to its next turn. `break` and `continue` are accepted as synonyms. Both work in every loop and using either outside a loop is a compile error rather than a puzzle at run time.",
          "In a `for` loop, `skip` still runs the update step, so a counter cannot be silently skipped into an infinite loop.",
        ],
        snippet: "stop-skip",
      },
    ],
  },

  {
    id: "updates",
    title: "Changing values in place",
    intro: "One instruction, a dozen ways to say it.",
    sections: [
      {
        id: "in-place-updates",
        title: "In-place updates",
        body: [
          "An update changes a variable where it stands. Updates are statements, never expressions: `i++` has no value, so `x <- i++` is a syntax error rather than a trap and the `i = i++` class of bug cannot be written.",
          "Each row below is one IR instruction whose destination is also its first operand and every spelling in a row produces exactly the same instruction.",
        ],
        snippet: "updates",
        table: {
          head: ["Symbolic", "Spoken"],
          rows: [
            ["`n++`, `++n`", "`increment n`, `n is incremented`"],
            ["`n--`, `--n`", "`decrement n`, `n is decremented`"],
            ["`n += x`", "`increase n by x`, `add x to n`, `x is added to n`"],
            [
              "`n -= x`",
              "`decrease n by x`, `subtract x from n`, `take x from n`, `remove x from n`, `x is subtracted from n`",
            ],
            ["`n *= x`", "`multiply n by x`"],
            ["`n /= x`", "`divide n by x`"],
            ["`n *= 2`", "`double n`, `n is doubled`"],
            ["`n /= 2`", "`halve n`, `n is halved`"],
            ["`n %= x`, `n ^= x`, `n **= x`", "-"],
          ],
        },
        notes: [
          "`the` is optional after every verb: `add 3 to the total`.",
          'An update is type-checked as the assignment it stands for, so `s += "!"` concatenates and `increment name` on a string is an error.',
          "The classic `for` loop accepts an update as its third clause.",
        ],
      },
    ],
  },

  {
    id: "functions",
    title: "Functions",
    intro: "Values in, values out (or nothing at all)",
    sections: [
      {
        id: "functions",
        title: "Functions",
        body: [
          "A function declares a return type, a name and typed parameters. Signatures are collected before any body is checked, so functions may call each other in any order and recursion works because every call gets its own frame.",
          "Arguments are checked for count and type. Passing a float where an integer is expected is a warning about lost precision instead of a silent truncation.",
        ],
        snippet: "functions",
      },
      {
        id: "procedures",
        title: "Procedures",
        body: [
          "A function that returns nothing is declared `procedure`, `void` or `nothing`. It may `return;` early but cannot return a value and using a call to one where a value is expected is a compile error rather than a null surprise.",
          "A prototype - a signature followed by a semicolon - declares a function whose body comes later in the file.",
        ],
        snippet: "procedures",
      },
      {
        id: "builtins",
        title: "Builtin functions",
        body: [
          "The builtins come in a spoken and a symbolic form. They are resolved by name and are not reserved words: define your own `length` and yours wins, with no special case in the grammar.",
          "A spoken builtin applies to the term right after it, so `length of s + 1` adds one to the length.",
        ],
        snippet: "builtins",
        table: {
          head: ["Spoken", "Symbolic", "Result"],
          rows: [
            ["`square root of x`", "`sqrt(x)`", "`float`"],
            ["`absolute value of x`", "`abs(x)`", "same as `x`"],
            [
              "`floor of x`, `ceiling of x`",
              "`floor(x)`, `ceiling(x)`",
              "`integer`",
            ],
            ["-", "`round(x)`", "`integer`"],
            ["-", "`min(a, b)`, `max(a, b)`", "float if either is"],
            ["`length of s`", "`length(s)`", "`integer`"],
            [
              "`uppercase of s`, `lowercase of s`",
              "`uppercase(s)`, `lowercase(s)`",
              "`string`",
            ],
          ],
        },
      },
    ],
  },

  {
    id: "diagnostics",
    title: "When things go wrong",
    intro:
      "What the compiler catches, what it merely warns about and what waits until run time.",
    sections: [
      {
        id: "compile-errors",
        title: "Compile errors",
        body: [
          "Names, types and argument counts are checked before anything runs. Every message carries a line, a column and a range, which is what the playground underlines as you type. A program with errors is never lowered to IR, so a broken program cannot half-run.",
        ],
        snippet: "compile-errors",
      },
      {
        id: "warnings",
        title: "Warnings",
        body: [
          "Some things are legal but suspicious and those are warnings: the program still runs. A bare comparison used as a statement is the one worth knowing, because in a language this close to English it looks like an assignment.",
        ],
        snippet: "warnings",
      },
      {
        id: "runtime-errors",
        title: "Runtime errors",
        body: [
          "What the types cannot rule out is checked as it happens: division by zero, a cast that cannot succeed, the square root of a negative number. The program stops at that point, having produced whatever it printed before.",
          "A step limit - fifty million instructions by default - stops runaway loops with an explanation instead of hanging.",
        ],
        snippet: "runtime-errors",
      },
    ],
  },

  {
    id: "internals",
    title: "Under the hood",
    intro: "What your program becomes.",
    sections: [
      {
        id: "ir",
        title: "The intermediate representation",
        body: [
          "Every program is lowered to a flat list of simple instructions and a small virtual machine runs that list. There is no LLVM and no transpilation step - the IR below is the whole compiled form and the playground shows it for whatever you type.",
          "This is why the language can keep growing without the runtime changing: range loops, predicates, `say` and the in-place verbs are all lowered into instructions that already existed. Notice `say total` at the end - it is a `print` with a newline operand.",
        ],
        snippet: "ir",
        afterBody: [
          "Two engines execute this IR: a Java reference implementation and the TypeScript port that runs in your browser. Both are built from the same grammar and pass the same regression suite, instruction for instruction.",
        ],
      },
    ],
  },
];

/** The reference tables at the foot of the page. */
export const REFERENCE: {
  id: string;
  title: string;
  note?: string;
  table: DocTable;
}[] = [
  {
    id: "ref-precedence",
    title: "Precedence, highest first",
    note: "Operators on the same row bind equally and associate left to right, except powers, which associate right.",
    table: {
      head: ["Level", "Operators"],
      rows: [
        ["1", "`( )`"],
        ["2", "`as` (cast)"],
        ["3", "`squared`, `cubed`"],
        ["4", "spoken builtins: `square root of`, `length of`, ..."],
        ["5", "`^`, `**`, `to the power of` (right associative)"],
        ["6", "unary `-`"],
        ["7", "`not`, `!`, `~`"],
        ["8", "`*`, `/`, `%`"],
        ["9", "`+`, `-`"],
        ["10", "`subtracted from`"],
        ["11", "predicates: `is even`, `is between ... and ...`, ..."],
        ["12", "`<`, `>`, `<=`, `>=`"],
        ["13", "`==`, `!=`"],
        ["14", "`and`, `&&`"],
        ["15", "`or`, `||`"],
      ],
    },
  },
  {
    id: "ref-keywords",
    title: "Reserved words",
    note: "These cannot be used as variable or function names.",
    table: {
      head: ["Group", "Words"],
      rows: [
        [
          "Structure",
          "`main`, `program`, `code`, `return`, `void`, `nothing`, `procedure`",
        ],
        ["Branching", "`if`, `else`, `otherwise`"],
        [
          "Loops",
          "`while`, `for`, `repeat`, `action`, `from`, `to`, `until`, `step`, `by`, `down to`, `in steps of`",
        ],
        ["Loop control", "`stop`, `break`, `skip`, `continue`"],
        ["I/O", "`print`, `say`, `input`, `ask`"],
        ["Assignment", "`set`, `let`, `be`, `swap`, `the`"],
        [
          "Updates",
          "`increment`, `decrement`, `increase`, `decrease`, `add`, `subtract`, `take`, `remove`, `multiply`, `divide`, `double`, `halve`",
        ],
        [
          "Predicates",
          "`even`, `odd`, `positive`, `negative`, `empty`, `divisible`, `between`",
        ],
        [
          "Operators",
          "`is`, `equals`, `plus`, `minus`, `times`, `and`, `or`, `not`, `as`, `squared`, `cubed`",
        ],
        [
          "Types",
          "`int`, `integer`, `number`, `float`, `bool`, `boolean`, `char`, `character`, `string`, `varchar`",
        ],
        ["Literals", "`true`, `false`"],
      ],
    },
  },
  {
    id: "ref-cli",
    title: "Command line",
    note: "The same flags work on both engines: `vox file.vox` and `node core/dist/cli.js file.vox`.",
    table: {
      head: ["Flag or code", "Meaning"],
      rows: [
        ["`--emit-ir`", "print the generated IR"],
        ["`--check`", "parse and type-check only, do not run"],
        ["`--steps N`", "change the step limit (default 50,000,000)"],
        ["exit `0`", "success"],
        ["exit `1`", "compile error"],
        ["exit `2`", "runtime error"],
        ["exit `64`", "bad usage"],
      ],
    },
  },
];

/** Maps each section to the snippet it shows, so the page can preload them. */
export const ALL_SECTIONS = CATEGORIES.flatMap((c) => c.sections);
