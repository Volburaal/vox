grammar Vox;

// ---------------------------------------------- parser ----------------------------------------------

program        : function* mainFunction EOF ;

mainFunction   : MAIN block ;

function       : prototype | definition ;
prototype      : returnType ID '(' parameterList? ')' ';' ;
definition     : returnType ID '(' parameterList? ')' block ;
parameterList  : parameter (',' parameter)* ;
parameter      : datatype ID ;
returnType     : datatype | VOID ;

block          : '{' statement* '}' ;

statement
    : variableDeclaration ';'   # declStmt
    | assignment ';'            # assignStmt
    | updateStatement ';'       # updateStmt
    | pushStatement ';'         # pushStmt
    | listStatement ';'         # listStmt
    | ifStatement               # ifStmt
    | whileLoop                 # whileStmt
    | forLoop                   # forStmt
    | rangeLoop                 # rangeStmt
    | forEachLoop               # forEachStmt
    | printStatement ';'        # printStmt
    | returnStatement ';'       # returnStmt
    | repeatLoop                # repeatStmt
    | SWAP target AND target ';'  # swapStmt
    | BREAK ';'                 # breakStmt
    | CONTINUE ';'              # continueStmt
    | expression ';'            # exprStmt
    ;

// A single rule covers `if`, `if/else` and `else if` chains, so the IR builder
// gets distinct blocks instead of one flattened statement list.
ifStatement    : IF '(' expression ')' thenBlock=block (ELSE (elseIf=ifStatement | elseBlock=block))? ;
whileLoop      : WHILE '(' expression ')' block ;
forLoop        : FOR '(' variableDeclaration forDel expression forDel forUpdate ')' block ;
forDel         : WHILE | ACTION | ';' | ',' | ':' ;
forUpdate      : assignment | updateStatement ;

// `for i from 1 to 10 { ... }`. The bounds and the step are evaluated once,
// before the first iteration. `to` is inclusive, `until` is exclusive and
// `down to` counts down. The loop variable is an integer unless a type is given.
rangeLoop      : FOR '(' rangeClause ')' block
               | FOR rangeClause block
               ;
rangeClause    : datatype? ID FROM start=expression dir=(TO | UNTIL | DOWN_TO) limit=expression
                 ((STEP | BY) step=expression)? ;

// `repeat 5 times { ... }` and `repeat { ... } until (done)`. The word
// `times` is the MUL token (as in `a times b`), which is why it appears as
// MUL here. The count is evaluated once; the until-body runs at least once.
repeatLoop     : REPEAT expression MUL block                  # repeatTimes
               | REPEAT block UNTIL '(' expression ')' ';'?   # repeatUntil
               ;

// `for each score in scores { ... }` and the C++ spelling
// `for (integer score : scores)`. The loop variable is a copy of the item and
// the length is re-read every turn, so pushing inside the body extends the loop.
forEachLoop    : FOR_EACH datatype? ID IN expression block
               | FOR '(' datatype ID ':' expression ')' block
               ;

// `fixed` declares a list that is born locked (an array, in C terms).
// `constant` declares a name that can never be assigned again.
variableDeclaration
    : DECL_START? FIXED? datatype ID (ASSIGN expression)?                                 # declForward
    | expression RASSIGN datatype ID                                                      # declReverse
    | LET ID BE expression                                                                # declLet
    // `integer xs[5]` is five defaults, `integer xs[]` is empty. The bracket
    // after the name adds one list dimension, as in C.
    | DECL_START? FIXED? datatype ID '[' size=expression? ']' (ASSIGN init=expression)?  # declSized
    | ID IS_A_LIST_OF datatype (ASSIGN init=expression)?                                  # declListIs
    | CONSTANT datatype ID ASSIGN expression                                              # declConstant
    | LET ID ALWAYS BE expression                                                         # declConstantLet
    ;

assignment
    : target ASSIGN expression        # assignForward
    | expression RASSIGN target       # assignReverse
    | SET THE? target TO expression   # setTo
    ;

// Anything that can be assigned to: a variable, an item by index, or an item
// by position. Ordinals count from one, so `2nd item of xs` is xs[1].
target
    : ID                              # nameTarget
    | target '[' expression ']'       # indexTarget
    | ORDINAL ITEM_OF target          # ordinalTarget
    ;

// In-place updates. These are statements, never expressions: `i++` has no
// value, so `x <- i++` is a syntax error rather than a trap. Every spoken form
// lowers to exactly the same IR as its symbolic twin.
updateStatement
    : INC target                                  # incStmt
    | target INC                                  # incStmt
    | INCREMENT THE? target                       # incStmt
    | target IS_INCREMENTED                       # incStmt
    | DEC target                                  # decStmt
    | target DEC                                  # decStmt
    | DECREMENT THE? target                       # decStmt
    | target IS_DECREMENTED                       # decStmt
    | target op=(ADD_ASSIGN | SUB_ASSIGN | MUL_ASSIGN | DIV_ASSIGN | MOD_ASSIGN | POW_ASSIGN) expression
                                                  # opAssign
    | INCREASE THE? target BY expression          # increaseBy
    | DECREASE THE? target BY expression          # decreaseBy
    | ADD_VERB expression TO THE? target          # addTo
    | expression IS_ADDED_TO THE? target          # addTo
    | SUBTRACT_VERB expression FROM THE? target   # takeFrom
    | expression IS_SUBTRACTED_FROM THE? target   # takeFrom
    | MULTIPLY THE? target BY expression          # multiplyBy
    | DIVIDE THE? target BY expression            # divideBy
    | DOUBLE THE? target                          # doubleStmt
    | target IS_DOUBLED                           # doubleStmt
    | HALVE THE? target                           # halveStmt
    | target IS_HALVED                            # halveStmt
    ;

// Growing a list. `push x to xs` appends; `at i` inserts before item i, and
// i may equal the length. Shrinking is `pop`, an expression, so the removed
// item can be used.
pushStatement
    : PUSH expression TO THE? expression (AT expression)?      # pushTo
    | INSERT expression INTO THE? expression AT expression     # insertInto
    | PUSH '(' expression ',' expression ')'                   # pushCall
    | INSERT '(' expression ',' expression ',' expression ')'  # insertCall
    ;

// One-list verbs: `lock xs;`, `sort the scores;`. `lock(xs)` is the same
// statement with a parenthesised operand, and `xs.lock()` is the dot form.
listStatement
    : verb=(LOCK | UNLOCK | WRAP | UNWRAP | SORT | REVERSE) THE? expression ;

printStatement  : PRINT '(' expression (',' expression)* ')'
                | SAY expression (',' expression)*
                ;
returnStatement : RETURN expression? ;
inputExpression : INPUT_CALL '(' ')' | INPUT ;
functionCall    : ID '(' (expression (',' expression)*)? ')' ;

// Precedence is the order of these alternatives, highest first.
// Prefix forms (builtins, negation, not) apply to the term that follows them;
// negation binds looser than power, so -x ^ 2 is -(x ^ 2) and -x squared is
// -(x squared).
expression
    : '(' expression ')'                          # parenExpr
    // `a.f(b)` means `f(a, b)`: the receiver is the first argument. This is
    // how `xs.push(5)`, `s.length()` and a user's own `n.twice()` all work.
    | expression '.' methodName '(' (expression (',' expression)*)? ')'   # methodCall
    | expression '[' expression ']'               # indexExpr
    | expression AS datatype                      # castExpr
    | expression op=(SQUARED | CUBED)             # squaredExpr
    | builtinName expression                      # builtinExpr
    | POSITION_OF expression IN expression        # positionExpr
    | ORDINAL ITEM_OF expression                  # ordinalExpr
    | POP '(' expression (',' expression)? ')'    # popCall
    | POP expression (AT expression)?             # popExpr
    | ASK expression                              # askExpr
    | <assoc=right> expression POW expression     # powExpr
    | SUB expression                              # negExpr
    | NOT expression                              # notExpr
    | expression op=(MUL|DIV|MOD) expression      # mulExpr
    | expression op=(ADD|SUB) expression          # addExpr
    | expression SUBFROM expression               # subFromExpr
    // Predicates reuse `is` (EQ) and `is not` (NE), so negation comes free.
    | expression op=(EQ|NE) pred=(EVEN | ODD | POSITIVE | NEGATIVE | EMPTY | LOCKED | WRAPPING)   # predicateExpr
    | expression op=(EQ|NE) DIVISIBLE BY expression                           # divisibleExpr
    | expression op=(EQ|NE) BETWEEN low=expression AND high=expression        # betweenExpr
    | expression op=(EQ|NE) IN expression                                     # inExpr
    | expression CONTAINS expression                                          # containsExpr
    | expression op=(LE|GE|LT|GT) expression      # relExpr
    | expression op=(EQ|NE) expression            # eqExpr
    | expression AND expression                   # andExpr
    | expression OR expression                    # orExpr
    | functionCall                                # callExpr
    | inputExpression                             # inputExpr
    | ID                                          # idExpr
    | INT                                         # intExpr
    | FLOAT                                       # floatExpr
    | STRING                                      # stringExpr
    | BOOL                                        # boolExpr
    | '[' (expression (',' expression)*)? ']'     # listExpr
    ;

// Spoken forms of the builtin functions. The symbolic forms (sqrt(x), abs(x),
// round(x), floor(x), ceiling(x), min(a, b), max(a, b), length(s),
// uppercase(s), lowercase(s)) are ordinary calls resolved by name.
builtinName : SQRT_OF | ABS_OF | LENGTH_OF | FLOOR_OF | CEIL_OF | UPPER_OF | LOWER_OF | COPY_OF
            | SUM_OF | LARGEST_OF | SMALLEST_OF ;

// What may follow a dot. The list verbs are keywords, so they are listed.
methodName  : ID | PUSH | INSERT | POP | LOCK | UNLOCK | WRAP | UNWRAP | SORT | REVERSE
            | LOCKED | WRAPPING ;

// `list<integer>`, `list of integers` and `integer[]` are the same type, and
// they nest: `integer[][]` is a list of lists.
datatype
    : LIST LT datatype GT                                                                        # listType
    | LIST_OF datatype                                                                           # listType
    | datatype '[' ']'                                                                           # listType
    | scalar=(DATATYPE_INT | DATATYPE_FLOAT | DATATYPE_BOOL | DATATYPE_CHAR | DATATYPE_STRING)   # scalarType
    ;

// ---------------------------------------------- lexer ----------------------------------------------

// Multi-word keywords are spelled with this fragment between words so they
// tolerate any run of whitespace, including newlines. The lexer always takes
// the longest match, so `is added to` wins over `is` and `to the power of`
// wins over `to`.
fragment S : [ \t\r\n]+ ;

MAIN     : 'main' | 'program' | 'code' ;
IF       : 'if' ;
ELSE     : 'else' | 'otherwise' ;
WHILE    : 'while' ;
FOR      : 'for' ;
ACTION   : 'action' | 'after' S 'iteration' ;
PRINT    : 'print' ;
INPUT_CALL : 'input' ;
INPUT    : 'an' S 'input' | 'some' S 'user' S 'input' | 'a' S 'user' S 'input' ;
RETURN   : 'return' ;
BREAK    : 'break' | 'stop' ;
CONTINUE : 'continue' | 'skip' ;
VOID     : 'void' | 'nothing' | 'procedure' ;
AS       : 'as' ;

// Range loops.
FROM     : 'from' ;
TO       : 'to' ;
DOWN_TO  : 'down' S 'to' ;
UNTIL    : 'until' ;
STEP     : 'step' | 'in' S 'steps' S 'of' ;
BY       : 'by' ;
THE      : 'the' ;

// Voice and textbook forms.
SAY       : 'say' ;
ASK       : 'ask' ;
SET       : 'set' ;
LET       : 'let' ;
BE        : 'be' ;
SWAP      : 'swap' ;
REPEAT    : 'repeat' ;
EVEN      : 'even' ;
ODD       : 'odd' ;
POSITIVE  : 'positive' ;
NEGATIVE  : 'negative' ;
EMPTY     : 'empty' ;
DIVISIBLE : 'divisible' ;
BETWEEN   : 'between' ;

// Lists. `item of`, `copy of` and `list of` are single tokens, so `item`,
// `copy` and `list` on their own stay usable as names.
LIST         : 'list' ;
LIST_OF      : 'list' S 'of' ;
IS_A_LIST_OF : 'is' S 'a' S 'list' S 'of' ;
ITEM_OF      : ('item' | 'value') S 'of' ;
COPY_OF      : 'copy' S 'of' ;
FOR_EACH     : 'for' S ('each' | 'every') ;
IN           : 'in' ;
AT           : 'at' ;
PUSH         : 'push' ;
INSERT       : 'insert' ;
INTO         : 'into' ;
POP          : 'pop' ;
CONTAINS     : 'contains' ;

// Locks, wrapping, ordering and constants.
LOCK        : 'lock' ;
UNLOCK      : 'unlock' ;
WRAP        : 'wrap' ;
UNWRAP      : 'unwrap' ;
LOCKED      : 'locked' ;
WRAPPING    : 'wrapping' ;
SORT        : 'sort' ;
REVERSE     : 'reverse' ;
FIXED       : 'fixed' ;
CONSTANT    : 'constant' ;
ALWAYS      : 'always' ;
SUM_OF      : 'sum' S 'of' ;
LARGEST_OF  : 'largest' S 'of' ;
SMALLEST_OF : 'smallest' S 'of' ;
POSITION_OF : 'position' S 'of' ;

// In-place updates: symbolic ...
INC        : '++' ;
DEC        : '--' ;
ADD_ASSIGN : '+=' ;
SUB_ASSIGN : '-=' ;
MUL_ASSIGN : '*=' ;
DIV_ASSIGN : '/=' ;
MOD_ASSIGN : '%=' ;
POW_ASSIGN : '^=' | '**=' ;

// ... and spoken. `is added to` and friends are single tokens so they never
// collide with `is` (equality) followed by an operator.
INCREMENT          : 'increment' ;
DECREMENT          : 'decrement' ;
IS_INCREMENTED     : 'is' S 'incremented' ;
IS_DECREMENTED     : 'is' S 'decremented' ;
INCREASE           : 'increase' ;
DECREASE           : 'decrease' ;
ADD_VERB           : 'add' ;
SUBTRACT_VERB      : 'subtract' | 'take' | 'remove' ;
IS_ADDED_TO        : 'is' S 'added' S 'to' ;
IS_SUBTRACTED_FROM : 'is' S 'subtracted' S 'from' ;
MULTIPLY           : 'multiply' ;
DIVIDE             : 'divide' ;
DOUBLE             : 'double' ;
HALVE              : 'halve' ;
IS_DOUBLED         : 'is' S 'doubled' ;
IS_HALVED          : 'is' S 'halved' ;

SQRT_OF   : 'square' S 'root' S 'of' ;
ABS_OF    : 'absolute' S 'value' S 'of' ;
LENGTH_OF : 'length' S 'of' ;
FLOOR_OF  : 'floor' S 'of' ;
CEIL_OF   : 'ceiling' S 'of' ;
UPPER_OF  : 'uppercase' S 'of' ;
LOWER_OF  : 'lowercase' S 'of' ;

DECL_START
    : ('consider'|'suppose') S ('an'|'a')
    | 'let' S 'there' S 'be' S ('an'|'a')
    ;

// '<=' and '=>' are comparisons only. They used to double as assignment
// operators, which made the grammar genuinely ambiguous.
ASSIGN  : '=' | '<-' | 'which' S 'is' S 'equal' S 'to' | 'which' S 'equals' ;
RASSIGN : '->' ;

SQUARED : 'squared' ;
CUBED   : 'cubed' ;
POW     : '^' | '**' | 'to' S 'the' S 'power' S 'of' | 'raised' S 'to' S 'the' S 'power' S 'of' ;
MUL     : '*'  | 'multiplied' S 'by' | 'times' ;
DIV     : '/'  | 'divided' S 'by' ;
MOD     : '%'  | 'remainder' S 'from' ;
ADD     : '+'  | 'added' S 'to' | 'plus' ;
SUB     : '-'  | 'minus' ;
SUBFROM : 'subtracted' S 'from' ;
LE      : '<=' | '=<' | 'is' S 'less' S 'or' S 'equal' S 'to' ;
GE      : '>=' | '=>' | 'is' S 'greater' S 'or' S 'equal' S 'to' ;
LT      : '<'  | 'is' S 'less' S 'than' ;
GT      : '>'  | 'is' S 'greater' S 'than' ;
NE      : '!=' | 'is' S 'not' ;
EQ      : '==' | 'equals' S 'to' | 'equals' | 'is' S 'equal' S 'to' | 'is' ;
AND     : '&&' | '&' | 'and' ;
OR      : '||' | '|' | 'or' ;
NOT     : '~'  | '!' | 'not' ;

// Plurals are accepted so `a list of integers` reads as written.
DATATYPE_INT    : 'int' | 'integer' | 'integers' | 'number' | 'numbers' | 'whole' S 'number' | 'whole' S 'numbers' ;
DATATYPE_FLOAT  : 'float' | 'floats' | 'floating' S 'point' S 'number' | 'floating' S 'point' S 'numbers' ;
DATATYPE_BOOL   : 'bool' | 'bools' | 'boolean' S 'number' | 'boolean' S 'numbers' | 'boolean' | 'booleans' ;
DATATYPE_CHAR   : 'character' | 'characters' | 'char' | 'chars' ;
DATATYPE_STRING : 'string' | 'strings' | 'character' S 'string' | 'character' S 'strings' | 'varchar' ;

BOOL   : 'true' | 'false' ;
FLOAT   : [0-9]+ '.' [0-9]+ ;
// `1st`, `2nd`, `3rd`, `4th`... The checker rejects a wrong suffix.
ORDINAL : [0-9]+ ('st' | 'nd' | 'rd' | 'th') ;
INT     : [0-9]+ ;
// Either quote style; escapes: \n \t \r \" \' \\
STRING : '"' (~["\\\r\n] | '\\' .)* '"'
       | '\'' (~['\\\r\n] | '\\' .)* '\''
       ;
ID     : [a-zA-Z_][a-zA-Z_0-9]* ;

LINE_COMMENT  : '//' ~[\r\n]* -> skip ;
BLOCK_COMMENT : '/*' .*? '*/' -> skip ;
WS            : [ \t\r\n]+ -> skip ;
