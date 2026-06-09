import { defineTool } from '@roll-agent/sdk';
import { z } from 'zod';

import { getConfig } from '../../pages/core/config.ts';
import { createAgentRuntime } from '../../pages/core/runtime.ts';

const positionInputSchema = z.object({
  message: z.string().min(1).describe('岗位管理自然语言请求，例如：查询已发布上海服务员岗位'),
  sessionId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('可选会话 ID，用于关联岗位预览和后续确认'),
});

const fieldIssueSchema = z.object({
  field: z.string(),
  label: z.string(),
  message: z.string(),
});

const positionResultSchema = z.object({
  jobBasicInfoId: z.number(),
  name: z.string(),
  projectName: z.string().optional(),
  brandName: z.string().optional(),
  cityRegion: z.string().optional(),
  status: z.enum(['unpublished', 'published', 'offline']),
  statusText: z.string(),
  salaryText: z.string().optional(),
  recruitCount: z.number().optional(),
});

const previewFieldSchema = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
});

const positionPreviewSchema = z.object({
  draftId: z.string(),
  mode: z.enum(['create', 'edit']),
  action: z.enum(['save', 'publish']),
  title: z.string(),
  groups: z.array(
    z.object({
      tab: z.enum(['basic', 'salary', 'requirement', 'schedule', 'process', 'recruitment']),
      label: z.string(),
      fields: z.array(previewFieldSchema),
    }),
  ),
});

const diffSchema = z.object({
  field: z.string(),
  label: z.string(),
  before: z.string(),
  after: z.string(),
});

const positionOutputSchema = z.object({
  reply: z.string(),
  intent: z.enum(['search', 'create_preview', 'edit_preview', 'commit', 'clarify', 'cancel']),
  needsClarification: z.boolean(),
  needsConfirmation: z.boolean(),
  draftId: z.string().optional(),
  results: z.array(positionResultSchema).optional(),
  preview: positionPreviewSchema.optional(),
  missingFields: z.array(fieldIssueSchema).optional(),
  validationErrors: z.array(fieldIssueSchema).optional(),
  diff: z.array(diffSchema).optional(),
  usedTools: z.array(z.string()).optional(),
});

let cachedRuntime: ReturnType<typeof createAgentRuntime> | undefined;

function getMcpRuntime() {
  cachedRuntime ??= createAgentRuntime(getConfig(), { silentLogger: true });
  return cachedRuntime;
}

export const positionTool = defineTool({
  name: 'position',
  description:
    '岗位管理工具，支持自然语言查询岗位、新建岗位预览、编辑岗位预览，以及用户确认后的保存或发布。',
  input: positionInputSchema,
  output: positionOutputSchema,
  execute: async ({ message, sessionId }, ctx) => {
    ctx.logger.info('position called');

    try {
      const runtime = getMcpRuntime();
      return await runtime.positionService.chat({
        sessionId: sessionId?.trim() || 'roll-position-default',
        message,
        userId: 'roll-core',
        channel: 'roll-mcp',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.logger.error(`position failed: ${errorMessage}`);

      return {
        reply: `岗位管理失败：${errorMessage}`,
        intent: 'clarify' as const,
        needsClarification: true,
        needsConfirmation: false,
        usedTools: [],
      };
    }
  },
});

