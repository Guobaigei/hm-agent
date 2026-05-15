import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { AppConfig } from '../core/config.ts';
import type { NamedLanguageModel } from '../core/modelProvider.ts';
import type {
  CandidateEntity,
  ChatRequest,
  ChatResponse,
  Citation,
  HmAggregateSearchResult,
  HmQueryResult,
  HmSearchResult,
  HmEntityType,
} from './types.ts';
import { HmApiClient } from './client.ts';
import { InMemorySessionStore } from './sessionStore.ts';

type AgentDependencies = {
  config: AppConfig;
  models: NamedLanguageModel[];
  hmApiClient: HmApiClient;
  sessionStore: InMemorySessionStore;
  logger: Logger;
};

type ToolOutput = HmSearchResult | HmAggregateSearchResult;

type ModelAttemptResult = {
  text: string;
  usedTools: string[];
  citations: Citation[];
  results: HmQueryResult[];
  clarificationCandidates: CandidateEntity[];
  needsClarification: boolean;
  toolFailureMessage?: string;
};

const searchNameSchema = z.object({
  searchName: z.string().trim().min(1).describe('要在海绵系统中搜索的名称关键词'),
});

export class HmQueryService {
  constructor(private readonly dependencies: AgentDependencies) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // 先检查运行条件，不让“缺 key / 缺 token”这种问题拖到模型调用阶段才爆炸。
    assertChatReadiness(this.dependencies.config);

    const now = Date.now();
    const session = this.dependencies.sessionStore.get(request.sessionId);

    // 生成5个工具
    const tools = createTools(this.dependencies.hmApiClient);
    // 根据用户话语缩小工具范围。
    const activeTools = inferActiveTools(request.message);

    // 提示词拼接，把历史对话、当前问题、用户上下文拼成一次完整调用。
    const prompt = buildPrompt({
      history: session.turns,
      message: request.message,
      userId: request.userId,
      channel: request.channel,
    });

    // 调用模型，生成回复。
    const result = await this.generateWithFallback({
      prompt,
      tools,
      activeTools,
    });
    // 如果模型调用失败，返回工具调用失败信息。
    const reply = result.toolFailureMessage ?? result.text.trim();

    // 会话存储使用“用户消息 + 助手回复”顺序追加，下一轮 prompt 会把它们带回去。
    this.dependencies.sessionStore.append(request.sessionId, {
      role: 'user',
      content: request.message,
      createdAt: now,
    });
    this.dependencies.sessionStore.append(request.sessionId, {
      role: 'assistant',
      content: reply,
      createdAt: now + 1,
    });

    return {
      reply,
      needsClarification: result.needsClarification,
      candidates: result.needsClarification ? result.clarificationCandidates : undefined,
      citations: dedupeCitations(result.citations),
      results: dedupeResults(result.results),
      usedTools: dedupeStrings(result.usedTools),
    };
  }

  private async generateWithFallback(input: {
    prompt: string;
    tools: ToolRegistry;
    activeTools: Array<keyof ToolRegistry>;
  }): Promise<ModelAttemptResult> {
    let lastError: unknown;

    for (const [index, modelCandidate] of this.dependencies.models.entries()) {
      try {
        return await runModelAttempt({
          modelCandidate,
          prompt: input.prompt,
          tools: input.tools,
          activeTools: input.activeTools,
        });
      } catch (error) {
        lastError = error;
        this.dependencies.logger.warn(
          {
            model: modelCandidate.name,
            provider: modelCandidate.provider,
            isFallbackAvailable: index < this.dependencies.models.length - 1,
            error: formatUnknownError(error),
          },
          'HM query model attempt failed',
        );
      }
    }

    throw lastError;
  }
}

async function runModelAttempt(input: {
  modelCandidate: NamedLanguageModel;
  prompt: string;
  tools: ToolRegistry;
  activeTools: Array<keyof ToolRegistry>;
}): Promise<ModelAttemptResult> {
  const usedTools: string[] = [];
  const citations: Citation[] = [];
  const results: HmQueryResult[] = [];
  let clarificationCandidates: CandidateEntity[] = [];
  let needsClarification = false;
  let toolFailureMessage: string | undefined;

  const agent = new ToolLoopAgent({
    model: input.modelCandidate.model,
    instructions: buildInstructions(),
    tools: input.tools,
    activeTools: input.activeTools,
    // 循环4次，避免模型无限循环。
    stopWhen: stepCountIs(4),
    onStepFinish: event => {
      // 每一步结束后回调，结果拼接，用于最后返回的 ChatResponse。
      for (const toolResult of event.toolResults) {
        usedTools.push(String(toolResult.toolName));

        const output = toolResult.output as ToolOutput;
        citations.push(...extractCitations(output));
        results.push(...extractResults(output));

        if ('needsClarification' in output && output.needsClarification) {
          needsClarification = true;
          clarificationCandidates = output.clarificationCandidates;
        }
      }

      for (const part of event.content) {
        if (part.type !== 'tool-error') {
          continue;
        }

        toolFailureMessage = formatToolFailureMessage(
          String(part.toolName),
          part.error,
        );
      }
    },
  });

  const result = await agent.generate({ prompt: input.prompt });

  return {
    text: result.text,
    usedTools,
    citations,
    results,
    clarificationCandidates,
    needsClarification,
    toolFailureMessage,
  };
}

function createTools(hmApiClient: HmApiClient) {
  // Tool 名称尽量和业务实体直接对应，这样模型更容易选对工具。
  return {
    search_brand: tool({
      description: '按品牌名称搜索海绵系统中的品牌列表',
      inputSchema: searchNameSchema,
      execute: ({ searchName }) => hmApiClient.search('brand', searchName),
    }),
    search_company: tool({
      description: '按公司名称搜索海绵系统中的公司列表',
      inputSchema: searchNameSchema,
      execute: ({ searchName }) => hmApiClient.search('company', searchName),
    }),
    search_store: tool({
      description: '按门店名称搜索海绵系统中的门店列表',
      inputSchema: searchNameSchema,
      execute: ({ searchName }) => hmApiClient.search('store', searchName),
    }),
    search_project: tool({
      description: '按项目名称搜索海绵系统中的项目列表',
      inputSchema: searchNameSchema,
      execute: ({ searchName }) => hmApiClient.search('project', searchName),
    }),
    search_all_entities: tool({
      description: '当用户未明确说品牌、公司、门店或项目时，一次性搜索全部实体类型',
      inputSchema: searchNameSchema,
      execute: ({ searchName }) => hmApiClient.searchAll(searchName),
    }),
  };
}

type ToolRegistry = ReturnType<typeof createTools>;

function buildInstructions(): string {
  // instructions 控制 Agent 的行为边界：
  // 什么能做、什么不能做、遇到歧义如何处理，都放在这里。
  return [
    '你是 agent-hm，一个只读的海绵系统查询助手。',
    '你的职责是帮助用户查询品牌、公司、门店、项目信息。',
    '回答必须使用中文。',
    '所有事实都必须来自工具返回，禁止编造字段、禁止猜测未返回的信息。',
    '如果结果为空，要明确告诉用户未查询到。',
    '如果结果唯一，直接总结关键字段并说明实体类型与 ID。',
    '如果结果有多条且用户意图指向单个对象，必须先追问澄清，不要替用户决定。',
    '如果用户意图是汇总或列表，可以直接给出列表摘要。',
    '当结果包含多条对象或候选项时，优先使用 Markdown 表格展示，列为：实体类型、ID、名称、摘要、来源。',
    '优先保持回答简洁，关键引用格式使用 [实体类型:ID] 名称。',
  ].join('\n');
}

function buildPrompt(input: {
  history: { role: 'user' | 'assistant'; content: string }[];
  message: string;
  userId?: string;
  channel?: string;
}): string {
  // prompt 负责把“当前问题 + 最近对话 + 用户上下文”拼成一次完整调用。
  const historyText =
    input.history.length === 0
      ? '无历史对话。'
      : input.history
          .map(turn => `${turn.role === 'user' ? '用户' : '助手'}: ${turn.content}`)
          .join('\n');

  return [
    `用户ID: ${input.userId ?? 'unknown'}`,
    `渠道: ${input.channel ?? 'local'}`,
    '最近对话：',
    historyText,
    '',
    `当前问题：${input.message}`,
    '',
    '请先判断用户是在查品牌、公司、门店、项目中的哪一类；如果不明确，再使用全量搜索工具。',
  ].join('\n');
}

function inferActiveTools(message: string): Array<keyof ToolRegistry> {
  // 这层不是做精确意图识别，只做一个粗粒度路由，优先降低工具选择噪音。
  const matchedEntity = inferEntityType(message);

  if (!matchedEntity) {
    return ['search_all_entities'];
  }

  return [`search_${matchedEntity}`];
}

function inferEntityType(message: string): HmEntityType | undefined {
  if (matchesAny(message, ['品牌', 'brand'])) {
    return 'brand';
  }

  if (matchesAny(message, ['公司', 'company'])) {
    return 'company';
  }

  if (matchesAny(message, ['门店', '店铺', 'store', 'shop'])) {
    return 'store';
  }

  if (matchesAny(message, ['项目', 'project'])) {
    return 'project';
  }

  return undefined;
}

function matchesAny(message: string, patterns: string[]): boolean {
  const lowered = message.toLowerCase();
  return patterns.some(pattern => lowered.includes(pattern.toLowerCase()));
}

function extractCitations(output: ToolOutput): Citation[] {
  // 引用信息从工具结果提取，不从模型文本里反向解析，稳定性更高。
  const matches = 'matches' in output ? output.matches : [];
  return matches.map(match => ({
    entityType: match.entityType,
    id: match.id,
    name: match.name,
    source: match.source,
  }));
}

function extractResults(output: ToolOutput): HmQueryResult[] {
  const matches = 'matches' in output ? output.matches : [];
  return matches.map(match => ({
    entityType: match.entityType,
    id: match.id,
    name: match.name,
    summary: match.summary,
    source: match.source,
  }));
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const unique: Citation[] = [];

  for (const citation of citations) {
    const key = `${citation.entityType}:${citation.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(citation);
  }

  return unique;
}

function dedupeResults(results: HmQueryResult[]): HmQueryResult[] {
  const seen = new Set<string>();
  const unique: HmQueryResult[] = [];

  for (const result of results) {
    const key = `${result.entityType}:${result.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(result);
  }

  return unique;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function formatToolFailureMessage(toolName: string, error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return `查询海绵系统失败，工具 ${toolName} 调用异常：${errorMessage}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertChatReadiness(config: AppConfig): void {
  if (!config.aiApiKey) {
    throw new Error('Missing AI_API_KEY');
  }

  if (!config.hmDulidayToken) {
    throw new Error('Missing HM_DULIDAY_TOKEN');
  }
}
