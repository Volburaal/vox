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
 *   VoxList -> Vox list      (a reference: two names may share one list)
 *   null    -> unset
 */
export type VoxValue = bigint | number | boolean | string | VoxList | null;

/**
 * A list, with the two switches a program can flip on it: `lock` freezes its
 * size (items stay writable), `wrap` makes indexes count around the ends.
 */
export class VoxList {
    locked = false;
    wrapping = false;
    constructor(public items: VoxValue[] = []) {}
}

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

const isList = (v: VoxValue): v is VoxList => v instanceof VoxList;

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

/** Strings inside a printed list are quoted, so ["a, b"] and ["a", "b"] differ. */
function quote(s: string): string {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
}

export function display(v: VoxValue): string {
    if (v === null) return 'null';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') return formatFloat(v);
    if (isList(v)) {
        return '[' + v.items.map(item => typeof item === 'string' ? quote(item) : display(item)).join(', ') + ']';
    }
    return String(v);
}

export function truthy(v: VoxValue): boolean {
    if (v === null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'number') return v !== 0;
    if (isList(v)) return v.items.length > 0;
    return v.length > 0;
}

export function describe(v: VoxValue): string {
    if (v === null) return 'an unset value';
    if (typeof v === 'bigint') return 'integer ' + v;
    if (typeof v === 'number') return 'float ' + formatFloat(v);
    if (typeof v === 'boolean') return 'boolean ' + v;
    if (isList(v)) return 'list ' + display(v);
    return 'string "' + v + '"';
}

export function negate(v: VoxValue): VoxValue {
    if (typeof v === 'bigint') return -v;
    if (typeof v === 'number') return -v;
    throw new VoxRuntimeError(`operator '-' needs a number but got ${describe(v)}`);
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

/** Value equality: numbers by value across int/float, lists item by item. */
export function equal(left: VoxValue, right: VoxValue): boolean {
    if (left === null || right === null) return left === null && right === null;
    if (isNumber(left) && isNumber(right)) {
        return typeof left === typeof right ? left === right : Number(left) === Number(right);
    }
    if (isList(left) && isList(right)) {
        return left.items.length === right.items.length
            && left.items.every((v, i) => equal(v, right.items[i]));
    }
    return left === right;
}

export function compare(op: string, left: VoxValue, right: VoxValue): boolean {
    // Equality is total; ordering against null is not meaningful.
    if (op === 'eq') return equal(left, right);
    if (op === 'ne') return !equal(left, right);

    if (left === null || right === null) {
        throw new VoxRuntimeError(
            `cannot order-compare with an unset value using '${op}'`);
    }

    const c = order(left, right);
    switch (op) {
        case 'lt': return c < 0;
        case 'gt': return c > 0;
        case 'le': return c <= 0;
        case 'ge': return c >= 0;
        default: throw new VoxRuntimeError('unknown comparison op: ' + op);
    }
}

/** Ordering for numbers, strings and booleans; anything else cannot be ordered. */
function order(left: VoxValue, right: VoxValue): number {
    if (isNumber(left) && isNumber(right)) {
        if (typeof left === 'bigint' && typeof right === 'bigint') {
            return left < right ? -1 : left > right ? 1 : 0;
        }
        const l = Number(left), r = Number(right);
        return l < r ? -1 : l > r ? 1 : 0;
    }
    if (typeof left === 'string' && typeof right === 'string') {
        return left < right ? -1 : left > right ? 1 : 0; // code-unit order, like Java
    }
    if (typeof left === 'boolean' && typeof right === 'boolean') {
        return Number(left) - Number(right);
    }
    throw new VoxRuntimeError(`cannot compare ${describe(left)} with ${describe(right)}`);
}

/** Coerces one line of user input: integer, float, boolean, else string. */
export function coerceInput(line: string): VoxValue {
    const t = line.trim();
    if (/^-?\d+$/.test(t)) return BigInt(t);
    if (/^-?\d*\.\d+$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
    return line;
}

/** Explicit conversion, `x as integer`. Fails loudly instead of guessing. */
export function cast(v: VoxValue, type: string): VoxValue {
    const fail = (): never => {
        throw new VoxRuntimeError(`cannot convert ${describe(v)} to ${type}`);
    };
    switch (type) {
        case 'integer':
            if (typeof v === 'bigint') return v;
            if (typeof v === 'number') {
                if (!Number.isFinite(v)) return fail();
                return BigInt(Math.trunc(v));
            }
            if (typeof v === 'boolean') return v ? 1n : 0n;
            if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
            return fail();
        case 'float':
            if (typeof v === 'number') return v;
            if (typeof v === 'bigint') return Number(v);
            if (typeof v === 'boolean') return v ? 1 : 0;
            if (typeof v === 'string' && /^-?(\d+|\d*\.\d+)$/.test(v.trim())) return Number(v.trim());
            return fail();
        case 'boolean':
            if (typeof v === 'boolean') return v;
            if (typeof v === 'bigint') return v !== 0n;
            if (typeof v === 'number') return v !== 0;
            if (typeof v === 'string') {
                const t = v.trim().toLowerCase();
                if (t === 'true') return true;
                if (t === 'false') return false;
            }
            return fail();
        case 'string':
        case 'character':
            if (v === null) return fail();
            return display(v);
        default:
            throw new VoxRuntimeError('unknown type in cast: ' + type);
    }
}

/** The value a variable of this IR type starts with: 0, 0.0, false, "" or []. */
export function defaultValue(irType: string): VoxValue {
    switch (irType) {
        case 'integer': return 0n;
        case 'float': return 0;
        case 'boolean': return false;
        case 'string':
        case 'character': return '';
        default:
            if (irType.startsWith('list<')) return new VoxList();
            throw new VoxRuntimeError('unknown type: ' + irType);
    }
}

export function asList(v: VoxValue): VoxList {
    if (isList(v)) return v;
    throw new VoxRuntimeError(`cannot use ${describe(v)} as a list`);
}

/**
 * Validates a list index: an integer from 0 to length - 1 (or to length when
 * inserting, so an item can go at the end). A wrapping list counts around
 * its ends instead - `-1` is the last item - except for insert positions,
 * where wrapping the end to the front would put items in the wrong place.
 */
export function checkIndex(index: VoxValue, list: VoxList, allowEnd: boolean): number {
    if (typeof index !== 'bigint') {
        throw new VoxRuntimeError(`index must be an integer but got ${describe(index)}`);
    }
    const length = list.items.length;
    if (list.wrapping && !allowEnd && length > 0) {
        const n = BigInt(length);
        return Number(((index % n) + n) % n);
    }
    const limit = allowEnd ? length : length - 1;
    if (index < 0n || index > BigInt(limit)) {
        throw new VoxRuntimeError(`index ${index} is out of range for a list of ${length}`);
    }
    return Number(index);
}

/** The builtin functions. Spoken forms and dot calls map onto the same names. */
export function builtin(name: string, args: VoxValue[]): VoxValue {
    const arity = (n: number): void => {
        if (args.length !== n) {
            throw new VoxRuntimeError(
                `builtin '${name}' expects ${n} argument(s) but got ${args.length}`);
        }
    };
    const num = (v: VoxValue): bigint | number => {
        if (!isNumber(v)) {
            throw new VoxRuntimeError(`'${name}' needs a number but got ${describe(v)}`);
        }
        return v;
    };
    const str = (v: VoxValue): string => {
        if (typeof v !== 'string') {
            throw new VoxRuntimeError(`'${name}' needs a string but got ${describe(v)}`);
        }
        return v;
    };
    const list = (v: VoxValue): VoxList => {
        if (!isList(v)) {
            throw new VoxRuntimeError(`'${name}' needs a list but got ${describe(v)}`);
        }
        return v;
    };

    switch (name) {
        case 'sqrt': {
            arity(1);
            const x = Number(num(args[0]));
            if (x < 0) throw new VoxRuntimeError('square root of a negative number: ' + display(args[0]));
            return Math.sqrt(x);
        }
        case 'abs': {
            arity(1);
            const x = num(args[0]);
            return typeof x === 'bigint' ? (x < 0n ? -x : x) : Math.abs(x);
        }
        case 'round':   arity(1); return BigInt(Math.round(Number(num(args[0]))));
        case 'floor':   arity(1); return BigInt(Math.floor(Number(num(args[0]))));
        case 'ceiling': arity(1); return BigInt(Math.ceil(Number(num(args[0]))));
        case 'min':
        case 'max': {
            arity(2);
            const a = num(args[0]), b = num(args[1]);
            const pickMin = name === 'min';
            if (typeof a === 'bigint' && typeof b === 'bigint') {
                return pickMin ? (a < b ? a : b) : (a > b ? a : b);
            }
            return pickMin ? Math.min(Number(a), Number(b)) : Math.max(Number(a), Number(b));
        }
        case 'length': {
            arity(1);
            const v = args[0];
            if (isList(v)) return BigInt(v.items.length);
            if (typeof v === 'string') return BigInt(v.length);
            throw new VoxRuntimeError(`'length' needs a string or a list but got ${describe(v)}`);
        }
        case 'uppercase': arity(1); return str(args[0]).toUpperCase();
        case 'lowercase': arity(1); return str(args[0]).toLowerCase();
        case 'copy':      arity(1); return new VoxList([...list(args[0]).items]); // one level deep

        // ---- list switches ------------------------------------------------
        case 'lock':     arity(1); list(args[0]).locked = true; return null;
        case 'unlock':   arity(1); list(args[0]).locked = false; return null;
        case 'wrap':     arity(1); list(args[0]).wrapping = true; return null;
        case 'unwrap':   arity(1); list(args[0]).wrapping = false; return null;
        case 'locked':   arity(1); return list(args[0]).locked;
        case 'wrapping': arity(1); return list(args[0]).wrapping;

        // ---- ordering and aggregates ---------------------------------------
        case 'sort': {
            arity(1);
            const l = list(args[0]);
            if (l.items.some(isList)) throw new VoxRuntimeError('cannot sort a list of lists');
            l.items.sort(order); // stable; mixed types fail inside order()
            return null;
        }
        case 'reverse':  arity(1); list(args[0]).items.reverse(); return null;
        case 'sum': {
            arity(1);
            let total: VoxValue = 0n;
            for (const v of list(args[0]).items) {
                if (!isNumber(v)) throw new VoxRuntimeError(`'sum' needs a list of numbers but got ${describe(v)}`);
                total = arithmetic('add', total, v);
            }
            return total;
        }
        case 'largest':
        case 'smallest': {
            arity(1);
            const items = list(args[0]).items;
            if (items.length === 0) throw new VoxRuntimeError(`${name} of an empty list`);
            let best = items[0];
            for (const v of items) {
                const c = order(v, best);
                if (name === 'largest' ? c > 0 : c < 0) best = v;
            }
            return best;
        }
        case 'position': {
            arity(2);
            const index = list(args[0]).items.findIndex(v => equal(v, args[1]));
            return BigInt(index); // -1 when absent
        }
        default:
            throw new VoxRuntimeError('unknown builtin: ' + name);
    }
}
