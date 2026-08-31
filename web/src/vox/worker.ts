import { compile, IRExecutor, VoxRuntimeError } from '@vox/core';
import type { ToWorker, FromWorker } from './protocol';

/**
 * Runs one Vox program off the main thread.
 *
 * The executor is resumable, so the worker runs it in slices of STEP_BUDGET
 * steps and yields between them. That keeps this thread responsive to
 * incoming 'input' messages; the main thread stops a runaway program by
 * terminating the worker outright, which needs no cooperation from here.
 */

const STEP_BUDGET = 250_000;

interface WorkerPort {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const port = self as unknown as WorkerPort;

let executor: IRExecutor | null = null;
let pending: string[] = [];
let startedAt = 0;

function flush(): void {
  if (pending.length === 0) return;
  port.postMessage({ type: 'output', chunks: pending });
  pending = [];
}

function slice(): void {
  if (!executor) return;
  let status;
  try {
    status = executor.run(STEP_BUDGET);
  } catch (e) {
    flush();
    if (e instanceof VoxRuntimeError) {
      port.postMessage({ type: 'runtime-error', message: e.message });
    } else {
      port.postMessage({ type: 'runtime-error', message: 'internal error: ' + String(e) });
    }
    executor = null;
    return;
  }
  flush();

  switch (status) {
    case 'paused':
      setTimeout(slice, 0); // let queued messages in before the next slice
      break;
    case 'need-input':
      port.postMessage({ type: 'need-input' });
      break;
    case 'done':
      port.postMessage({ type: 'done', elapsedMs: performance.now() - startedAt });
      executor = null;
      break;
  }
}

port.onmessage = (event: MessageEvent<ToWorker>) => {
  const msg = event.data;

  if (msg.type === 'run') {
    const result = compile(msg.source);
    if (result.errors.length > 0 || result.ir === null) {
      port.postMessage({ type: 'compile-error', errors: result.errors, warnings: result.warnings });
      return;
    }
    port.postMessage({ type: 'compiled', ir: result.ir, warnings: result.warnings });

    executor = new IRExecutor(result.ir);
    executor.onOutput = chunk => { pending.push(chunk); };
    startedAt = performance.now();
    slice();
    return;
  }

  if (msg.type === 'input') {
    if (!executor) return;
    executor.provideInput(msg.line);
    slice();
  }
};
