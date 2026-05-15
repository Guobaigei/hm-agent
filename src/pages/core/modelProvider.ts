import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { AppConfig } from './config.ts';

export type NamedLanguageModel = {
  provider: string;
  name: string;
  model: LanguageModel;
};

// 百炼提供 OpenAI 兼容接口，所以这里把模型适配单独收口。
// 后续如果切换到别的平台，只需要改这个模块。
export function createLanguageModels(config: AppConfig): NamedLanguageModel[] {
  const provider = createOpenAICompatible({
    name: 'bailian',
    apiKey: config.aiApiKey,
    baseURL: config.aiBaseUrl,
  });

  const models: NamedLanguageModel[] = [
    {
      provider: 'bailian',
      name: config.aiModel,
      model: provider(config.aiModel),
    },
  ];

  if (config.aiFallbackModel && config.deepseekApiKey) {
    const fallbackProvider = createOpenAICompatible({
      name: 'deepseek',
      apiKey: config.deepseekApiKey,
      baseURL: config.aiFallbackBaseUrl,
    });

    models.push({
      provider: 'deepseek',
      name: config.aiFallbackModel,
      model: fallbackProvider(config.aiFallbackModel),
    });
  }

  return models;
}
