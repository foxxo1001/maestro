import { hostForWorkspace } from '../../hosts';
import { Messages, uid, Workspaces } from '../../db';
import { modelForTier, type AgentEvent } from '../../../shared/types';
import type { Workspace } from '../../../shared/types';
import { adapters, isAgentRunning, resolveTurn } from './index';
import { shellAdapter } from './shell';
import { wireAdapterStream } from './adapter';

/**
 * Context compaction for any harness: a one-off, fresh-session turn on the
 * same harness's lightest model summarizes the chat transcript, then the chat
 * re-points at that new session and a handoff summary message is inserted.
 * The old CLI session is abandoned — the fresh session carries only the
 * summary, so occupancy drops to roughly the summary's size.
 */

const TIMEOUT_MS = 240_000;
const MAX_TRANSCRIPT_CHARS = 120_000;
const PER_MSG_CHARS = 1_600;

export async function compactChat(
  workspaceId: string,
  agentId: number
): Promise<{ ok: boolean; error?: string }> {
  const ws: Workspace | null = Workspaces.get(workspaceId);
  if (!ws) return { ok: false, error: '未知工作区' };
  if (isAgentRunning(workspaceId, agentId)) return { ok: false, error: '会话正在运行，请先停止' };

  const msgs = Messages.list(workspaceId).filter((m) => m.agentId === agentId);
  if (!msgs.length) return { ok: false, error: '没有可压缩的历史' };
  const transcript = msgs
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.slice(0, PER_MSG_CHARS)}`)
    .join('\n\n')
    .slice(-MAX_TRANSCRIPT_CHARS);

  const prompt = [
    '把下面的 agent 会话记录压缩成一份可延续工作的交接摘要（中文），供在全新上下文里继续任务。',
    '必须包含：1) 任务目标 2) 已完成的改动（文件/函数级） 3) 关键决定与原因 4) 未完成事项与下一步 5) 重要的命令、测试与环境注意事项。',
    '只输出摘要本身，不要任何开场白。\n\n=== 会话记录 ===\n',
    transcript,
  ].join('\n');

  const adapter = adapters[ws.harness] ?? shellAdapter;
  const { base, spawnEnv } = resolveTurn(ws, agentId, null);
  const cmd = adapter.build({
    ...base,
    prompt,
    sessionId: null, // fresh session: the summary turn itself
    model: modelForTier(ws.harness, 'light') || base.model,
    effort: 'low',
  });

  let summary = '';
  let textSeg = false;
  let newSessionId: string | null = null;
  let doneEv: { ok: boolean; error?: string } | null = null;

  const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let settled = false;
    const finish = (r: { ok: boolean; error?: string }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    const timer = setTimeout(() => finish({ ok: false, error: '压缩超时' }), TIMEOUT_MS);
    try {
      const child = hostForWorkspace(ws).spawnStream(cmd.cmd, cmd.args, {
        cwd: ws.worktreePath,
        env: spawnEnv,
      });
      wireAdapterStream(child, adapter, cmd.stdin, (ev: AgentEvent) => {
        if (ev.kind === 'session') newSessionId = ev.sessionId;
        else if (ev.kind === 'seg-start') textSeg = ev.segType === 'text';
        else if (ev.kind === 'seg-delta' && textSeg) summary += ev.text;
        else if (ev.kind === 'done') doneEv = { ok: ev.ok, error: ev.error };
      }, () => {});
      child.onClose(() => {
        if (doneEv && !doneEv.ok) finish({ ok: false, error: doneEv.error ?? '压缩失败' });
        else if (!summary.trim()) finish({ ok: false, error: '压缩失败：模型没有返回摘要' });
        else finish({ ok: true });
      });
    } catch (err) {
      finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  if (!result.ok) return result;

  // Re-point the chat at the fresh session (adapter-minted hints win over the
  // parsed session event when a CLI never announces one), and leave the
  // handoff summary in the transcript so the next turn reads naturally.
  const nextSession = newSessionId ?? cmd.sessionHint;
  if (nextSession) Workspaces.setSession(workspaceId, agentId, nextSession);
  Messages.insert({
    id: uid(),
    workspaceId,
    agentId,
    role: 'agent',
    content: '🧹 上下文已压缩，已从全新会话继续。以下是交接摘要：\n\n' + summary.trim(),
    attachments: [],
    ts: Date.now(),
  });
  return { ok: true };
}
