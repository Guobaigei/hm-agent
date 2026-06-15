import 'dotenv/config';

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { getConfig } from '../pages/core/config.ts';
import { createAgentRuntime } from '../pages/core/runtime.ts';

async function main() {
  const config = getConfig();
  const runtime = createAgentRuntime(config, { silentLogger: true });
  const sessionId = process.argv[2]?.trim() || `cli-${Date.now()}`;
  const userId = 'cli-user';

  const rl = createInterface({
    input,
    output,
  });

  output.write('本地的 agent-hm CLI 已启动\n');
  output.write('你可以在终端这里与海绵系统进行对话，查询品牌/公司/门店/项目，也可以查询、新建、编辑岗位\n');
  output.write(`会话ID: ${sessionId}\n`);
  output.write('输入 /exit 退出，对话会保留在当前会话上下文中。岗位新建/编辑会先生成预览，确认后才提交。\n\n');

  try {
    while (true) {
      const message = (await rl.question('老板请讲: ')).trim();

      if (!message) {
        continue;
      }

      if (['/exit', 'exit', '/quit', 'quit'].includes(message.toLowerCase())) {
        output.write('CLI 已退出\n');
        break;
      }

      try {
        if (isCapabilityQuestion(message)) {
          output.write(`\nAgent: ${buildCapabilityReply()}\n\n`);
          continue;
        }

        const hasPendingPositionDraft = Boolean(
          runtime.positionDraftStore.getBySession(sessionId),
        );
        const hasPositionContext =
          runtime.positionDraftStore.hasPositionContext(sessionId);
        const usePositionService = shouldUsePositionService(
          message,
          hasPendingPositionDraft,
          hasPositionContext,
        );

        const response = usePositionService
          ? await runtime.positionService.chat({
              sessionId,
              message,
              userId,
              channel: 'cli',
            })
          : await runtime.hmQueryService.chat({
              sessionId,
              message,
              userId,
              channel: 'cli',
            });

        output.write(`\nAgent: ${response.reply}\n`);

        if ('candidates' in response && response.needsClarification && response.candidates?.length) {
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

function isCapabilityQuestion(message: string): boolean {
  return /你.*(功能|能做什么|会什么)|有什么功能|支持什么/.test(message);
}

function shouldUsePositionService(
  message: string,
  hasPendingPositionDraft: boolean,
  hasPositionContext: boolean,
): boolean {
  if (hasDraftReference(message)) {
    return true;
  }

  if (hasPendingPositionDraft) {
    return true;
  }

  if (hasPositionContext && /详情|详细|完整信息|列给我|展开|这个岗位|该岗位|刚刚/.test(message)) {
    return true;
  }

  if (hasPositionContext && /编辑|修改|更新|调整|改成|改为|改一下|把/.test(message)) {
    return true;
  }

  return /岗位|职位|工种|招聘人数|招聘门店|用工形式|用工类型|兼职类型|合作模式|工作内容|工作地址|试工|培训|试用期|面试|发薪|薪资|工资|社保|公积金|商业保险|年龄|性别|学历|排班|上下班|供应商/.test(message);
}

function hasDraftReference(message: string): boolean {
  return /draftId\s*[:：#]?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(message);
}

function buildCapabilityReply(): string {
  return [
    '我现在支持两类能力：',
    '',
    '1. 查询海绵实体：品牌、公司、门店、项目。',
    '2. 岗位管理：查询岗位、新建岗位、编辑岗位。',
    '',
    '岗位新建/编辑会先生成预览，不会直接写入；你确认保存或确认发布后才会提交。发布前我会要求你明确是否通知供应商。',
    '',
    '示例：',
    '- 查询已发布服务员岗位',
    '- 新建一个肯德基服务员兼职岗位，月结，薪资20元/时',
    '- 编辑岗位 ID 123，把招聘人数改为 10 人',
    '- 确认保存',
    '- 不通知供应商并发布',
  ].join('\n');
}
