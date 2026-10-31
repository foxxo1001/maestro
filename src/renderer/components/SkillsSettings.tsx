import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { tryInvoke } from '../lib/api';
import { useApp } from '../store/app';
import { SettingsRow, SettingsSection } from './HarnessesSettings';
import { Spinner } from './common';
import type { HarnessId, SkillEntry } from '../../shared/types';

/** Settings → Skills: manage user-scope skills per harness (the files the CLI
 *  loads on its next run — same folders the slash menu reads). Grok has no
 *  native loader; its skills are inlined into the prompt by the composer, so
 *  they work there too. */

const HARNESS_SKILLS: { id: HarnessId; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'kimi-code', label: 'Kimi Code' },
  { id: 'grok', label: 'Grok Build' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
];

function parseFrontmatter(md: string): { name: string; description: string; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: '', description: '', body: md };
  const get = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])?.[1]?.trim() ?? '';
  return { name: get('name'), description: get('description'), body: m[2] ?? '' };
}

const buildMd = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;

const template = (name: string) =>
  buildMd(name || 'my-skill', '一句话描述这个技能的用途', `# ${name || 'my-skill'}\n\n在这里写技能说明…`);

export default function SkillsManagerTab() {
  const toast = useApp((s) => s.toast);
  const [harness, setHarness] = useState<HarnessId>('claude-code');
  const [list, setList] = useState<SkillEntry[] | null>(null);
  const [editing, setEditing] = useState<{ path: string | null; name: string; description: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setList(null);
    void tryInvoke('skills:managerList', { harness }).then(({ data }) => setList(data ?? []));
  }, [harness]);
  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => setEditing({ path: null, name: 'my-skill', description: '', body: template('my-skill').split('\n---\n')[1]?.replace(/^\n/, '') ?? '' });
  const openEdit = async (skill: SkillEntry) => {
    const { data, error } = await tryInvoke('skills:managerRead', { harness, path: skill.path });
    if (error || !data) return toast('error', error ?? '读取失败');
    const fm = parseFrontmatter(data.markdown);
    setEditing({ path: skill.path, name: fm.name || skill.name, description: fm.description, body: fm.body });
  };

  const save = async () => {
    if (!editing || saving) return;
    if (!/^[a-z0-9_-]+$/i.test(editing.name.trim())) return toast('error', '名称只能包含字母、数字、- 和 _');
    setSaving(true);
    const { data, error } = await tryInvoke('skills:managerSave', {
      harness,
      location: 'user',
      markdown: buildMd(editing.name.trim(), editing.description.trim(), editing.body),
      prevPath: editing.path ?? undefined,
    });
    setSaving(false);
    if (error) return toast('error', error);
    toast('success', `技能已保存：${data?.name ?? editing.name}`);
    setEditing(null);
    load();
  };

  const remove = async (skill: SkillEntry) => {
    if (!confirm(`删除技能「${skill.name}」？将同时删除其文件夹。`)) return;
    const { error } = await tryInvoke('skills:managerDelete', { harness, path: skill.path });
    if (error) return toast('error', error);
    toast('success', '已删除');
    load();
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Skills"
        description="按 harness 管理用户级技能（磁盘上的 SKILL.md / prompts 文件，CLI 下次运行即生效）。新建时保存在该 harness 的用户目录。"
        action={
          <div className="flex items-center gap-1.5">
            {HARNESS_SKILLS.map((h) => (
              <button
                key={h.id}
                className={clsx(
                  'rounded-full px-2 py-1 text-2xs transition-colors',
                  h.id === harness ? 'bg-accent-soft text-fg' : 'text-muted hover:text-fg'
                )}
                onClick={() => setHarness(h.id)}
              >
                {h.label}
              </button>
            ))}
            <div className="mx-1 h-4 w-px bg-border/60" />
            <button className="btn h-7 gap-1 text-2xs" onClick={openNew}>
              <Plus className="h-3 w-3" /> 新建
            </button>
          </div>
        }
      >
        {list === null ? (
          <SettingsRow>
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          </SettingsRow>
        ) : editing ? (
          <SettingsRow stack label={editing.path ? `编辑：${editing.name}` : '新建技能'}>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="space-y-1">
                <span className="text-2xs text-muted">名称（调用名，/名称）</span>
                <input className="input w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <label className="space-y-1">
                <span className="text-2xs text-muted">描述</span>
                <input className="input w-full" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
            </div>
            <textarea
              className="input h-56 resize-y font-mono"
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            />
            <div className="flex items-center justify-between">
              <button className="btn h-8 text-2xs" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="btn btn-accent h-8 text-2xs" disabled={saving} onClick={() => void save()}>
                {saving ? <Spinner size={12} /> : '保存'}
              </button>
            </div>
          </SettingsRow>
        ) : list.length === 0 ? (
          <SettingsRow description="该 harness 还没有用户级技能——点右上角「新建」创建一个。">
            <span />
          </SettingsRow>
        ) : (
          list.map((s) => (
            <SettingsRow
              key={s.path}
              label={
                <span className="flex items-center gap-2">
                  <code className="font-mono text-fg">/{s.name}</code>
                  {s.source !== 'user' && (
                    <span className="rounded bg-raised px-1 py-0.5 text-2xs text-muted">{s.source}</span>
                  )}
                </span>
              }
              description={s.description || s.path}
            >
              {s.source === 'user' && (
                <>
                  <button className="btn h-8" title="编辑" onClick={() => void openEdit(s)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className="btn h-8" title="删除" onClick={() => void remove(s)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </div>
  );
}
