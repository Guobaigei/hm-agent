import pino from 'pino';

import { HmAgentService } from './agent.js';
import type { AppConfig } from './config.js';
import { HmApiClient } from './hm-client.js';
import { createLanguageModel } from './model-provider.js';
import { InMemorySessionStore } from './session-store.js';

type CreateAgentRuntimeOptions = {
  silentLogger?: boolean;
};

export function createAgentRuntime(
  config: AppConfig,
  options: CreateAgentRuntimeOptions = {},
) {
  // 运行时依赖统一在这里组装，避免 HTTP 和 CLI 各自复制一套初始化逻辑。
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

  const agentService = new HmAgentService({
    config,
    model: createLanguageModel(config),
    hmApiClient,
    sessionStore,
    logger,
  });

  return {
    logger,
    hmApiClient,
    sessionStore,
    agentService,
  };
}
