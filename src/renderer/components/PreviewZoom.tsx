import { useCallback, useEffect, useRef, useState } from 'react';

/** Ctrl+wheel zoom for the split preview pane. React's root onWheel is a
 *  passive listener (preventDefault is dropped), so the wheel listener is
 *  attached manually with passive:false. */

const MIN = 0.3;
const MAX = 3;

export function usePreviewZoom() {
  const [zoom, setZoom] = useState(1);
  const step = useCallback((dir: number) => {
    setZoom((z) => Math.min(MAX, Math.max(MIN, Math.round((z + dir * 0.1) * 10) / 10)));
  }, []);
  const reset = useCallback(() => setZoom(1), []);
  // Ctrl+0 resets, wherever focus is in our own document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { zoom, step, reset };
}

/** Ctrl+wheel over `ref`'s box steps the zoom (up = in). */
export function useCtrlWheelZoom(ref: React.RefObject<HTMLElement | null>, step: (dir: number) => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}

/** Floating zoom pill, bottom-right; hidden at 100% to keep the pane clean. */
export function PreviewZoomBadge({
  zoom,
  onStep,
  onReset,
}: {
  zoom: number;
  onStep: (dir: number) => void;
  onReset: () => void;
}) {
  if (zoom === 1) return null;
  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full border border-border/60 bg-raised/95 px-1.5 py-1 text-2xs shadow-md backdrop-blur">
      <button className="rounded px-1.5 hover:text-fg" title="缩小（Ctrl+滚轮）" onClick={() => onStep(-1)}>
        −
      </button>
      <button className="min-w-10 text-center font-mono text-muted" title="重置为 100%（Ctrl+0）" onClick={onReset}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="rounded px-1.5 hover:text-fg" title="放大（Ctrl+滚轮）" onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}
