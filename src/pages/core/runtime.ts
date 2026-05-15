import pino from 'pino';

import { HmApiClient } from '../hm-query/client.ts';
import { HmQueryService } from '../hm-query/service.ts';
import { InMemorySessionStore } from '../hm-query/sessionStore.ts';
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

  const hmQueryService = new HmQueryService({
    config,
    models: createLanguageModels(config),
    hmApiClient,
    sessionStore,
    logger,
  });

  return {
    logger,
    hmApiClient,
    sessionStore,
    hmQueryService,
  };
}
