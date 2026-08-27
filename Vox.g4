grammar Vox;

// ---------------------------------------------- parser ----------------------------------------------

program        : function* mainFunction EOF ;

mainFunction   : MAIN block ;

function       : prototype | definition ;
prototype      : returnType ID '(' parameterList? ')' ';' ;
definition     : returnType ID '(' parameterList? ')' block ;
parameterList  : parameter (',' parameter)* ;
parameter      : datatype ID ;
returnType     : datatype ;

block          : '{' statement* '}' ;

statement
    : variableDeclaration ';'   # declStmt
    | assignment ';'            # assignStmt
    | ifStatement               # ifStmt
    | whileLoop                 # whileStmt
    | forLoop                   # forStmt
    | printStatement ';'        # printStmt
    | returnStatement ';'       # returnStmt
    | expression ';'            # exprStmt
    ;

// A single rule covers `if` and `if/else`, so the IR builder gets two distinct
// blocks instead of one flattened statement list.
ifStatement    : IF '(' expression ')' thenBlock=block (ELSE elseBlock=block)? ;
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
expression
    : '(' expression ')'                          # parenExpr
    | <assoc=right> expression POW expression     # powExpr
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

datatype : DATATYPE_INT | DATATYPE_FLOAT | DATATYPE_BOOL | DATATYPE_CHAR | DATATYPE_STRING ;

// ---------------------------------------------- lexer ----------------------------------------------

// Multi-word keywords are spelled with this fragment between words so they
// tolerate any run of whitespace, including newlines.
fragment S : [ \t\r\n]+ ;

MAIN   : 'main' ;
IF     : 'if' ;
ELSE   : 'else' ;
WHILE  : 'while' ;
FOR    : 'for' ;
ACTION : 'action' ;
PRINT  : 'print' ;
INPUT_CALL  : 'input' ;
INPUT: 'an input' | 'some user input' | 'a user input';
RETURN : 'return' ;

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
