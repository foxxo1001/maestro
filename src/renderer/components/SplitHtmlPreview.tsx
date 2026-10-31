import { useEffect, useState } from 'react';
import { staticPreviewUrl } from '../lib/staticPreview';
import PdfJsViewer from './PdfJsViewer';

/**
 * Side-pane static preview on the local server. HTML rides an iframe (scripts
 * and canvas run); PDF rides PDF.js canvas rendering — Chromium's PDF plugin
 * does not render inside iframes/embeds under Electron (the request just
 * downloads). The center Preview surface keeps its WebContentsView (console
 * capture, annotate, agent-driving).
 */
export default function SplitHtmlPreview({ absPath }: { absPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const isPdf = /\.pdf$/i.test(absPath);
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
  return (
    <div className="absolute inset-0">
      {url ? (
        isPdf ? (
          <PdfJsViewer url={url} nonce={nonce} />
        ) : (
          <iframe key={nonce} src={url} className="absolute inset-0 h-full w-full border-0 bg-white" title="预览" />
        )
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">加载中…</div>
      )}
    </div>
  );
}
