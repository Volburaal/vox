import { useCallback, useEffect, useRef, useState } from 'react';
import type { FromWorker, ToWorker } from './protocol';

export type LineKind = 'out' | 'err' | 'warn' | 'info' | 'in';
export interface ConsoleLine {
  id: number;
  kind: LineKind;
  text: string;
}

export type RunnerStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';

/** Keep the console usable if a program prints without end. */
const MAX_LINES = 5000;

/**
 * Owns the worker that runs Vox programs and exposes its state to React.
 * Each run gets a fresh worker; stopping is simply terminating it.
 */
export function useVoxRunner() {
  const [status, setStatus] = useState<RunnerStatus>('idle');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [ir, setIr] = useState<string[] | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const truncated = useRef(false);

  const append = useCallback((kind: LineKind, texts: string[]) => {
    if (texts.length === 0) return;
    setLines(prev => {
      const room = MAX_LINES - prev.length;
      if (room <= 0) {
        if (truncated.current) return prev;
        truncated.current = true;
        return [...prev, {
          id: nextId.current++,
          kind: 'info',
          text: `… output truncated after ${MAX_LINES} lines`,
        }];
      }
      const slice = texts.slice(0, room);
      const added = slice.map(text => ({ id: nextId.current++, kind, text }));
      return [...prev, ...added];
    });
  }, []);

  // print emits raw chunks; a console line only ends at '\n'. The trailing
  // partial line is shown live and replaced as more chunks arrive.
  const partialText = useRef('');
  const partialId = useRef<number | null>(null);

  const appendOutput = useCallback((chunks: string[]) => {
    const text = partialText.current + chunks.join('');
    const parts = text.split('\n');
    partialText.current = parts.pop()!;
    const completed = parts;
    setLines(prev => {
      const next = partialId.current !== null ? prev.slice(0, -1) : prev.slice();
      const room = MAX_LINES - next.length;
      if (room <= 0) {
        partialId.current = null;
        if (truncated.current) return prev;
        truncated.current = true;
        next.push({
          id: nextId.current++,
          kind: 'info',
          text: `… output truncated after ${MAX_LINES} lines`,
        });
        return next;
      }
      for (const t of completed.slice(0, room)) {
        next.push({ id: nextId.current++, kind: 'out', text: t });
      }
      if (completed.length > room) {
        truncated.current = true;
        partialId.current = null;
        next.push({
          id: nextId.current++,
          kind: 'info',
          text: `… output truncated after ${MAX_LINES} lines`,
        });
        return next;
      }
      if (partialText.current !== '') {
        partialId.current = nextId.current;
        next.push({ id: nextId.current++, kind: 'out', text: partialText.current });
      } else {
        partialId.current = null;
      }
      return next;
    });
  }, []);

  /** The partial line becomes permanent: before input echoes, or at exit. */
  const finalizePartial = useCallback(() => {
    partialId.current = null;
    partialText.current = '';
  }, []);

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const run = useCallback((source: string) => {
    killWorker();
    truncated.current = false;
    partialText.current = '';
    partialId.current = null;
    setLines([]);
    setIr(null);
    setStatus('running');

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'compiled':
          setIr(msg.ir);
          append('warn', msg.warnings);
          break;
        case 'compile-error':
          append('warn', msg.warnings);
          append('err', msg.errors);
          append('info', [`${msg.errors.length} ${msg.errors.length === 1 ? 'error' : 'errors'}`]);
          setStatus('error');
          break;
        case 'output':
          appendOutput(msg.chunks);
          break;
        case 'need-input':
          setStatus('waiting');
          break;
        case 'done':
          finalizePartial();
          append('info', [`program finished in ${formatMs(msg.elapsedMs)}`]);
          setStatus('done');
          killWorker();
          break;
        case 'runtime-error':
          finalizePartial();
          append('err', ['runtime error: ' + msg.message]);
          setStatus('error');
          killWorker();
          break;
      }
    };

    worker.onerror = event => {
      append('err', ['worker error: ' + event.message]);
      setStatus('error');
      killWorker();
    };

    const msg: ToWorker = { type: 'run', source };
    worker.postMessage(msg);
  }, [append, appendOutput, finalizePartial, killWorker]);

  const sendInput = useCallback((line: string) => {
    const worker = workerRef.current;
    if (!worker) return;
    finalizePartial();
    append('in', ['> ' + line]);
    setStatus('running');
    const msg: ToWorker = { type: 'input', line };
    worker.postMessage(msg);
  }, [append, finalizePartial]);

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    killWorker();
    finalizePartial();
    append('info', ['stopped']);
    setStatus('idle');
  }, [append, finalizePartial, killWorker]);

  const clear = useCallback(() => {
    truncated.current = false;
    // Keep partialText: a still-running program continues its current line.
    partialId.current = null;
    setLines([]);
  }, []);

  useEffect(() => () => killWorker(), [killWorker]);

  return { status, lines, ir, run, stop, sendInput, clear };
}

function formatMs(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
