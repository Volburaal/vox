import { VoxValue, VoxRuntimeError, display, truthy, arithmetic, compare, coerceInput } from './values.js';

export { VoxRuntimeError };

/**
 * What a call to run() came back with:
 *   'done'       - the program finished
 *   'need-input' - the program hit input() and the input queue is empty;
 *                  call provideInput(line) and run() again
 *   'paused'     - the per-call step budget ran out; call run() again
 */
export type RunStatus = 'done' | 'need-input' | 'paused';

/** One activation record. Locals are private to this frame. */
class Frame {
    readonly locals = new Map<string, VoxValue>();
    constructor(
        readonly returnPc: number,
        readonly destVar: string | null,
        readonly args: VoxValue[],
    ) {}
}

const DEFAULT_STEP_LIMIT = 50_000_000;

/**
 * Executes the IR produced by IRBuilder. Same instruction set and storage
 * model as the Java reference implementation (see src/IRExecutor.java), with
 * one structural difference: instead of blocking on stdin, run() is resumable.
 * It returns 'need-input' when the program wants a line and continues after
 * provideInput() - which is what lets the same core run in a browser, where
 * blocking is impossible. An optional per-call step budget makes run() yield
 * regularly so a worker thread can stay responsive.
 */
export class IRExecutor {
    /** Receives each line the program prints. */
    onOutput: (line: string) => void = () => {};

    private readonly instructions: string[];
    private readonly labelToIndex = new Map<string, number>();
    private readonly functionToIndex = new Map<string, number>();
    private readonly callStack: Frame[] = [];
    private readonly inputQueue: string[] = [];
    private readonly stepLimit: number;

    private pc = 0;
    private steps = 0;
    private started = false;
    private finished = false;

    constructor(instructions: string[], options?: { stepLimit?: number }) {
        this.instructions = [...instructions];
        this.stepLimit = options?.stepLimit ?? DEFAULT_STEP_LIMIT;
        for (let i = 0; i < this.instructions.length; i++) {
            const t = tokenize(this.instructions[i]);
            if (t.length < 2) continue;
            if (t[0] === 'label') this.labelToIndex.set(t[1], i);
            else if (t[0] === 'func_start') this.functionToIndex.set(t[1], i);
        }
    }

    /** Queues one line for the next input() the program executes. */
    provideInput(line: string): void {
        this.inputQueue.push(line);
    }

    /**
     * Runs until the program finishes, needs input, or (when given) the
     * per-call step budget is spent. Throws VoxRuntimeError on program errors.
     */
    run(budget?: number): RunStatus {
        if (this.finished) return 'done';

        if (!this.started) {
            const mainIndex = this.functionToIndex.get('main');
            if (mainIndex === undefined) {
                throw new VoxRuntimeError('program has no main function');
            }
            // Start inside main rather than at instruction 0, which would
            // otherwise fall into whichever function is emitted first.
            this.callStack.push(new Frame(-1, null, []));
            this.pc = mainIndex + 1;
            this.started = true;
        }

        let remaining = budget ?? Infinity;

        while (this.pc >= 0 && this.pc < this.instructions.length) {
            const raw = this.instructions[this.pc].trim();
            if (raw === '') { this.pc++; continue; }
            const toks = tokenize(raw);
            const op = toks[0];

            // Pause BEFORE consuming the input instruction, so it re-executes
            // once a line has been provided.
            if (op === 'input' && this.inputQueue.length === 0) {
                return 'need-input';
            }
            if (remaining <= 0) return 'paused';
            remaining--;

            if (++this.steps > this.stepLimit) {
                throw new VoxRuntimeError(
                    `execution step limit exceeded (${this.stepLimit}); the program is probably looping forever`);
            }

            switch (op) {
                case 'func_start':
                case 'label':
                    this.pc++;
                    break;

                case 'func_end': {
                    // Falling off the end of a function returns nothing.
                    if (this.doReturn(null)) return 'done';
                    break;
                }

                case 'param': {
                    this.require(toks, 3, raw);
                    const index = Number(toks[1]);
                    const args = this.frame().args;
                    this.frame().locals.set(toks[2], index < args.length ? args[index] : null);
                    this.pc++;
                    break;
                }

                case 'set': {
                    this.require(toks, 3, raw);
                    this.frame().locals.set(toks[1], this.resolve(toks[2]));
                    this.pc++;
                    break;
                }

                case 'input': {
                    this.require(toks, 2, raw);
                    this.frame().locals.set(toks[1], coerceInput(this.inputQueue.shift()!));
                    this.pc++;
                    break;
                }

                case 'print': {
                    let out = '';
                    for (let i = 1; i < toks.length; i++) out += display(this.resolve(toks[i]));
                    this.onOutput(out);
                    this.pc++;
                    break;
                }

                case 'not': {
                    this.require(toks, 3, raw);
                    this.frame().locals.set(toks[1], !truthy(this.resolve(toks[2])));
                    this.pc++;
                    break;
                }

                case 'add': case 'sub': case 'mul':
                case 'div': case 'mod': case 'power': {
                    this.require(toks, 4, raw);
                    this.frame().locals.set(toks[1],
                        arithmetic(op, this.resolve(toks[2]), this.resolve(toks[3])));
                    this.pc++;
                    break;
                }

                case 'eq': case 'ne': case 'lt':
                case 'gt': case 'le': case 'ge': {
                    this.require(toks, 4, raw);
                    this.frame().locals.set(toks[1],
                        compare(op, this.resolve(toks[2]), this.resolve(toks[3])));
                    this.pc++;
                    break;
                }

                case 'and': case 'or': {
                    this.require(toks, 4, raw);
                    const l = truthy(this.resolve(toks[2]));
                    const r = truthy(this.resolve(toks[3]));
                    this.frame().locals.set(toks[1], op === 'and' ? (l && r) : (l || r));
                    this.pc++;
                    break;
                }

                case 'if_false': {
                    this.require(toks, 4, raw);
                    if (toks[2] !== 'goto') throw new VoxRuntimeError('malformed if_false: ' + raw);
                    this.pc = truthy(this.resolve(toks[1])) ? this.pc + 1 : this.labelIndex(toks[3]);
                    break;
                }

                case 'goto': {
                    this.require(toks, 2, raw);
                    this.pc = this.labelIndex(toks[1]);
                    break;
                }

                case 'call': {
                    let arrow = -1;
                    for (let i = 2; i < toks.length; i++) if (toks[i] === '->') arrow = i;
                    if (arrow === -1 || arrow + 1 >= toks.length) {
                        throw new VoxRuntimeError('malformed call: ' + raw);
                    }
                    const name = toks[1];
                    const target = this.functionToIndex.get(name);
                    if (target === undefined) throw new VoxRuntimeError('unknown function: ' + name);

                    const args: VoxValue[] = [];
                    for (let i = 2; i < arrow; i++) args.push(this.resolve(toks[i]));

                    this.callStack.push(new Frame(this.pc + 1, toks[arrow + 1], args));
                    this.pc = target + 1;
                    break;
                }

                case 'return': {
                    const value = toks.length >= 2 ? this.resolve(toks[1]) : null;
                    if (this.doReturn(value)) return 'done';
                    break;
                }

                default:
                    throw new VoxRuntimeError(`unknown instruction '${op}' in: ${raw}`);
            }
        }

        this.finished = true;
        return 'done';
    }

    /** Pops the current frame. Returns true if the program is done. */
    private doReturn(value: VoxValue): boolean {
        const done = this.callStack.pop()!;
        if (this.callStack.length === 0) {
            this.finished = true;
            return true; // returned out of main
        }
        if (done.destVar !== null) this.frame().locals.set(done.destVar, value);
        this.pc = done.returnPc;
        return false;
    }

    private frame(): Frame {
        return this.callStack[this.callStack.length - 1];
    }

    private labelIndex(label: string): number {
        const target = this.labelToIndex.get(label);
        if (target === undefined) throw new VoxRuntimeError('unknown label: ' + label);
        return target + 1;
    }

    private require(toks: string[], n: number, raw: string): void {
        if (toks.length < n) throw new VoxRuntimeError('malformed instruction: ' + raw);
    }

    private resolve(token: string): VoxValue {
        if (token === '') return null;

        if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
            return unescape(token.slice(1, -1));
        }
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (/^-?\d+$/.test(token)) return BigInt(token);
        if (/^-?\d*\.\d+$/.test(token)) return Number(token);

        return this.frame().locals.get(token) ?? null;
    }
}

/** Splits on whitespace, keeping quoted strings (and their escapes) intact. */
export function tokenize(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuote && c === '\\' && i + 1 < line.length) {
            cur += c + line[++i]; // keep the escape pair together
            continue;
        }
        if (c === '"') {
            cur += c;
            inQuote = !inQuote;
            continue;
        }
        if (!inQuote && /\s/.test(c)) {
            if (cur !== '') { out.push(cur); cur = ''; }
            continue;
        }
        cur += c;
    }
    if (cur !== '') out.push(cur);
    return out;
}

function unescape(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c !== '\\' || i + 1 >= s.length) { out += c; continue; }
        const next = s[++i];
        switch (next) {
            case 'n': out += '\n'; break;
            case 't': out += '\t'; break;
            case 'r': out += '\r'; break;
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            default: out += next; break;
        }
    }
    return out;
}
