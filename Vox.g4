grammar Vox;

@header {
    import java.util.*;
}

@members {
    static class SymbolTable {
        Stack<Map<String, String>> scopes = new Stack<>();

        public SymbolTable() {
            scopes.push(new HashMap<>());
        }

        public void enterScope() { scopes.push(new HashMap<>()); }
        public void exitScope() { if (!scopes.isEmpty()) scopes.pop(); }

        public void define(String name, String type) {
            scopes.peek().put(name, type);
        }

        public boolean isDefined(String name) {
            for (int i = scopes.size() - 1; i >= 0; i--) {
                if (scopes.get(i).containsKey(name)) return true;
            }
            return false;
        }

        public String getType(String name) {
            for (int i = scopes.size() - 1; i >= 0; i--) {
                if (scopes.get(i).containsKey(name)) return scopes.get(i).get(name);
            }
            return null;
        }

        public void printSymbolTable() {
            System.out.println("\n===== Symbol Table =====");
            for (int i = 0; i < scopes.size(); i++) {
                System.out.println("Scope " + i + ": " + scopes.get(i));
            }
        }
    }

    static SymbolTable symbolTable = new SymbolTable();
}

program: function* mainFunction {
    symbolTable.printSymbolTable();
};

mainFunction: 'integer' 'main' '(' ')' '{'
    {
        symbolTable.enterScope();
        symbolTable.define("main", "function");
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

function: prototype | definition;

prototype: returnType ID '(' parameterList? ')' ';' {
    symbolTable.define($ID.text, "function");
};

definition: returnType ID '(' parameterList? ')' '{'
    {
        if (symbolTable.isDefined($ID.text)) {
            System.err.println("Error: Function " + $ID.text + " already defined.");
        } else {
            symbolTable.define($ID.text, "function");
        }
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

parameterList: parameter (',' parameter)*;

parameter: datatype ID {
    symbolTable.define($ID.text, $datatype.text);
};

variableDeclaration: datatype ID 'equals to' expression {
    if (symbolTable.isDefined($ID.text)) {
        System.err.println("Error: Variable " + $ID.text + " already declared.");
    } else {
        symbolTable.define($ID.text, $datatype.text);
    }

    String lhsType = $datatype.text;
    String rhsType = $expression.type;
    if (!lhsType.equals(rhsType)) {
        System.out.println("Implicit cast: " + rhsType + " -> " + lhsType);
    }
};

assignment: ID 'equals to' expression {
    if (!symbolTable.isDefined($ID.text)) {
        System.err.println("Error: Variable " + $ID.text + " not declared.");
    } else {
        String lhsType = symbolTable.getType($ID.text);
        String rhsType = $expression.type;
        if (!lhsType.equals(rhsType)) {
            System.out.println("Implicit cast: " + rhsType + " -> " + lhsType);
        }
    }
};

ifStatement: 'if' '(' expression ')' '{'
    {
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

ifElse: 'if' '(' expression ')' '{'
    {
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}' 'else' '{'
    {
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

whileLoop: 'while' '(' expression ')' '{'
    {
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

forLoop: 'for' '(' variableDeclaration 'while' expression 'action' assignment ')' '{'
    {
        symbolTable.enterScope();
    }
    statement*
    {
        symbolTable.exitScope();
    }
'}';

functionCall returns [String type]: ID '(' argumentList? ')' {
    if (!symbolTable.isDefined($ID.text)) {
        System.err.println("Error: Function " + $ID.text + " not declared.");
    }
    $type = "integer"; // Placeholder: you may define return type tracking later
};

expression returns [String type]
    : ID {
        if (!symbolTable.isDefined($ID.text)) {
            System.err.println("Error: Variable " + $ID.text + " not declared.");
            $type = "error";
        } else {
            $type = symbolTable.getType($ID.text);
        }
    }
    | INT { $type = "integer"; }
    | FLOAT { $type = "float"; }
    | BOOL { $type = "boolean"; }
    | STRING { $type = "string"; }
    | functionCall { $type = $functionCall.type; }
    | inputExpression { $type = $inputExpression.type; }
    | '(' expression ')' { $type = $expression.type; }
    | e1=expression operator e2=expression {
        if ($e1.type.equals("float") || $e2.type.equals("float")) {
            $type = "float";
        } else if ($e1.type.equals("boolean") || $e2.type.equals("boolean")) {
            $type = "boolean";
        } else if ($e1.type.equals("string") || $e2.type.equals("string")) {
            if ($operator.text.equals("added to")) {
                $type = "string";
            } else {
                System.err.println("Error: Invalid operation between strings");
                $type = "error";
            }
        } else {
            $type = $e1.type;
        }
    }
    | 'not' expression { $type = "boolean"; }
    ;

datatype: 'integer' | 'float' | 'boolean' | 'character' | 'string';

operator: 'added to'
        | 'minus'
        | 'multiplied by'
        | 'divided by'
        | 'is equal to'
        | 'is less than'
        | 'is greater than'
        | 'and'
        | 'or';

returnType: datatype;

statement: variableDeclaration ';'
        | assignment ';'
        | expression ';'
        | ifStatement
        | ifElse
        | whileLoop
        | forLoop
        | functionCall ';'
        | returnStatement ';'
        | printStatement ';'
        ;

printStatement: 'print' '(' printArgs ')';
printArgs: expression (',' expression)*;

inputExpression returns [String type]:
    'input' '(' ')' {
        $type = "string";
    };

returnStatement: 'return' expression;

argumentList: expression (',' expression)*;

STRING : '"' (~["\\] | '\\' .)* '"' ;
INT: [0-9]+;
FLOAT: [0-9]+'.'[0-9]+;
BOOL: 'true' | 'false';
ID: [a-zA-Z_][a-zA-Z_0-9]*;
WS: [ \t\n\r]+ -> skip;
