import {
  PHRASES,
  phraseKind,
  KEYWORDS,
  TYPES,
  WORD_OPERATORS,
  BOOLS,
} from "../vox/language";

/**
 * A static, highlighted Vox snippet for the landing and documentation pages.
 * It shares its word lists with the editor's tokenizer, so a snippet here is
 * coloured exactly as it would be in the playground - without paying for
 * CodeMirror on a page that only reads code.
 */

const COLOR: Record<string, string> = {
  keyword: "text-[#ff4d4d] font-medium",
  type: "text-[#5b9dff]",
  operator: "text-[#ff8a8a]",
  string: "text-[#ffd27a]",
  number: "text-[#9ad1ff]",
  bool: "text-[#9ad1ff]",
  comment: "text-[#5c5c66] italic",
  function: "text-[#86adff]",
  variable: "text-paper",
  punctuation: "text-[#8b8b96]",
};

// Longest first, so `is added to` wins over `is` and `**=` over `*`.
const TOKEN_RE = new RegExp(
  "(" +
    PHRASES.map((p) => p.replace(/ /g, "\\s+")).join("|") +
    ")(?![A-Za-z0-9_])" +
    '|("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')' +
    "|(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" +
    "|(\\d+(?:st|nd|rd|th)(?![A-Za-z0-9_])|\\d+(?:\\.\\d+)?)" +
    "|([A-Za-z_][A-Za-z0-9_]*)(\\s*\\()?" +
    "|(\\*\\*=|\\*\\*|\\+\\+|--|\\+=|-=|\\*=|\\/=|%=|\\^=|->|<-|<=|>=|=<|=>|==|!=|&&|\\|\\||[+\\-*/%^<>=&|~!])" +
    "|([(){}\\[\\];,:.])",
  "g",
);

function kindOf(
  phrase: string,
  str: string,
  comment: string,
  num: string,
  ident: string,
  callParen: string,
  sym: string,
): string {
  if (phrase) return phraseKind.get(phrase.replace(/\s+/g, " ")) ?? "operator";
  if (str) return "string";
  if (comment) return "comment";
  if (num) return "number";
  if (ident) {
    if (KEYWORDS.has(ident)) return "keyword";
    if (TYPES.has(ident)) return "type";
    if (BOOLS.has(ident)) return "bool";
    if (WORD_OPERATORS.has(ident)) return "operator";
    return callParen ? "function" : "variable";
  }
  return sym ? "operator" : "punctuation";
}

function highlight(source: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const m of source.matchAll(TOKEN_RE)) {
    const start = m.index!;
    if (start > last) out.push(source.slice(last, start));
    const [full, phrase, str, comment, num, ident, callParen, sym] = m;

    // Anything left over - braces, semicolons, commas - is punctuation.
    const kind = kindOf(phrase, str, comment, num, ident, callParen, sym);
    const text = ident ? ident : full;

    out.push(
      <span key={key++} className={COLOR[kind]}>
        {text}
      </span>,
    );
    // The whitespace and paren after a call name are not part of the name.
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
