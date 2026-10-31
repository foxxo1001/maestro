import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { sep } from 'node:path';
import { Projects, Workspaces } from '../db';

/**
 * Static preview for plain HTML files.
 *
 * The preview pipeline (address bar, console capture, annotate) is built
 * around http URLs, so instead of teaching it a custom scheme we run a tiny
 * static file server bound to 127.0.0.1 on an ephemeral port:
 *   http://127.0.0.1:<port>/f/<path segments>
 * Only files under the machine's known project/workspace roots are served.
 *
 * (A `maestro-local:` standard scheme was tried first; sandboxed renderers
 * crash on it with "preloadScripts of binding.startupData is null" in this
 * Electron, so it is no longer used by the UI — the registration stays only
 * as a fallback.)
 */

const SCHEME = 'maestro-local';

const MIME: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};

/** Must run before app ready. */
export function registerWorkspaceProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/** Runs after ready. Currently unused by the UI (see file comment). */
export function registerWorkspaceProtocol(): void {
  protocol.handle(SCHEME, async (req) => {
    try {
      const u = new URL(req.url);
      const p = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!allowedRoot(p)) return new Response('forbidden', { status: 403 });
      const body = await readFile(p);
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      return new Response(body, { headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

// ---------- the http static server the Preview tab actually uses ----------

let server: http.Server | null = null;
let port = 0;

/** Idempotent; called once at boot. Binds 127.0.0.1 on an ephemeral port. */
export function startStaticPreviewServer(): void {
  if (server) return;
  server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!u.pathname.startsWith('/f/')) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const p = u.pathname
        .slice(3)
        .split('/')
        .map((s) => decodeURIComponent(s))
        .filter(Boolean)
        .join(sep);
      if (!allowedRoot(p)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const body = await readFile(p);
      const ext = p.split('.').pop()?.toLowerCase() ?? '';
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      res.end(ext === 'html' || ext === 'htm' ? injectZoomBridge(body) : body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  server.listen(0, '127.0.0.1', () => {
    port = (server!.address() as { port: number }).port;
    console.log('[static-preview] serving on http://127.0.0.1:' + port);
  });
}

export function staticPreviewPort(): number {
  return port;
}

// Wheel events over the preview iframe never reach the parent document, so
// served HTML gets this bridge: it reports Ctrl+wheel / Ctrl+0 to the pane,
// which applies CSS zoom on the iframe (see SplitHtmlPreview).
const ZOOM_BRIDGE =
  `<script>(function(){var M='__maestroPreviewZoom';` +
  `addEventListener('wheel',function(e){if(!e.ctrlKey)return;e.preventDefault();` +
  `parent.postMessage({__maestroPreview:M,delta:e.deltaY<0?1:-1},'*')},{passive:false});` +
  `addEventListener('keydown',function(e){if(e.ctrlKey&&e.key==='0'){e.preventDefault();` +
  `parent.postMessage({__maestroPreview:M,reset:1},'*')}},true)}())</script>`;

function injectZoomBridge(body: Buffer): Buffer {
  const html = body.toString('utf8');
  const at = html.toLowerCase().lastIndexOf('</body>');
  if (at < 0) return Buffer.from(html + ZOOM_BRIDGE, 'utf8');
  return Buffer.from(html.slice(0, at) + ZOOM_BRIDGE + html.slice(at), 'utf8');
}

/** Case/slash-insensitive containment check against every known root. */
function allowedRoot(p: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
  const file = norm(p);
  const roots: string[] = [];
  try {
    for (const pr of Projects.list()) if (pr.repoPath) roots.push(pr.repoPath);
  } catch {}
  try {
    for (const w of Workspaces.list()) if (w.worktreePath) roots.push(w.worktreePath);
  } catch {}
  return roots.some((r) => {
    const nr = norm(r);
    return file === nr || file.startsWith(nr + '/');
  });
}
