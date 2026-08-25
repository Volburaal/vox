#!/usr/bin/env bash
# Builds Vox: generates the parser from Vox.g4, compiles everything, packages
# a runnable jar at build/vox.jar.
set -euo pipefail

cd "$(dirname "$0")"

ANTLR_JAR="tools/antlr-4.13.2-complete.jar"
GEN_DIR="build/gen"
CLASS_DIR="build/classes"
JAR_OUT="build/vox.jar"

if [ ! -f "$ANTLR_JAR" ]; then
    echo "build: missing $ANTLR_JAR" >&2
    exit 1
fi

echo "==> generating parser"
rm -rf "$GEN_DIR" "$CLASS_DIR"
mkdir -p "$GEN_DIR" "$CLASS_DIR"
java -cp "$ANTLR_JAR" org.antlr.v4.Tool -visitor -no-listener -o "$GEN_DIR" Vox.g4

echo "==> compiling"
find "$GEN_DIR" src -name '*.java' > build/sources.txt
javac -nowarn -d "$CLASS_DIR" -cp "$ANTLR_JAR" @build/sources.txt

echo "==> packaging $JAR_OUT"
# Unpack the ANTLR runtime into the jar so it is self-contained.
UNPACK="build/runtime"
rm -rf "$UNPACK"
mkdir -p "$UNPACK"
( cd "$UNPACK" && jar xf "../../$ANTLR_JAR" org/antlr/v4/runtime )
jar --create --file "$JAR_OUT" --main-class VoxMain -C "$CLASS_DIR" . -C "$UNPACK" org

echo "==> done: $JAR_OUT"
echo "    run with: java -jar $JAR_OUT examples/factorial.vox"
