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

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const run = useCallback((source: string) => {
    killWorker();
    truncated.current = false;
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
          append('out', msg.lines);
          break;
        case 'need-input':
          setStatus('waiting');
          break;
        case 'done':
          append('info', [`program finished in ${formatMs(msg.elapsedMs)}`]);
          setStatus('done');
          killWorker();
          break;
        case 'runtime-error':
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
  }, [append, killWorker]);

  const sendInput = useCallback((line: string) => {
    const worker = workerRef.current;
    if (!worker) return;
    append('in', ['> ' + line]);
    setStatus('running');
    const msg: ToWorker = { type: 'input', line };
    worker.postMessage(msg);
  }, [append]);

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    killWorker();
    append('info', ['stopped']);
    setStatus('idle');
  }, [append, killWorker]);

  const clear = useCallback(() => {
    truncated.current = false;
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
