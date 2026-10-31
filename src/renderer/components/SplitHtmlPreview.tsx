import { useEffect, useRef, useState } from 'react';
import { staticPreviewUrl } from '../lib/staticPreview';
import PdfJsViewer from './PdfJsViewer';
import { PreviewZoomBadge, useCtrlWheelZoom, usePreviewZoom } from './PreviewZoom';

/**
 * Side-pane static preview on the local server. HTML rides an iframe (scripts
 * and canvas run); PDF rides PDF.js canvas rendering — Chromium's PDF plugin
 * does not render inside iframes/embeds under Electron (the request just
 * downloads). The center Preview surface keeps its WebContentsView (console
 * capture, annotate, agent-driving).
 *
 * Ctrl+wheel zooms: wheel over the iframe itself is seen by the iframe's
 * document, so the static server injects a small script into served HTML that
 * forwards the gesture via postMessage; wheel outside the iframe (and all of
 * the PDF viewer, which we render) is caught here directly. CSS `zoom` on the
 * iframe re-lays the page out at the new size (transform: scale would only
 * magnify without reflow).
 */
const MARKER = '__maestroPreviewZoom';

export default function SplitHtmlPreview({ absPath }: { absPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const isPdf = /\.pdf$/i.test(absPath);
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { zoom, step, reset } = usePreviewZoom();
  useCtrlWheelZoom(wrapRef, step);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    void staticPreviewUrl(absPath).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [absPath, nonce]);
  // The injected script inside the iframe reports Ctrl+wheel / Ctrl+0 here.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __maestroPreview?: string; delta?: number; reset?: number } | null;
      if (!d || d.__maestroPreview !== MARKER) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (!/^http:\/\/127\.0\.0\.1:/.test(e.origin)) return;
      if (d.reset) reset();
      else if (d.delta) step(d.delta);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [step, reset]);
  return (
    <div ref={wrapRef} className="absolute inset-0">
      {url ? (
        isPdf ? (
          <PdfJsViewer url={url} nonce={nonce} />
        ) : (
          <iframe
            key={nonce}
            ref={iframeRef}
            src={url}
            className="absolute inset-0 h-full w-full border-0 bg-white"
            style={{ zoom }}
            title="预览"
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">加载中…</div>
      )}
      <PreviewZoomBadge zoom={zoom} onStep={step} onReset={reset} />
    </div>
  );
}
