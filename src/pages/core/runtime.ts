import pino from 'pino';

import { HmApiClient } from '../hm-query/client.ts';
import { HmQueryService } from '../hm-query/service.ts';
import { InMemorySessionStore } from '../hm-query/sessionStore.ts';
import { PositionApiClient } from '../position/client.ts';
import { PositionDraftStore } from '../position/draftStore.ts';
import {
  createLlmPositionCreatePlanner,
  createLlmPositionSearchPlanner,
} from '../position/planner.ts';
import { PositionService } from '../position/service.ts';
import type { AppConfig } from './config.ts';
import { createLanguageModels } from './modelProvider.ts';

type CreateAgentRuntimeOptions = {
  silentLogger?: boolean;
};

export function createAgentRuntime(
  config: AppConfig,
  options: CreateAgentRuntimeOptions = {},
) {
  // 运行时依赖统一在这里组装，避免 CLI、MCP 等入口各自复制一套初始化逻辑。
  const logger = pino({
    level: options.silentLogger ? 'silent' : config.logLevel,
  });

  const hmApiClient = new HmApiClient({
    baseUrl: config.hmBaseUrl,
    token: config.hmDulidayToken,
    timeoutMs: config.hmTimeoutMs,
    requestStrategy: config.hmRequestStrategy,
    maxResults: config.maxToolResults,
    logger,
  });

  // 会话存储的 过期时间 最大轮数
  const sessionStore = new InMemorySessionStore(
    config.sessionTtlMs,
    config.sessionMaxTurns,
  );
  const positionDraftStore = new PositionDraftStore(config.sessionTtlMs);
  const positionApiClient = new PositionApiClient({
    baseUrl: config.hmBaseUrl,
    token: config.hmDulidayToken,
    timeoutMs: config.hmTimeoutMs,
    logger,
  });

  const models = createLanguageModels(config);
  const hmQueryService = new HmQueryService({
    config,
    models,
    hmApiClient,
    sessionStore,
    logger,
  });
  const positionPlannerModels = models.filter(model => model.provider !== 'bailian' || Boolean(config.aiApiKey));
  const positionService = new PositionService({
    config,
    positionApiClient,
    draftStore: positionDraftStore,
    searchPlanner:
      config.aiApiKey || config.deepseekApiKey
        ? createLlmPositionSearchPlanner(positionPlannerModels, logger)
        : undefined,
    createPlanner:
      config.aiApiKey || config.deepseekApiKey
        ? createLlmPositionCreatePlanner(positionPlannerModels, logger)
        : undefined,
    logger,
  });

  return {
    logger,
    hmApiClient,
    sessionStore,
    hmQueryService,
    positionApiClient,
    positionDraftStore,
    positionService,
  };
}
