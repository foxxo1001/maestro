import fs from 'fs';
import os from 'os';
import path from 'path';
import type { GlobalSettings, McpServerConfig } from '../../shared/types';

/**
 * MCP (Model Context Protocol) injection for harness runs.
 *
 * Maestro doesn't speak MCP itself — the harness CLIs are the MCP clients.
 * We manage the server list (Settings → MCP) and hand it to each CLI in its
 * own dialect at spawn time:
 *   - claude-code: a `--mcp-config` JSON file (merged with the user's own
 *     servers; pass `--strict-mcp-config` by hand if isolation is wanted)
 *   - codex:       `-c mcp_servers.<id>.*` runtime config overrides
 * and the CLI spawns and owns the server processes for the run. Kimi has no
 * MCP surface yet (its print mode exposes no such flags), so it never
 * receives servers.
 */

/** Enabled servers, in saved order — malformed entries are skipped so one bad
 *  row can't take down every turn. */
export function enabledMcpServers(settings: GlobalSettings): McpServerConfig[] {
  return (settings.mcpServers ?? []).filter(
    (s) => s.enabled && !!s.id.trim() && /^[a-zA-Z0-9_-]+$/.test(s.id) && !!s.command.trim()
  );
}

/** Claude Code: write the `--mcp-config` JSON (stdio servers) to a stable file
 *  under the OS temp dir and return its path; null when there's nothing to
 *  inject. One file rewritten per turn — the CLI reads it once at spawn, and a
 *  stable path keeps temp litter at zero. */
export function claudeMcpConfigFile(servers: McpServerConfig[]): string | null {
  if (!servers.length) return null;
  const mcpServers: Record<string, unknown> = {};
  for (const s of servers) {
    mcpServers[s.id] = {
      type: 'stdio',
      command: s.command,
      args: s.args,
      ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}),
    };
  }
  const dir = path.join(os.tmpdir(), 'maestro-mcp');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'claude.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
    return file;
  } catch (err) {
    console.error('[mcp] failed to write claude config', err);
    return null;
  }
}

/** Codex: `codex exec -c mcp_servers.<id>.*` runtime overrides — the same shape
 *  `config.toml` would hold, without touching the user's file. Values are TOML
 *  literals; JSON string/array syntax doubles as TOML here. Empty when there's
 *  nothing to inject. */
export function codexMcpArgs(servers: McpServerConfig[]): string[] {
  const args: string[] = [];
  for (const s of servers) {
    const base = `mcp_servers.${s.id}`;
    args.push('-c', `${base}.command=${tomlString(s.command)}`);
    if (s.args.length) args.push('-c', `${base}.args=[${s.args.map(tomlString).join(',')}]`);
    for (const [k, v] of Object.entries(s.env ?? {})) {
      if (/^[a-zA-Z0-9_-]+$/.test(k)) args.push('-c', `${base}.env.${k}=${tomlString(v)}`);
    }
  }
  return args;
}

/** JSON string escaping matches TOML basic-string escaping for the characters
 *  that matter (backslash, quote, control chars). */
function tomlString(v: string): string {
  return JSON.stringify(v);
}
