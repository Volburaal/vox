import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Play, Square, Braces } from "lucide-react";
import Nav from "../components/Nav";
import Editor from "../components/Editor";
import Console from "../components/Console";
import IRPanel from "../components/IRPanel";
import SplitPane, { useMediaQuery } from "../components/SplitPane";
import { DEFAULT_EXAMPLE, EXAMPLES, findExample } from "../examples";
import { decodeSource } from "../share";
import { useVoxRunner } from "../vox/useVoxRunner";

const STORAGE = {
  source: "vox.playground.source",
  showIr: "vox.playground.showIr",
  codeRatio: "vox.playground.codeRatio",
  consoleRatio: "vox.playground.consoleRatio",
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}
function readRatio(key: string, fallback: number): number {
  const n = Number(readStorage(key));
  return Number.isFinite(n) && n > 0 && n < 1 ? n : fallback;
}

export default function Playground() {
  const [params, setParams] = useSearchParams();

  // Initial source: ?code= (a documentation snippet) or ?example= wins, then
  // whatever was last edited, then the default.
  const [source, setSource] = useState<string>(() => {
    const shared = decodeSource(params.get("code"));
    if (shared !== null) return shared;
    const fromUrl = findExample(params.get("example"));
    if (fromUrl) return fromUrl.source;
    return readStorage(STORAGE.source) ?? DEFAULT_EXAMPLE.source;
  });
  const [showIr, setShowIr] = useState<boolean>(
    () => readStorage(STORAGE.showIr) !== "false",
  );

  // Pane sizes: code vs. the right column and console vs. IR.
  const [codeRatio, setCodeRatio] = useState(() =>
    readRatio(STORAGE.codeRatio, 0.5),
  );
  const [consoleRatio, setConsoleRatio] = useState(() =>
    readRatio(STORAGE.consoleRatio, 0.58),
  );
  const wide = useMediaQuery("(min-width: 1024px)");

  const runner = useVoxRunner();
  const busy = runner.status === "running" || runner.status === "waiting";

  useEffect(() => {
    writeStorage(STORAGE.source, source);
  }, [source]);
  useEffect(() => {
    writeStorage(STORAGE.showIr, String(showIr));
  }, [showIr]);
  useEffect(() => {
    writeStorage(STORAGE.codeRatio, String(codeRatio));
  }, [codeRatio]);
  useEffect(() => {
    writeStorage(STORAGE.consoleRatio, String(consoleRatio));
  }, [consoleRatio]);

  // A late ?code= or ?example= change (a link followed while already here).
  useEffect(() => {
    const shared = decodeSource(params.get("code"));
    if (shared !== null) {
      setSource(shared);
      return;
    }
    const ex = findExample(params.get("example"));
    if (ex) setSource(ex.source);
  }, [params]);

  const run = useCallback(() => runner.run(source), [runner, source]);

  const loadExample = (id: string) => {
    const ex = findExample(id);
    if (!ex) return;
    setSource(ex.source);
    setParams({ example: id }, { replace: true });
  };

  const currentExample = EXAMPLES.find((e) => e.source === source)?.id ?? "";

  const codePane = (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-3">
          <span className="panel-title hidden sm:inline">Code</span>
          <select
            value={currentExample}
            onChange={(e) => loadExample(e.target.value)}
            className="rounded-md border border-line-2 bg-panel-2 px-2 py-1 text-sm text-paper outline-none focus:border-neon-blue"
          >
            <option value="" disabled>
              {currentExample ? "Examples" : "Examples (edited)"}
            </option>
            {EXAMPLES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIr((v) => !v)}
            aria-pressed={showIr}
            title="Toggle the intermediate representation panel"
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 select-none ${
              showIr
                ? "tube-blue text-neon-blue-soft"
                : "border border-line-2 text-fog hover:text-paper"
            }`}
          >
            <Braces size={14} />
            IR
          </button>
          {busy ? (
            <button type="button" onClick={runner.stop} className="btn-ghost">
              <Square size={14} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              className="btn-red"
              title="Ctrl+Enter"
            >
              <Play size={14} />
              Run
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Editor value={source} onChange={setSource} onRun={run} />
      </div>
    </section>
  );

  const rightColumn = (
    <SplitPane
      direction="vertical"
      ratio={consoleRatio}
      onRatioChange={setConsoleRatio}
      min={0.15}
      max={0.85}
      className="h-full"
      first={
        <Console
          lines={runner.lines}
          status={runner.status}
          onSubmitInput={runner.sendInput}
          onClear={runner.clear}
        />
      }
      second={
        showIr ? (
          <IRPanel ir={runner.ir} onHide={() => setShowIr(false)} />
        ) : null
      }
    />
  );

  return (
    <div className="flex h-full flex-col">
      <Nav />
      <SplitPane
        direction={wide ? "horizontal" : "vertical"}
        ratio={codeRatio}
        onRatioChange={setCodeRatio}
        min={0.25}
        max={0.75}
        className="min-h-0 flex-1"
        first={codePane}
        second={rightColumn}
      />
    </div>
  );
}
