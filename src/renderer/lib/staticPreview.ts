import { tryInvoke } from './api';

/**
 * URL for serving an absolute file path through the app's local static
 * preview server (started at boot, bound to 127.0.0.1). Each path segment is
 * encoded separately so relative subresources (css/js/img) resolve inside the
 * same directory.
 */
export async function staticPreviewUrl(absPath: string): Promise<string | null> {
  const { data } = await tryInvoke('preview:staticPort');
  const port = data;
  if (!port) return null;
  const segs = absPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `http://127.0.0.1:${port}/f/${segs}`;
}
