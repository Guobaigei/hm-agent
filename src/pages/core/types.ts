export type HmEntityType = 'brand' | 'company' | 'store' | 'project';

export type ChatRole = 'user' | 'assistant';

export type ChatTurn = {
  role: ChatRole;
  content: string;
  createdAt: number;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
  userId?: string;
  traceId?: string;
  channel?: 'local' | string;
};

export type ChatResponse = {
  reply: string;
  needsClarification: boolean;
  candidates?: CandidateEntity[];
  citations?: Citation[];
  usedTools?: string[];
};

export type CandidateEntity = {
  entityType: HmEntityType;
  id: string;
  name: string;
};

export type Citation = CandidateEntity & {
  source: string;
};

export type NormalizedEntity = {
  entityType: HmEntityType;
  id: string;
  name: string;
  summary: string;
  source: string;
  raw: Record<string, unknown>;
};

export type HmSearchResult = {
  entityType: HmEntityType;
  searchName: string;
  total: number;
  matches: NormalizedEntity[];
  needsClarification: boolean;
  clarificationCandidates: CandidateEntity[];
  guidance: string;
};

export type HmAggregateSearchResult = {
  searchName: string;
  total: number;
  totalByType: Record<HmEntityType, number>;
  matches: NormalizedEntity[];
  guidance: string;
};

export type HmListClientConfig = {
  entityType: HmEntityType;
  path: string;
  idCandidates: string[];
  nameCandidates: string[];
  summaryCandidates: string[];
};

export type HmRequestStrategy = 'auto' | 'post-json' | 'post-form';

export type SessionSnapshot = {
  sessionId: string;
  turns: ChatTurn[];
  updatedAt: number;
};
