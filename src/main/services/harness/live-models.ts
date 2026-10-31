import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  CODEX_EFFORT_LEVELS,
  CONTEXT_WINDOW,
  HARNESS_MODELS,
  type EffortLevel,
  type ModelOption,
} from '../../../shared/types';
import { localHost } from '../../hosts/local';
import { readOAuthCreds } from './claude';
import { grokModels } from './grok-models';

/**
 * Live model catalogs for the harnesses whose backends can answer "what models
 * exist" — the Codex treatment (codex-models.ts) generalized:
 *   - claude-code: Anthropic /v1/models with the CLI's own OAuth credentials
 *     (the auth path fetchUsage already uses), cached to a file in userData
 *   - kimi-code:   `kimi provider list --json` — the CLI's own alias catalog,
 *     with display names, context windows and effort ladders
 *   - grok:        `grok models` — login-scoped availability list
 *   - cursor:      `cursor-agent models list`, parsed defensively (schema
 *     undocumented; any failure keeps the built-in Default-only list)
 *
 * Every getter falls back to the built-in HARNESS_MODELS entry, so the picker
 * is never empty and one misbehaving CLI can't blank the menu. Probes run at
 * startup and on the harness:models IPC (throttled); see refreshLiveModels in
 * codex-models.ts for the change-detection + broadcast wrapper.
 */

const TTL_MS = 60 * 60_000;

type LiveKey = 'claude-code' | 'kimi-code' | 'grok' | 'cursor';

const memo: Partial<Record<LiveKey, { at: number; models: ModelOption[] }>> = {};

const fallback = (h: LiveKey): ModelOption[] => HARNESS_MODELS[h] as ModelOption[];

/** The memoised list, while younger than the TTL. */
const fresh = (h: LiveKey): ModelOption[] | null => {
  const m = memo[h];
  return m && Date.now() - m.at < TTL_MS ? m.models : null;
};

/** All probes at once; resolves when every probe settled (success or not). */
export async function refreshLiveProbes(): Promise<void> {
  await Promise.allSettled([refreshClaude(), refreshKimi(), refreshGrok(), refreshCursor()]);
}

// ---------- claude-code: /v1/models over the CLI's own OAuth login ----------

const claudeCachePath = () => join(app.getPath('userData'), 'claude-models-cache.json');

/** Synchronous read path: the file the last successful refresh wrote, so app
 *  start shows the live list without waiting on the network. */
function claudeCacheModels(): ModelOption[] | null {
  try {
    const j = JSON.parse(readFileSync(claudeCachePath(), 'utf8'));
    return Array.isArray(j?.models) && j.models.length ? (j.models as ModelOption[]) : null;
  } catch {
    return null;
  }
}

export function claudeLiveModels(): ModelOption[] {
  return fresh('claude-code') ?? claudeCacheModels() ?? fallback('claude-code');
}

async function refreshClaude(): Promise<boolean> {
  // Account-scoped first (OAuth login, then a saved API key); models.dev — a
  // public, auth-free catalog — as the always-works fallback, so a machine
  // whose credentials aren't file-readable (Windows keychain installs) still
  // tracks new model releases.
  const sources = [claudeModelsFromOAuth(), claudeModelsFromApiKey(), claudeModelsFromModelsDev()];
  for (const source of sources) {
    const models = await source;
    if (models?.length) {
      memo['claude-code'] = { at: Date.now(), models };
      try {
        writeFileSync(claudeCachePath(), JSON.stringify({ models }));
      } catch {}
      return true;
    }
  }
  return false;
}

/** Anthropic /v1/models with the CLI's own OAuth credentials — the auth path
 *  fetchUsage uses. Null when this install's credentials aren't file-readable. */
async function claudeModelsFromOAuth(): Promise<ModelOption[] | null> {
  try {
    const creds = await readOAuthCreds();
    if (!creds?.accessToken) return null;
    if (creds.expiresAt && creds.expiresAt < Date.now()) return null;
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return (Array.isArray(j?.data) ? j.data : [])
      .filter((m: any) => typeof m?.id === 'string' && m.id.startsWith('claude-'))
      // Newest first — our picker lists run strongest→weakest, and the API's
      // created_at tracks release order.
      .sort((a: any, b: any) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))
      .map((m: any) => ({
        id: m.id,
        label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id,
        contextWindow: CONTEXT_WINDOW,
      }));
  } catch {
    return null;
  }
}

/** /v1/models with a plain ANTHROPIC_API_KEY, when the user runs key-based. */
async function claudeModelsFromApiKey(): Promise<ModelOption[] | null> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return (Array.isArray(j?.data) ? j.data : [])
      .filter((m: any) => typeof m?.id === 'string' && m.id.startsWith('claude-'))
      .sort((a: any, b: any) => String(b?.created_at ?? '').localeCompare(String(a?.created_at ?? '')))
      .map((m: any) => ({
        id: m.id,
        label: typeof m.display_name === 'string' && m.display_name ? m.display_name : m.id,
        contextWindow: CONTEXT_WINDOW,
      }));
  } catch {
    return null;
  }
}

/** models.dev's public catalog (the same registry `kimi provider catalog`
 *  imports from) — no auth, tracks new releases within days. Snapshot
 *  variants (`…-20251001`) are dropped so the picker stays readable. */
async function claudeModelsFromModelsDev(): Promise<ModelOption[] | null> {
  try {
    const res = await fetch('https://models.dev/api.json', { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const j: any = await res.json();
    return Object.entries(j?.anthropic?.models ?? {})
      .map(([key, v]: [string, any]) => ({ ...(v ?? {}), id: typeof v?.id === 'string' && v.id ? v.id : key }))
      .filter((m: any) => m.id.startsWith('claude-') && !/-\d{8}$/.test(m.id))
      .sort((a: any, b: any) => String(b?.release_date ?? '').localeCompare(String(a?.release_date ?? '')))
      .map((m: any) => ({
        id: m.id,
        label: typeof m.name === 'string' && m.name ? m.name : m.id,
        contextWindow: typeof m.context_window === 'number' ? m.context_window : CONTEXT_WINDOW,
      }));
  } catch {
    return null;
  }
}

// ---------- kimi-code: `kimi provider list --json` ----------

export function kimiLiveModels(): ModelOption[] {
  return fresh('kimi-code') ?? fallback('kimi-code');
}

async function refreshKimi(): Promise<boolean> {
  try {
    const r = await localHost.exec('kimi', ['provider', 'list', '--json'], { timeout: 20_000 });
    if (!r.ok) return false;
    const raw = (JSON.parse(r.stdout) as { models?: Record<string, any> }).models ?? {};
    const models: ModelOption[] = [];
    for (const [key, v] of Object.entries(raw)) {
      // Keys are `kimi-code/<alias>`; the bare alias is what the adapter
      // passes as `-m` (it re-wraps with the provider prefix itself).
      const id = typeof v?.model === 'string' && v.model ? v.model : (key.split('/').pop() ?? '');
      if (!id) continue;
      const efforts = Array.isArray(v?.supportEfforts)
        ? (v.supportEfforts as unknown[])
            .map((e) => CODEX_EFFORT_LEVELS.find((l) => l.id === e))
            .filter((l): l is EffortLevel => !!l)
        : undefined;
      models.push({
        id,
        label: typeof v?.displayName === 'string' && v.displayName ? v.displayName : id,
        ...(typeof v?.maxContextSize === 'number' ? { contextWindow: v.maxContextSize } : {}),
        ...(efforts?.length
          ? { efforts, defaultEffort: typeof v?.defaultEffort === 'string' ? v.defaultEffort : undefined }
          : {}),
      });
    }
    if (!models.length) return false;
    memo['kimi-code'] = { at: Date.now(), models };
    return true;
  } catch {
    return false;
  }
}

// ---------- grok: `grok models` ----------

export function grokLiveModels(): ModelOption[] {
  const live = fresh('grok');
  if (!live) return grokModels(); // built-ins + ~/.grok/config.toml custom models
  // Live list first (login-scoped, freshest); config.toml custom models after.
  const seen = new Set(live.map((m) => m.id));
  return [...live, ...grokModels().filter((m) => m.id && !seen.has(m.id))];
}

async function refreshGrok(): Promise<boolean> {
  try {
    const r = await localHost.exec('grok', ['models'], { timeout: 20_000 });
    if (!r.ok) return false;
    // Lines like "  * grok-4.7 (default)" / "  - grok-4.7-build-fast".
    const models: ModelOption[] = [...r.stdout.matchAll(/^\s*[*-]\s+(\S+?)(?:\s+\(default\))?\s*$/gm)].map((m) => {
      const rest = m[1].replace(/^grok-/, '').replace(/-/g, ' ');
      return { id: m[1], label: `Grok ${rest.replace(/(^|\s)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())}` };
    });
    if (!models.length) return false;
    memo.grok = { at: Date.now(), models };
    return true;
  } catch {
    return false;
  }
}

// ---------- cursor: `cursor-agent models list` (schema undocumented) ----------

export function cursorLiveModels(): ModelOption[] {
  const live = fresh('cursor');
  return live?.length ? live : fallback('cursor');
}

async function refreshCursor(): Promise<boolean> {
  try {
    let stdout = '';
    for (const args of [
      ['models', 'list'],
      ['models'],
    ]) {
      const r = await localHost.exec('cursor-agent', args, { timeout: 20_000 });
      if (r.ok && r.stdout.trim()) {
        stdout = r.stdout;
        break;
      }
    }
    if (!stdout) return false;
    const models = parseCursorModels(stdout);
    if (!models.length) return false;
    memo.cursor = { at: Date.now(), models };
    return true;
  } catch {
    return false;
  }
}

/** Best-effort parse: a JSON array of ids/objects, a {models:[…]} envelope, or
 *  plain "id" / "- id — label" lines. Empty on anything unrecognizable — the
 *  caller then keeps the built-in Default-only list. */
function parseCursorModels(out: string): ModelOption[] {
  const t = out.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t);
      const arr = Array.isArray(j) ? j : Array.isArray(j?.models) ? j.models : [];
      return arr
        .map((m: any) => (typeof m === 'string' ? { id: m } : m))
        .map((m: any) => ({
          id: m?.id ?? m?.name ?? m?.slug,
          label: m?.label ?? m?.display_name ?? m?.displayName ?? m?.id ?? m?.name ?? m?.slug,
        }))
        .filter((m: any): m is ModelOption => typeof m.id === 'string' && !!m.id);
    } catch {}
  }
  return [...t.matchAll(/^\s*[*-]?\s*(\S+)(?:\s+[—-]\s+(.+))?$/gm)]
    .map((m) => ({ id: m[1], label: (m[2] ?? m[1]).trim() }))
    .filter((m) => /^[a-z0-9][a-z0-9._/:+-]*$/i.test(m.id));
}
