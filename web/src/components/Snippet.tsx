import { Link } from "react-router-dom";
import { Play, CornerDownRight } from "lucide-react";
import Code from "./Code";
import { getSnippet } from "../docs/snippets";
import { encodeSource } from "../share";

/**
 * One documented example: the program, what it printed and any messages the
 * compiler gave. All three come from docs/snippets/, where the regression
 * suite runs them on both engines - so what is shown here is what happens.
 */

interface Props {
  id: string;
  /** Hide the "open in playground" link for programs that need stdin. */
  runnable?: boolean;
}

function OutputPane({
  title,
  text,
  tone = "out",
}: {
  title: string;
  text: string;
  tone?: "out" | "err" | "warn";
}) {
  const toneClass =
    tone === "err"
      ? "text-neon-red-soft"
      : tone === "warn"
        ? "text-amber"
        : "text-paper";
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <div className="flex h-9 items-center border-b border-line px-4">
        <span className="panel-title">{title}</span>
      </div>
      <pre
        className={`overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed ${toneClass}`}
      >
        <code>{text}</code>
      </pre>
    </div>
  );
}

export default function Snippet({ id, runnable = true }: Props) {
  const snippet = getSnippet(id);
  const isWarning = snippet.diagnostics?.includes("warning:") ?? false;

  return (
    <div className="mt-5 space-y-3">
      <div className="relative">
        <Code source={snippet.source} title={`${id}.vox`} />
        {runnable && (
          <Link
            to={`/playground?code=${encodeSource(snippet.source)}`}
            title="Open this program in the playground"
            className="absolute right-3 top-1.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-fog transition-colors hover:text-neon-red-soft"
          >
            <Play size={11} />
            run it
          </Link>
        )}
      </div>

      {snippet.stdin !== undefined && (
        <div className="flex items-start gap-2 px-1 text-[13px] text-fog">
          <CornerDownRight size={14} className="mt-0.5 shrink-0" />
          <span>
            typed at the prompt:{" "}
            {snippet.stdin.split("\n").map((line, i) => (
              <span key={i} className="mr-2 font-mono text-neon-blue-soft">
                {line}
              </span>
            ))}
          </span>
        </div>
      )}

      {snippet.output !== undefined && (
        <OutputPane title="output" text={snippet.output} />
      )}

      {snippet.diagnostics !== undefined && (
        <OutputPane
          title={isWarning ? "compiler warning" : "compiler says"}
          text={snippet.diagnostics}
          tone={isWarning ? "warn" : "err"}
        />
      )}

      {snippet.ir !== undefined && (
        <OutputPane title="emitted IR" text={snippet.ir} />
      )}
    </div>
  );
}
