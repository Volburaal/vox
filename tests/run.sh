#!/usr/bin/env bash
# Vox regression suite.
#
#   tests/run/NAME.vox   + NAME.out     expect exit 0 and this exact stdout
#   tests/run/NAME.in                   optional stdin for the program
#   tests/fail/NAME.vox  + NAME.expect  first line = expected exit code,
#                                       remaining lines = substrings that must
#                                       appear in the combined output
#
# Every program is run with stdin redirected, so a test that calls input()
# without an .in file cannot hang the suite.
#
# Line endings are normalised on both sides, so CRLF from the JVM on Windows
# does not cause spurious failures.
set -uo pipefail

cd "$(dirname "$0")/.."

# The engine under test. Defaults to the Java reference implementation; set
# VOX_CMD to point the same suite at another engine, e.g.
#   VOX_CMD="node core/dist/cli.js" tests/run.sh
if [ -z "${VOX_CMD:-}" ]; then
    JAR="build/vox.jar"
    if [ ! -f "$JAR" ]; then
        echo "tests: $JAR not found - run ./build.sh first" >&2
        exit 1
    fi
    VOX_CMD="java -jar $JAR"
fi
echo "engine: $VOX_CMD"

pass=0
fail=0
failed_names=()

strip_cr() { tr -d '\r'; }

# ---- programs that must run and produce exact output ------------------------
for src in tests/run/*.vox; do
    name="$(basename "$src" .vox)"
    expected_file="tests/run/$name.out"

    if [ ! -f "$expected_file" ]; then
        echo "MISS  $name (no .out file)"
        fail=$((fail + 1)); failed_names+=("$name"); continue
    fi

    stdin_file="tests/run/$name.in"
    [ -f "$stdin_file" ] || stdin_file="/dev/null"

    actual="$($VOX_CMD "$src" < "$stdin_file" 2>/dev/null | strip_cr)"
    status=$?
    expected="$(strip_cr < "$expected_file")"

    if [ "$status" -ne 0 ]; then
        echo "FAIL  $name (exit $status, expected 0)"
        fail=$((fail + 1)); failed_names+=("$name")
    elif [ "$actual" = "$expected" ]; then
        echo "ok    $name"
        pass=$((pass + 1))
    else
        echo "FAIL  $name (output mismatch)"
        diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") \
            | sed 's/^/        /' | head -20
        fail=$((fail + 1)); failed_names+=("$name")
    fi
done

# ---- programs that must be rejected ----------------------------------------
for src in tests/fail/*.vox; do
    name="$(basename "$src" .vox)"
    expect_file="tests/fail/$name.expect"

    if [ ! -f "$expect_file" ]; then
        echo "MISS  $name (no .expect file)"
        fail=$((fail + 1)); failed_names+=("$name"); continue
    fi

    # A tight step limit keeps the infinite-loop test quick.
    output="$($VOX_CMD "$src" --steps 200000 < /dev/null 2>&1 | strip_cr)"
    status=$?

    want_status="$(head -1 "$expect_file" | strip_cr)"
    problem=""

    if [ "$status" != "$want_status" ]; then
        problem="exit $status, expected $want_status"
    else
        while IFS= read -r needle; do
            [ -z "$needle" ] && continue
            case "$output" in
                *"$needle"*) ;;
                *) problem="missing text: $needle" ; break ;;
            esac
        done < <(tail -n +2 "$expect_file" | strip_cr)
    fi

    if [ -z "$problem" ]; then
        echo "ok    $name (rejected as expected)"
        pass=$((pass + 1))
    else
        echo "FAIL  $name ($problem)"
        printf '%s\n' "$output" | sed 's/^/        /' | head -10
        fail=$((fail + 1)); failed_names+=("$name")
    fi
done

# ---- documentation snippets -------------------------------------------------
# Every code block on the website's /docs page is a real program here, checked
# against the output the page shows. Docs cannot drift from the compiler.
#
#   docs/snippets/NAME.vox  + NAME.out   exact stdout
#                           + NAME.err   exact diagnostics (path prefix stripped)
#                           + NAME.ir    exact emitted IR
#                           + NAME.in    optional stdin
for src in docs/snippets/*.vox; do
    name="$(basename "$src" .vox)"
    stdin_file="docs/snippets/$name.in"
    [ -f "$stdin_file" ] || stdin_file="/dev/null"

    problem=""
    checked=0

    if [ -f "docs/snippets/$name.out" ]; then
        checked=1
        actual="$($VOX_CMD "$src" < "$stdin_file" 2>/dev/null | strip_cr)"
        expected="$(strip_cr < "docs/snippets/$name.out")"
        if [ "$actual" != "$expected" ]; then
            problem="stdout mismatch"
            diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") \
                | sed 's/^/        /' | head -10
        fi
    fi

    if [ -z "$problem" ] && [ -f "docs/snippets/$name.err" ]; then
        checked=1
        # Diagnostics carry the source path; the page shows them without it.
        actual="$($VOX_CMD "$src" < "$stdin_file" 2>&1 >/dev/null \
            | strip_cr | sed -e "s|^$src: *||" -e 's/^\(> \)*//')"
        expected="$(strip_cr < "docs/snippets/$name.err")"
        if [ "$actual" != "$expected" ]; then
            problem="stderr mismatch"
            diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") \
                | sed 's/^/        /' | head -10
        fi
    fi

    if [ -z "$problem" ] && [ -f "docs/snippets/$name.ir" ]; then
        checked=1
        actual="$($VOX_CMD "$src" --emit-ir --check 2>/dev/null | strip_cr)"
        expected="$(strip_cr < "docs/snippets/$name.ir")"
        [ "$actual" = "$expected" ] || problem="IR mismatch"
    fi

    [ "$checked" -eq 0 ] && problem="no .out/.err/.ir file"

    if [ -z "$problem" ]; then
        echo "ok    docs:$name"
        pass=$((pass + 1))
    else
        echo "FAIL  docs:$name ($problem)"
        fail=$((fail + 1)); failed_names+=("docs:$name")
    fi
done

# ---- the shipped examples must at least run ---------------------------------
for src in examples/*.vox; do
    name="$(basename "$src" .vox)"
    stdin_file="examples/$name.in"
    [ -f "$stdin_file" ] || stdin_file="/dev/null"
    if $VOX_CMD "$src" < "$stdin_file" >/dev/null 2>&1; then
        echo "ok    example:$name"
        pass=$((pass + 1))
    else
        echo "FAIL  example:$name (non-zero exit)"
        fail=$((fail + 1)); failed_names+=("example:$name")
    fi
done

echo
echo "$pass passed, $fail failed"
if [ "$fail" -ne 0 ]; then
    echo "failed: ${failed_names[*]}"
    exit 1
fi
