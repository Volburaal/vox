/**
 * The console's line model, as pure functions so the React state updaters
 * stay pure: they must not read or write refs, because React may run them
 * later than the call (after the worker's `done` message has already
 * arrived) or more than once.
 *
 * `print` emits raw chunks. A console line ends only at '\n'; whatever comes
 * after the last newline is the trailing partial line, shown live and
 * replaced as more chunks arrive.
 */

export type LineKind = "out" | "err" | "warn" | "info" | "in";

export interface ConsoleLine {
  id: number;
  kind: LineKind;
  text: string;
}

/** Keep the console usable if a program prints without end. */
export const MAX_LINES = 5000;

/** A fixed id no real line uses, so the marker is recognisable in state. */
const TRUNCATED_ID = -1;
const TRUNCATED: ConsoleLine = {
  id: TRUNCATED_ID,
  kind: "info",
  text: `… output truncated after ${MAX_LINES} lines`,
};

function isTruncated(lines: ConsoleLine[]): boolean {
  return lines.length > 0 && lines[lines.length - 1].id === TRUNCATED_ID;
}

/** Splits raw output into finished lines and the new trailing partial line. */
export function splitOutput(
  partial: string,
  chunks: string[],
): { completed: string[]; partial: string } {
  const parts = (partial + chunks.join("")).split("\n");
  const rest = parts.pop()!;
  return { completed: parts, partial: rest };
}

/**
 * Appends lines, capping the console at MAX_LINES with a single marker.
 * Pure: the same `prev` and `added` always give the same result.
 */
export function withLines(prev: ConsoleLine[], added: ConsoleLine[]): ConsoleLine[] {
  if (added.length === 0 || isTruncated(prev)) return prev;
  const room = MAX_LINES - prev.length;
  if (room <= 0) return [...prev, TRUNCATED];
  if (added.length > room) return [...prev, ...added.slice(0, room), TRUNCATED];
  return [...prev, ...added];
}

/** Drops the trailing partial line so an updated version can replace it. */
export function withoutPartial(prev: ConsoleLine[]): ConsoleLine[] {
  return isTruncated(prev) ? prev : prev.slice(0, -1);
}
