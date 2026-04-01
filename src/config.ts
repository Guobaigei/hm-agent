import { z } from 'zod';

import type { HmRequestStrategy } from './types.js';

// 所有环境变量统一在这里做解析和兜底，避免业务代码里到处判断 process.env。
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default('info'),
  AI_MODEL: z.string().default('qwen3.5-plus'),
  AI_API_KEY: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
  AI_BASE_URL: z
    .string()
    .url()
    .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  HM_BASE_URL: z.string().url().default('https://test-gateway.duliday.com/sponge/admin'),
  HM_DULIDAY_TOKEN: z.string().optional(),
  HM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  HM_REQUEST_STRATEGY: z
    .enum(['auto', 'get', 'post-json', 'post-form'])
    .default('auto'),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  SESSION_MAX_TURNS: z.coerce.number().int().positive().default(12),
  MAX_TOOL_RESULTS: z.coerce.number().int().positive().default(5),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  aiModel: string;
  aiApiKey?: string;
  aiBaseUrl: string;
  hmBaseUrl: string;
  hmDulidayToken?: string;
  hmTimeoutMs: number;
  hmRequestStrategy: HmRequestStrategy;
  sessionTtlMs: number;
  sessionMaxTurns: number;
  maxToolResults: number;
};

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  // 配置只解析一次，后续模块直接复用，避免每次请求都重复做 zod 校验。
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse(process.env);

  cachedConfig = {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    aiModel: parsed.AI_MODEL,
    // 兼容旧命名，优先使用更通用的 AI_API_KEY。
    aiApiKey: parsed.AI_API_KEY ?? parsed.AI_GATEWAY_API_KEY,
    aiBaseUrl: parsed.AI_BASE_URL,
    hmBaseUrl: parsed.HM_BASE_URL,
    hmDulidayToken: parsed.HM_DULIDAY_TOKEN,
    hmTimeoutMs: parsed.HM_TIMEOUT_MS,
    hmRequestStrategy: parsed.HM_REQUEST_STRATEGY,
    sessionTtlMs: parsed.SESSION_TTL_MS,
    sessionMaxTurns: parsed.SESSION_MAX_TURNS,
    maxToolResults: parsed.MAX_TOOL_RESULTS,
  };

  return cachedConfig;
}

export function getReadinessChecks(config: AppConfig) {
  // ready 检查只关心“运行这个服务所需的关键条件是否具备”。
  return {
    aiApiKey: Boolean(config.aiApiKey),
    aiBaseUrl: Boolean(config.aiBaseUrl),
    hmBaseUrl: Boolean(config.hmBaseUrl),
    hmDulidayToken: Boolean(config.hmDulidayToken),
  };
}
