import 'dotenv/config';

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { getConfig } from './config.js';
import { createAgentRuntime } from './runtime.js';

async function main() {
  const config = getConfig();
  const runtime = createAgentRuntime(config);
  const sessionId = process.argv[2]?.trim() || `cli-${Date.now()}`;
  const userId = 'cli-user';

  const rl = createInterface({
    input,
    output,
  });

  output.write('agent-hm CLI 已启动\n');
  output.write(`会话ID: ${sessionId}\n`);
  output.write('输入 /exit 退出，对话会保留在当前会话上下文中。\n\n');

  try {
    while (true) {
      const message = (await rl.question('你: ')).trim();

      if (!message) {
        continue;
      }

      if (['/exit', 'exit', '/quit', 'quit'].includes(message.toLowerCase())) {
        output.write('CLI 已退出\n');
        break;
      }

      try {
        const response = await runtime.agentService.chat({
          sessionId,
          message,
          userId,
          channel: 'cli',
        });

        output.write(`\nAgent: ${response.reply}\n`);

        if (response.needsClarification && response.candidates?.length) {
          output.write('候选项:\n');
          for (const candidate of response.candidates) {
            output.write(`- [${candidate.entityType}:${candidate.id}] ${candidate.name}\n`);
          }
        }

        if (response.usedTools?.length) {
          output.write(`工具: ${response.usedTools.join(', ')}\n`);
        }

        output.write('\n');
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : '未知错误';
        runtime.logger.error({ error: messageText }, 'CLI chat failed');
        output.write(`\nAgent 调用失败: ${messageText}\n\n`);
      }
    }
  } finally {
    rl.close();
  }
}

void main();
