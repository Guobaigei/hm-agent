import { randomUUID } from 'node:crypto';

import { defineTool } from '@roll-agent/sdk';
import { z } from 'zod';

import { getConfig } from '../../pages/core/config.ts';
import { createAgentRuntime } from '../../pages/core/runtime.ts';

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

const queryResultSchema = citationSchema.extend({
  summary: z.string(),
});

const queryHmOutputSchema = z.object({
  reply: z.string(),
  needsClarification: z.boolean(),
  candidates: z.array(candidateSchema).optional(),
  citations: z.array(citationSchema).optional(),
  results: z.array(queryResultSchema).optional(),
  usedTools: z.array(z.string()).optional(),
});

type QueryHmOutput = z.infer<typeof queryHmOutputSchema>;
type HmEntityType = z.infer<typeof entityTypeSchema>;

let cachedRuntime: ReturnType<typeof createAgentRuntime> | undefined;

function getMcpRuntime() {
  // MCP stdio 模式下 stdout 用于协议传输，这里关闭内部 pino 日志，避免污染协议流。
  cachedRuntime ??= createAgentRuntime(getConfig(), { silentLogger: true });
  return cachedRuntime;
}

export const queryHmTool = defineTool({
  name: 'hm-query',
  description:
    '查询海绵系统中的品牌、公司、门店、项目等信息。输入自然语言问题，返回查询结果、澄清候选项和引用信息。',
  input: queryHmInputSchema,
  output: queryHmOutputSchema,
  execute: async ({ message }, ctx) => {
    ctx.logger.info('queryHm called');

    try {
      const runtime = getMcpRuntime();

      const response = await runtime.hmQueryService.chat({
        sessionId: `roll-mcp-${randomUUID()}`,
        message,
        userId: 'roll-core',
        channel: 'roll-mcp',
      });

      return formatQueryHmOutput(response);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      ctx.logger.error(`queryHm failed: ${errorMessage}`);

      return {
        reply: `查询海绵系统失败：${errorMessage}`,
        needsClarification: false,
        usedTools: [],
      };
    }
  },
});

function formatQueryHmOutput(response: QueryHmOutput): QueryHmOutput {
  const reply = buildTableReply(response);

  return {
    ...response,
    reply,
  };
}

function buildTableReply(response: QueryHmOutput): string {
  if (response.results?.length) {
    const title = response.needsClarification
      ? '查询到多个候选项，请确认你要查询哪一个：'
      : '查询结果如下：';

    return `${title}\n\n${formatResultsTable(response.results)}`;
  }

  if (response.needsClarification && response.candidates?.length) {
    return [
      '查询到多个候选项，请确认你要查询哪一个：',
      '',
      formatCandidatesTable(response.candidates),
    ].join('\n');
  }

  return response.reply;
}

function formatResultsTable(results: NonNullable<QueryHmOutput['results']>): string {
  const rows = results.map(result => [
    formatEntityType(result.entityType),
    result.id,
    result.name,
    result.summary || '-',
    result.source,
  ]);

  return formatMarkdownTable(['实体类型', 'ID', '名称', '摘要', '来源'], rows);
}

function formatCandidatesTable(
  candidates: NonNullable<QueryHmOutput['candidates']>,
): string {
  const rows = candidates.map(candidate => [
    formatEntityType(candidate.entityType),
    candidate.id,
    candidate.name,
  ]);

  return formatMarkdownTable(['实体类型', 'ID', '名称'], rows);
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(escapeTableCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escapeTableCell).join(' | ')} |`),
  ].join('\n');
}

function escapeTableCell(value: string): string {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '-';
}

function formatEntityType(entityType: HmEntityType): string {
  const labels: Record<HmEntityType, string> = {
    brand: '品牌',
    company: '公司',
    store: '门店',
    project: '项目',
  };

  return labels[entityType];
}
