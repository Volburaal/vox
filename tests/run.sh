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

JAR="build/vox.jar"
if [ ! -f "$JAR" ]; then
    echo "tests: $JAR not found - run ./build.sh first" >&2
    exit 1
fi

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

    actual="$(java -jar "$JAR" "$src" < "$stdin_file" 2>/dev/null | strip_cr)"
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
    output="$(java -jar "$JAR" "$src" --steps 200000 < /dev/null 2>&1 | strip_cr)"
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

# ---- the shipped examples must at least run ---------------------------------
for src in examples/*.vox; do
    name="$(basename "$src" .vox)"
    if java -jar "$JAR" "$src" < /dev/null >/dev/null 2>&1; then
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
