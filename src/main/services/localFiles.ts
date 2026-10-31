import { protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { Projects, Workspaces } from '../db';

/**
 * Static-file preview: `maestro-local://f/<percent-encoded absolute path>`
 * serves a file straight off disk, so the Preview tab can render a plain
 * index.html without a dev server. Standard scheme (relative subresources
 * resolve inside the same directory). Paths are validated against the
 * machine's project/workspace roots — arbitrary disk reads stay impossible.
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

/** Runs after ready. */
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
