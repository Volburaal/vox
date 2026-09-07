import { useCallback, useEffect, useRef, useState } from "react";
import type { FromWorker, ToWorker } from "./protocol";
import {
  splitOutput,
  withLines,
  withoutPartial,
  type ConsoleLine,
  type LineKind,
} from "./consoleLines";

export type { ConsoleLine, LineKind };

export type RunnerStatus = "idle" | "running" | "waiting" | "done" | "error";

/**
 * Owns the worker that runs Vox programs and exposes its state to React.
 * Each run gets a fresh worker; stopping is simply terminating it.
 *
 * Every decision about the console - ids, which lines are finished, whether
 * the trailing partial line is being replaced - is made here, synchronously,
 * before setLines is called. The updaters passed to setLines are pure
 * functions of the previous state: React may run them later than the call
 * (after the next worker message has arrived) or more than once.
 */
export function useVoxRunner() {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [ir, setIr] = useState<string[] | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  // The unfinished last line of program output, and whether it is on screen.
  const partial = useRef<{ text: string; shown: boolean }>({ text: "", shown: false });

  const line = useCallback(
    (kind: LineKind, text: string): ConsoleLine => ({ id: nextId.current++, kind, text }),
    [],
  );

  const append = useCallback(
    (kind: LineKind, texts: string[]) => {
      if (texts.length === 0) return;
      const added = texts.map((text) => line(kind, text));
      setLines((prev) => withLines(prev, added));
    },
    [line],
  );

  /** Raw print output: finished lines are appended, the partial line is shown live. */
  const appendOutput = useCallback(
    (chunks: string[]) => {
      const split = splitOutput(partial.current.text, chunks);
      const replacing = partial.current.shown;
      const added = split.completed.map((text) => line("out", text));
      if (split.partial !== "") added.push(line("out", split.partial));
      partial.current = { text: split.partial, shown: split.partial !== "" };
      setLines((prev) => withLines(replacing ? withoutPartial(prev) : prev, added));
    },
    [line],
  );

  /** The partial line becomes permanent: before input echoes or at exit. */
  const finalizePartial = useCallback(() => {
    partial.current = { text: "", shown: false };
  }, []);

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const run = useCallback(
    (source: string) => {
      killWorker();
      partial.current = { text: "", shown: false };
      setLines([]);
      setIr(null);
      setStatus("running");

      const worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        switch (msg.type) {
          case "compiled":
            setIr(msg.ir);
            append("warn", msg.warnings);
            break;
          case "compile-error":
            append("warn", msg.warnings);
            append("err", msg.errors);
            append("info", [
              `${msg.errors.length} ${msg.errors.length === 1 ? "error" : "errors"}`,
            ]);
            setStatus("error");
            break;
          case "output":
            appendOutput(msg.chunks);
            break;
          case "need-input":
            setStatus("waiting");
            break;
          case "done":
            finalizePartial();
            append("info", [`program finished in ${formatMs(msg.elapsedMs)}`]);
            setStatus("done");
            killWorker();
            break;
          case "runtime-error":
            finalizePartial();
            append("err", ["runtime error: " + msg.message]);
            setStatus("error");
            killWorker();
            break;
        }
      };

      worker.onerror = (event) => {
        append("err", ["worker error: " + event.message]);
        setStatus("error");
        killWorker();
      };

      const msg: ToWorker = { type: "run", source };
      worker.postMessage(msg);
    },
    [append, appendOutput, finalizePartial, killWorker],
  );

  const sendInput = useCallback(
    (line: string) => {
      const worker = workerRef.current;
      if (!worker) return;
      finalizePartial();
      append("in", ["> " + line]);
      setStatus("running");
      const msg: ToWorker = { type: "input", line };
      worker.postMessage(msg);
    },
    [append, finalizePartial],
  );

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    killWorker();
    finalizePartial();
    append("info", ["stopped"]);
    setStatus("idle");
  }, [append, finalizePartial, killWorker]);

  const clear = useCallback(() => {
    // Keep the partial text: a still-running program continues its line.
    // It is no longer on screen, so the next chunk starts a fresh line.
    partial.current = { text: partial.current.text, shown: false };
    setLines([]);
  }, []);

  useEffect(() => () => killWorker(), [killWorker]);

  return { status, lines, ir, run, stop, sendInput, clear };
}

function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
