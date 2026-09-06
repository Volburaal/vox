import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { StringStream } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

/**
 * Syntax highlighting for Vox. This is a lightweight stream tokenizer, not a
 * full parser: the real grammar lives in Vox.g4 and runs in the worker.
 *
 * Multi-word phrases are matched first, longest first, so "is greater or
 * equal to" is one operator token rather than five words.
 */

const DECL_STARTERS = ['let there be an', 'let there be a', 'consider an', 'consider a', 'suppose an', 'suppose a'];
const KEYWORD_PHRASES = [
  'some user input', 'a user input', 'after iteration', 'an input', 'in steps of', 'down to',
  'is a list of', 'for every', 'for each', 'list of', 'item of', 'value of',
];
const ASSIGN_PHRASES = ['which is equal to', 'which equals'];
const TYPE_PHRASES = ['floating point number', 'character string', 'boolean number', 'whole number'];
const OPERATOR_PHRASES = [
  'raised to the power of', 'is greater or equal to', 'is less or equal to',
  'is subtracted from', 'to the power of', 'is greater than', 'is decremented',
  'is incremented', 'subtracted from', 'remainder from', 'is less than',
  'multiplied by', 'is equal to', 'is added to', 'divided by', 'is doubled',
  'is halved', 'equals to', 'added to', 'is not',
];
// Spoken forms of the builtin functions.
const BUILTIN_PHRASES = [
  'absolute value of', 'square root of', 'uppercase of', 'lowercase of',
  'ceiling of', 'length of', 'floor of', 'copy of',
  'smallest of', 'position of', 'largest of', 'sum of',
];

export const PHRASES = [
  ...DECL_STARTERS, ...KEYWORD_PHRASES, ...ASSIGN_PHRASES, ...TYPE_PHRASES,
  ...OPERATOR_PHRASES, ...BUILTIN_PHRASES,
].sort((a, b) => b.length - a.length);

export const KEYWORDS = new Set([
  'main', 'program', 'code', 'if', 'else', 'otherwise', 'while', 'for', 'action',
  'print', 'say', 'input', 'ask', 'return',
  'break', 'stop', 'continue', 'skip', 'void', 'nothing', 'procedure', 'as',
  // range loops
  'from', 'to', 'until', 'step', 'by', 'the',
  // in-place updates
  'increment', 'decrement', 'increase', 'decrease', 'add', 'subtract', 'take',
  'remove', 'multiply', 'divide', 'double', 'halve',
  // voice and textbook forms
  'set', 'let', 'be', 'swap', 'repeat',
  'even', 'odd', 'positive', 'negative', 'empty', 'divisible', 'between',
  // lists
  'list', 'in', 'at', 'push', 'insert', 'into', 'pop', 'contains',
  'lock', 'unlock', 'wrap', 'unwrap', 'locked', 'wrapping', 'sort', 'reverse', 'fixed',
  // constants
  'constant', 'always',
]);
export const TYPES = new Set([
  'int', 'integer', 'integers', 'number', 'numbers', 'float', 'floats',
  'bool', 'bools', 'boolean', 'booleans', 'character', 'characters', 'char', 'chars',
  'string', 'strings', 'varchar',
]);
export const WORD_OPERATORS = new Set([
  'is', 'equals', 'minus', 'plus', 'times', 'and', 'or', 'not', 'squared', 'cubed',
]);
export const BOOLS = new Set(['true', 'false']);

/** What each multi-word phrase is, so static and live highlighting agree. */
export const phraseKind = new Map<string, string>();
for (const p of DECL_STARTERS) phraseKind.set(p, 'keyword');
for (const p of KEYWORD_PHRASES) phraseKind.set(p, 'keyword');
for (const p of ASSIGN_PHRASES) phraseKind.set(p, 'operator');
for (const p of TYPE_PHRASES) phraseKind.set(p, 'type');
for (const p of OPERATOR_PHRASES) phraseKind.set(p, 'operator');
for (const p of BUILTIN_PHRASES) phraseKind.set(p, 'function');

const PHRASE_RE = new RegExp(
  '^(?:' + PHRASES.map(p => p.split(' ').join('\\s+')).join('|') + ')(?![A-Za-z0-9_])',
);
// Longest first: `**=` before `**` before `*`.
const SYMBOL_RE = /^(?:\*\*=|\*\*|\+\+|--|\+=|-=|\*=|\/=|%=|\^=|->|<-|<=|>=|=<|=>|==|!=|&&|\|\||[+\-*/%^<>=&|~!])/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

interface State {
  inBlockComment: boolean;
}

export const voxLanguage = StreamLanguage.define<State>({
  name: 'vox',
  startState: () => ({ inBlockComment: false }),
  token(stream: StringStream, state: State): string | null {
    if (state.inBlockComment) {
      if (stream.match(/^.*?\*\//)) state.inBlockComment = false;
      else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;

    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { state.inBlockComment = true; return 'comment'; }

    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)*'?/)) return 'string';
    // Ordinals (`2nd`) before plain numbers, so the suffix is not read as a name.
    if (stream.match(/^\d+(?:st|nd|rd|th)(?![A-Za-z0-9_])/)) return 'number';
    if (stream.match(/^\d+\.\d+/) || stream.match(/^\d+/)) return 'number';

    const phrase = stream.match(PHRASE_RE) as RegExpMatchArray | null;
    if (phrase) {
      return phraseKind.get(phrase[0].replace(/\s+/g, ' ')) ?? 'operator';
    }

    if (stream.match(SYMBOL_RE)) return 'operator';
    if (stream.match(/^[(){}[\];,:.]/)) return 'punctuation';

    const ident = stream.match(IDENT_RE) as RegExpMatchArray | null;
    if (ident) {
      const word = ident[0];
      if (KEYWORDS.has(word)) return 'keyword';
      if (TYPES.has(word)) return 'type';
      if (BOOLS.has(word)) return 'bool';
      if (WORD_OPERATORS.has(word)) return 'operator';
      if (stream.match(/^\s*\(/, false)) return 'function';
      return 'variable';
    }

    stream.next();
    return null;
  },
  tokenTable: {
    keyword: tags.keyword,
    type: tags.typeName,
    string: tags.string,
    number: tags.number,
    comment: tags.comment,
    operator: tags.operator,
    bool: tags.bool,
    punctuation: tags.punctuation,
    variable: tags.variableName,
    function: tags.function(tags.variableName),
  },
});

/** Neon palette: keywords red, types blue, everything else kept quiet. */
export const voxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: '#ff4d4d', fontWeight: '500' },
  { tag: tags.typeName, color: '#5b9dff' },
  { tag: tags.operator, color: '#ff8a8a' },
  { tag: tags.string, color: '#ffd27a' },
  { tag: tags.number, color: '#9ad1ff' },
  { tag: tags.bool, color: '#9ad1ff' },
  { tag: tags.comment, color: '#5c5c66', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: '#86adff' },
  { tag: tags.variableName, color: '#ececf1' },
  { tag: tags.punctuation, color: '#8b8b96' },
]));

export const voxTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#0b0b0e',
    color: '#ececf1',
    fontSize: '14px',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.65',
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { padding: '0 16px' },
  '.cm-gutters': {
    backgroundColor: '#0b0b0e',
    color: '#45454f',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 43, 43, 0.05)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#ff6b6b' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ff2b2b', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(61, 123, 255, 0.28) !important',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(61, 123, 255, 0.2)',
    outline: '1px solid rgba(61, 123, 255, 0.6)',
  },
  // Lint: red squiggles for errors, amber for warnings, dark tooltips.
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy #ff2b2b',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy #ffb454',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cm-gutter-lint': { width: '1.1em' },
  '.cm-lint-marker-error': { content: 'none' },
  '.cm-tooltip': {
    backgroundColor: '#101014',
    border: '1px solid #2a2a34',
    color: '#ececf1',
    borderRadius: '6px',
  },
  '.cm-tooltip.cm-tooltip-lint': { padding: '2px 0' },
  '.cm-tooltip .cm-diagnostic': { padding: '4px 10px', borderLeftWidth: '3px' },
  '.cm-tooltip .cm-diagnostic-error': { borderLeftColor: '#ff2b2b' },
  '.cm-tooltip .cm-diagnostic-warning': { borderLeftColor: '#ffb454' },
  '.cm-diagnosticSource': { color: '#8b8b96' },
}, { dark: true });
