import { PHRASES } from "../vox/language";

/**
 * A static, highlighted Vox snippet for the landing page. It shares the
 * phrase list with the editor's tokenizer but stays free of CodeMirror so the
 * landing page does not pay for the editor bundle.
 */

const KEYWORDS = /^(?:main|if|else|while|for|action|print|input|return)$/;
const TYPES =
  /^(?:int|integer|number|float|bool|boolean|character|char|string|varchar)$/;
const WORD_OPS = /^(?:is|minus|times|and|or|not)$/;

const TOKEN_RE = new RegExp(
  "(" +
    PHRASES.map((p) => p.replace(/ /g, "\\s+")).join("|") +
    ")(?![A-Za-z0-9_])" +
    '|("(?:[^"\\\\]|\\\\.)*")' +
    "|(\\/\\/.*)" +
    "|(\\d+(?:\\.\\d+)?)" +
    "|([A-Za-z_][A-Za-z0-9_]*)(\\s*\\()?" +
    "|(->|<-|<=|>=|=<|=>|==|!=|&&|\\|\\||[+\\-*/%^<>=&|~!])",
  "g",
);

function highlight(source: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of source.matchAll(TOKEN_RE)) {
    const start = m.index!;
    if (start > last) out.push(source.slice(last, start));
    const [full, phrase, str, comment, num, ident, callParen, sym] = m;

    let cls: string;
    let text = full;
    if (phrase) {
      cls = /^(?:let|consider|suppose)/.test(phrase)
        ? "text-[#ff4d4d] font-medium"
        : /number|string/.test(phrase)
          ? "text-[#5b9dff]"
          : "text-[#ff8a8a]";
    } else if (str) cls = "text-[#ffd27a]";
    else if (comment) cls = "text-[#5c5c66] italic";
    else if (num) cls = "text-[#9ad1ff]";
    else if (ident) {
      text = ident;
      cls = KEYWORDS.test(ident)
        ? "text-[#ff4d4d] font-medium"
        : TYPES.test(ident)
          ? "text-[#5b9dff]"
          : /^(?:true|false)$/.test(ident)
            ? "text-[#9ad1ff]"
            : WORD_OPS.test(ident)
              ? "text-[#ff8a8a]"
              : callParen
                ? "text-[#86adff]"
                : "text-paper";
    } else cls = sym ? "text-[#ff8a8a]" : "";

    out.push(
      <span key={key++} className={cls}>
        {text}
      </span>,
    );
    if (ident && callParen) out.push(callParen);
    last = start + full.length;
  }
  if (last < source.length) out.push(source.slice(last));
  return out;
}

interface Props {
  source: string;
  title?: string;
  accent?: "red" | "blue";
  className?: string;
}

export default function Code({
  source,
  title,
  accent = "red",
  className = "",
}: Props) {
  return (
    <div
      className={`overflow-hidden rounded-lg bg-panel ${accent === "red" ? "tube-red" : "tube-blue"} ${className}`}
    >
      {title && (
        <div className="flex h-9 items-center border-b border-line px-4">
          <span className="panel-title">{title}</span>
        </div>
      )}
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed">
        <code>{highlight(source.trim())}</code>
      </pre>
    </div>
  );
}
