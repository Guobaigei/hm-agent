import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import type { AppConfig } from './config.js';

// 百炼提供 OpenAI 兼容接口，所以这里把模型适配单独收口。
// 后续如果切换到别的平台，只需要改这个模块。
export function createLanguageModel(config: AppConfig) {
  const provider = createOpenAICompatible({
    name: 'bailian',
    apiKey: config.aiApiKey,
    baseURL: config.aiBaseUrl,
  });

  return provider(config.aiModel);
}
