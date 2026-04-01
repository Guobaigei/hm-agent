import 'dotenv/config';

import { defineAgent } from '@roll-agent/sdk';

import { queryHmTool } from './tools/query-hm.js';

const agent = defineAgent({
  name: 'hm-agent',
  tools: [queryHmTool],
});

agent.listen().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
