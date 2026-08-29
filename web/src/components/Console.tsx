import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import type { ConsoleLine, RunnerStatus } from "../vox/useVoxRunner";

interface Props {
  lines: ConsoleLine[];
  status: RunnerStatus;
  onSubmitInput: (line: string) => void;
  onClear: () => void;
}

const LINE_CLASS: Record<ConsoleLine["kind"], string> = {
  out: "text-paper",
  err: "text-neon-red-soft",
  warn: "text-amber",
  info: "text-fog italic",
  in: "text-neon-blue-soft",
};

const STATUS_LABEL: Record<RunnerStatus, string> = {
  idle: "ready",
  running: "running",
  waiting: "waiting for input",
  done: "finished",
  error: "error",
};

const STATUS_CLASS: Record<RunnerStatus, string> = {
  idle: "text-fog",
  running: "text-neon-blue-soft glow-blue",
  waiting: "text-amber",
  done: "text-neon-blue-soft",
  error: "text-neon-red-soft glow-red",
};

export default function Console({
  lines,
  status,
  onSubmitInput,
  onClear,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, status]);

  useEffect(() => {
    if (status === "waiting") inputRef.current?.focus();
  }, [status]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitInput(draft);
    setDraft("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-3">
          <span className="panel-title">Output</span>
          <span className={`text-xs ${STATUS_CLASS[status]}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={lines.length === 0}
          className="flex items-center gap-1.5 text-xs text-fog transition-colors hover:text-paper disabled:opacity-30"
        >
          <Eraser size={13} />
          clear
        </button>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[13px] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.length === 0 && status === "idle" && (
          <p className="text-fog/70">
            Press{" "}
            <kbd className="rounded border border-line-2 px-1.5 py-0.5 text-[11px]">
              Ctrl
            </kbd>
            {" + "}
            <kbd className="rounded border border-line-2 px-1.5 py-0.5 text-[11px]">
              Enter
            </kbd>{" "}
            or hit Run.
          </p>
        )}
        {lines.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap wrap-break-word ${LINE_CLASS[line.kind]}`}
          >
            {line.text}
          </div>
        ))}

        {status === "waiting" && (
          <form onSubmit={submit} className="mt-1 flex items-center gap-2">
            <span className="text-amber">&gt;</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="the program is waiting for input…"
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-paper caret-amber outline-none placeholder:text-fog/50"
            />
          </form>
        )}
      </div>
    </div>
  );
}
