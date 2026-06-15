import { generateText, Output } from 'ai';
import type { Logger } from 'pino';
import { z } from 'zod';

import type { NamedLanguageModel } from '../core/modelProvider.ts';
import type { ParsedPositionMessage, PositionApiStatus, PositionFormValues } from './types.ts';

export type PositionSearchPlanningResult = {
  shouldSearchPosition?: boolean;
  detailRequested?: boolean;
  searchJobName?: string;
  projectName?: string;
  brandName?: string;
  cityNames?: string[];
  statuses?: PositionApiStatus[];
};

export type PositionSearchPlanner = {
  planSearch(input: {
    message: string;
    parsed: ParsedPositionMessage;
  }): Promise<PositionSearchPlanningResult | undefined>;
};

export type PositionCreatePlanningResult = {
  shouldCreatePosition?: boolean;
  projectName?: string;
  brandName?: string;
  storeNames?: string[];
  positionName?: string;
  positionCategoryName?: string;
  workContent?: string;
  recruitCount?: number;
  threshold?: number;
  genders?: Array<'1' | '2'>;
  ageMin?: number;
  ageMax?: number;
  dailyTimeRange?: [string, string];
  dailyWorkDuration?: number;
  baseSalary?: number;
  baseSalaryUnit?: PositionFormValues['baseSalaryUnit'];
  salaryMin?: number;
  salaryMax?: number;
  salaryRangeUnit?: PositionFormValues['salaryRangeUnit'];
  settlementCycle?: PositionFormValues['settlementCycle'];
  payDay?: string;
  minWorkMonths?: number;
};

export type PositionCreatePlanner = {
  planCreate(input: {
    message: string;
    parsed: ParsedPositionMessage;
  }): Promise<PositionCreatePlanningResult | undefined>;
};

const llmSearchPlanSchema = z.object({
  shouldSearchPosition: z
    .boolean()
    .describe('用户是否在查询岗位/职位信息。'),
  detailRequested: z
    .boolean()
    .optional()
    .describe('用户是否想查看单个岗位详情，而不是只看列表。'),
  searchJobName: z
    .string()
    .optional()
    .describe('岗位名称关键词。默认把未明确声明为项目/品牌/城市/状态的业务词放这里。'),
  projectName: z
    .string()
    .optional()
    .describe('仅当用户明确说“项目/项目下/项目的岗位”时填写项目名称。'),
  brandName: z
    .string()
    .optional()
    .describe('仅当用户明确说“品牌/品牌下/品牌的岗位”时填写品牌名称。'),
  cityNames: z
    .array(z.string())
    .optional()
    .describe('用户明确提到的城市或区域名称。'),
  statuses: z
    .array(z.enum(['published', 'unpublished', 'offline']))
    .optional()
    .describe('岗位状态：已发布/在招=published，未发布/待发布=unpublished，下架/关闭=offline。'),
});

const llmCreatePlanSchema = z.object({
  shouldCreatePosition: z
    .boolean()
    .describe('用户是否在新建/创建/发布一个岗位。'),
  projectName: z
    .string()
    .optional()
    .describe('用户提到的项目名称。不要编造，不要填项目 ID。'),
  brandName: z
    .string()
    .optional()
    .describe('用户提到的品牌名称。不要编造，不要填品牌 ID。'),
  storeNames: z
    .array(z.string())
    .optional()
    .describe('用户提到的招聘门店名称列表。不要编造，不要填门店 ID。'),
  positionName: z
    .string()
    .optional()
    .describe('岗位短名称，即 HM2.0 jobNickName，不包含品牌、门店、用工形式。'),
  positionCategoryName: z
    .string()
    .optional()
    .describe('职位类别/工种名称，例如服务员、理货员、收银员。'),
  workContent: z
    .string()
    .optional()
    .describe('用户明确填写的工作内容/岗位职责。'),
  recruitCount: z
    .number()
    .optional()
    .describe('招聘人数。'),
  threshold: z
    .number()
    .optional()
    .describe('招聘阈值。用户说1.5倍时填15；用户说15时填15。'),
  genders: z
    .array(z.enum(['1', '2']))
    .optional()
    .describe('性别要求：男=1，女=2，男女不限=[1,2]。'),
  ageMin: z.number().optional(),
  ageMax: z.number().optional(),
  dailyTimeRange: z
    .tuple([z.string(), z.string()])
    .optional()
    .describe('上下班时间，格式 HH:mm，例如 ["08:00","14:00"]。'),
  dailyWorkDuration: z.number().optional().describe('每日工时/每天几小时。'),
  baseSalary: z.number().optional().describe('基本薪资金额。'),
  baseSalaryUnit: z
    .enum(['1', '3', '4', '5', '6', '7'])
    .optional()
    .describe('基本薪资单位：天/日=1，月=3，小时/时=4，单=5，次=6。'),
  salaryMin: z.number().optional().describe('综合薪资下限。'),
  salaryMax: z.number().optional().describe('综合薪资上限。'),
  salaryRangeUnit: z.enum(['1', '2', '3']).optional().describe('综合薪资单位：天/日=1，周=2，月=3。'),
  settlementCycle: z
    .enum(['1', '2', '3', '4'])
    .optional()
    .describe('结算周期：日结=1，周结=2，月结=3，完工结=4。'),
  payDay: z.string().optional().describe('发薪日：当日结=1，次日结=2，月结填每月几号。'),
  minWorkMonths: z.number().optional().describe('至少上岗月数。'),
});

type LlmSearchPlan = z.infer<typeof llmSearchPlanSchema>;
type LlmCreatePlan = z.infer<typeof llmCreatePlanSchema>;

const PLANNER_TIMEOUT_MS = 4000;
const PLANNER_MAX_OUTPUT_TOKENS = 700;

export function createLlmPositionSearchPlanner(
  models: NamedLanguageModel[],
  logger: Logger,
): PositionSearchPlanner | undefined {
  if (!models.length) {
    return undefined;
  }

  return {
    async planSearch(input) {
      let lastError: unknown;

      for (const [index, modelCandidate] of models.entries()) {
        try {
          const result = await generateText({
            model: modelCandidate.model,
            output: Output.object({
              schema: llmSearchPlanSchema,
              name: 'position_search_plan',
            }),
            prompt: buildSearchPlanningPrompt(input.message, input.parsed),
            temperature: 0,
            maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
            maxRetries: 0,
            timeout: { totalMs: PLANNER_TIMEOUT_MS },
          });
          return normalizeLlmSearchPlan(result.output);
        } catch (error) {
          lastError = error;
          logger.warn(
            {
              model: modelCandidate.name,
              provider: modelCandidate.provider,
              isFallbackAvailable: index < models.length - 1,
              error: error instanceof Error ? error.message : String(error),
            },
            'Position search planning model attempt failed',
          );
        }
      }

      if (lastError) {
        logger.warn(
          {
            error: lastError instanceof Error ? lastError.message : String(lastError),
          },
          'Position search planning unavailable',
        );
      }

      return undefined;
    },
  };
}

export function createLlmPositionCreatePlanner(
  models: NamedLanguageModel[],
  logger: Logger,
): PositionCreatePlanner | undefined {
  if (!models.length) {
    return undefined;
  }

  return {
    async planCreate(input) {
      let lastError: unknown;

      for (const [index, modelCandidate] of models.entries()) {
        try {
          const result = await generateText({
            model: modelCandidate.model,
            output: Output.object({
              schema: llmCreatePlanSchema,
              name: 'position_create_plan',
            }),
            prompt: buildCreatePlanningPrompt(input.message, input.parsed),
            temperature: 0,
            maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
            maxRetries: 0,
            timeout: { totalMs: PLANNER_TIMEOUT_MS },
          });
          return normalizeLlmCreatePlan(result.output);
        } catch (error) {
          lastError = error;
          logger.warn(
            {
              model: modelCandidate.name,
              provider: modelCandidate.provider,
              isFallbackAvailable: index < models.length - 1,
              error: error instanceof Error ? error.message : String(error),
            },
            'Position create planning model attempt failed',
          );
        }
      }

      if (lastError) {
        logger.warn(
          {
            error: lastError instanceof Error ? lastError.message : String(lastError),
          },
          'Position create planning unavailable',
        );
      }

      return undefined;
    },
  };
}

function buildSearchPlanningPrompt(
  message: string,
  parsed: ParsedPositionMessage,
): string {
  return [
    '你是岗位查询规划器，只输出结构化 JSON，不回答用户。',
    '输出必须是一个 JSON 对象，不要使用 Markdown 代码块，不要添加解释文字。',
    '目标：从中文自然语言中提取岗位查询条件，供后续系统调用岗位列表/详情接口。',
    '',
    '规则：',
    '1. 如果用户没有明确说“项目/项目下”，不要把关键词放到 projectName。',
    '2. 如果用户没有明确说“品牌/品牌下”，不要把关键词放到 brandName。',
    '3. 普通用户说“果蔬好岗位”“肯德基相关岗位”时，优先作为岗位名称关键词：searchJobName=果蔬好/肯德基。',
    '4. “果蔬好岗位”里的“岗位/职位/相关/所有/全部/哪些/都有哪些”不是关键词，要去掉。',
    '5. 不要编造岗位 ID，不要生成写入字段，不要生成接口 payload。',
    '6. 如果用户想“看详情/详细信息/列出来完整信息/看一下这个”，detailRequested=true。',
    '',
    '当前规则解析结果如下，仅用于参考，不要覆盖其中已经明确的 ID、项目 ID、品牌 ID：',
    JSON.stringify(parsed),
    '',
    `用户原话：${message}`,
  ].join('\n');
}

function buildCreatePlanningPrompt(
  message: string,
  parsed: ParsedPositionMessage,
): string {
  return [
    '你是岗位新建信息抽取器，只输出结构化 JSON，不回答用户。',
    '输出必须是一个 JSON 对象，不要使用 Markdown 代码块，不要添加解释文字。',
    '目标：从中文自然语言中提取用户明确表达的新建岗位字段，供后续系统做项目/品牌/门店校验和草稿预览。',
    '',
    '重要原则：',
    '1. 不要编造项目、品牌、门店、职位类别、薪资或 ID。',
    '2. 不要输出任何 ID。项目/品牌/门店/职位类别只输出名称，后续系统会用接口解析。',
    '3. positionName 是岗位短名称，只能是“理货员/服务员/收银员”这类短名，不要拼接品牌、门店、全职/兼职。',
    '4. 如果用户说“果蔬好-人民广场店-理货员”，应理解为 brandName=果蔬好，storeNames=[人民广场店]，positionName=理货员，positionCategoryName=理货员。',
    '5. 如果用户说“上海生鲜项目果蔬好人民广场店理货员招2个女生”，可以按语义切分为项目、品牌、门店、岗位短名。',
    '6. 多门店要输出多个 storeNames；如果同一句有统一招聘人数/阈值，则 recruitCount/threshold 填统一值。',
    '7. 上下班时间输出 HH:mm。8点到14点 => ["08:00","14:00"]；8点半到14点半 => ["08:30","14:30"]。',
    '8. 招聘阈值 1.5/1.5倍 输出 15；阈值 15 输出 15。',
    '9. 性别：男=1，女=2，男女不限=[1,2]。',
    '10. 基本薪资单位：天/日=1，月=3，小时/时=4，单=5，次=6。综合薪资单位：天/日=1，周=2，月=3。',
    '11. 结算周期：日结=1，周结=2，月结=3，完工结=4。发薪日：当日结/今天结=1，次日结=2，月结填日期数字字符串。',
    '12. 如果用户是“复制/照着/参考某个岗位新建”，来源岗位 ID 已由规则解析保留；你只抽取用户本句明确要覆盖的字段，不要把来源岗位已有字段当作用户输入。',
    '',
    '当前规则解析结果如下，仅用于参考；如果规则漏掉自然语言信息，你可以补充；如果规则已有明确 ID，不要覆盖：',
    JSON.stringify(parsed),
    '',
    `用户原话：${message}`,
  ].join('\n');
}

function parseLlmSearchPlan(text: string): LlmSearchPlan | undefined {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const result = llmSearchPlanSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseLlmCreatePlan(text: string): LlmCreatePlan | undefined {
  const jsonText = extractJsonObject(text);
  if (!jsonText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const result = llmCreatePlanSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    if (inner.startsWith('{') && inner.endsWith('}')) {
      return inner;
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return undefined;
}

function normalizeLlmSearchPlan(plan: LlmSearchPlan): PositionSearchPlanningResult | undefined {
  if (!plan.shouldSearchPosition) {
    return undefined;
  }

  return {
    shouldSearchPosition: plan.shouldSearchPosition,
    detailRequested: plan.detailRequested,
    searchJobName: cleanPlannerText(plan.searchJobName),
    projectName: cleanPlannerText(plan.projectName),
    brandName: cleanPlannerText(plan.brandName),
    cityNames: cleanPlannerList(plan.cityNames),
    statuses: normalizePlannerStatuses(plan.statuses),
  };
}

function normalizeLlmCreatePlan(plan: LlmCreatePlan): PositionCreatePlanningResult | undefined {
  if (!plan.shouldCreatePosition) {
    return undefined;
  }

  const storeNames = cleanPlannerList(plan.storeNames);
  const genders = plan.genders?.filter((value): value is '1' | '2' => value === '1' || value === '2');
  const dailyTimeRange = normalizePlannerTimeRange(plan.dailyTimeRange);

  return {
    shouldCreatePosition: true,
    projectName: cleanPlannerText(plan.projectName),
    brandName: cleanPlannerText(plan.brandName),
    storeNames,
    positionName: cleanPlannerText(plan.positionName),
    positionCategoryName: cleanPlannerText(plan.positionCategoryName),
    workContent: cleanPlannerText(plan.workContent),
    recruitCount: normalizePositivePlannerNumber(plan.recruitCount),
    threshold: normalizeThresholdPlannerNumber(plan.threshold),
    genders: genders?.length ? Array.from(new Set(genders)) : undefined,
    ageMin: normalizePlannerNumber(plan.ageMin),
    ageMax: normalizePlannerNumber(plan.ageMax),
    dailyTimeRange,
    dailyWorkDuration: normalizePositivePlannerNumber(plan.dailyWorkDuration),
    baseSalary: normalizePositivePlannerNumber(plan.baseSalary),
    baseSalaryUnit: plan.baseSalaryUnit,
    salaryMin: normalizePositivePlannerNumber(plan.salaryMin),
    salaryMax: normalizePositivePlannerNumber(plan.salaryMax),
    salaryRangeUnit: plan.salaryRangeUnit,
    settlementCycle: plan.settlementCycle,
    payDay: cleanPlannerText(plan.payDay),
    minWorkMonths: normalizePositivePlannerNumber(plan.minWorkMonths),
  };
}

function cleanPlannerText(value?: string): string | undefined {
  const text = value
    ?.replace(/岗位|职位|相关|所有|全部|都有哪些|有哪些|有哪?些|哪些/g, '')
    .replace(/^(?:名称|名字|名)(?:是|为|叫|改为|改成|调整为|换成|换为|设为|设置为|命名为)?/u, '')
    .replace(/(?:的|下的|里的)$/u, '')
    .replace(/[，,。；;]$/u, '')
    .trim();
  return text || undefined;
}

function normalizePlannerNumber(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePositivePlannerNumber(value?: number): number | undefined {
  const number = normalizePlannerNumber(value);
  return number === undefined || number <= 0 ? undefined : number;
}

function normalizeThresholdPlannerNumber(value?: number): number | undefined {
  const number = normalizePositivePlannerNumber(value);
  if (number === undefined) {
    return undefined;
  }
  return number <= 10 ? number * 10 : number;
}

function normalizePlannerTimeRange(value?: [string, string]): [string, string] | undefined {
  if (!value) {
    return undefined;
  }

  const start = normalizePlannerTime(value[0]);
  const end = normalizePlannerTime(value[1]);
  return start && end ? [start, end] : undefined;
}

function normalizePlannerTime(value?: string): string | undefined {
  const matched = value?.trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!matched) {
    return undefined;
  }

  const hour = Number(matched[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return undefined;
  }

  return `${String(hour).padStart(2, '0')}:${matched[2]}`;
}

function cleanPlannerList(values?: string[]): string[] | undefined {
  const result = values
    ?.map(cleanPlannerText)
    .filter((item): item is string => Boolean(item));
  return result?.length ? Array.from(new Set(result)) : undefined;
}

function normalizePlannerStatuses(values?: LlmSearchPlan['statuses']): PositionApiStatus[] | undefined {
  const mapped = values
    ?.map(value => {
      if (value === 'published') return 1;
      if (value === 'offline') return 2;
      return 0;
    })
    .filter((value): value is PositionApiStatus => value === 0 || value === 1 || value === 2);
  return mapped?.length ? Array.from(new Set(mapped)) : undefined;
}
