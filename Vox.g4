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
    | ifStatement               # ifStmt
    | whileLoop                 # whileStmt
    | forLoop                   # forStmt
    | printStatement ';'        # printStmt
    | returnStatement ';'       # returnStmt
    | BREAK ';'                 # breakStmt
    | CONTINUE ';'              # continueStmt
    | expression ';'            # exprStmt
    ;

// A single rule covers `if`, `if/else` and `else if` chains, so the IR builder
// gets distinct blocks instead of one flattened statement list.
ifStatement    : IF '(' expression ')' thenBlock=block (ELSE (elseIf=ifStatement | elseBlock=block))? ;
whileLoop      : WHILE '(' expression ')' block ;
forLoop        : FOR '(' variableDeclaration forDel expression forDel assignment ')' block ;
forDel         : WHILE | ACTION | ';' | ',' | ':' ;

variableDeclaration
    : DECL_START? datatype ID (ASSIGN expression)?   # declForward
    | expression RASSIGN datatype ID                 # declReverse
    ;

assignment
    : ID ASSIGN expression    # assignForward
    | expression RASSIGN ID   # assignReverse
    ;

printStatement  : PRINT '(' expression (',' expression)* ')' ;
returnStatement : RETURN expression? ;
inputExpression : INPUT_CALL '(' ')' | INPUT ;
functionCall    : ID '(' (expression (',' expression)*)? ')' ;

// Precedence is the order of these alternatives, highest first.
// Prefix forms (builtins, negation, not) apply to the term that follows them;
// negation binds looser than power, so -x ^ 2 is -(x ^ 2).
expression
    : '(' expression ')'                          # parenExpr
    | expression AS datatype                      # castExpr
    | builtinName expression                      # builtinExpr
    | <assoc=right> expression POW expression     # powExpr
    | SUB expression                              # negExpr
    | NOT expression                              # notExpr
    | expression op=(MUL|DIV|MOD) expression      # mulExpr
    | expression op=(ADD|SUB) expression          # addExpr
    | expression SUBFROM expression               # subFromExpr
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
// tolerate any run of whitespace, including newlines.
fragment S : [ \t\r\n]+ ;

MAIN     : 'main' ;
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

POW     : '^'  | 'to' S 'the' S 'power' S 'of' ;
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
EQ      : '==' | 'equals' S 'to' | 'is' ;
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
