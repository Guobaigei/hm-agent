import 'dotenv/config';

import { defineAgent } from '@roll-agent/sdk';

import { queryHmTool } from './tools/queryHm.ts';

const agent = defineAgent({
  name: 'hm-agent',
  tools: [queryHmTool],
});

// 启动 MCP Server，等待 MCP 请求
agent.listen().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
