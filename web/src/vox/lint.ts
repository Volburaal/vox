import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Text } from '@codemirror/state';
import { compile } from '@vox/core';

/** Clamps a (1-based line, 0-based column) position into the document. */
function offset(doc: Text, line: number, column: number): number {
  const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return Math.min(l.from + Math.max(0, column), l.to);
}

/**
 * Runs the real Vox compiler on the buffer (debounced) and turns its
 * diagnostics into CodeMirror lint ranges: red squiggles for syntax and
 * semantic errors, orange for warnings. Programs are small, so compiling on
 * the main thread is well under a frame.
 */
export const voxLinter = linter(view => {
  const doc = view.state.doc;
  if (doc.toString().trim() === '') return [];

  const { diagnostics } = compile(doc.toString());
  return diagnostics.map<CmDiagnostic>(d => {
    const from = offset(doc, d.line, d.column);
    let to = offset(doc, d.endLine, d.endColumn);
    if (to <= from) to = Math.min(from + 1, doc.length);
    return { from, to, severity: d.severity, message: d.message, source: 'vox' };
  });
}, { delay: 350 });

export const voxLintGutter = lintGutter();
