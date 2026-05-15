import { z } from 'zod';

export type HmRequestStrategy = 'auto' | 'post-json' | 'post-form';

// 所有环境变量统一在这里做解析和兜底，避免业务代码里到处判断 process.env。
const envSchema = z.object({
  LOG_LEVEL: z.string().default('info'),
  AI_MODEL: z.string().default('qwen3.6-plus'),
  AI_FALLBACK_MODEL: z.string().trim().min(1).default('deepseek-v4-pro'),
  AI_FALLBACK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  AI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  AI_BASE_URL: z
    .string()
    .url()
    .default('https://dashscope.aliyuncs.com/compatible-mode/v1'),
  // 不设默认真实网关，避免仓库与示例环境暴露内网地址；部署时必须在 .env 中配置。
  HM_BASE_URL: z.string().url(),
  HM_DULIDAY_TOKEN: z.string().optional(),
  HM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  HM_REQUEST_STRATEGY: z.enum(['auto', 'post-json', 'post-form']).default('auto'),
  SESSION_TTL_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  SESSION_MAX_TURNS: z.coerce.number().int().positive().default(12),
  MAX_TOOL_RESULTS: z.coerce.number().int().positive().default(5),
});

export type AppConfig = {
  logLevel: string;
  aiModel: string;
  aiFallbackModel?: string;
  aiFallbackBaseUrl: string;
  aiApiKey?: string;
  deepseekApiKey?: string;
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
    logLevel: parsed.LOG_LEVEL,
    aiModel: parsed.AI_MODEL,
    aiFallbackModel:
      parsed.AI_FALLBACK_MODEL === parsed.AI_MODEL
        ? undefined
        : parsed.AI_FALLBACK_MODEL,
    aiFallbackBaseUrl: parsed.AI_FALLBACK_BASE_URL,
    aiApiKey: parsed.AI_API_KEY,
    deepseekApiKey: parsed.DEEPSEEK_API_KEY,
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
