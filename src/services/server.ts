import Fastify from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../core/config.js';
import { getReadinessChecks } from '../core/config.js';
import { createAgentRuntime } from '../core/runtime.js';
import type { ChatRequest } from '../core/types.js';

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  message: z.string().trim().min(1),
  userId: z.string().trim().optional(),
  traceId: z.string().trim().optional(),
  channel: z.string().trim().optional(),
});

export function createServer(config: AppConfig) {
  // server.ts 只负责 HTTP 装配，具体运行时依赖交给 runtime 模块统一创建。
  const runtime = createAgentRuntime(config);

  const app = Fastify({
    // Fastify v5 的 `logger` 只接受配置对象；
    // 如果要传入现成的 pino 实例，需要使用 `loggerInstance`。
    loggerInstance: runtime.logger,
  });

  // node 健康检查
  app.get('/health', async () => ({
    ok: true,
    uptimeSec: process.uptime(),
  }));

  // 环境变量检查
  app.get('/ready', async (_request, reply) => {
    const checks = getReadinessChecks(config);
    const ok = Object.values(checks).every(Boolean);

    if (!ok) {
      reply.code(503);
    }

    return {
      ok,
      checks,
    };
  });

  // 聊天接口
  app.post('/chat', async (request, reply) => {
    // 入口先做参数校验，避免脏数据直接进 Agent。
    // 这里并不会去理解转化消息，只是校验非空、格式正确。
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        error: parsed.error.flatten(),
      };
    }

    const chatRequest = parsed.data as ChatRequest;

    try {
      // 真正调用 agent 去操作
      const response = await runtime.agentService.chat(chatRequest);
      return {
        ok: true,
        data: response,
      };
    } catch (error) {
      // 这里统一兜底，把内部异常转换成稳定的 HTTP 响应。
      const message = error instanceof Error ? error.message : 'Unknown chat error';
      request.log.error({ error: message }, 'Chat request failed');
      reply.code(500);
      return {
        ok: false,
        error: message,
      };
    }
  });

  return app;
}
