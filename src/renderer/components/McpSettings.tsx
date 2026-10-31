import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { useApp } from '../store/app';
import { SettingsRow, SettingsSection } from './HarnessesSettings';
import { Toggle } from './common';
import type { McpServerConfig } from '../../shared/types';
import { t } from '../../shared/i18n';

/** Settings → MCP. Maestro manages the server list; the harness CLIs that
 *  support MCP (claude-code, codex) are the actual clients — each run spawns
 *  the enabled servers itself. Kimi has no MCP surface yet, so it never
 *  receives servers. */

/** Split a shell-style args line into argv, honoring quotes. */
function splitArgs(line: string): string[] {
  return (
    line
      .match(/"[^"]*"|'[^']*'|\S+/g)
      ?.map((t) => t.replace(/^["']|["']$/g, ''))
      .filter(Boolean) ?? []
  );
}

/** Server ids become CLI config keys (claude JSON keys, codex TOML paths), so
 *  keep them to [a-zA-Z0-9_-]. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'server'
  );
}

interface Draft {
  id: string;
  name: string;
  command: string;
  argsLine: string;
  envText: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = { id: '', name: '', command: '', argsLine: '', envText: '', enabled: true };

function toDraft(s: McpServerConfig): Draft {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    argsLine: s.args.join(' '),
    envText: Object.entries(s.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    enabled: s.enabled,
  };
}

/** Draft → config, or a user-facing error string. */
function fromDraft(d: Draft): { server?: McpServerConfig; error?: string } {
  const id = d.id.trim();
  const command = d.command.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return { error: 'ID 只能包含字母、数字、- 和 _（它会被写进 CLI 配置）' };
  if (!command) return { error: '请填写启动命令，例如 npx' };
  const env: Record<string, string> = {};
  for (const line of d.envText.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) return { error: `环境变量行格式应为 KEY=value：${t}` };
    env[t.slice(0, eq).trim()] = t.slice(eq + 1);
  }
  return {
    server: {
      id,
      name: d.name.trim() || id,
      command,
      args: splitArgs(d.argsLine),
      ...(Object.keys(env).length ? { env } : {}),
      enabled: d.enabled,
    },
  };
}

const input = 'input w-full';

export default function McpTab() {
  const settings = useApp((s) => s.settings);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editIdx, setEditIdx] = useState(-1);
  const [error, setError] = useState('');
  const servers = settings.mcpServers ?? [];

  const save = (next: McpServerConfig[]) => void useApp.getState().saveSettings({ mcpServers: next });

  const startAdd = () => {
    setEditIdx(-1);
    setError('');
    setDraft({ ...EMPTY_DRAFT });
  };
  const startEdit = (i: number) => {
    setEditIdx(i);
    setError('');
    setDraft(toDraft(servers[i]));
  };

  const commit = () => {
    if (!draft) return;
    const r = fromDraft(draft);
    if (!r.server) {
      setError(r.error ?? '无效配置');
      return;
    }
    if (servers.some((s, i) => s.id === r.server!.id && i !== editIdx)) {
      setError(`ID "${r.server.id}" 已被占用`);
      return;
    }
    const next = [...servers];
    if (editIdx >= 0) next[editIdx] = r.server;
    else next.push(r.server);
    save(next);
    setDraft(null);
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t("MCP servers")}
        description="注入到支持 MCP 的 agent CLI：Claude Code 走 --mcp-config，Codex 走运行时 -c 覆盖；服务器进程由 CLI 自己拉起（仅 stdio 类型）。Kimi 暂无 MCP 入口。"
        action={
          !draft && (
            <button className="btn h-8" onClick={startAdd}>
              <Plus className="h-3.5 w-3.5" /> 添加 server
            </button>
          )
        }
      >
        {draft ? (
          <SettingsRow
            stack
            label={editIdx >= 0 ? `编辑：${servers[editIdx].name}` : '新增 MCP server'}
            description="启动命令 + 参数按空格分割（引号包裹的算一个参数）。"
          >
            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className="text-2xs text-muted">名称</span>
                <input
                  className={input}
                  value={draft.name}
                  onChange={(e) =>
                    setDraft({ ...draft, name: e.target.value, id: editIdx < 0 ? slugify(e.target.value) : draft.id })
                  }
                  placeholder="Filesystem"
                />
              </label>
              <label className="space-y-1">
                <span className="text-2xs text-muted">ID（配置键）</span>
                <input
                  className={input}
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  placeholder="filesystem"
                />
              </label>
              <label className="space-y-1">
                <span className="text-2xs text-muted">启动命令</span>
                <input
                  className={input}
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="npx"
                />
              </label>
              <label className="space-y-1">
                <span className="text-2xs text-muted">参数（空格分割）</span>
                <input
                  className={input}
                  value={draft.argsLine}
                  onChange={(e) => setDraft({ ...draft, argsLine: e.target.value })}
                  placeholder="-y @modelcontextprotocol/server-filesystem D:/tmp"
                />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-2xs text-muted">环境变量（每行 KEY=value，可留空）</span>
              <textarea
                className={`${input} h-20 resize-y font-mono`}
                value={draft.envText}
                onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
                placeholder={'API_KEY=xxx'}
              />
            </label>
            {error && <p className="text-2xs text-err">{error}</p>}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-2xs text-muted">
                <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} />
                启用
              </label>
              <div className="flex items-center gap-2">
                <button className="btn h-8" onClick={() => setDraft(null)}>
                  <X className="h-3.5 w-3.5" /> 取消
                </button>
                <button className="btn btn-accent h-8" onClick={commit}>
                  保存
                </button>
              </div>
            </div>
          </SettingsRow>
        ) : servers.length === 0 ? (
          <SettingsRow description="还没有配置 MCP server。添加后，每次 Claude Code / Codex 会话启动时会自动注入。">
            <span />
          </SettingsRow>
        ) : (
          servers.map((s, i) => (
            <SettingsRow
              key={s.id}
              label={
                <span className="flex items-center gap-2">
                  {s.name}
                  <code className="rounded bg-raised px-1 py-0.5 font-mono text-2xs text-muted">{s.id}</code>
                </span>
              }
              description={
                <code className="font-mono text-2xs">
                  {s.command} {s.args.join(' ')}
                </code>
              }
            >
              <Toggle
                checked={s.enabled}
                onChange={(v) => save(servers.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
              />
              <button className="btn h-8" onClick={() => startEdit(i)} title="编辑">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                className="btn h-8"
                onClick={() => save(servers.filter((_, j) => j !== i))}
                title="删除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </div>
  );
}
