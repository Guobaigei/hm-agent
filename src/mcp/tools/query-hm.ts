import { randomUUID } from 'node:crypto';

import { defineTool } from '@roll-agent/sdk';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { createAgentRuntime } from '../../runtime.js';

const entityTypeSchema = z.enum(['brand', 'company', 'store', 'project']);

const queryHmInputSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe('用户的自然语言查询，例如：帮我查一下肯德基这个品牌'),
});

const candidateSchema = z.object({
  entityType: entityTypeSchema,
  id: z.string(),
  name: z.string(),
});

const citationSchema = candidateSchema.extend({
  source: z.string(),
});

const queryHmOutputSchema = z.object({
  reply: z.string(),
  needsClarification: z.boolean(),
  candidates: z.array(candidateSchema).optional(),
  citations: z.array(citationSchema).optional(),
  usedTools: z.array(z.string()).optional(),
});

let cachedRuntime: ReturnType<typeof createAgentRuntime> | undefined;

function getMcpRuntime() {
  // MCP stdio 模式下 stdout 用于协议传输，这里关闭内部 pino 日志，避免污染协议流。
  cachedRuntime ??= createAgentRuntime(getConfig(), { silentLogger: true });
  return cachedRuntime;
}

export const queryHmTool = defineTool({
  name: 'query_hm',
  description:
    '查询海绵系统中的品牌、公司、门店、项目等信息。输入自然语言问题，返回查询结果、澄清候选项和引用信息。',
  input: queryHmInputSchema,
  output: queryHmOutputSchema,
  execute: async ({ message }, ctx) => {
    ctx.logger.info('query_hm called');

    try {
      const runtime = getMcpRuntime();

      return await runtime.agentService.chat({
        sessionId: `roll-mcp-${randomUUID()}`,
        message,
        userId: 'roll-core',
        channel: 'roll-mcp',
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      ctx.logger.error(`query_hm failed: ${errorMessage}`);

      return {
        reply: `查询海绵系统失败：${errorMessage}`,
        needsClarification: false,
        usedTools: [],
      };
    }
  },
});
