import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { RotateCw } from 'lucide-react';
import { PreviewZoomBadge, useCtrlWheelZoom, usePreviewZoom } from './PreviewZoom';

// PDF.js renders pages to canvas — no dependence on Chromium's PDF plugin,
// which Electron does not enable inside iframes/embeds (a PDF request there
// just downloads instead of displaying).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGES = 100;

export default function PdfJsViewer({ url, nonce }: { url: string; nonce: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState('');
  const { zoom, step, reset } = usePreviewZoom();
  useCtrlWheelZoom(hostRef, step);

  // Load the document once per url/refresh; zoom re-renders from the same doc.
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErr('');
    setDoc(null);
    (async () => {
      try {
        const d = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          void d.destroy();
          return;
        }
        setDoc(d);
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, refresh]);

  // Render pages at the current zoom; keeps the scroll position roughly put.
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    const prevRatio = host.scrollHeight > 0 ? host.scrollTop / host.scrollHeight : 0;
    host.innerHTML = '';
    (async () => {
      try {
        const pages = Math.min(doc.numPages, MAX_PAGES);
        for (let i = 1; i <= pages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.max(0.4, (host.clientWidth - 24) / base.width) * zoom;
          const vp = page.getViewport({ scale });
          const dpr = window.devicePixelRatio || 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width * dpr);
          canvas.height = Math.floor(vp.height * dpr);
          canvas.style.width = `${Math.floor(vp.width)}px`;
          canvas.style.margin = '0 auto 12px';
          canvas.style.display = 'block';
          canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,.25)';
          host.appendChild(canvas);
          const ctx = canvas.getContext('2d')!;
          await page.render({
            canvasContext: ctx,
            viewport: vp,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
        }
        if (!cancelled) {
          host.scrollTop = prevRatio * host.scrollHeight;
          setStatus('ok');
        }
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, zoom]);

  // Drop the worker-side doc when the viewer unmounts or reloads.
  useEffect(() => {
    return () => {
      void doc?.destroy();
    };
  }, [doc]);

  return (
    <div className="absolute inset-0 bg-[#525659]">
      <div ref={hostRef} className="absolute inset-0 overflow-auto px-3 py-3" />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-x-0 top-3 text-center text-2xs text-white/80">加载中…</div>
      )}
      {status === 'error' && (
        <div className="absolute inset-x-3 top-3 rounded-lg bg-err/10 px-3 py-2 text-2xs text-err">
          PDF 渲染失败：{err}
        </div>
      )}
      <button
        className="btn absolute right-2 top-2 h-6 gap-1 text-2xs"
        title="重新加载"
        onClick={() => setRefresh((n) => n + 1)}
      >
        <RotateCw size={11} />
      </button>
      <PreviewZoomBadge zoom={zoom} onStep={step} onReset={reset} />
    </div>
  );
}
