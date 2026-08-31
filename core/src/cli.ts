import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { compile } from './compiler.js';
import { IRExecutor } from './IRExecutor.js';
import { VoxRuntimeError } from './values.js';

/**
 * Node CLI mirroring the Java VoxMain: same flags, same message shapes, same
 * exit codes (0 success, 1 compile error, 2 runtime error, 64 bad usage), so
 * the shared regression suite can drive either engine.
 */

const USAGE =
    'Usage: vox <source.vox> [options]\n'
  + '  --emit-ir     print the generated IR\n'
  + '  --check       parse and type-check only, do not run\n'
  + '  --steps <n>   change the execution step limit\n';

function fail(code: number, message: string): never {
    process.stderr.write(message + '\n');
    process.exit(code);
}

function report(path: string, messages: string[]): void {
    for (const m of messages) process.stderr.write(`${path}:${m}\n`);
    const n = messages.length;
    process.stderr.write(`${n} ${n === 1 ? 'error' : 'errors'}\n`);
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    let sourcePath: string | null = null;
    let emitIr = false;
    let checkOnly = false;
    let stepLimit = -1;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--emit-ir') emitIr = true;
        else if (a === '--check') checkOnly = true;
        else if (a === '--steps' && i + 1 < args.length) {
            stepLimit = Number(args[++i]);
            if (!Number.isFinite(stepLimit)) fail(64, 'vox: --steps needs a number');
        } else if (a.startsWith('-')) {
            fail(64, `vox: unknown option ${a}\n\n${USAGE}`);
        } else if (sourcePath === null) {
            sourcePath = a;
        } else {
            fail(64, `vox: more than one source file given\n\n${USAGE}`);
        }
    }

    if (sourcePath === null) fail(64, USAGE);

    let source: string;
    try {
        source = readFileSync(sourcePath, 'utf8');
    } catch (e) {
        fail(64, `vox: cannot read ${sourcePath}: ${(e as Error).message}`);
    }

    const result = compile(source);

    for (const w of result.warnings) process.stderr.write(`${sourcePath}:${w}\n`);
    if (result.errors.length > 0) {
        report(sourcePath, result.errors);
        process.exitCode = 1;
        return;
    }

    const ir = result.ir!;
    if (emitIr) {
        for (let i = 0; i < ir.length; i++) {
            process.stdout.write(`${String(i).padStart(4)}  ${ir[i]}\n`);
        }
    }
    if (checkOnly) return;

    const executor = new IRExecutor(ir, stepLimit > 0 ? { stepLimit } : undefined);
    executor.onOutput = chunk => process.stdout.write(chunk);

    // Lines are read from stdin only when the program actually asks for one,
    // matching the Java CLI's lazy reader.
    let lines: AsyncIterator<string> | null = null;
    let rl: ReturnType<typeof createInterface> | null = null;

    try {
        for (;;) {
            const status = executor.run();
            if (status === 'done') break;
            if (status === 'need-input') {
                if (lines === null) {
                    rl = createInterface({ input: process.stdin });
                    lines = rl[Symbol.asyncIterator]();
                }
                process.stderr.write('> ');
                const next = await lines.next();
                executor.provideInput(next.done ? '' : next.value);
            }
        }
    } catch (e) {
        if (e instanceof VoxRuntimeError) {
            process.stderr.write(`${sourcePath}: runtime error: ${e.message}\n`);
            process.exitCode = 2;
        } else {
            throw e;
        }
    } finally {
        rl?.close();
    }
}

await main();
