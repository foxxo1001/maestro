import { useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { staticPreviewUrl } from '../lib/staticPreview';

/**
 * Side-pane static HTML preview: an iframe on the local static server. The
 * center Preview surface keeps its WebContentsView (console capture, annotate,
 * agent-driving); this one is deliberately plain — scripts and canvas run,
 * no chrome, instant reload.
 */
export default function SplitHtmlPreview({ absPath }: { absPath: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
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
    <div className="absolute inset-0 bg-white">
      {url ? (
        <iframe key={nonce} src={url} className="h-full w-full border-0" title="预览" />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted">加载中…</div>
      )}
      <button className="btn absolute right-2 top-2 h-6 gap-1 text-2xs" title="重新加载" onClick={() => setNonce((n) => n + 1)}>
        <RotateCw size={11} />
      </button>
    </div>
  );
}
