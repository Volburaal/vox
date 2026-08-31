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
    | ifStatement               # ifStmt
    | whileLoop                 # whileStmt
    | forLoop                   # forStmt
    | rangeLoop                 # rangeStmt
    | printStatement ';'        # printStmt
    | returnStatement ';'       # returnStmt
    | repeatLoop                # repeatStmt
    | SWAP ID AND ID ';'        # swapStmt
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

variableDeclaration
    : DECL_START? datatype ID (ASSIGN expression)?   # declForward
    | expression RASSIGN datatype ID                 # declReverse
    | LET ID BE expression                           # declLet
    ;

assignment
    : ID ASSIGN expression        # assignForward
    | expression RASSIGN ID       # assignReverse
    | SET THE? ID TO expression   # setTo
    ;

// In-place updates. These are statements, never expressions: `i++` has no
// value, so `x <- i++` is a syntax error rather than a trap. Every spoken form
// lowers to exactly the same IR as its symbolic twin.
updateStatement
    : INC ID                                  # incStmt
    | ID INC                                  # incStmt
    | INCREMENT THE? ID                       # incStmt
    | ID IS_INCREMENTED                       # incStmt
    | DEC ID                                  # decStmt
    | ID DEC                                  # decStmt
    | DECREMENT THE? ID                       # decStmt
    | ID IS_DECREMENTED                       # decStmt
    | ID op=(ADD_ASSIGN | SUB_ASSIGN | MUL_ASSIGN | DIV_ASSIGN | MOD_ASSIGN | POW_ASSIGN) expression
                                              # opAssign
    | INCREASE THE? ID BY expression          # increaseBy
    | DECREASE THE? ID BY expression          # decreaseBy
    | ADD_VERB expression TO THE? ID          # addTo
    | expression IS_ADDED_TO THE? ID          # addTo
    | SUBTRACT_VERB expression FROM THE? ID   # takeFrom
    | expression IS_SUBTRACTED_FROM THE? ID   # takeFrom
    | MULTIPLY THE? ID BY expression          # multiplyBy
    | DIVIDE THE? ID BY expression            # divideBy
    | DOUBLE THE? ID                          # doubleStmt
    | ID IS_DOUBLED                           # doubleStmt
    | HALVE THE? ID                           # halveStmt
    | ID IS_HALVED                            # halveStmt
    ;

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
    | expression AS datatype                      # castExpr
    | expression op=(SQUARED | CUBED)             # squaredExpr
    | builtinName expression                      # builtinExpr
    | ASK expression                              # askExpr
    | <assoc=right> expression POW expression     # powExpr
    | SUB expression                              # negExpr
    | NOT expression                              # notExpr
    | expression op=(MUL|DIV|MOD) expression      # mulExpr
    | expression op=(ADD|SUB) expression          # addExpr
    | expression SUBFROM expression               # subFromExpr
    // Predicates reuse `is` (EQ) and `is not` (NE), so negation comes free.
    | expression op=(EQ|NE) pred=(EVEN | ODD | POSITIVE | NEGATIVE | EMPTY)   # predicateExpr
    | expression op=(EQ|NE) DIVISIBLE BY expression                           # divisibleExpr
    | expression op=(EQ|NE) BETWEEN low=expression AND high=expression        # betweenExpr
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
    ;

// Spoken forms of the builtin functions. The symbolic forms (sqrt(x), abs(x),
// round(x), floor(x), ceiling(x), min(a, b), max(a, b), length(s),
// uppercase(s), lowercase(s)) are ordinary calls resolved by name.
builtinName : SQRT_OF | ABS_OF | LENGTH_OF | FLOOR_OF | CEIL_OF | UPPER_OF | LOWER_OF ;

datatype : DATATYPE_INT | DATATYPE_FLOAT | DATATYPE_BOOL | DATATYPE_CHAR | DATATYPE_STRING ;

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

DATATYPE_INT    : 'int' | 'integer' | 'number' | 'whole' S 'number' ;
DATATYPE_FLOAT  : 'float' | 'floating' S 'point' S 'number' ;
DATATYPE_BOOL   : 'bool' | 'boolean' S 'number' | 'boolean' ;
DATATYPE_CHAR   : 'character' | 'char' ;
DATATYPE_STRING : 'string' | 'character' S 'string' | 'varchar' ;

BOOL   : 'true' | 'false' ;
FLOAT  : [0-9]+ '.' [0-9]+ ;
INT    : [0-9]+ ;
STRING : '"' (~["\\\r\n] | '\\' .)* '"' ;
ID     : [a-zA-Z_][a-zA-Z_0-9]* ;

LINE_COMMENT  : '//' ~[\r\n]* -> skip ;
BLOCK_COMMENT : '/*' .*? '*/' -> skip ;
WS            : [ \t\r\n]+ -> skip ;
