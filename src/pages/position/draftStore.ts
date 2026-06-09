import type { PendingPositionDraft, PositionResultSummary } from './types.ts';

type LastPositionResults = {
  sessionId: string;
  results: PositionResultSummary[];
  updatedAt: number;
};

type FocusedPosition = {
  sessionId: string;
  jobBasicInfoId: number;
  summary?: PositionResultSummary;
  updatedAt: number;
};

export class PositionDraftStore {
  private readonly draftsBySession = new Map<string, PendingPositionDraft>();
  private readonly draftsById = new Map<string, PendingPositionDraft>();
  private readonly lastResultsBySession = new Map<string, LastPositionResults>();
  private readonly focusedPositionBySession = new Map<string, FocusedPosition>();

  constructor(private readonly ttlMs: number) {}

  set(draft: PendingPositionDraft): PendingPositionDraft {
    this.purgeExpired();
    const existing = this.draftsBySession.get(draft.sessionId);
    if (existing) {
      this.draftsById.delete(existing.draftId);
    }
    this.draftsBySession.set(draft.sessionId, draft);
    this.draftsById.set(draft.draftId, draft);
    return draft;
  }

  getBySession(sessionId: string): PendingPositionDraft | undefined {
    this.purgeExpired();
    return this.draftsBySession.get(sessionId);
  }

  getById(draftId: string): PendingPositionDraft | undefined {
    this.purgeExpired();
    return this.draftsById.get(draftId);
  }

  setLastResults(sessionId: string, results: PositionResultSummary[]): void {
    this.purgeExpired();

    if (!results.length) {
      this.lastResultsBySession.delete(sessionId);
      this.focusedPositionBySession.delete(sessionId);
      return;
    }

    this.lastResultsBySession.set(sessionId, {
      sessionId,
      results,
      updatedAt: Date.now(),
    });

    if (results.length === 1) {
      this.setFocusedPosition(sessionId, results[0].jobBasicInfoId, results[0]);
    } else {
      this.focusedPositionBySession.delete(sessionId);
    }
  }

  getLastResults(sessionId: string): PositionResultSummary[] {
    this.purgeExpired();
    return this.lastResultsBySession.get(sessionId)?.results ?? [];
  }

  hasLastResults(sessionId: string): boolean {
    return this.getLastResults(sessionId).length > 0;
  }

  setFocusedPosition(
    sessionId: string,
    jobBasicInfoId: number,
    summary?: PositionResultSummary,
  ): void {
    this.purgeExpired();
    this.focusedPositionBySession.set(sessionId, {
      sessionId,
      jobBasicInfoId,
      summary,
      updatedAt: Date.now(),
    });
  }

  getFocusedPosition(sessionId: string): FocusedPosition | undefined {
    this.purgeExpired();
    return this.focusedPositionBySession.get(sessionId);
  }

  hasPositionContext(sessionId: string): boolean {
    return this.hasLastResults(sessionId) || Boolean(this.getFocusedPosition(sessionId));
  }

  delete(draft: PendingPositionDraft): void {
    this.draftsBySession.delete(draft.sessionId);
    this.draftsById.delete(draft.draftId);
  }

  purgeExpired(now = Date.now()): void {
    for (const draft of this.draftsBySession.values()) {
      if (now - draft.updatedAt <= this.ttlMs) {
        continue;
      }
      this.delete(draft);
    }

    for (const result of this.lastResultsBySession.values()) {
      if (now - result.updatedAt <= this.ttlMs) {
        continue;
      }
      this.lastResultsBySession.delete(result.sessionId);
    }

    for (const focus of this.focusedPositionBySession.values()) {
      if (now - focus.updatedAt <= this.ttlMs) {
        continue;
      }
      this.focusedPositionBySession.delete(focus.sessionId);
    }
  }
}
