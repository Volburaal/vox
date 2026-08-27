import { EyeOff } from 'lucide-react';

interface Props {
  ir: string[] | null;
  onHide: () => void;
}

/** Colours the first token of an IR line so the control flow stands out. */
function classify(line: string): string {
  const op = line.split(' ', 1)[0];
  switch (op) {
    case 'func_start':
    case 'func_end':
      return 'text-neon-red-soft';
    case 'label':
      return 'text-neon-blue-soft';
    case 'goto':
    case 'if_false':
    case 'call':
    case 'return':
      return 'text-amber';
    case 'print':
    case 'input':
      return 'text-paper';
    default:
      return 'text-fog';
  }
}

export default function IRPanel({ ir, onHide }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel-2">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-3">
          <span className="panel-title">Intermediate representation</span>
          {ir && <span className="text-xs text-fog">{ir.length} instructions</span>}
        </div>
        <button
          type="button"
          onClick={onHide}
          className="flex items-center gap-1.5 text-xs text-fog transition-colors hover:text-paper"
        >
          <EyeOff size={13} />
          hide
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed">
        {ir === null ? (
          <p className="text-fog/70">Run a program to see the IR it compiles to.</p>
        ) : (
          <table className="border-separate border-spacing-0">
            <tbody>
              {ir.map((line, i) => {
                const [op, ...rest] = line.split(' ');
                return (
                  <tr key={i}>
                    <td className="select-none pr-4 text-right align-top text-fog/50">{i}</td>
                    <td className="whitespace-pre align-top">
                      <span className={classify(line)}>{op}</span>
                      {rest.length > 0 && <span className="text-paper"> {rest.join(' ')}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
