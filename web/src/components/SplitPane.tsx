import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent, type ReactNode } from 'react';

interface Props {
  /** 'horizontal' places panes side by side; 'vertical' stacks them. */
  direction: 'horizontal' | 'vertical';
  /** The first pane's share of the space, 0..1. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  first: ReactNode;
  /** Pass null to hide the second pane and the handle entirely. */
  second: ReactNode | null;
  min?: number;
  max?: number;
  className?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Two panes with a draggable divider. The divider carries a small round grip
 * (the "o" in the layout sketch) and glows while it is being dragged. It is
 * also keyboard-operable: focus it and use the arrow keys.
 */
export default function SplitPane({
  direction, ratio, onRatioChange, first, second, min = 0.2, max = 0.8, className = '',
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const horizontal = direction === 'horizontal';
  const showSecond = second !== null;

  const updateFromPointer = (e: PointerEvent) => {
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    const r = horizontal
      ? (e.clientX - rect.left) / rect.width
      : (e.clientY - rect.top) / rect.height;
    onRatioChange(clamp(r, min, max));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromPointer(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) updateFromPointer(e);
  };
  const endDrag = () => setDragging(false);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === dec) { onRatioChange(clamp(ratio - 0.02, min, max)); e.preventDefault(); }
    if (e.key === inc) { onRatioChange(clamp(ratio + 0.02, min, max)); e.preventDefault(); }
  };

  // While dragging, keep the resize cursor everywhere so it doesn't flicker
  // over the editor or console content.
  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    return () => { document.body.style.cursor = prev; };
  }, [dragging, horizontal]);

  return (
    <div
      ref={container}
      className={`flex min-h-0 min-w-0 ${horizontal ? 'flex-row' : 'flex-col'} ${dragging ? 'select-none' : ''} ${className}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={showSecond ? { flex: `0 0 calc(${ratio * 100}% - 4px)` } : { flex: '1 1 0%' }}
      >
        {first}
      </div>

      {showSecond && (
        <div
          role="separator"
          aria-orientation={horizontal ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={Math.round(min * 100)}
          aria-valuemax={Math.round(max * 100)}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className={`group relative flex shrink-0 items-center justify-center bg-line outline-none transition-colors touch-none
            ${horizontal ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize'}
            ${dragging ? 'bg-neon-blue/40' : 'hover:bg-line-2 focus-visible:bg-neon-blue/30'}`}
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute h-3.5 w-3.5 rounded-full border bg-panel transition-all
              ${dragging
                ? 'scale-110 border-neon-blue shadow-[0_0_10px_rgba(61,123,255,0.85)]'
                : 'border-line-2 group-hover:border-neon-blue group-hover:shadow-[0_0_8px_rgba(61,123,255,0.6)] group-focus-visible:border-neon-blue'}`}
          />
        </div>
      )}

      {showSecond && <div className="min-h-0 min-w-0 flex-1">{second}</div>}
    </div>
  );
}

/** True when the media query matches; re-evaluates on change. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
