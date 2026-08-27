/** Messages between the playground and the worker that runs Vox programs. */

export type ToWorker =
  | { type: 'run'; source: string }
  | { type: 'input'; line: string };

export type FromWorker =
  | { type: 'compiled'; ir: string[]; warnings: string[] }
  | { type: 'compile-error'; errors: string[]; warnings: string[] }
  | { type: 'output'; lines: string[] }
  | { type: 'need-input' }
  | { type: 'done'; elapsedMs: number }
  | { type: 'runtime-error'; message: string };
