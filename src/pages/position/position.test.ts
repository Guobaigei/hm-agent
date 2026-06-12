import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AppConfig } from '../core/config.ts';
import { PositionDraftStore } from './draftStore.ts';
import {
  cleanPositionFormValues,
  createDefaultPositionFormValues,
  mergePositionValues,
  validatePositionValues,
} from './form.ts';
import { parsePositionMessage } from './parser.ts';
import { buildCreateJobPayload } from './payload.ts';
import { PositionService } from './service.ts';
import type { PositionApiClient } from './client.ts';
import type { PositionCreatePlanner, PositionSearchPlanner } from './planner.ts';
import type { PositionFormValues } from './types.ts';

const baseConfig: AppConfig = {
  logLevel: 'silent',
  aiModel: 'test-model',
  aiFallbackBaseUrl: 'https://api.deepseek.com',
  aiApiKey: 'test-ai-key',
  aiBaseUrl: 'https://example.com/v1',
  hmBaseUrl: 'https://gateway.example/sponge/admin',
  hmDulidayToken: 'test-token',
  hmTimeoutMs: 15000,
  hmRequestStrategy: 'auto',
  sessionTtlMs: 30 * 60 * 1000,
  sessionMaxTurns: 12,
  maxToolResults: 5,
};

function createCompleteValues(): PositionFormValues {
  return mergePositionValues(createDefaultPositionFormValues(), {
    projectId: 101,
    projectName: '上海项目',
    brandId: 202,
    brandName: '肯德基',
    positionName: '服务员',
    positionCategory: 303,
    workContent: '负责门店服务和基础清洁',
    employmentType: 'part-time',
    partTimeType: '5',
    employmentDurationType: '1',
    minWorkMonths: 3,
    cooperationMode: '2',
    trialRequired: '0',
    trainingRequired: '0',
    settlementCycle: '3',
    payDay: '15',
    baseSalary: 5000,
    baseSalaryUnit: '3',
    salaryMin: 5000,
    salaryMax: 6000,
    salaryRangeUnit: '3',
    commercialInsurance: '2',
    ageMin: 18,
    ageMax: 45,
    genders: ['1', '2'],
    education: '1',
    socialIdentity: '0',
    weeklyMonthlyMode: '1',
    workDays: 6,
    restDays: 1,
    restMode: '0',
    dailyScheduleMode: '2',
    dailyWorkDuration: 8,
    dailyTimeRange: ['09:00', '18:00'],
    interviewRounds: '0',
    recruitStoreAllocations: [
      {
        id: '1',
        storeId: 1,
        storeName: '人民广场店',
        recruitCount: 3,
        threshold: 15,
      },
    ],
  });
}

function createCompleteDetail(jobBasicInfoId = 1909) {
  return {
    jobBasicInfoId,
    requirement: {
      basicInfo: {
        project: { projectId: 598, projectName: '京津果蔬好' },
        brand: { brandId: 10024, brandName: '果蔬好' },
        jobName: '果蔬好-人民广场店-工时初始化测试5-兼职',
        jobNickName: '工时初始化测试5',
        jobType: 12,
        jobContent: '测试下',
        laborForm: 5,
        cooperationMode: '4',
        needProbationWork: '0',
        needTraining: '0',
      },
      salaryWelfare: {
        jobSalaries: [
          {
            type: 0,
            salaryPeriod: '3',
            monthSalaryPeriodTime: '15',
            salary: 5000,
            salaryUnit: '3',
            minComprehensiveSalary: 5000,
            maxComprehensiveSalary: 6000,
            comprehensiveSalaryUnit: '3',
          },
        ],
        jobWelfare: {
          haveInsurance: '2',
          accommodation: '0',
          catering: '0',
        },
      },
      hiringRequirement: {
        minAge: 18,
        maxAge: 45,
        genderIds: ['1', '2'],
        educationId: '1',
        figureId: '0',
      },
      workTimeArrangement: {
        employmentForm: '1',
        minWorkMonths: 3,
        weekMonthArrangementMode: '1',
        perWeekWorkDays: 6,
        perWeekRestDays: 1,
        weekMonthRestMode: '0',
        arrangementType: '2',
        perDayMinWorkHours: 8,
        goToWorkStartTime: 32400,
        goOffWorkStartTime: 64800,
      },
      processRequirement: {
        interviewTotal: '0',
      },
      storeRequirement: {
        jobStores: [
          {
            id: 'store-1',
            storeId: 1,
            storeName: '人民广场店',
            storeExactAddress: '上海市黄浦区南京东路街道成都北路333号东703室',
            requirementNum: 3,
            thresholdNum: 15,
          },
        ],
      },
    },
  };
}

describe('position parser', () => {
  it('parses job id lists and status filters', () => {
    const parsed = parsePositionMessage('查询岗位 ID 12, 13 已发布岗位');

    assert.equal(parsed.intent, 'search');
    assert.deepEqual(parsed.search.jobBasicInfoIds, [12, 13]);
    assert.deepEqual(parsed.search.statuses, [1]);
  });

  it('parses bare numbers as job ids in position search context', () => {
    const parsed = parsePositionMessage('你根据1915查下岗位信息');

    assert.equal(parsed.intent, 'search');
    assert.deepEqual(parsed.search.jobBasicInfoIds, [1915]);
    assert.equal(parsed.search.searchJobName, undefined);
  });

  it('parses bare job ids in detail requests as direct detail targets', () => {
    const parsed = parsePositionMessage('看下1914的详情');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.detailRequested, true);
    assert.equal(parsed.jobBasicInfoId, 1914);
    assert.equal(parsed.search.searchJobName, undefined);
  });

  it('supports five-digit job ids in detail requests', () => {
    const parsed = parsePositionMessage('看下12345的详情');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.detailRequested, true);
    assert.equal(parsed.jobBasicInfoId, 12345);
  });

  it('parses bare numbers as job ids in edit context', () => {
    const parsed = parsePositionMessage('帮我修改下 1914 的岗位信息，将用工形式改为全职');

    assert.equal(parsed.intent, 'edit_preview');
    assert.equal(parsed.jobBasicInfoId, 1914);
    assert.equal(parsed.patch.employmentType, 'full-time');
  });

  it('parses supported search dimensions', () => {
    const parsed = parsePositionMessage('查询项目ID 11 品牌ID 22 上海已下架岗位名称 服务员');

    assert.deepEqual(parsed.search.projectIds, [11]);
    assert.deepEqual(parsed.search.brandIds, [22]);
    assert.deepEqual(parsed.search.statuses, [2]);
    assert.equal(parsed.search.searchJobName, '服务员');
    assert.deepEqual(parsed.references.cityNames, ['上海']);
  });

  it('parses casual city and job name search wording', () => {
    const parsed = parsePositionMessage('我想让你帮我看下上海市果蔬好岗位都有哪些');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, '果蔬好');
    assert.deepEqual(parsed.references.cityNames, ['上海']);
  });

  it('treats embedded numeric codes in position names as name text instead of job ids', () => {
    const parsed = parsePositionMessage('test050900-上海徐汇绿地店-迎宾-小时工这个岗位看下详情');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.jobBasicInfoIds, undefined);
    assert.equal(parsed.search.searchJobName, 'test050900-上海徐汇绿地店-迎宾-小时工');
    assert.deepEqual(parsed.references.cityNames, ['上海']);
  });

  it('does not treat edit-like words inside a position name as an edit request', () => {
    const parsed = parsePositionMessage('test051901-五店-修改等待通知测试2-全职 看下这个岗位信息');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.detailRequested, true);
    assert.equal(parsed.search.searchJobName, 'test051901-五店-修改等待通知测试2-全职');
    assert.equal(parsed.sendMsgToSupplier, undefined);
    assert.equal(parsed.patch.interviewTimeMode, undefined);
  });

  it('parses trailing position names after "this position info" wording', () => {
    const parsed = parsePositionMessage('你帮我看下这个岗位的信息 test051901-五店-修改等待通知测试2-全职');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.detailRequested, true);
    assert.equal(parsed.search.searchJobName, 'test051901-五店-修改等待通知测试2-全职');
    assert.equal(parsed.sendMsgToSupplier, undefined);
    assert.equal(parsed.patch.interviewTimeMode, undefined);
  });

  it('cleans trailing quantifiers from implicit position search names', () => {
    const parsed = parsePositionMessage('你帮我查下果蔬好的所有岗位');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, '果蔬好');
  });

  it('cleans generic related-position wording down to the searchable keyword', () => {
    const parsed = parsePositionMessage('你帮我查下肯德基相关的岗位');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, '肯德基');
  });

  it('parses explicit brand scoped search without treating the brand as job name', () => {
    const parsed = parsePositionMessage('你查下果蔬好品牌下的所有岗位信息');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, undefined);
    assert.equal(parsed.references.brandName, '果蔬好');
  });

  it('parses explicit project scoped search without dropping the project name', () => {
    const parsed = parsePositionMessage('你查下上海肯德基项目下的所有已发布岗位');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, undefined);
    assert.deepEqual(parsed.search.statuses, [1]);
    assert.equal(parsed.references.projectName, '上海肯德基');
  });

  it('treats status-only position wording as search instead of publish commit', () => {
    const parsed = parsePositionMessage('已发布岗位有哪些');

    assert.equal(parsed.intent, 'search');
    assert.deepEqual(parsed.search.statuses, [1]);
    assert.equal(parsed.action, undefined);
  });

  it('parses common create fields from natural language', () => {
    const parsed = parsePositionMessage(
      '新建服务员岗位，兼职小时工，月结，薪资20元/时，综合薪资4000-6000元/月，18到45岁，男女不限，无试工，无培训，招聘3人，阈值1.5倍',
    );

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.patch.positionName, '服务员');
    assert.equal(parsed.patch.employmentType, 'part-time');
    assert.equal(parsed.patch.partTimeType, '5');
    assert.equal(parsed.patch.baseSalary, 20);
    assert.equal(parsed.patch.baseSalaryUnit, '4');
    assert.equal(parsed.patch.salaryMin, 4000);
    assert.equal(parsed.patch.salaryMax, 6000);
    assert.deepEqual(parsed.patch.genders, ['1', '2']);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 3);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.threshold, 15);
  });

  it('parses lightweight create requirements with Chinese counts and age ranges', () => {
    const parsed = parsePositionMessage('我现在要新建一个岗位，我现在要招两名女性，年龄在20-40之间');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.ageMin, 20);
    assert.equal(parsed.patch.ageMax, 40);
  });

  it('parses HM style composite create names and loose Chinese work times', () => {
    const parsed = parsePositionMessage(
      '老板请讲: 创建一个岗位，果蔬好-人民广场店-理货员，招2名女性年龄在20到40岁，上班时间为8点到14点',
    );

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.references.brandName, '果蔬好');
    assert.deepEqual(parsed.references.storeNames, ['人民广场店']);
    assert.equal(parsed.references.positionCategoryName, '理货员');
    assert.equal(parsed.patch.positionName, '理货员');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.ageMin, 20);
    assert.equal(parsed.patch.ageMax, 40);
    assert.equal(parsed.patch.dailyScheduleMode, '2');
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '14:00']);
  });

  it('treats casual build wording as create intent', () => {
    const parsed = parsePositionMessage('帮我建上海肯德基项目肯德基静安寺店服务员');

    assert.equal(parsed.intent, 'create_preview');
  });

  it('does not parse salaries or work time ranges as age ranges', () => {
    const parsed = parsePositionMessage(
      '新建岗位，招聘人数2，工资25元/小时，日结，当日结，综合薪资150到150元/天，上班时间8:00-14:00',
    );

    assert.equal(parsed.patch.ageMin, undefined);
    assert.equal(parsed.patch.ageMax, undefined);
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '14:00']);
  });

  it('parses threshold values even when the user omits multiplier wording', () => {
    const parsed = parsePositionMessage('新建岗位，招聘人数2，招聘阈值1.5');

    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.threshold, 15);
  });

  it('parses compact labels and casual gender/payday wording', () => {
    const parsed = parsePositionMessage(
      '新建岗位，项目上海生鲜项目，品牌果蔬好，门店人民广场店，招2名女，今天结，上班时间8:00-14:00，招聘阈值1.5',
    );

    assert.equal(parsed.references.projectName, '上海生鲜项目');
    assert.equal(parsed.references.brandName, '果蔬好');
    assert.deepEqual(parsed.references.storeNames, ['人民广场店']);
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.payDay, '1');
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '14:00']);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.threshold, 15);
  });

  it('parses source inheritance wording after an incomplete create draft', () => {
    const parsed = parsePositionMessage('其他信息要跟1914一致就可以');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.sourceJobBasicInfoId, 1914);
  });

  it('supports five-digit source job ids in inheritance wording', () => {
    const parsed = parsePositionMessage('其他信息要跟12345一致就可以');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.sourceJobBasicInfoId, 12345);
  });

  it('parses no social insurance as none instead of all insurance options', () => {
    const parsed = parsePositionMessage('无试用期，且无社保公积金');

    assert.equal(parsed.patch.probationStatus, '1');
    assert.deepEqual(parsed.patch.socialInsuranceList, ['none']);
  });

  it('parses change wording for salary updates', () => {
    const parsed = parsePositionMessage('把薪资改为25元/时');

    assert.equal(parsed.intent, 'edit_preview');
    assert.equal(parsed.patch.baseSalary, 25);
    assert.equal(parsed.patch.baseSalaryUnit, '4');
  });

  it('parses change wording for recruitment count updates', () => {
    const parsed = parsePositionMessage('帮我把招聘人数改成5人，并且用工形式改成兼职吧');

    assert.equal(parsed.intent, 'edit_preview');
    assert.equal(parsed.patch.employmentType, 'part-time');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 5);
  });

  it('parses inherited create source job id and patch fields', () => {
    const parsed = parsePositionMessage('照着岗位 ID 1909 新建一个岗位，把招聘人数改为5人');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.sourceJobBasicInfoId, 1909);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 5);
  });

  it('parses inherited create from current context and store replacement', () => {
    const parsed = parsePositionMessage('照着这个岗位新建，门店换成人民广场店');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.inheritFromContext, true);
    assert.deepEqual(parsed.references.storeNames, ['人民广场店']);
  });
});

describe('position form and payload', () => {
  it('cleans hidden part-time fields when switching to full-time', () => {
    const values = cleanPositionFormValues({
      employmentType: 'full-time',
      partTimeType: '5',
      employmentDurationType: '2',
      temporaryEmploymentStartTime: '2026-01-01',
      temporaryEmploymentEndTime: '2026-02-01',
      probationStatus: '1',
    });

    assert.equal(values.partTimeType, undefined);
    assert.equal(values.temporaryEmploymentStartTime, undefined);
    assert.equal(values.employmentDurationType, '1');
  });

  it('builds create payload for save and publish actions', () => {
    const payload = buildCreateJobPayload(createCompleteValues(), {
      publishNow: true,
      sendMsgToSupplier: false,
    });

    assert.equal(payload.immediate, 1);
    assert.equal(payload.sendMsgToSupplier, false);

    const requirement = payload.jobRequirement as Record<string, unknown>;
    const basicInfo = requirement.basicInfo as Record<string, unknown>;
    const salaryWelfare = requirement.salaryWelfare as Record<string, unknown>;
    const storeRequirement = requirement.storeRequirement as Record<string, unknown>;

    assert.equal((basicInfo.project as Record<string, unknown>).projectId, 101);
    assert.equal((basicInfo.brand as Record<string, unknown>).brandId, 202);
    assert.equal(basicInfo.jobName, '测试岗位名称');
    assert.equal(basicInfo.jobNickName, '服务员');
    assert.equal(basicInfo.laborForm, 5);
    assert.ok(Array.isArray(salaryWelfare.jobSalaries));
    assert.ok(Array.isArray((storeRequirement as { jobStores?: unknown[] }).jobStores));
  });

  it('includes fill-in options in missing required field prompts', () => {
    const values = mergePositionValues(createCompleteValues(), {
      employmentType: 'full-time',
      probationStatus: undefined,
      socialInsuranceList: undefined,
    });

    const { missingFields } = validatePositionValues(values);
    const probation = missingFields.find(item => item.field === 'probationStatus');
    const insurance = missingFields.find(item => item.field === 'socialInsuranceList');

    assert.match(probation?.message ?? '', /可选：无试用期、有试用期/);
    assert.match(insurance?.message ?? '', /可选：无、五险一金、公积金、养老保险/);
    assert.match(insurance?.message ?? '', /无社保公积金/);
  });
});

describe('position service', () => {
  it('searches by parsed job id instead of falling back to an unfiltered list', async () => {
    let capturedParams: unknown;
    const apiClient = {
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return { result: [], total: 0 };
      },
      searchBrands: async () => [],
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-search',
      message: '你根据1915查下岗位信息',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.deepEqual(
      (capturedParams as { jobBasicInfoIds?: number[] }).jobBasicInfoIds,
      [1915],
    );
  });

  it('does not call list API when no search condition is present', async () => {
    let called = false;
    const apiClient = {
      getJobList: async () => {
        called = true;
        return { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-empty',
      message: '查询岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'clarify');
    assert.equal(called, false);
    assert.match(response.reply, /岗位 ID、岗位名称、项目、品牌、城市区域或状态/);
  });

  it('uses the search planner only when rules cannot extract query conditions', async () => {
    let plannerCalls = 0;
    let capturedParams: unknown;
    const searchPlanner: PositionSearchPlanner = {
      async planSearch() {
        plannerCalls += 1;
        return {
          shouldSearchPosition: true,
          searchJobName: '麦当劳',
        };
      },
    };
    const apiClient = {
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return {
          result: [
            {
              id: '2001',
              jobBasicInfoId: 2001,
              positionName: '麦当劳-服务员-兼职',
              projectName: '上海麦当劳',
              brandName: '麦当劳',
              status: 'published',
              requirementNum: 2,
            },
          ],
          total: 1,
        };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      searchPlanner,
      logger: { warn: () => undefined } as never,
    });

    const planned = await service.chat({
      sessionId: 's-llm-planner',
      message: '帮我看看麦当劳都有哪些',
      channel: 'test',
    });

    assert.equal(planned.intent, 'search');
    assert.equal(plannerCalls, 1);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, '麦当劳');
    assert.match(planned.reply, /2001/);

    const ruleFirst = await service.chat({
      sessionId: 's-llm-planner',
      message: '果蔬好岗位',
      channel: 'test',
    });

    assert.equal(ruleFirst.intent, 'search');
    assert.equal(plannerCalls, 1);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, '果蔬好');
  });

  it('lets the search planner replace weak rule-only keywords', async () => {
    let capturedParams: unknown;
    const searchPlanner: PositionSearchPlanner = {
      async planSearch() {
        return {
          shouldSearchPosition: true,
          searchJobName: '麦当劳',
        };
      },
    };
    const apiClient = {
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return {
          result: [
            {
              id: '2001',
              jobBasicInfoId: 2001,
              positionName: '麦当劳-全职服务员',
              projectName: '上海麦当劳',
              brandName: '麦当劳',
              status: 'published',
              requirementNum: 2,
            },
          ],
          total: 1,
        };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      searchPlanner,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-llm-planner-weak-keyword',
      message: '你帮我看下这个全职岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, '麦当劳');
    assert.match(response.reply, /2001/);
  });

  it('lets the search planner request detail lookup after planning a vague query', async () => {
    const calledTools: string[] = [];
    const searchPlanner: PositionSearchPlanner = {
      async planSearch() {
        return {
          shouldSearchPosition: true,
          detailRequested: true,
          searchJobName: '麦当劳',
        };
      },
    };
    const apiClient = {
      getJobList: async () => {
        calledTools.push('getJobList');
        return {
          result: [
            {
              id: '2001',
              jobBasicInfoId: 2001,
              positionName: '麦当劳-服务员-兼职',
              projectName: '上海麦当劳',
              brandName: '麦当劳',
              status: 'published',
              requirementNum: 2,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      searchPlanner,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-llm-planner-detail',
      message: '帮我看看麦当劳那个',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.deepEqual(calledTools, ['getJobList', 'getJobDetail:2001']);
    assert.match(response.reply, /岗位详情：2001/);
  });

  it('uses the create planner to understand unseparated natural language create requests', async () => {
    let plannerCalls = 0;
    let capturedStoreParams: unknown;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate() {
        plannerCalls += 1;
        return {
          shouldCreatePosition: true,
          projectName: '上海生鲜项目',
          brandName: '果蔬好',
          storeNames: ['人民广场店'],
          positionName: '理货员',
          positionCategoryName: '理货员',
          recruitCount: 2,
          threshold: 15,
          genders: ['2'],
          ageMin: 20,
          ageMax: 40,
          dailyTimeRange: ['08:00', '14:00'],
        };
      },
    };
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海生鲜项目',
          raw: {
            brands: [{ brandId: 202, brandName: '果蔬好' }],
          },
        },
      ],
      searchStores: async (params: unknown) => {
        capturedStoreParams = params;
        return [
          {
            id: 303,
            name: '人民广场店',
            raw: {},
          },
        ];
      },
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责商品陈列、补货、理货和货架维护。' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-llm-create-planner',
      message: '创建岗位，上海生鲜项目果蔬好人民广场店理货员招2个女生8点到14点，阈值1.5倍',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-llm-create-planner')?.values;

    assert.equal(response.intent, 'create_preview');
    assert.equal(plannerCalls, 1);
    assert.deepEqual((capturedStoreParams as { projectIds?: number[] }).projectIds, [101]);
    assert.deepEqual((capturedStoreParams as { brandIds?: number[] }).brandIds, [202]);
    assert.equal(values?.projectName, '上海生鲜项目');
    assert.equal(values?.brandName, '果蔬好');
    assert.equal(values?.positionName, '理货员');
    assert.equal(values?.positionCategoryName, '理货员');
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeId, 303);
    assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(values?.recruitStoreAllocations?.[0]?.threshold, 15);
    assert.deepEqual(values?.genders, ['2']);
    assert.equal(values?.ageMin, 20);
    assert.equal(values?.ageMax, 40);
    assert.deepEqual(values?.dailyTimeRange, ['08:00', '14:00']);
  });

  it('lets the create planner override weak rule-extracted names before resolving references', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate() {
        return {
          shouldCreatePosition: true,
          projectName: '上海生鲜项目',
          brandName: '果蔬好',
          storeNames: ['人民广场店'],
          positionName: '理货员',
          positionCategoryName: '理货员',
          recruitCount: 2,
          threshold: 15,
        };
      },
    };
    const apiClient = {
      searchProjects: async (query: string) => {
        assert.equal(query, '上海生鲜项目');
        return [
          {
            id: 101,
            name: '上海生鲜项目',
            raw: {
              brands: [{ brandId: 202, brandName: '果蔬好' }],
            },
          },
        ];
      },
      searchStores: async () => [{ id: 303, name: '人民广场店', raw: {} }],
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责商品陈列、补货、理货和货架维护。' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-llm-create-override-rule-name',
      message: '新建上海生鲜项目果蔬好人民广场店理货员，招2人',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-llm-create-override-rule-name')?.values;

    assert.equal(values?.projectName, '上海生鲜项目');
    assert.equal(values?.brandName, '果蔬好');
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
  });

  it('keeps multiple store names planned by the create planner', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate() {
        return {
          shouldCreatePosition: true,
          projectName: '上海生鲜项目',
          brandName: '果蔬好',
          storeNames: ['人民广场店', '徐家汇店'],
          positionName: '理货员',
          positionCategoryName: '理货员',
          recruitCount: 2,
          threshold: 15,
        };
      },
    };
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海生鲜项目',
          raw: {
            brands: [{ brandId: 202, brandName: '果蔬好' }],
          },
        },
      ],
      searchStores: async (params: { searchName?: string }) =>
        params.searchName === '人民广场店'
          ? [{ id: 303, name: '人民广场店', raw: {} }]
          : [{ id: 304, name: '徐家汇店', raw: {} }],
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责商品陈列、补货、理货和货架维护。' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-llm-create-multi-store',
      message: '上海生鲜项目果蔬好人民广场店和徐家汇店各招2个理货员',
      channel: 'test',
    });
    const stores = draftStore.getBySession('s-llm-create-multi-store')?.values.recruitStoreAllocations;

    assert.deepEqual(
      stores?.map(store => ({ name: store.storeName, count: store.recruitCount, threshold: store.threshold })),
      [
        { name: '人民广场店', count: 2, threshold: 15 },
        { name: '徐家汇店', count: 2, threshold: 15 },
      ],
    );
  });

  it('replaces existing draft stores when the user says store changed to another one', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate(input) {
        if (/徐家汇店/.test(input.message)) {
          return {
            shouldCreatePosition: true,
            storeNames: ['徐家汇店'],
          };
        }

        return {
          shouldCreatePosition: true,
          projectName: '上海生鲜项目',
          brandName: '果蔬好',
          storeNames: ['人民广场店'],
          positionName: '理货员',
          positionCategoryName: '理货员',
          recruitCount: 2,
          threshold: 15,
          genders: ['2'],
          ageMin: 20,
          ageMax: 40,
          dailyTimeRange: ['08:00', '14:00'],
          baseSalary: 25,
          baseSalaryUnit: '4',
          salaryMin: 150,
          salaryMax: 150,
          salaryRangeUnit: '1',
          settlementCycle: '1',
          payDay: '1',
          minWorkMonths: 3,
          dailyWorkDuration: 6,
        };
      },
    };
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海生鲜项目',
          raw: {
            brands: [{ brandId: 202, brandName: '果蔬好' }],
          },
        },
      ],
      searchStores: async (params: { searchName?: string }) =>
        params.searchName === '人民广场店'
          ? [{ id: 303, name: '人民广场店', raw: {} }]
          : [{ id: 304, name: '徐家汇店', raw: {} }],
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责商品陈列、补货、理货和货架维护。' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-llm-create-replace-store',
      message: '帮我建上海生鲜项目果蔬好人民广场店理货员',
      channel: 'test',
    });
    await service.chat({
      sessionId: 's-llm-create-replace-store',
      message: '门店换成徐家汇店',
      channel: 'test',
    });
    const stores = draftStore.getBySession('s-llm-create-replace-store')?.values.recruitStoreAllocations;

    assert.deepEqual(
      stores?.map(store => ({ name: store.storeName, count: store.recruitCount, threshold: store.threshold })),
      [{ name: '徐家汇店', count: 2, threshold: 15 }],
    );
  });

  it('resolves casual Shanghai city search without asking the user to disambiguate all cities', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      getProvinceList: async () => [
        {
          id: 110000,
          name: '北京市',
          children: [
            {
              id: 110100,
              name: '北京市',
              children: [{ id: 110101, name: '东城区' }],
            },
          ],
        },
        {
          id: 310000,
          name: '上海市',
          children: [
            {
              id: 310100,
              name: '上海市',
              children: [{ id: 310101, name: '黄浦区' }],
            },
          ],
        },
      ],
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        return { result: [], total: 0 };
      },
      searchBrands: async () => [],
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-shanghai-search',
      message: '我想让你帮我看下上海市果蔬好岗位都有哪些',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.deepEqual(
      (capturedParams[0] as { cityIdList?: number[] }).cityIdList,
      [310100],
    );
    assert.equal(
      (capturedParams[0] as { searchJobName?: string }).searchJobName,
      '果蔬好',
    );
    assert.doesNotMatch(response.reply, /匹配到多个城市/);
  });

  it('uses brand id when the user explicitly asks for positions under a brand', async () => {
    let capturedParams: unknown;
    const apiClient = {
      searchBrands: async (name: string) => {
        assert.equal(name, '果蔬好');
        return [{ id: 10024, name: '果蔬好', raw: {} }];
      },
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return {
          result: [
            {
              id: '1909',
              jobBasicInfoId: 1909,
              positionName: '果蔬好-人民广场店-工时初始化测试5（复制）（复制）-兼职',
              projectName: '京津果蔬好',
              brandName: '果蔬好',
              status: 'published',
              salaryText: '3000元/天',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-brand-scope',
      message: '你查下果蔬好品牌下的所有岗位信息',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.deepEqual((capturedParams as { brandIds?: number[] }).brandIds, [10024]);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, undefined);
    assert.match(response.reply, /1909/);
  });

  it('returns a readable response when a position lookup API request fails', async () => {
    const apiClient = {
      searchBrands: async () => {
        throw new TypeError('fetch failed');
      },
      getJobList: async () => ({ result: [], total: 0 }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-api-failure',
      message: '你帮我查下果蔬好品牌的所有岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'clarify');
    assert.equal(response.needsClarification, true);
    assert.match(response.reply, /岗位接口请求失败/);
    assert.match(response.reply, /fetch failed/);
  });

  it('does not globally resolve a brand when the selected project has different brands', async () => {
    let brandSearchCalls = 0;
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海肯德基项目',
          raw: {
            brands: [{ brandId: 202, brandName: '肯德基' }],
          },
        },
      ],
      searchBrands: async () => {
        brandSearchCalls += 1;
        return [{ id: 303, name: '麦当劳', raw: {} }];
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-create-brand-project-scope',
      message: '新建岗位，项目 上海肯德基项目，品牌 麦当劳',
      channel: 'test',
    });

    assert.equal(response.intent, 'clarify');
    assert.equal(brandSearchCalls, 0);
    assert.match(response.reply, /当前项目下没有“麦当劳”这个品牌/);
  });

  it('requires project and brand before resolving a create store', async () => {
    let storeSearchCalls = 0;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchStores: async () => {
        storeSearchCalls += 1;
        return [];
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-create-store-missing-scope',
      message: '新建岗位，门店 人民广场店，招聘3人，阈值1.5倍',
      channel: 'test',
    });

    assert.equal(response.intent, 'create_preview');
    assert.equal(storeSearchCalls, 0);
    assert.ok(response.missingFields?.some(item => item.label === '项目'));
    assert.ok(response.missingFields?.some(item => item.label === '品牌'));
    assert.equal(draftStore.getBySession('s-create-store-missing-scope')?.values.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
  });

  it('resolves create stores within the selected project and brand and preserves count fields', async () => {
    let capturedStoreParams: unknown;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海项目',
          raw: {
            brands: [{ brandId: 202, brandName: '肯德基' }],
          },
        },
      ],
      searchStores: async (params: unknown) => {
        capturedStoreParams = params;
        return [
          {
            id: 303,
            name: '人民广场店',
            raw: {
              address: '上海市黄浦区',
              exactAddress: '南京东路1号',
            },
          },
        ];
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-create-store-scope',
      message: '新建岗位，项目 上海项目，品牌 肯德基，门店 人民广场店，招聘3人，阈值1.5倍',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-create-store-scope')?.values;

    assert.equal(response.intent, 'create_preview');
    assert.deepEqual((capturedStoreParams as { projectIds?: number[] }).projectIds, [101]);
    assert.deepEqual((capturedStoreParams as { brandIds?: number[] }).brandIds, [202]);
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeId, 303);
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
    assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, 3);
    assert.equal(values?.recruitStoreAllocations?.[0]?.threshold, 15);
    assert.equal(values?.workAddress, '上海市黄浦区南京东路1号');
  });

  it('resolves HM style composite create names through project scoped brand and store lookup', async () => {
    let capturedStoreParams: unknown;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海项目',
          raw: {
            brands: [{ brandId: 202, brandName: '果蔬好' }],
          },
        },
      ],
      searchStores: async (params: unknown) => {
        capturedStoreParams = params;
        return [
          {
            id: 303,
            name: '人民广场店',
            raw: {
              address: '上海市黄浦区',
              exactAddress: '南京东路1号',
            },
          },
        ];
      },
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责果蔬陈列、理货和排面维护' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-create-composite-name',
      message:
        '新建岗位，项目 上海项目，果蔬好-人民广场店-理货员，招2名女性年龄在20到40岁，上班时间为8点到14点，阈值1.5倍',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-create-composite-name')?.values;

    assert.equal(response.intent, 'create_preview');
    assert.deepEqual((capturedStoreParams as { projectIds?: number[] }).projectIds, [101]);
    assert.deepEqual((capturedStoreParams as { brandIds?: number[] }).brandIds, [202]);
    assert.equal(values?.projectId, 101);
    assert.equal(values?.brandId, 202);
    assert.equal(values?.brandName, '果蔬好');
    assert.equal(values?.positionName, '理货员');
    assert.equal(values?.positionCategory, 12);
    assert.equal(values?.positionCategoryName, '理货员');
    assert.equal(values?.workContent, '负责果蔬陈列、理货和排面维护');
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeId, 303);
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
    assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(values?.recruitStoreAllocations?.[0]?.threshold, 15);
    assert.deepEqual(values?.genders, ['2']);
    assert.equal(values?.ageMin, 20);
    assert.equal(values?.ageMax, 40);
    assert.deepEqual(values?.dailyTimeRange, ['08:00', '14:00']);
  });

  it('keeps unresolved create store names and resolves them after the user provides a project', async () => {
    let capturedStoreParams: unknown;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海项目',
          raw: {
            brands: [{ brandId: 202, brandName: '果蔬好' }],
          },
        },
      ],
      searchBrands: async () => [{ id: 202, name: '果蔬好', raw: {} }],
      searchStores: async (params: unknown) => {
        capturedStoreParams = params;
        return [
          {
            id: 303,
            name: '人民广场店',
            raw: {
              address: '上海市黄浦区',
              exactAddress: '南京东路1号',
            },
          },
        ];
      },
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
      getJobTemplateByJobType: async () => ({ jobContent: '负责果蔬陈列、理货和排面维护' }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-create-store-later-project',
      message: '创建一个岗位，果蔬好-人民广场店-理货员，招2名女性年龄在20到40岁，上班时间为8点到14点，阈值1.5倍',
      channel: 'test',
    });
    const firstValues = draftStore.getBySession('s-create-store-later-project')?.values;

    assert.equal(firstValues?.brandName, '果蔬好');
    assert.equal(firstValues?.positionName, '理货员');
    assert.equal(firstValues?.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
    assert.equal(firstValues?.recruitStoreAllocations?.[0]?.storeId, undefined);

    await service.chat({
      sessionId: 's-create-store-later-project',
      message: '项目 上海项目',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-create-store-later-project')?.values;

    assert.deepEqual((capturedStoreParams as { projectIds?: number[] }).projectIds, [101]);
    assert.deepEqual((capturedStoreParams as { brandIds?: number[] }).brandIds, [202]);
    assert.equal(values?.projectId, 101);
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeId, 303);
    assert.equal(values?.recruitStoreAllocations?.[0]?.storeName, '人民广场店');
    assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(values?.recruitStoreAllocations?.[0]?.threshold, 15);
  });

  it('clears stale brand and store fields when a create draft project changes', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    draftStore.set({
      draftId: 'draft-project-change',
      sessionId: 's-create-project-change',
      mode: 'create',
      action: 'save',
      values: createCompleteValues(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      missingFields: [],
      validationErrors: [],
      diff: [],
    });
    const apiClient = {
      searchProjects: async () => [
        {
          id: 404,
          name: '北京项目',
          raw: {
            brands: [{ brandId: 505, brandName: '汉堡王' }],
          },
        },
      ],
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-create-project-change',
      message: '项目 北京项目',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-create-project-change')?.values;

    assert.equal(values?.projectId, 404);
    assert.equal(values?.brandId, undefined);
    assert.equal(values?.brandName, undefined);
    assert.equal(values?.recruitStoreAllocations, undefined);
    assert.equal(values?.workAddress, undefined);
  });

  it('uses job type defaults for create nickname and work content when missing', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchProjects: async () => [
        {
          id: 101,
          name: '上海项目',
          raw: {
            brands: [{ brandId: 202, brandName: '肯德基' }],
          },
        },
      ],
      searchStores: async () => [
        {
          id: 303,
          name: '人民广场店',
          raw: {},
        },
      ],
      getJobTypes: async () => [{ id: 12, name: '服务员', raw: {} }],
      getJobTemplateByJobType: async (jobTypeId: number) => {
        assert.equal(jobTypeId, 12);
        return { jobContent: '负责门店服务和基础清洁' };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-create-job-type-defaults',
      message: '新建岗位，项目 上海项目，品牌 肯德基，门店 人民广场店，工种 服务员，招聘3人，阈值1.5倍',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-create-job-type-defaults')?.values;

    assert.equal(values?.positionCategory, 12);
    assert.equal(values?.positionName, '服务员');
    assert.equal(values?.workContent, '负责门店服务和基础清洁');
  });

  it('uses job-name search as a planned alternative when explicit brand resolution fails but list search can hit', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      searchBrands: async () => {
        throw new TypeError('fetch failed');
      },
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        return (params as { searchJobName?: string }).searchJobName === '果蔬好'
          ? {
              result: [
                {
                  id: '1909',
                  jobBasicInfoId: 1909,
                  positionName: '果蔬好-人民广场店-兼职',
                  projectName: '京津果蔬好',
                  brandName: '果蔬好',
                  status: 'published',
                  requirementNum: 1,
                },
              ],
              total: 1,
            }
          : { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-brand-api-fallback-hit',
      message: '你帮我查下果蔬好品牌的所有岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal(response.results?.[0]?.jobBasicInfoId, 1909);
    assert.deepEqual(response.usedTools, ['position.searchBrands', 'position.getJobList']);
    assert.equal((capturedParams[0] as { searchJobName?: string }).searchJobName, '果蔬好');
    assert.doesNotMatch(response.reply, /岗位接口请求失败/);
  });

  it('stops after the primary job-name candidate hits for ambiguous related-position wording', async () => {
    let brandSearchCalls = 0;
    let projectSearchCalls = 0;
    const apiClient = {
      getJobList: async (params: unknown) => {
        assert.equal((params as { searchJobName?: string }).searchJobName, '肯德基');
        return {
          result: [
            {
              id: '1914',
              jobBasicInfoId: 1914,
              positionName: '肯德基-服务员-兼职',
              projectName: '上海肯德基',
              brandName: '肯德基',
              status: 'published',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
      searchBrands: async () => {
        brandSearchCalls += 1;
        return [];
      },
      searchProjects: async () => {
        projectSearchCalls += 1;
        return [];
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-primary-hit-stops',
      message: '你帮我查下肯德基相关的岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.results?.[0]?.jobBasicInfoId, 1914);
    assert.equal(brandSearchCalls, 0);
    assert.equal(projectSearchCalls, 0);
  });

  it('returns no matches only after exhausting planned job-name, brand, and project candidates', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        return { result: [], total: 0 };
      },
      searchBrands: async () => [{ id: 10024, name: '果蔬好', raw: {} }],
      searchProjects: async () => [{ id: 598, name: '京津果蔬好', raw: {} }],
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-no-result-after-plan',
      message: '你查下果蔬好岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal(response.results?.length, 0);
    assert.equal(capturedParams.length, 3);
    assert.equal((capturedParams[0] as { searchJobName?: string }).searchJobName, '果蔬好');
    assert.deepEqual((capturedParams[1] as { brandIds?: number[] }).brandIds, [10024]);
    assert.deepEqual((capturedParams[2] as { projectIds?: number[] }).projectIds, [598]);
    assert.match(response.reply, /已尝试：岗位名称包含“果蔬好”、品牌“果蔬好”、项目“果蔬好”/);
  });

  it('uses project id when the user explicitly asks for positions under a project', async () => {
    let capturedParams: unknown;
    const apiClient = {
      searchProjects: async (name: string) => {
        assert.equal(name, '上海肯德基');
        return [{ id: 591, name: '上海肯德基', raw: {} }];
      },
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return {
          result: [
            {
              id: '1914',
              jobBasicInfoId: 1914,
              positionName: '肯德基修改测试2-静安寺修改2-工时初始化测试5-全职',
              projectName: '上海肯德基',
              brandName: '肯德基修改测试2',
              status: 'published',
              salaryText: '3000元/天',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-project-scope',
      message: '你查下上海肯德基项目下的所有已发布岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.deepEqual((capturedParams as { projectIds?: number[] }).projectIds, [591]);
    assert.deepEqual((capturedParams as { statuses?: number[] }).statuses, [1]);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, undefined);
    assert.match(response.reply, /1914/);
  });

  it('falls back to brand search when city plus implicit job name returns no positions', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      getProvinceList: async () => [
        {
          id: 310000,
          name: '上海市',
          children: [
            {
              id: 310100,
              name: '上海市',
              children: [{ id: 310101, name: '黄浦区' }],
            },
          ],
        },
      ],
      searchBrands: async (name: string) => {
        assert.equal(name, '果蔬好');
        return [{ id: 10024, name: '果蔬好', raw: {} }];
      },
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        if ((params as { brandIds?: number[] }).brandIds?.length) {
          return {
            result: [
              {
                id: '1909',
                jobBasicInfoId: 1909,
                positionName: '果蔬好-人民广场店-工时初始化测试5（复制）（复制）-兼职',
                projectName: '京津果蔬好',
                brandName: '果蔬好',
                status: 'published',
                salaryText: '3000元/天',
                requirementNum: 1,
              },
            ],
            total: 1,
          };
        }
        return { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-brand-fallback',
      message: '你帮我看下上海的果蔬好岗位都有哪些',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal(response.results?.[0]?.jobBasicInfoId, 1909);
    assert.equal(capturedParams.length, 2);
    assert.deepEqual((capturedParams[0] as { cityIdList?: number[] }).cityIdList, [310100]);
    assert.equal((capturedParams[0] as { searchJobName?: string }).searchJobName, '果蔬好');
    assert.deepEqual((capturedParams[1] as { brandIds?: number[] }).brandIds, [10024]);
    assert.deepEqual((capturedParams[1] as { cityIdList?: number[] }).cityIdList, [310100]);
    assert.equal((capturedParams[1] as { searchJobName?: string }).searchJobName, undefined);
    assert.deepEqual(response.usedTools, [
      'position.getProvinceList',
      'position.getJobList',
      'position.searchBrands',
      'position.getJobList',
    ]);
  });

  it('falls back to brand search for generic "all positions" wording', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      searchBrands: async (name: string) => {
        assert.equal(name, '果蔬好');
        return [{ id: 10024, name: '果蔬好', raw: {} }];
      },
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        if ((params as { brandIds?: number[] }).brandIds?.length) {
          return {
            result: [
              {
                id: '1909',
                jobBasicInfoId: 1909,
                positionName: '果蔬好-人民广场店-工时初始化测试5（复制）（复制）-兼职',
                projectName: '京津果蔬好',
                brandName: '果蔬好',
                status: 'published',
                salaryText: '3000元/天',
                requirementNum: 1,
              },
            ],
            total: 1,
          };
        }
        return { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-all-brand-fallback',
      message: '你帮我查下果蔬好的所有岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal(response.results?.[0]?.jobBasicInfoId, 1909);
    assert.equal((capturedParams[0] as { searchJobName?: string }).searchJobName, '果蔬好');
    assert.deepEqual((capturedParams[1] as { brandIds?: number[] }).brandIds, [10024]);
  });

  it('falls back to project search when implicit job name returns no positions', async () => {
    const capturedParams: unknown[] = [];
    const apiClient = {
      searchBrands: async () => [],
      searchProjects: async (name: string) => {
        assert.equal(name, '长阳创谷');
        return [{ id: 66, name: '长阳创谷13131111111', raw: {} }];
      },
      getJobList: async (params: unknown) => {
        capturedParams.push(params);
        if ((params as { projectIds?: number[] }).projectIds?.length) {
          return {
            result: [
              {
                id: '1873',
                jobBasicInfoId: 1873,
                positionName: '老乡鸡2-测试111-新建测试011再来测试下同步小程序3-小时工',
                projectName: '长阳创谷13131111111',
                brandName: '测试品牌oy',
                status: 'published',
                salaryText: '200元/月',
                requirementNum: 4,
              },
            ],
            total: 1,
          };
        }
        return { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-project-fallback',
      message: '查下长阳创谷岗位都有哪些',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal(response.results?.[0]?.jobBasicInfoId, 1873);
    assert.equal(capturedParams.length, 2);
    assert.equal((capturedParams[0] as { searchJobName?: string }).searchJobName, '长阳创谷');
    assert.deepEqual((capturedParams[1] as { projectIds?: number[] }).projectIds, [66]);
    assert.equal((capturedParams[1] as { searchJobName?: string }).searchJobName, undefined);
    assert.deepEqual(response.usedTools, [
      'position.getJobList',
      'position.searchBrands',
      'position.searchProjects',
      'position.getJobList',
    ]);
  });

  it('searches status-only position wording without requiring an explicit query verb', async () => {
    let capturedParams: unknown;
    const apiClient = {
      getJobList: async (params: unknown) => {
        capturedParams = params;
        return { result: [], total: 0 };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-status-only',
      message: '已发布岗位有哪些',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.deepEqual((capturedParams as { statuses?: number[] }).statuses, [1]);
  });

  it('searches by full position name before loading details when the name contains digits', async () => {
    const calledTools: string[] = [];
    let capturedParams: unknown;
    const apiClient = {
      getProvinceList: async () => [
        {
          id: 310000,
          name: '上海市',
          children: [
            {
              id: 310100,
              name: '上海市',
              children: [{ id: 310104, name: '徐汇区' }],
            },
          ],
        },
      ],
      getJobList: async (params: unknown) => {
        calledTools.push('getJobList');
        capturedParams = params;
        return {
          result: [
            {
              id: '1915',
              jobBasicInfoId: 1915,
              positionName: 'test050900-上海徐汇绿地店-迎宾-小时工',
              projectName: 'P051901',
              brandName: 'test051901',
              status: 'published',
              salaryText: '22元/时',
              requirementNum: 3,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-detail-by-name',
      message: 'test050900-上海徐汇绿地店-迎宾-小时工这个岗位看下详情',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, 'test050900-上海徐汇绿地店-迎宾-小时工');
    assert.equal((capturedParams as { jobBasicInfoIds?: number[] }).jobBasicInfoIds, undefined);
    assert.deepEqual(calledTools, ['getJobList', 'getJobDetail:1915']);
    assert.match(response.reply, /岗位详情：1915/);
    assert.deepEqual(response.usedTools, ['position.getProvinceList', 'position.getJobList', 'position.getJobDetail']);
  });

  it('does not route edit-like position names to edit preview', async () => {
    const calledTools: string[] = [];
    let capturedParams: unknown;
    const apiClient = {
      getJobList: async (params: unknown) => {
        calledTools.push('getJobList');
        capturedParams = params;
        return {
          result: [
            {
              id: '2019',
              jobBasicInfoId: 2019,
              positionName: 'test051901-五店-修改等待通知测试2-全职',
              projectName: 'P051901',
              brandName: 'test051901',
              status: 'published',
              salaryText: '5000元/月',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-edit-like-name-detail',
      message: 'test051901-五店-修改等待通知测试2-全职 看下这个岗位信息',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, 'test051901-五店-修改等待通知测试2-全职');
    assert.deepEqual(calledTools, ['getJobList', 'getJobDetail:2019']);
    assert.match(response.reply, /岗位详情：2019/);
    assert.doesNotMatch(response.reply, /请提供要编辑的岗位 ID/);
  });

  it('loads details for trailing position names after this-position wording', async () => {
    const calledTools: string[] = [];
    let capturedParams: unknown;
    const apiClient = {
      getJobList: async (params: unknown) => {
        calledTools.push('getJobList');
        capturedParams = params;
        return {
          result: [
            {
              id: '2019',
              jobBasicInfoId: 2019,
              positionName: 'test051901-五店-修改等待通知测试2-全职',
              projectName: 'P051901',
              brandName: 'test051901',
              status: 'published',
              salaryText: '5000元/月',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-trailing-name-detail',
      message: '你帮我看下这个岗位的信息 test051901-五店-修改等待通知测试2-全职',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, false);
    assert.equal((capturedParams as { searchJobName?: string }).searchJobName, 'test051901-五店-修改等待通知测试2-全职');
    assert.deepEqual(calledTools, ['getJobList', 'getJobDetail:2019']);
    assert.match(response.reply, /岗位详情：2019/);
    assert.doesNotMatch(response.reply, /请提供至少一个岗位查询条件/);
  });

  it('asks the user to pick a job id when a detail-by-name search matches multiple positions', async () => {
    const apiClient = {
      getJobList: async () => ({
        result: [
          {
            id: '1909',
            jobBasicInfoId: 1909,
            positionName: '肯德基-门店A-服务员-兼职',
            projectName: '上海肯德基',
            brandName: '肯德基',
            status: 'published',
            requirementNum: 1,
          },
          {
            id: '1910',
            jobBasicInfoId: 1910,
            positionName: '肯德基-门店B-服务员-兼职',
            projectName: '上海肯德基',
            brandName: '肯德基',
            status: 'published',
            requirementNum: 1,
          },
        ],
        total: 2,
      }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-detail-by-name-multiple',
      message: '肯德基服务员岗位看下详情',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.equal(response.needsClarification, true);
    assert.match(response.reply, /匹配到多条岗位，请指定岗位 ID 查看详情/);
    assert.match(response.reply, /1909/);
    assert.match(response.reply, /1910/);
  });

  it('uses the latest single position search result when user asks for details', async () => {
    const calledTools: string[] = [];
    const apiClient = {
      getJobList: async () => {
        calledTools.push('getJobList');
        return {
          result: [
            {
              id: '1914',
              jobBasicInfoId: 1914,
              positionName: '肯德基修改测试2-静安寺修改2-工时初始化测试5-全职',
              projectName: '上海肯德基',
              brandName: '肯德基修改测试2',
              status: 'published',
              salaryText: '3000元/天',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return {
          jobBasicInfoId,
          requirement: {
            basicInfo: {
              project: { projectId: 591, projectName: '上海肯德基' },
              brand: { brandId: 10029, brandName: '肯德基修改测试2' },
              jobName: '肯德基修改测试2-静安寺修改2-工时初始化测试5-全职',
              jobNickName: '工时初始化测试5',
              jobType: 12,
              jobContent: '测试下',
              laborForm: 2,
              haveProbation: '1',
              cooperationMode: '4',
              needProbationWork: '0',
              needTraining: '0',
            },
            salaryWelfare: {
              jobSalaries: [
                {
                  type: 0,
                  salaryPeriod: '1',
                  daySalaryPeriodTime: '1',
                  salary: 3000,
                  salaryUnit: '1',
                  minComprehensiveSalary: 40000,
                  maxComprehensiveSalary: 50000,
                  comprehensiveSalaryUnit: '1',
                },
              ],
              jobWelfare: {
                haveInsurance: '2',
                insuranceFund: ['1', '2', '3', '4', '5', '6'],
              },
            },
            hiringRequirement: {
              minAge: 30,
              maxAge: 100,
              genderIds: ['1', '2'],
              educationId: '1',
              figureId: '0',
            },
            workTimeArrangement: {
              weekMonthArrangementMode: '1',
              perWeekWorkDays: 2,
              perWeekRestDays: 2,
              weekMonthRestMode: '2',
              arrangementType: '2',
              perDayMinWorkHours: 4,
              goToWorkStartTime: 25200,
              goOffWorkStartTime: 68400,
            },
            processRequirement: {
              interviewTotal: '1',
              interviewTimeMode: '1',
              firstInterviewWay: '3',
              firstInterviewDesc: '1121',
            },
            storeRequirement: {
              jobStores: [
                {
                  id: 'store-1',
                  storeId: 1,
                  storeName: '静安寺修改2',
                  requirementNum: 1,
                  thresholdNum: 30,
                },
              ],
            },
          },
        };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-detail-context',
      message: '你再检查下1914的岗位信息',
      channel: 'test',
    });

    const response = await service.chat({
      sessionId: 's-detail-context',
      message: '将详细信息列给我',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.deepEqual(calledTools, ['getJobList', 'getJobDetail:1914']);
    assert.match(response.reply, /岗位详情：1914/);
    assert.match(response.reply, /工时初始化测试5/);
    assert.match(response.reply, /### 用工概览/);
    assert.match(response.reply, /### 基础信息/);
    assert.match(response.reply, /### 薪资福利/);
    assert.doesNotMatch(response.reply, /\| 字段 \| 值 \|/);
    assert.deepEqual(response.usedTools, ['position.getJobDetail']);

    const editResponse = await service.chat({
      sessionId: 's-detail-context',
      message: '把薪资改为25元/时',
      channel: 'test',
    });

    assert.equal(editResponse.intent, 'edit_preview');
    assert.equal(calledTools.at(-1), 'getJobDetail:1914');
    assert.ok(editResponse.diff?.some(item => item.field === 'baseSalary'));
    assert.match(editResponse.reply, /以下是修改后的岗位信息，请确认/);
    assert.match(editResponse.reply, /### 薪资福利/);
    assert.match(editResponse.reply, /变更说明：/);
    assert.match(editResponse.reply, /基本薪资由3000调整为25/);
    assert.doesNotMatch(editResponse.reply, /\| 字段 \| 值 \|/);
  });

  it('loads detail by explicit id without invoking the search planner or list search', async () => {
    const calledTools: string[] = [];
    let plannerCalled = false;
    const searchPlanner: PositionSearchPlanner = {
      async planSearch() {
        plannerCalled = true;
        return {
          shouldSearchPosition: true,
          searchJobName: '不应该使用',
        };
      },
    };
    const apiClient = {
      getJobList: async () => {
        throw new Error('getJobList should not be called');
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      searchPlanner,
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-direct-detail-id',
      message: '看下1914的详情',
      channel: 'test',
    });

    assert.equal(plannerCalled, false);
    assert.deepEqual(calledTools, ['getJobDetail:1914']);
    assert.equal(response.intent, 'search');
    assert.deepEqual(response.usedTools, ['position.getJobDetail']);
    assert.match(response.reply, /岗位详情：1914/);
  });

  it('renders position details semantically instead of exposing raw internal codes', async () => {
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => ({
        jobBasicInfoId,
        requirement: {
          basicInfo: {
            project: { projectId: 598, projectName: '京津果蔬好' },
            brand: { brandId: 10024, brandName: '果蔬好' },
            jobName: '果蔬好-人民广场店-工时初始化测试5（复制）（复制）-兼职',
            jobNickName: '工时初始化测试5（复制）（复制）',
            jobType: 12,
            jobContent: '测试下',
            laborForm: 1,
            cooperationMode: '4',
            needProbationWork: '0',
            needTraining: '0',
          },
          salaryWelfare: {
            jobSalaries: [
              {
                type: 0,
                salaryPeriod: '1',
                daySalaryPeriodTime: '1',
                salary: 3000,
                salaryUnit: '1',
                minComprehensiveSalary: 40000,
                maxComprehensiveSalary: 50000,
                comprehensiveSalaryUnit: '1',
              },
            ],
            jobWelfare: {
              haveInsurance: '1',
            },
          },
          hiringRequirement: {
            minAge: 30,
            maxAge: 100,
            genderIds: ['1', '2'],
            educationId: '1',
            figureId: '0',
          },
          processRequirement: {
            interviewTotal: '1',
            interviewTimeMode: '1',
            firstInterviewWay: '3',
            firstInterviewDesc: '1121',
            onWorkClothingExplain: '21',
          },
          storeRequirement: {
            jobStores: [
              {
                id: 'store-1',
                storeId: 1,
                storeName: '人民广场店',
                storeExactAddress: '上海市黄浦区南京东路街道成都北路333号东703室',
                requirementNum: 1,
                thresholdNum: 15,
              },
            ],
          },
        },
      }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-semantic-detail',
      message: '查看岗位 ID 1909 的详细信息',
      channel: 'test',
    });

    assert.equal(response.intent, 'search');
    assert.match(response.reply, /用工形式：兼职/);
    assert.match(response.reply, /职位类别：职位类别ID 12/);
    assert.doesNotMatch(response.reply, /兼职类型：1/);
    assert.doesNotMatch(response.reply, /仪容仪表：21/);
  });

  it('creates a new preview by inheriting an existing position detail', async () => {
    const createdPayloads: Record<string, unknown>[] = [];
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => createCompleteDetail(jobBasicInfoId),
      createJob: async (payload: Record<string, unknown>) => {
        createdPayloads.push(payload);
        return true;
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const preview = await service.chat({
      sessionId: 's-inherit-create',
      message: '照着岗位 ID 1909 新建一个岗位，把招聘人数改为5人',
      channel: 'test',
    });

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.deepEqual(preview.usedTools, ['position.getJobDetail']);
    assert.match(preview.reply, /以下是修改后的岗位信息，请确认/);
    assert.match(preview.reply, /招聘门店：人民广场店；招聘 5 人/);
    assert.ok(preview.diff?.some(item => item.field === 'recruitStoreAllocations'));

    const committed = await service.chat({
      sessionId: 's-inherit-create',
      message: '确认保存',
      channel: 'test',
    });

    assert.equal(committed.intent, 'commit');
    assert.equal(createdPayloads.length, 1);
    const requirement = createdPayloads[0].jobRequirement as Record<string, unknown>;
    const basicInfo = requirement.basicInfo as Record<string, unknown>;
    const storeRequirement = requirement.storeRequirement as { jobStores?: Array<Record<string, unknown>> };
    assert.equal(basicInfo.id, undefined);
    assert.equal(storeRequirement.jobStores?.[0]?.requirementNum, 5);
  });

  it('inherits from the focused position when user says current position', async () => {
    const calledIds: number[] = [];
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => {
        calledIds.push(jobBasicInfoId);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-inherit-context',
      message: '查看岗位 ID 1909 的详细信息',
      channel: 'test',
    });

    const preview = await service.chat({
      sessionId: 's-inherit-context',
      message: '照着这个岗位新建，把招聘人数改为5人',
      channel: 'test',
    });

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.deepEqual(calledIds, [1909, 1909]);
    assert.match(preview.reply, /招聘门店：人民广场店；招聘 5 人/);
  });

  it('applies a source position to an incomplete create draft while preserving user fields', async () => {
    const calledIds: number[] = [];
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => {
        calledIds.push(jobBasicInfoId);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const first = await service.chat({
      sessionId: 's-apply-source-to-draft',
      message: '我现在要新建一个岗位，我现在要招两名女性，年龄在20-40之间',
      channel: 'test',
    });

    assert.equal(first.intent, 'create_preview');
    assert.equal(first.needsClarification, true);

    const preview = await service.chat({
      sessionId: 's-apply-source-to-draft',
      message: '其他信息要跟1914一致就可以',
      channel: 'test',
    });

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.deepEqual(calledIds, [1914]);
    assert.match(preview.reply, /招聘门店：人民广场店；招聘 2 人/);
    assert.match(preview.reply, /年龄：20-40岁/);
    assert.match(preview.reply, /性别：女性/);
    assert.match(preview.reply, /变更说明：/);
  });

  it('does not suggest a focused position as a template when create entities are missing', async () => {
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => createCompleteDetail(jobBasicInfoId),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-suggest-context-source',
      message: '查看岗位 ID 1909 的详细信息',
      channel: 'test',
    });

    const response = await service.chat({
      sessionId: 's-suggest-context-source',
      message: '我现在要新建一个岗位，我现在要招两名女性，年龄在20-40之间',
      channel: 'test',
    });

    assert.equal(response.intent, 'create_preview');
    assert.equal(response.needsClarification, true);
    assert.match(response.reply, /当前不能保存的问题/);
    assert.match(response.reply, /请补充项目/);
    assert.match(response.reply, /请补充品牌/);
    assert.match(response.reply, /请补充当前项目、品牌下已存在的招聘门店/);
    assert.doesNotMatch(response.reply, /刚查看过岗位 ID 1909/);
  });

  it('does not auto-inherit from a similar position when create entities are missing', async () => {
    const calledTools: string[] = [];
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      getJobList: async (params: { searchJobName?: string }) => {
        calledTools.push(`getJobList:${params.searchJobName}`);
        return {
          result: [
            {
              id: '1909',
              jobBasicInfoId: 1909,
              positionName: '果蔬好-人民广场店-理货员-兼职',
              projectName: '京津果蔬好',
              brandName: '果蔬好',
              status: 'published',
              requirementNum: 1,
            },
          ],
          total: 1,
        };
      },
      getJobDetail: async (jobBasicInfoId: number) => {
        calledTools.push(`getJobDetail:${jobBasicInfoId}`);
        return createCompleteDetail(jobBasicInfoId);
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const preview = await service.chat({
      sessionId: 's-auto-source-by-name',
      message: '新建一个果蔬好理货员岗位，招聘2人',
      channel: 'test',
    });

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, false);
    assert.deepEqual(calledTools, []);
    assert.equal(draftStore.getBySession('s-auto-source-by-name')?.values.positionName, '果蔬好理货员');
    assert.match(preview.reply, /请补充项目/);
    assert.match(preview.reply, /请补充品牌/);
    assert.match(preview.reply, /请补充当前项目、品牌下已存在的招聘门店/);
  });

  it('requires supplier notification choice before publishing and then commits', async () => {
    const createdPayloads: Record<string, unknown>[] = [];
    const apiClient = {
      searchStores: async () => [
        {
          id: 1,
          name: '人民广场店',
          raw: {},
        },
      ],
      createJob: async (payload: Record<string, unknown>) => {
        createdPayloads.push(payload);
        return true;
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });
    const message = `新建岗位 ${JSON.stringify(createCompleteValues())}`;

    const preview = await service.chat({
      sessionId: 's1',
      message,
      channel: 'test',
    });
    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);

    const publishClarify = await service.chat({
      sessionId: 's1',
      message: '确认发布',
      channel: 'test',
    });
    assert.equal(publishClarify.intent, 'clarify');
    assert.equal(publishClarify.needsConfirmation, true);
    assert.match(publishClarify.reply, /是否通知供应商/);

    const committed = await service.chat({
      sessionId: 's1',
      message: '不通知供应商并发布',
      channel: 'test',
    });
    assert.equal(committed.intent, 'commit');
    assert.equal(committed.needsConfirmation, false);
    assert.equal(createdPayloads.length, 1);
    assert.equal(createdPayloads[0].immediate, 1);
    assert.equal(createdPayloads[0].sendMsgToSupplier, false);
  });

  it('shows only blocking issues before full preview when edited values are incomplete', async () => {
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => ({
        jobBasicInfoId,
        requirement: {
          basicInfo: {
            project: { projectId: 591, projectName: '上海肯德基' },
            brand: { brandId: 10029, brandName: '肯德基修改测试2' },
            jobName: '肯德基修改测试2-静安寺修改2-工时初始化测试5-全职',
            jobNickName: '工时初始化测试5',
            jobType: 12,
            jobContent: '测试下',
            laborForm: 2,
            haveProbation: '1',
            cooperationMode: '4',
            needProbationWork: '0',
            needTraining: '0',
          },
          salaryWelfare: {
            jobSalaries: [
              {
                type: 0,
                salaryPeriod: '1',
                daySalaryPeriodTime: '1',
                salary: 3000,
                salaryUnit: '1',
                minComprehensiveSalary: 40000,
                maxComprehensiveSalary: 50000,
                comprehensiveSalaryUnit: '1',
              },
            ],
            jobWelfare: {
              haveInsurance: '2',
              insuranceFund: ['1', '2', '3', '4', '5', '6'],
            },
          },
          hiringRequirement: {
            minAge: 30,
            maxAge: 100,
            genderIds: ['1', '2'],
            educationId: '1',
            figureId: '0',
          },
          workTimeArrangement: {
            weekMonthArrangementMode: '1',
            perWeekWorkDays: 2,
            perWeekRestDays: 2,
            weekMonthRestMode: '2',
            arrangementType: '2',
            perDayMinWorkHours: 4,
            goToWorkStartTime: 25200,
            goOffWorkStartTime: 68400,
          },
          processRequirement: {
            interviewTotal: '1',
            interviewTimeMode: '1',
            firstInterviewWay: '3',
            firstInterviewDesc: '1121',
          },
          storeRequirement: {
            jobStores: [
              {
                id: 'store-1',
                storeId: 1,
                storeName: '静安寺修改2',
                requirementNum: 1,
                thresholdNum: 30,
              },
            ],
          },
        },
      }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const response = await service.chat({
      sessionId: 's-incomplete-edit',
      message: '编辑岗位 ID 1914，把用工形式改为兼职',
      channel: 'test',
    });

    assert.equal(response.intent, 'edit_preview');
    assert.equal(response.needsClarification, true);
    assert.match(response.reply, /当前还有必填项或校验问题/);
    assert.match(response.reply, /当前不能保存的问题/);
    assert.match(response.reply, /兼职类型/);
    assert.match(response.reply, /至少上岗月/);
    assert.match(response.reply, /变更说明：/);
    assert.doesNotMatch(response.reply, /以下是修改后的岗位信息，请确认/);
    assert.doesNotMatch(response.reply, /### 薪资福利/);
  });

  it('keeps recruitment count changes while user fills missing edit fields', async () => {
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => ({
        jobBasicInfoId,
        requirement: {
          basicInfo: {
            project: { projectId: 591, projectName: '上海肯德基' },
            brand: { brandId: 10029, brandName: '肯德基修改测试2' },
            jobName: '肯德基修改测试2-静安寺修改2-工时初始化测试5-全职',
            jobNickName: '工时初始化测试5',
            jobType: 12,
            jobContent: '测试下',
            laborForm: 2,
            haveProbation: '1',
            cooperationMode: '4',
            needProbationWork: '0',
            needTraining: '0',
          },
          salaryWelfare: {
            jobSalaries: [
              {
                type: 0,
                salaryPeriod: '1',
                daySalaryPeriodTime: '1',
                salary: 3000,
                salaryUnit: '1',
                minComprehensiveSalary: 40000,
                maxComprehensiveSalary: 50000,
                comprehensiveSalaryUnit: '1',
              },
            ],
            jobWelfare: {
              haveInsurance: '2',
              insuranceFund: ['1', '2', '3', '4', '5', '6'],
            },
          },
          hiringRequirement: {
            minAge: 30,
            maxAge: 100,
            genderIds: ['1', '2'],
            educationId: '1',
            figureId: '0',
          },
          workTimeArrangement: {
            weekMonthArrangementMode: '1',
            perWeekWorkDays: 2,
            perWeekRestDays: 2,
            weekMonthRestMode: '2',
            arrangementType: '2',
            perDayMinWorkHours: 4,
            goToWorkStartTime: 25200,
            goOffWorkStartTime: 68400,
          },
          processRequirement: {
            interviewTotal: '1',
            interviewTimeMode: '1',
            firstInterviewWay: '3',
            firstInterviewDesc: '1121',
          },
          storeRequirement: {
            jobStores: [
              {
                id: 'store-1',
                storeId: 1,
                storeName: '静安寺修改2',
                requirementNum: 1,
                thresholdNum: 30,
              },
            ],
          },
        },
      }),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const first = await service.chat({
      sessionId: 's-recruit-count-edit',
      message: '编辑岗位 ID 1914，帮我把招聘人数改成5人，并且用工形式改成兼职吧',
      channel: 'test',
    });

    assert.equal(first.intent, 'edit_preview');
    assert.equal(first.needsClarification, true);
    assert.ok(first.diff?.some(item => item.field === 'recruitStoreAllocations'));

    const second = await service.chat({
      sessionId: 's-recruit-count-edit',
      message: '兼职类型选小时工，至少上岗6个月吧',
      channel: 'test',
    });

    assert.equal(second.intent, 'edit_preview');
    assert.equal(second.needsConfirmation, true);
    assert.match(second.reply, /招聘门店：静安寺修改2；招聘 5 人；阈值 3倍/);
    assert.ok(second.diff?.some(item => item.field === 'recruitStoreAllocations'));
  });

  it('asks what to modify when user requests another edit without fields on a pending preview', async () => {
    const service = new PositionService({
      config: baseConfig,
      positionApiClient: {
        searchStores: async () => [
          {
            id: 1,
            name: '人民广场店',
            raw: {},
          },
        ],
      } as unknown as PositionApiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    const preview = await service.chat({
      sessionId: 's-second-edit',
      message: `新建岗位 ${JSON.stringify(createCompleteValues())}`,
      channel: 'test',
    });
    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);

    const response = await service.chat({
      sessionId: 's-second-edit',
      message: '再帮我修改下这个岗位',
      channel: 'test',
    });

    assert.equal(response.intent, 'clarify');
    assert.equal(response.needsClarification, true);
    assert.equal(response.draftId, preview.draftId);
    assert.match(response.reply, /继续修改，请直接告诉我要改哪些信息/);
    assert.doesNotMatch(response.reply, /以下是修改后的岗位信息，请确认/);
    assert.doesNotMatch(response.reply, /确认无误后/);
  });

  it('keeps pending draft context when user asks what is still missing', async () => {
    const service = new PositionService({
      config: baseConfig,
      positionApiClient: {} as PositionApiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });

    await service.chat({
      sessionId: 's-missing',
      message: '新建岗位 {"positionName":"服务员"}',
      channel: 'test',
    });

    const response = await service.chat({
      sessionId: 's-missing',
      message: '还需要补充哪些',
      channel: 'test',
    });

    assert.equal(response.intent, 'clarify');
    assert.equal(response.needsClarification, true);
    assert.match(response.reply, /当前岗位预览还需要补充以下内容/);
    assert.ok(response.missingFields?.some(item => item.field === 'projectId'));
  });
});
