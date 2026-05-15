import type { ChatTurn, SessionSnapshot } from './types.ts';

type SessionEntry = SessionSnapshot;

export class InMemorySessionStore {
  // V1 先用内存存储会话，够本地调试，也方便后续替换成 Redis / DB。
  private readonly sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxTurns: number,
  ) {}

  append(sessionId: string, turn: ChatTurn): SessionSnapshot {
    this.purgeExpired();

    const existing = this.sessions.get(sessionId);
    // 只保留最近 N 轮，控制 prompt 长度，避免历史消息无限膨胀。
    const turns = [...(existing?.turns ?? []), turn].slice(-this.maxTurns);
    const next: SessionSnapshot = {
      sessionId,
      turns,
      updatedAt: turn.createdAt,
    };

    this.sessions.set(sessionId, next);
    return next;
  }

  get(sessionId: string): SessionSnapshot {
    this.purgeExpired();

    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return {
        sessionId,
        turns: [],
        updatedAt: 0,
      };
    }

    return existing;
  }

  purgeExpired(now = Date.now()): void {
    // 过期清理放在读写路径上做，省掉额外的后台定时任务。
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.updatedAt > this.ttlMs) {
        this.sessions.delete(sessionId);
      }
    }
  }
}
