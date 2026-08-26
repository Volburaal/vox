/**
 * Vox runtime values.
 *
 * The JS type carries the Vox type tag:
 *   bigint  -> Vox integer   (exact, arbitrary precision - no 32-bit wrapping;
 *                             this intentionally diverges from the Java CLI,
 *                             which overflows at Integer.MAX_VALUE)
 *   number  -> Vox float
 *   boolean -> Vox boolean
 *   string  -> Vox string
 *   null    -> unset
 */
export type VoxValue = bigint | number | boolean | string | null;

/** Raised for anything the program does wrong at run time. */
export class VoxRuntimeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VoxRuntimeError';
    }
}

/**
 * A safety valve for exact integer exponentiation: 2 ^ 1000000000 would
 * allocate a gigabyte-sized bigint and freeze the host. The Java CLI never hit
 * this because its ints silently overflowed instead.
 */
const MAX_POW_EXPONENT = 1_000_000n;

const isNumber = (v: VoxValue): v is bigint | number =>
    typeof v === 'bigint' || typeof v === 'number';

/**
 * Renders a float the way Java's Double.toString does (the reference
 * implementation prints through it): integral values keep a trailing ".0",
 * and magnitudes >= 1e7 or < 1e-3 use E-notation.
 */
function formatFloat(v: number): string {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    const abs = Math.abs(v);
    if (v !== 0 && (abs >= 1e7 || abs < 1e-3)) {
        const [rawMantissa, rawExp] = v.toExponential().split('e');
        const mantissa = rawMantissa.includes('.') ? rawMantissa : rawMantissa + '.0';
        const exp = rawExp.startsWith('+') ? rawExp.slice(1) : rawExp;
        return mantissa + 'E' + exp;
    }
    if (Number.isInteger(v)) return v.toFixed(1);
    return String(v);
}

export function display(v: VoxValue): string {
    if (v === null) return 'null';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return formatFloat(v);
    return String(v);
}

export function truthy(v: VoxValue): boolean {
    if (v === null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'number') return v !== 0;
    return v.length > 0;
}

function describe(v: VoxValue): string {
    if (v === null) return 'an unset value';
    if (typeof v === 'bigint') return 'integer ' + v;
    if (typeof v === 'number') return 'float ' + formatFloat(v);
    if (typeof v === 'boolean') return 'boolean ' + v;
    return 'string "' + v + '"';
}

export function arithmetic(op: string, left: VoxValue, right: VoxValue): VoxValue {
    // '+' doubles as string concatenation.
    if (op === 'add' && (typeof left === 'string' || typeof right === 'string')) {
        return display(left) + display(right);
    }
    if (!isNumber(left) || !isNumber(right)) {
        throw new VoxRuntimeError(
            `operator '${op}' needs numbers but got ${describe(left)} and ${describe(right)}`);
    }

    const bothInt = typeof left === 'bigint' && typeof right === 'bigint';

    if (op === 'power') {
        if (bothInt && (right as bigint) >= 0n) {
            if ((right as bigint) > MAX_POW_EXPONENT) {
                throw new VoxRuntimeError('power exponent too large: ' + right);
            }
            return (left as bigint) ** (right as bigint);
        }
        // A float operand, or a negative exponent, makes the result a float.
        const result = Math.pow(Number(left), Number(right));
        if (Number.isNaN(result)) {
            throw new VoxRuntimeError(
                `power produced an undefined result: ${display(left)} ^ ${display(right)}`);
        }
        return result;
    }

    if (bothInt) {
        const l = left as bigint, r = right as bigint;
        switch (op) {
            case 'add': return l + r;
            case 'sub': return l - r;
            case 'mul': return l * r;
            case 'div':
                if (r === 0n) throw new VoxRuntimeError('division by zero');
                return l / r; // bigint division truncates toward zero, like Java
            case 'mod':
                if (r === 0n) throw new VoxRuntimeError('modulo by zero');
                return l % r;
            default: throw new VoxRuntimeError('unknown arithmetic op: ' + op);
        }
    }

    const l = Number(left), r = Number(right);
    switch (op) {
        case 'add': return l + r;
        case 'sub': return l - r;
        case 'mul': return l * r;
        case 'div':
            if (r === 0) throw new VoxRuntimeError('division by zero');
            return l / r;
        case 'mod':
            if (r === 0) throw new VoxRuntimeError('modulo by zero');
            return l % r;
        default: throw new VoxRuntimeError('unknown arithmetic op: ' + op);
    }
}

export function compare(op: string, left: VoxValue, right: VoxValue): boolean {
    // Equality is total; ordering against null is not meaningful.
    let equal: boolean;
    if (left === null || right === null) {
        equal = left === null && right === null;
    } else if (isNumber(left) && isNumber(right)) {
        equal = typeof left === typeof right
            ? left === right
            : Number(left) === Number(right);
    } else {
        equal = left === right;
    }
    if (op === 'eq') return equal;
    if (op === 'ne') return !equal;

    if (left === null || right === null) {
        throw new VoxRuntimeError(
            `cannot order-compare with an unset value using '${op}'`);
    }

    let c: number;
    if (isNumber(left) && isNumber(right)) {
        if (typeof left === 'bigint' && typeof right === 'bigint') {
            c = left < right ? -1 : left > right ? 1 : 0;
        } else {
            const l = Number(left), r = Number(right);
            c = l < r ? -1 : l > r ? 1 : 0;
        }
    } else if (typeof left === 'string' && typeof right === 'string') {
        c = left < right ? -1 : left > right ? 1 : 0; // code-unit order, like Java
    } else if (typeof left === 'boolean' && typeof right === 'boolean') {
        c = Number(left) - Number(right);
    } else {
        throw new VoxRuntimeError(
            `cannot compare ${describe(left)} with ${describe(right)}`);
    }

    switch (op) {
        case 'lt': return c < 0;
        case 'gt': return c > 0;
        case 'le': return c <= 0;
        case 'ge': return c >= 0;
        default: throw new VoxRuntimeError('unknown comparison op: ' + op);
    }
}

/** Coerces one line of user input: integer, float, boolean, else string. */
export function coerceInput(line: string): VoxValue {
    const t = line.trim();
    if (/^-?\d+$/.test(t)) return BigInt(t);
    if (/^-?\d*\.\d+$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
    return line;
}
