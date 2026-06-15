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
import { buildPositionFormValuesFromDetail } from './client.ts';
import { PositionService } from './service.ts';
import type { PositionApiClient } from './client.ts';
import type { PositionCreatePlanner, PositionCreatePlanningResult, PositionSearchPlanner } from './planner.ts';
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

function createUserPerspectivePlan(
  overrides: Partial<PositionCreatePlanningResult> = {},
): PositionCreatePlanningResult {
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
    dailyWorkDuration: 6,
    baseSalary: 25,
    baseSalaryUnit: '4',
    salaryMin: 150,
    salaryMax: 180,
    salaryRangeUnit: '1',
    settlementCycle: '1',
    payDay: '1',
    minWorkMonths: 3,
    ...overrides,
  };
}

function createUserPerspectiveHarness(input: {
  plans?: Record<string, PositionCreatePlanningResult | undefined>;
  candidates?: Array<Record<string, unknown>>;
}) {
  const createdPayloads: Record<string, unknown>[] = [];
  const listCalls: string[] = [];
  const storeSearchCalls: Array<{ searchName?: string; projectIds?: number[]; brandIds?: number[] }> = [];
  const plans = input.plans ?? {};
  const createPlanner: PositionCreatePlanner = {
    async planCreate({ message }) {
      return plans[message];
    },
  };

  const projects = [
    {
      id: 101,
      name: '上海生鲜项目',
      raw: {
        brands: [
          { brandId: 202, brandName: '果蔬好' },
          { brandId: 203, brandName: '咖茶' },
        ],
      },
    },
    {
      id: 102,
      name: '北京餐饮项目',
      raw: {
        brands: [{ brandId: 204, brandName: '麦香堡' }],
      },
    },
  ];
  const brands = [
    { id: 202, name: '果蔬好', raw: {} },
    { id: 203, name: '咖茶', raw: {} },
    { id: 204, name: '麦香堡', raw: {} },
  ];
  const stores = [
    { id: 303, name: '人民广场店', projectId: 101, brandId: 202, address: '上海市黄浦区', exactAddress: '人民广场1号' },
    { id: 304, name: '徐家汇店', projectId: 101, brandId: 202, address: '上海市徐汇区', exactAddress: '漕溪北路1号' },
    { id: 305, name: '静安寺店', projectId: 101, brandId: 202, address: '上海市静安区', exactAddress: '南京西路100号' },
    { id: 306, name: '陆家嘴店', projectId: 101, brandId: 202, address: '上海市浦东新区', exactAddress: '世纪大道8号' },
    { id: 307, name: '中关村店', projectId: 102, brandId: 204, address: '北京市海淀区', exactAddress: '中关村大街1号' },
    { id: 308, name: '南京东路店', projectId: 101, brandId: 202, address: '上海市黄浦区', exactAddress: '南京东路88号' },
    { id: 309, name: '淮海路店', projectId: 101, brandId: 202, address: '上海市黄浦区', exactAddress: '淮海中路99号' },
    { id: 310, name: '五角场店', projectId: 101, brandId: 202, address: '上海市杨浦区', exactAddress: '淞沪路10号' },
    { id: 403, name: '人民广场店', projectId: 598, brandId: 10024, address: '上海市黄浦区', exactAddress: '人民广场1号' },
    { id: 404, name: '徐家汇店', projectId: 598, brandId: 10024, address: '上海市徐汇区', exactAddress: '漕溪北路1号' },
    { id: 406, name: '陆家嘴店', projectId: 598, brandId: 10024, address: '上海市浦东新区', exactAddress: '世纪大道8号' },
  ];
  const candidates =
    input.candidates ??
    [
      {
        id: '1909',
        jobBasicInfoId: 1909,
        positionName: '果蔬好-人民广场店-理货员-兼职',
        projectName: '上海生鲜项目',
        brandName: '果蔬好',
        status: 'published',
        requirementNum: 2,
      },
    ];

  const apiClient = {
    searchProjects: async (query: string) =>
      projects.filter(project => project.name.includes(query) || query.includes(project.name)),
    searchBrands: async (query: string) =>
      brands.filter(brand => brand.name.includes(query) || query.includes(brand.name)),
    searchStores: async (params: { searchName?: string; projectIds?: number[]; brandIds?: number[] }) => {
      storeSearchCalls.push(params);
      return stores
        .filter(store => !params.projectIds?.length || params.projectIds.includes(store.projectId))
        .filter(store => !params.brandIds?.length || params.brandIds.includes(store.brandId))
        .filter(store => !params.searchName || store.name.includes(params.searchName) || params.searchName.includes(store.name))
        .map(store => ({
          id: store.id,
          name: store.name,
          raw: {
            address: store.address,
            exactAddress: store.exactAddress,
          },
        }));
    },
    getJobTypes: async () => [
      { id: 12, name: '理货员', raw: {} },
      { id: 13, name: '服务员', raw: {} },
      { id: 14, name: '收银员', raw: {} },
      { id: 15, name: '分拣员', raw: {} },
      { id: 16, name: '咖啡师', raw: {} },
    ],
    getJobTemplateByJobType: async (jobTypeId: number) => ({
      jobContent:
        jobTypeId === 13
          ? '负责门店服务、接待顾客和基础清洁。'
          : jobTypeId === 14
            ? '负责收银结算、票据核对和顾客引导。'
            : jobTypeId === 16
              ? '负责饮品制作、出品和吧台清洁。'
              : '负责商品陈列、补货、理货和货架维护。',
    }),
    getJobList: async (params: { searchJobName?: string }) => {
      listCalls.push(params.searchJobName ?? '');
      if (!params.searchJobName) {
        return { result: [], total: 0 };
      }
      return { result: candidates, total: candidates.length };
    },
    getJobDetail: async (jobBasicInfoId: number) => createCompleteDetail(jobBasicInfoId),
    createJob: async (payload: Record<string, unknown>) => {
      createdPayloads.push(payload);
      return true;
    },
  } as unknown as PositionApiClient;

  return {
    createdPayloads,
    listCalls,
    storeSearchCalls,
    service: new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      createPlanner,
      logger: { warn: () => undefined } as never,
    }),
  };
}

type UserPerspectiveCreateCase = {
  name: string;
  messages: string[];
  commit: 'save' | 'publish' | 'publishWithSupplier';
  plans?: Record<string, PositionCreatePlanningResult | undefined>;
  candidates?: Array<Record<string, unknown>>;
  expectedNickName?: string;
  expectedPayloadCount?: number;
  expectedListCalls?: string[];
};

async function runSuccessfulUserCreateCases(cases: UserPerspectiveCreateCase[]) {
  for (const testCase of cases) {
    const harness = createUserPerspectiveHarness({
      plans: testCase.plans,
      candidates: testCase.candidates,
    });
    let response: Awaited<ReturnType<PositionService['chat']>> | undefined;
    let preCommitReply = '';

    for (const message of testCase.messages) {
      response = await harness.service.chat({
        sessionId: `s-user-create-${testCase.name}`,
        message,
        channel: 'test',
      });
    }
    preCommitReply = response?.reply ?? '';

    if (testCase.commit === 'publish' || testCase.commit === 'publishWithSupplier') {
      const publishClarify = await harness.service.chat({
        sessionId: `s-user-create-${testCase.name}`,
        message: '确认发布',
        channel: 'test',
      });
      assert.equal(publishClarify.needsConfirmation, true, testCase.name);
      assert.match(publishClarify.reply, /是否通知供应商/, testCase.name);
      response = await harness.service.chat({
        sessionId: `s-user-create-${testCase.name}`,
        message: testCase.commit === 'publishWithSupplier' ? '通知供应商并发布' : '不通知供应商并发布',
        channel: 'test',
      });
    } else {
      response = await harness.service.chat({
        sessionId: `s-user-create-${testCase.name}`,
        message: '确认保存',
        channel: 'test',
      });
    }

    assert.equal(response.intent, 'commit', `${testCase.name}: before commit: ${preCommitReply}\ncommit: ${response.reply}`);
    assert.equal(harness.createdPayloads.length, 1, testCase.name);
    if (testCase.expectedListCalls) {
      assert.deepEqual(harness.listCalls, testCase.expectedListCalls, testCase.name);
    }
    for (const storeCall of harness.storeSearchCalls) {
      assert.ok(storeCall.projectIds?.length, `${testCase.name}: store lookup must be project scoped`);
      assert.ok(storeCall.brandIds?.length, `${testCase.name}: store lookup must be brand scoped`);
    }

    const payload = harness.createdPayloads[0];
    const requirement = payload.jobRequirement as Record<string, unknown>;
    const basicInfo = requirement.basicInfo as Record<string, unknown>;
    const storeRequirement = requirement.storeRequirement as { jobStores?: Array<Record<string, unknown>> };
    assert.equal(basicInfo.jobName, '测试岗位名称', testCase.name);
    assert.equal(basicInfo.jobNickName, testCase.expectedNickName, testCase.name);
    assert.equal(
      storeRequirement.jobStores?.length,
      testCase.expectedPayloadCount ?? 1,
      `${testCase.name}: ${JSON.stringify(storeRequirement.jobStores)}`,
    );
    if (testCase.commit === 'publish') {
      assert.equal(payload.sendMsgToSupplier, false, testCase.name);
    }
    if (testCase.commit === 'publishWithSupplier') {
      assert.equal(payload.sendMsgToSupplier, true, testCase.name);
    }
  }
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

  it('cleans possessive particles from implicit position search names', () => {
    const parsed = parsePositionMessage('帮我查一下有哪些肯德基的岗位');

    assert.equal(parsed.intent, 'search');
    assert.equal(parsed.search.searchJobName, '肯德基');
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

  it('cleans name-label prefixes from brand references', () => {
    const parsed = parsePositionMessage('品牌名字为肯德基修改测试2');

    assert.equal(parsed.intent, 'clarify');
    assert.equal(parsed.references.brandName, '肯德基修改测试2');
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
    assert.equal(parsed.references.positionCategoryName, undefined);
    assert.equal(parsed.patch.positionName, '理货员');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.ageMin, 20);
    assert.equal(parsed.patch.ageMax, 40);
    assert.equal(parsed.patch.dailyScheduleMode, '2');
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '14:00']);
    assert.equal(parsed.patch.dailyWorkDuration, 6);
  });

  it('keeps composite create job nicknames separate from job type clarification', () => {
    const parsed = parsePositionMessage('帮我新建一个岗位 gt测试品牌-gt测试门店-gt测试agent1-兼职 的岗位');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.references.brandName, 'gt测试品牌');
    assert.deepEqual(parsed.references.storeNames, ['gt测试门店']);
    assert.equal(parsed.patch.positionName, 'gt测试agent1');
    assert.equal(parsed.patch.employmentType, 'part-time');
    assert.equal(parsed.references.positionCategoryName, undefined);
  });

  it('parses explicit job type clarification with connector words', () => {
    const parsed = parsePositionMessage('职位类别为普通服务员');

    assert.equal(parsed.intent, 'clarify');
    assert.equal(parsed.references.positionCategoryName, '普通服务员');
  });

  it('parses store-scoped create wording with an explicit nickname label', () => {
    const parsed = parsePositionMessage('在gt测试门店 下新建一个岗位，岗位名称是gt测试agent1…其他信息');

    assert.equal(parsed.intent, 'create_preview');
    assert.deepEqual(parsed.references.storeNames, ['gt测试门店']);
    assert.equal(parsed.patch.positionName, 'gt测试agent1');
    assert.equal(parsed.references.positionCategoryName, undefined);
    assert.equal(parsed.search.searchJobName, 'gt测试agent1');
  });

  it('parses create wording when the store scope appears after the create phrase', () => {
    const parsed = parsePositionMessage(
      '帮我新建一个岗位，在gt测试门店下，岗位名称是gt测试agent1，要求招聘2名兼职小时工，女性20到40岁，工作时间为8点 到12点',
    );

    assert.equal(parsed.intent, 'create_preview');
    assert.deepEqual(parsed.references.storeNames, ['gt测试门店']);
    assert.equal(parsed.patch.positionName, 'gt测试agent1');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(parsed.patch.employmentType, 'part-time');
    assert.equal(parsed.patch.partTimeType, '5');
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.ageMin, 20);
    assert.equal(parsed.patch.ageMax, 40);
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '12:00']);
    assert.equal(parsed.patch.dailyWorkDuration, 4);
  });

  it('parses store-scoped create wording when polite words appear after the store scope', () => {
    const parsed = parsePositionMessage(
      '在gt测试门店下帮我新建一个岗位，岗位名称是gt测试agent1，要求招聘2名兼职小时工，女性20到40岁，工作时间为8点 到\n12点',
    );

    assert.equal(parsed.intent, 'create_preview');
    assert.deepEqual(parsed.references.storeNames, ['gt测试门店']);
    assert.equal(parsed.patch.positionName, 'gt测试agent1');
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.recruitCount, 2);
    assert.equal(parsed.patch.employmentType, 'part-time');
    assert.equal(parsed.patch.partTimeType, '5');
    assert.deepEqual(parsed.patch.genders, ['2']);
    assert.equal(parsed.patch.ageMin, 20);
    assert.equal(parsed.patch.ageMax, 40);
    assert.deepEqual(parsed.patch.dailyTimeRange, ['08:00', '12:00']);
    assert.equal(parsed.patch.dailyWorkDuration, 4);
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

  it('does not treat explicit id labels as reference names', () => {
    const parsed = parsePositionMessage('新建岗位，项目ID101，品牌ID202，门店ID303，工种ID12，招2人');

    assert.equal(parsed.patch.projectId, 101);
    assert.equal(parsed.patch.brandId, 202);
    assert.equal(parsed.patch.positionCategory, 12);
    assert.equal(parsed.patch.recruitStoreAllocations?.[0]?.storeId, 303);
    assert.equal(parsed.references.projectName, undefined);
    assert.equal(parsed.references.brandName, undefined);
    assert.equal(parsed.references.positionCategoryName, undefined);
    assert.equal(parsed.references.storeNames, undefined);
  });

  it('treats publish-one wording as create preview instead of commit', () => {
    const parsed = parsePositionMessage('帮我发布一个上海生鲜项目果蔬好淮海路店咖啡师');

    assert.equal(parsed.intent, 'create_preview');
    assert.equal(parsed.action, 'publish');
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

  it('does not create empty nested configs while merging values', () => {
    const values = mergePositionValues(createDefaultPositionFormValues(), {
      genders: ['1', '2'],
      trainingRequired: '1',
    });

    assert.equal(values.maleRequirement, undefined);
    assert.equal(values.femaleRequirement, undefined);
    assert.equal(values.trainingSalaryConfig, undefined);
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
    const hiringRequirement = requirement.hiringRequirement as Record<string, unknown>;
    const storeRequirement = requirement.storeRequirement as Record<string, unknown>;

    assert.equal((basicInfo.project as Record<string, unknown>).projectId, 101);
    assert.equal((basicInfo.brand as Record<string, unknown>).brandId, 202);
    assert.equal(basicInfo.jobName, '测试岗位名称');
    assert.equal(basicInfo.jobNickName, '服务员');
    assert.equal(basicInfo.laborForm, 5);
    assert.equal(hiringRequirement.countryRequirementType, 0);
    assert.ok(Array.isArray(salaryWelfare.jobSalaries));
    assert.ok(Array.isArray((storeRequirement as { jobStores?: unknown[] }).jobStores));
  });

  it('preserves HM2.0 inherited salary, welfare and interview mappings in create payload', () => {
    const inheritedValues = buildPositionFormValuesFromDetail({
      jobBasicInfoId: 2102,
      requirement: {
        basicInfo: {
          project: { projectId: 604, projectName: 'gt测试项目' },
          brand: { brandId: 10031, brandName: 'gt测试品牌' },
          jobNickName: '理货员',
          jobType: 241,
          jobContent: '负责传菜。',
          laborForm: 5,
          cooperationMode: 4,
          needProbationWork: 1,
          needTraining: 1,
        },
        salaryWelfare: {
          jobSalaries: [
            {
              type: 0,
              salaryPeriod: 1,
              daySalaryPeriodTime: 1,
              salary: 150,
              salaryUnit: 4,
              haveStairSalary: 2,
              hasSpecialSalary: false,
              holidaySalary: 1,
              holidaySalaryMultiple: 3,
              overtimeSalary: 2,
              overtimeFixedSalary: 25,
              overtimeFixedSalaryUnit: 4,
              attendenceSalary: 500,
              attendenceSalaryUnit: 7,
              minComprehensiveSalary: 5000,
              maxComprehensiveSalary: 6000,
              comprehensiveSalaryUnit: 3,
            },
            {
              type: 2,
              salaryPeriod: 1,
              daySalaryPeriodTime: 1,
              salary: 120,
              salaryUnit: 4,
              haveStairSalary: 2,
              hasSpecialSalary: false,
              minComprehensiveSalary: 4000,
              maxComprehensiveSalary: 5000,
              comprehensiveSalaryUnit: 3,
            },
          ],
          jobProbationSalary: {
            salary: 150,
            salaryUnit: 1,
            otherSalaryDescription: '干满3天',
          },
          jobWelfare: {
            haveInsurance: 2,
            accommodation: 1,
            catering: 1,
            probationInsuranceReceive: 0,
            probationAccommodationSalaryReceive: 1,
            probationCateringSalaryReceive: 1,
          },
        },
        hiringRequirement: {
          minAge: 20,
          maxAge: 40,
          genderIds: [2, 1],
          manMinHeight: 170,
          manMaxHeight: 185,
          manMinWeight: 60,
          manMaxWeight: 80,
          womanMinHeight: 165,
          womanMaxHeight: 180,
          womanMinWeight: 40,
          womanMaxWeight: 70,
          figureId: 0,
          educationId: 1,
          marriageBearingType: 0,
          nativePlaceRequirementType: 0,
          nationRequirementType: 0,
          countryRequirementType: 2,
        },
        workTimeArrangement: {
          employmentForm: 1,
          maxWorkTakingTime: 20,
          minWorkMonths: 3,
          weekMonthArrangementMode: 1,
          perWeekWorkDays: 5,
          perWeekRestDays: 2,
          weekMonthRestMode: 1,
          arrangementType: 2,
          perDayMinWorkHours: 4,
          goToWorkStartTime: 28800,
          goOffWorkStartTime: 43200,
          goOffWorkTimeType: 1,
          shiftCodes: [1, 2, 3],
        },
        processRequirement: {
          interviewTotal: 1,
          interviewTimeMode: 2,
          interviewTimes: [
            {
              weekdays: [0],
              times: [{ start: 32400, end: 72000 }],
            },
          ],
          firstInterviewWay: 1,
          firstInterviewAddressMode: 1,
          interviewExtLabel: '2,3,4',
          probationWorkMode: 1,
          probationWorkPeriod: 3,
          probationWorkPeriodUnit: 1,
          probationWorkAssessment: 2,
          trainMode: 1,
          trainPeriod: 3,
          trainPeriodUnit: 1,
          trainDesc: '培训内容-正常工作',
        },
        storeRequirement: {
          jobStores: [
            {
              storeId: 1466535,
              storeName: 'gt测试门店',
              storeAddress: '长阳创谷',
              storeExactAddress: '长阳创谷12345号',
              requirementNum: 2,
              thresholdNum: 15,
            },
          ],
        },
      },
    });

    const values = mergePositionValues(createDefaultPositionFormValues(), {
      ...inheritedValues,
      positionName: 'gt测试agent1',
    });
    assert.equal(values.nationality, 'china-only');
    const payload = buildCreateJobPayload(values, {
      publishNow: true,
      sendMsgToSupplier: true,
    });

    const requirement = payload.jobRequirement as Record<string, unknown>;
    const basicInfo = requirement.basicInfo as Record<string, unknown>;
    const salaryWelfare = requirement.salaryWelfare as Record<string, unknown>;
    const hiringRequirement = requirement.hiringRequirement as Record<string, unknown>;
    const workTimeArrangement = requirement.workTimeArrangement as Record<string, unknown>;
    const processRequirement = requirement.processRequirement as Record<string, unknown>;
    const jobSalaries = salaryWelfare.jobSalaries as Array<Record<string, unknown>>;

    assert.equal(basicInfo.needTraining, 1);
    assert.deepEqual(jobSalaries.map(item => item.type), [0, 2]);
    assert.equal(jobSalaries[1].salary, 120);
    assert.equal((salaryWelfare.jobProbationSalary as Record<string, unknown>).otherSalaryDescription, '干满3天');
    assert.equal((salaryWelfare.jobWelfare as Record<string, unknown>).accommodation, 1);
    assert.equal((salaryWelfare.jobWelfare as Record<string, unknown>).probationInsuranceReceive, 0);
    assert.equal(hiringRequirement.manMinHeight, 170);
    assert.equal(hiringRequirement.manMaxWeight, 80);
    assert.equal(hiringRequirement.womanMinHeight, 165);
    assert.equal(hiringRequirement.womanMaxWeight, 70);
    assert.equal(hiringRequirement.marriageBearingType, 0);
    assert.equal(hiringRequirement.nativePlaceRequirementType, 0);
    assert.equal(hiringRequirement.nationRequirementType, 0);
    assert.equal(hiringRequirement.countryRequirementType, 2);
    assert.equal(workTimeArrangement.maxWorkTakingTime, 20);
    assert.deepEqual(workTimeArrangement.shiftCodes, [1, 2, 3]);
    assert.deepEqual(processRequirement.interviewTimes, [
      {
        weekdays: [0],
        times: [{ start: 32400, end: 72000 }],
      },
    ]);
    assert.equal(processRequirement.interviewExtLabel, '2,3,4');
    assert.equal(processRequirement.trainPeriod, 3);
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

  it('successfully creates positions across ten user-perspective create flows', async () => {
    const singleSimilarCandidate = [
      {
        id: '1909',
        jobBasicInfoId: 1909,
        positionName: '果蔬好-人民广场店-理货员-兼职',
        projectName: '上海生鲜项目',
        brandName: '果蔬好',
        status: 'published',
        requirementNum: 2,
      },
    ];
    const multipleSimilarCandidates = [
      ...singleSimilarCandidate,
      {
        id: '1911',
        jobBasicInfoId: 1911,
        positionName: '果蔬好-徐家汇店-理货员-兼职',
        projectName: '上海生鲜项目',
        brandName: '果蔬好',
        status: 'published',
        requirementNum: 3,
      },
    ];
    const cases: UserPerspectiveCreateCase[] = [
      {
        name: '完全新建：HM 拼接名一句话',
        messages: ['创建一个岗位，上海生鲜项目果蔬好-人民广场店-理货员，招2名女性年龄20到40岁，上班8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月，阈值1.5倍'],
        commit: 'save',
        plans: {
          '创建一个岗位，上海生鲜项目果蔬好-人民广场店-理货员，招2名女性年龄20到40岁，上班8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月，阈值1.5倍':
            createUserPerspectivePlan(),
        },
        expectedNickName: '理货员',
      },
      {
        name: '完全新建：多门店统一配置',
        messages: ['上海生鲜项目果蔬好人民广场店和徐家汇店都招理货员，各2人，阈值1.5倍，女性20到40岁，8点到14点，日结当日发，25一小时'],
        commit: 'save',
        plans: {
          '上海生鲜项目果蔬好人民广场店和徐家汇店都招理货员，各2人，阈值1.5倍，女性20到40岁，8点到14点，日结当日发，25一小时':
            createUserPerspectivePlan({ storeNames: ['人民广场店', '徐家汇店'] }),
        },
        expectedPayloadCount: 2,
        expectedNickName: '理货员',
      },
      {
        name: '完全新建：先缺项目品牌后补齐',
        messages: [
          '先建个人民广场店理货员，招2个女生，20到40岁，8点到14点',
          '项目上海生鲜项目，品牌果蔬好，日结当日结，25元每小时，综合150到180元每天，至少上岗3个月，阈值1.5倍',
        ],
        commit: 'save',
        plans: {
          '先建个人民广场店理货员，招2个女生，20到40岁，8点到14点':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              baseSalary: undefined,
              salaryMin: undefined,
              salaryMax: undefined,
              settlementCycle: undefined,
              payDay: undefined,
              minWorkMonths: undefined,
            }),
          '项目上海生鲜项目，品牌果蔬好，日结当日结，25元每小时，综合150到180元每天，至少上岗3个月，阈值1.5倍':
            createUserPerspectivePlan(),
        },
        candidates: [],
        expectedNickName: '理货员',
      },
      {
        name: '完全新建：全职字段通过校验',
        messages: ['帮我新建上海生鲜项目果蔬好静安寺店全职服务员，招3人，男女不限，18到45岁，无试用期，五险一金，月结15号，薪资5000到6500每月，9点到18点'],
        commit: 'save',
        plans: {
          '帮我新建上海生鲜项目果蔬好静安寺店全职服务员，招3人，男女不限，18到45岁，无试用期，五险一金，月结15号，薪资5000到6500每月，9点到18点':
            createUserPerspectivePlan({
              storeNames: ['静安寺店'],
              positionName: '服务员',
              positionCategoryName: '服务员',
              recruitCount: 3,
              genders: ['1', '2'],
              ageMin: 18,
              ageMax: 45,
              dailyTimeRange: ['09:00', '18:00'],
              dailyWorkDuration: 8,
              baseSalary: 5000,
              baseSalaryUnit: '3',
              salaryMin: 5000,
              salaryMax: 6500,
              salaryRangeUnit: '3',
              settlementCycle: '3',
              payDay: '15',
              minWorkMonths: undefined,
            }),
        },
        expectedNickName: '服务员',
      },
      {
        name: '相似岗位：单候选确认模板',
        messages: ['新建一个果蔬好理货员岗位，招2名女生，8点到14点', '用这个作为模板'],
        commit: 'save',
        plans: {
          '新建一个果蔬好理货员岗位，招2名女生，8点到14点':
            createUserPerspectivePlan({
              projectName: undefined,
              storeNames: undefined,
              threshold: undefined,
              baseSalary: undefined,
              salaryMin: undefined,
              salaryMax: undefined,
              settlementCycle: undefined,
              payDay: undefined,
              minWorkMonths: undefined,
            }),
        },
        candidates: singleSimilarCandidate,
        expectedListCalls: ['理货员'],
        expectedNickName: '理货员',
      },
      {
        name: '相似岗位：多候选指定 ID',
        messages: ['帮我建一个理货员岗位，招3个女性', '用岗位 ID 1911 作为模板'],
        commit: 'save',
        plans: {
          '帮我建一个理货员岗位，招3个女性':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              storeNames: undefined,
              recruitCount: 3,
              threshold: undefined,
              baseSalary: undefined,
              salaryMin: undefined,
              salaryMax: undefined,
              settlementCycle: undefined,
              payDay: undefined,
              minWorkMonths: undefined,
            }),
        },
        candidates: multipleSimilarCandidates,
        expectedListCalls: ['理货员'],
        expectedNickName: '理货员',
      },
      {
        name: '相似岗位：拒绝模板后空白补齐',
        messages: [
          '先建一个理货员岗位，人民广场店招2人',
          '都不用，继续空白新建',
          '项目上海生鲜项目，品牌果蔬好，门店人民广场店，女性20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少上岗3个月，阈值1.5倍',
        ],
        commit: 'save',
        plans: {
          '先建一个理货员岗位，人民广场店招2人':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              threshold: undefined,
              baseSalary: undefined,
              salaryMin: undefined,
              salaryMax: undefined,
              settlementCycle: undefined,
              payDay: undefined,
              minWorkMonths: undefined,
            }),
          '项目上海生鲜项目，品牌果蔬好，门店人民广场店，女性20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少上岗3个月，阈值1.5倍':
            createUserPerspectivePlan(),
        },
        candidates: singleSimilarCandidate,
        expectedListCalls: ['人民广场店'],
        expectedNickName: '理货员',
      },
      {
        name: '复制新建：纯复制',
        messages: ['照着岗位 ID 1909 新建一个岗位'],
        commit: 'save',
        expectedNickName: '工时初始化测试5',
      },
      {
        name: '复制新建：复制并自然语言覆盖',
        messages: ['照着岗位 ID 1909 新建一个岗位，门店换成徐家汇店，招3个女孩子，早八点半到下午两点半'],
        commit: 'save',
        plans: {
          '照着岗位 ID 1909 新建一个岗位，门店换成徐家汇店，招3个女孩子，早八点半到下午两点半':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['徐家汇店'],
              recruitCount: 3,
              dailyTimeRange: ['08:30', '14:30'],
            }),
        },
        expectedNickName: '工时初始化测试5',
      },
      {
        name: '复制新建：当前详情复制并发布',
        messages: ['查看岗位 ID 1909 的详细信息', '照着这个岗位新建，门店换成陆家嘴店，招4人'],
        commit: 'publish',
        plans: {
          '照着这个岗位新建，门店换成陆家嘴店，招4人':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['陆家嘴店'],
              recruitCount: 4,
            }),
        },
        expectedNickName: '工时初始化测试5',
      },
    ];

    await runSuccessfulUserCreateCases(cases);
  });

  it('successfully creates positions across a second ten-case retry after fixing blockers', async () => {
    const cases: UserPerspectiveCreateCase[] = [
      {
        name: '复测复制 scope：ID 复制换徐家汇店',
        messages: ['复制岗位 ID 1909 新建，门店换成徐家汇店，招5人'],
        commit: 'save',
        plans: {
          '复制岗位 ID 1909 新建，门店换成徐家汇店，招5人':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['徐家汇店'],
              recruitCount: 5,
            }),
        },
        expectedNickName: '工时初始化测试5',
      },
      {
        name: '复测复制 scope：ID 复制换陆家嘴店',
        messages: ['照着岗位 ID 1909 发一个新岗位，门店改成陆家嘴店，招2名女性'],
        commit: 'save',
        plans: {
          '照着岗位 ID 1909 发一个新岗位，门店改成陆家嘴店，招2名女性':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['陆家嘴店'],
              recruitCount: 2,
              genders: ['2'],
            }),
        },
        expectedNickName: '工时初始化测试5',
      },
      {
        name: '复测复制 scope：ID 复制换两个门店',
        messages: ['基于岗位 ID 1909 新建，徐家汇店和陆家嘴店各招3人'],
        commit: 'save',
        plans: {
          '基于岗位 ID 1909 新建，徐家汇店和陆家嘴店各招3人':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['徐家汇店', '陆家嘴店'],
              recruitCount: 3,
            }),
        },
        expectedNickName: '工时初始化测试5',
        expectedPayloadCount: 2,
      },
      {
        name: '复测复制 scope：详情上下文复制换店发布',
        messages: ['查看岗位 ID 1909 的详细信息', '参考当前岗位新建，门店换成徐家汇店，招6人'],
        commit: 'publish',
        plans: {
          '参考当前岗位新建，门店换成徐家汇店，招6人':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              storeNames: ['徐家汇店'],
              recruitCount: 6,
            }),
        },
        expectedNickName: '工时初始化测试5',
      },
      {
        name: '全新角度：项目品牌 ID 输入',
        messages: ['新建岗位，项目ID101，品牌ID202，人民广场店理货员，招2人，阈值15，女，20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月'],
        commit: 'save',
        plans: {
          '新建岗位，项目ID101，品牌ID202，人民广场店理货员，招2人，阈值15，女，20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月':
            createUserPerspectivePlan({
              projectName: undefined,
              brandName: undefined,
            }),
        },
        expectedNickName: '理货员',
      },
      {
        name: '全新角度：项目 ID 加品牌名',
        messages: ['项目ID101，品牌果蔬好，徐家汇店收银员招1人，男女不限，18到45，9点到18点，月结15号，5000到6000每月'],
        commit: 'save',
        plans: {
          '项目ID101，品牌果蔬好，徐家汇店收银员招1人，男女不限，18到45，9点到18点，月结15号，5000到6000每月':
            createUserPerspectivePlan({
              projectName: undefined,
              storeNames: ['徐家汇店'],
              positionName: '收银员',
              positionCategoryName: '收银员',
              recruitCount: 1,
              genders: ['1', '2'],
              ageMin: 18,
              ageMax: 45,
              dailyTimeRange: ['09:00', '18:00'],
              dailyWorkDuration: 8,
              baseSalary: 5000,
              baseSalaryUnit: '3',
              salaryMin: 5000,
              salaryMax: 6000,
              salaryRangeUnit: '3',
              settlementCycle: '3',
              payDay: '15',
            }),
        },
        expectedNickName: '收银员',
      },
      {
        name: '全新角度：职位类别默认岗位名',
        messages: ['上海生鲜项目果蔬好南京东路店，工种收银员，招2人，男女不限，18到45岁，9点到18点，月结15号，5000到6000每月'],
        commit: 'save',
        plans: {
          '上海生鲜项目果蔬好南京东路店，工种收银员，招2人，男女不限，18到45岁，9点到18点，月结15号，5000到6000每月':
            createUserPerspectivePlan({
              storeNames: ['南京东路店'],
              positionName: undefined,
              positionCategoryName: '收银员',
              recruitCount: 2,
              genders: ['1', '2'],
              ageMin: 18,
              ageMax: 45,
              dailyTimeRange: ['09:00', '18:00'],
              dailyWorkDuration: 8,
              baseSalary: 5000,
              baseSalaryUnit: '3',
              salaryMin: 5000,
              salaryMax: 6000,
              salaryRangeUnit: '3',
              settlementCycle: '3',
              payDay: '15',
            }),
        },
        expectedNickName: '收银员',
      },
      {
        name: '全新角度：先人数阈值后补门店',
        messages: [
          '上海生鲜项目果蔬好新建理货员，招4人，阈值2倍，女性20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月',
          '门店补徐家汇店',
        ],
        commit: 'save',
        plans: {
          '上海生鲜项目果蔬好新建理货员，招4人，阈值2倍，女性20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月':
            createUserPerspectivePlan({
              storeNames: undefined,
              recruitCount: 4,
              threshold: 20,
            }),
          '门店补徐家汇店': {
            shouldCreatePosition: true,
            storeNames: ['徐家汇店'],
          },
        },
        expectedNickName: '理货员',
      },
      {
        name: '全新角度：草稿切换项目品牌门店',
        messages: [
          '先建上海生鲜项目果蔬好人民广场店理货员，招2人，女，20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月',
          '项目改成北京餐饮项目，品牌麦香堡，门店中关村店',
        ],
        commit: 'save',
        plans: {
          '先建上海生鲜项目果蔬好人民广场店理货员，招2人，女，20到40岁，8点到14点，日结当日结，25元每小时，综合150到180元每天，至少3个月':
            createUserPerspectivePlan(),
          '项目改成北京餐饮项目，品牌麦香堡，门店中关村店':
            createUserPerspectivePlan({
              projectName: '北京餐饮项目',
              brandName: '麦香堡',
              storeNames: ['中关村店'],
              positionName: undefined,
              positionCategoryName: undefined,
              workContent: undefined,
              recruitCount: undefined,
              threshold: undefined,
              genders: undefined,
              ageMin: undefined,
              ageMax: undefined,
              dailyTimeRange: undefined,
              dailyWorkDuration: undefined,
              baseSalary: undefined,
              salaryMin: undefined,
              salaryMax: undefined,
              settlementCycle: undefined,
              payDay: undefined,
              minWorkMonths: undefined,
            }),
        },
        expectedNickName: '理货员',
      },
      {
        name: '全新角度：完整新建并通知供应商发布',
        messages: ['帮我发布一个上海生鲜项目果蔬好淮海路店咖啡师，招2人，男女不限，20到35岁，10点到18点，月结15号，5000到7000每月'],
        commit: 'publishWithSupplier',
        plans: {
          '帮我发布一个上海生鲜项目果蔬好淮海路店咖啡师，招2人，男女不限，20到35岁，10点到18点，月结15号，5000到7000每月':
            createUserPerspectivePlan({
              storeNames: ['淮海路店'],
              positionName: '咖啡师',
              positionCategoryName: '咖啡师',
              recruitCount: 2,
              genders: ['1', '2'],
              ageMin: 20,
              ageMax: 35,
              dailyTimeRange: ['10:00', '18:00'],
              dailyWorkDuration: 8,
              baseSalary: 5000,
              baseSalaryUnit: '3',
              salaryMin: 5000,
              salaryMax: 7000,
              salaryRangeUnit: '3',
              settlementCycle: '3',
              payDay: '15',
            }),
        },
        expectedNickName: '咖啡师',
      },
    ];

    await runSuccessfulUserCreateCases(cases);
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

  it('does not call the create planner for pure inherited create without overrides', async () => {
    let plannerCalls = 0;
    const createPlanner: PositionCreatePlanner = {
      async planCreate() {
        plannerCalls += 1;
        return {
          shouldCreatePosition: true,
        };
      },
    };
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => createCompleteDetail(jobBasicInfoId),
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    const preview = await service.chat({
      sessionId: 's-inherit-create-no-planner',
      message: '照着岗位 ID 1909 新建一个岗位',
      channel: 'test',
    });

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.equal(plannerCalls, 0);
  });

  it('uses the create planner for natural-language overrides in inherited create', async () => {
    let plannerCalls = 0;
    let capturedStoreParams: unknown;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate(input) {
        plannerCalls += 1;
        assert.match(input.message, /照着岗位 ID 1909/);
        assert.equal(input.parsed.sourceJobBasicInfoId, 1909);
        return {
          shouldCreatePosition: true,
          storeNames: ['徐家汇店'],
          recruitCount: 3,
          genders: ['2'],
          dailyTimeRange: ['08:30', '14:30'],
        };
      },
    };
    const apiClient = {
      getJobDetail: async (jobBasicInfoId: number) => createCompleteDetail(jobBasicInfoId),
      searchStores: async (params: unknown) => {
        capturedStoreParams = params;
        return [
          {
            id: 2,
            name: '徐家汇店',
            raw: {
              address: '上海市徐汇区',
              exactAddress: '漕溪北路1号',
            },
          },
        ];
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    const preview = await service.chat({
      sessionId: 's-inherit-create-llm-overrides',
      message: '照着岗位 ID 1909 新建一个岗位，门店换成徐家汇店，招3个女孩子，早八点半到下午两点半',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-inherit-create-llm-overrides')?.values;

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.equal(plannerCalls, 1);
    assert.deepEqual((capturedStoreParams as { projectIds?: number[] }).projectIds, [598]);
    assert.deepEqual((capturedStoreParams as { brandIds?: number[] }).brandIds, [10024]);
    assert.equal(values?.projectName, '京津果蔬好');
    assert.equal(values?.brandName, '果蔬好');
    assert.deepEqual(
      values?.recruitStoreAllocations?.map(store => ({
        storeName: store.storeName,
        recruitCount: store.recruitCount,
        threshold: store.threshold,
      })),
      [{ storeName: '徐家汇店', recruitCount: 3, threshold: 15 }],
    );
    assert.deepEqual(values?.genders, ['2']);
    assert.deepEqual(values?.dailyTimeRange, ['08:30', '14:30']);
    assert.equal(values?.workAddress, '上海市徐汇区漕溪北路1号');
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

  it('suggests a similar source position when create entities are missing and applies it after user confirmation', async () => {
    const calledTools: string[] = [];
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const createPlanner: PositionCreatePlanner = {
      async planCreate(input) {
        if (/理货员/.test(input.message)) {
          return {
            shouldCreatePosition: true,
            positionName: '理货员',
            positionCategoryName: '理货员',
            recruitCount: 2,
          };
        }
        return undefined;
      },
    };
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
      getJobTypes: async () => [{ id: 12, name: '理货员', raw: {} }],
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      createPlanner,
      logger: { warn: () => undefined } as never,
    });

    const suggestion = await service.chat({
      sessionId: 's-auto-source-by-name',
      message: '新建一个果蔬好理货员岗位，招聘2人',
      channel: 'test',
    });

    assert.equal(suggestion.intent, 'clarify');
    assert.equal(suggestion.needsConfirmation, false);
    assert.deepEqual(calledTools, ['getJobList:理货员']);
    assert.equal(draftStore.getBySession('s-auto-source-by-name')?.values.positionName, '理货员');
    assert.match(suggestion.reply, /找到以下可参考的已有岗位/);
    assert.match(suggestion.reply, /用岗位 ID 1909 作为模板/);

    const preview = await service.chat({
      sessionId: 's-auto-source-by-name',
      message: '用这个作为模板',
      channel: 'test',
    });
    const values = draftStore.getBySession('s-auto-source-by-name')?.values;

    assert.equal(preview.intent, 'create_preview');
    assert.equal(preview.needsConfirmation, true);
    assert.deepEqual(calledTools, ['getJobList:理货员', 'getJobDetail:1909']);
    assert.equal(values?.projectName, '京津果蔬好');
    assert.equal(values?.brandName, '果蔬好');
    assert.equal(values?.positionName, '理货员');
    assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, 2);
  });

  it('describes a referenced draft id from local state without external calls', async () => {
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
      sessionId: 's-draft-lookup',
      message: `新建岗位 ${JSON.stringify(createCompleteValues())}`,
      channel: 'test',
    });
    assert.equal(preview.needsConfirmation, true);

    const response = await service.chat({
      sessionId: 's-draft-lookup',
      message: `你能看到这个信息吗 draftId: ${preview.draftId}`,
      channel: 'test',
    });

    assert.equal(response.draftId, preview.draftId);
    assert.equal(response.needsConfirmation, true);
    assert.deepEqual(response.usedTools, []);
    assert.match(response.reply, /当前岗位预览已满足提交条件/);
  });

  it('keeps create draft context and accepts a short job type clarification', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const calledTools: string[] = [];
    const apiClient = {
      searchBrands: async (query: string) => {
        calledTools.push(`searchBrands:${query}`);
        return [{ id: 202, name: 'gt测试品牌', raw: {} }];
      },
      getJobTypes: async () => {
        calledTools.push('getJobTypes');
        return [
          { id: 12, name: '普通服务员', raw: {} },
          { id: 183, name: '撤菜', raw: {} },
          { id: 200, name: '传菜', raw: {} },
          { id: 13, name: '收银员', raw: {} },
          { id: 14, name: '迎宾/接待', raw: {} },
        ];
      },
      getJobTemplateByJobType: async (jobTypeId: number) => {
        calledTools.push(`getJobTemplateByJobType:${jobTypeId}`);
        return { jobContent: '负责门店基础服务。' };
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const first = await service.chat({
      sessionId: 's-short-job-type',
      message: '帮我新建一个岗位 gt测试品牌-gt测试门店-gt测试agent1-兼职 的岗位',
      channel: 'test',
    });
    const firstValues = draftStore.getBySession('s-short-job-type')?.values;

    assert.equal(first.intent, 'create_preview');
    assert.equal(first.needsClarification, true);
    assert.equal(firstValues?.brandName, 'gt测试品牌');
    assert.equal(firstValues?.positionName, 'gt测试agent1');
    assert.equal(firstValues?.positionCategory, undefined);
    assert.doesNotMatch(first.reply, /匹配到多个职位类别/);

    const second = await service.chat({
      sessionId: 's-short-job-type',
      message: '普通服务员',
      channel: 'test',
    });
    const secondValues = draftStore.getBySession('s-short-job-type')?.values;

    assert.equal(second.intent, 'create_preview');
    assert.equal(secondValues?.positionName, 'gt测试agent1');
    assert.equal(secondValues?.positionCategory, 12);
    assert.equal(secondValues?.positionCategoryName, '普通服务员');
    assert.equal(secondValues?.workContent, '负责门店基础服务。');
    assert.match(second.reply, /当前不能保存的问题/);
    assert.deepEqual(calledTools, [
      'searchBrands:gt测试品牌',
      'getJobTypes',
      'getJobTemplateByJobType:12',
    ]);
  });

  it('describes an incomplete create draft instead of treating preview wording as job type', async () => {
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const calledTools: string[] = [];
    const service = new PositionService({
      config: baseConfig,
      positionApiClient: {
        getJobTypes: async () => {
          calledTools.push('getJobTypes');
          return [
            { id: 12, name: '普通服务员', raw: {} },
            { id: 13, name: '收银员', raw: {} },
          ];
        },
      } as unknown as PositionApiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });

    const first = await service.chat({
      sessionId: 's-preview-current-values',
      message: '帮我新建一个岗位，岗位名称是gt测试agent1，要求招聘2名兼职小时工',
      channel: 'test',
    });
    assert.equal(first.needsClarification, true);
    assert.equal(calledTools.length, 0);

    const serviceWithPlanner = new PositionService({
      config: baseConfig,
      positionApiClient: {
        getJobTypes: async () => {
          calledTools.push('getJobTypes');
          return [
            { id: 12, name: '普通服务员', raw: {} },
            { id: 13, name: '收银员', raw: {} },
          ];
        },
      } as unknown as PositionApiClient,
      draftStore,
      createPlanner: {
        async planCreate() {
          throw new Error('create planner should not run for draft inspection');
        },
      },
      logger: { warn: () => undefined } as never,
    });

    const second = await serviceWithPlanner.chat({
      sessionId: 's-preview-current-values',
      message: '预览下现在都填写什么了',
      channel: 'test',
    });

    assert.equal(second.draftId, first.draftId);
    assert.equal(second.needsClarification, true);
    assert.deepEqual(calledTools, []);
    assert.match(second.reply, /当前岗位预览还需要补充以下内容/);
    assert.doesNotMatch(second.reply, /匹配到多个职位类别/);
  });

  it('reuses job type options within one service instance', async () => {
    let jobTypeCalls = 0;
    const service = new PositionService({
      config: baseConfig,
      positionApiClient: {
        searchStores: async () => [{ id: 1, name: '人民广场店', raw: {} }],
        getJobTypes: async () => {
          jobTypeCalls += 1;
          return [
            { id: 12, name: '服务员', raw: {} },
            { id: 13, name: '收银员', raw: {} },
          ];
        },
        getJobTemplateByJobType: async (jobTypeId: number) => ({
          jobContent: jobTypeId === 12 ? '负责门店服务。' : '负责收银结算。',
        }),
      } as unknown as PositionApiClient,
      draftStore: new PositionDraftStore(30 * 60 * 1000),
      logger: { warn: () => undefined } as never,
    });
    const sessionId = 's-job-type-cache';

    const preview = await service.chat({
      sessionId,
      message: `新建岗位 ${JSON.stringify(createCompleteValues())}`,
      channel: 'test',
    });
    assert.equal(preview.intent, 'create_preview');

    await service.chat({
      sessionId,
      message: '职位类别为服务员',
      channel: 'test',
    });
    await service.chat({
      sessionId,
      message: '职位类别为收银员',
      channel: 'test',
    });

    assert.equal(jobTypeCalls, 1);
  });

  it('self-tests store-scoped template discovery across ten user flows', async () => {
    const candidates = {
      fullTime: {
        id: '2101',
        jobBasicInfoId: 2101,
        positionName: 'gt测试品牌-gt测试门店-理货员-全职',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 5,
      },
      hourly: {
        id: '2102',
        jobBasicInfoId: 2102,
        positionName: 'gt测试品牌-gt测试门店-理货员-小时工',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 5,
      },
      partTime: {
        id: '2103',
        jobBasicInfoId: 2103,
        positionName: 'gt测试品牌-gt测试门店-服务员-兼职',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 3,
      },
      cashier: {
        id: '2104',
        jobBasicInfoId: 2104,
        positionName: 'gt测试品牌-gt测试门店-收银员-兼职',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 2,
      },
      anotherHourly: {
        id: '2105',
        jobBasicInfoId: 2105,
        positionName: 'gt测试品牌-gt测试门店-分拣员-小时工',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 5,
      },
      otherStore: {
        id: '2106',
        jobBasicInfoId: 2106,
        positionName: 'gt测试品牌-其他门店-理货员-小时工',
        projectName: 'gt测试项目',
        brandName: 'gt测试品牌',
        status: 'published',
        requirementNum: 5,
      },
    };
    const cases: Array<{
      name: string;
      message: string;
      byQuery: Record<string, Array<Record<string, unknown>>>;
      expectedQueries: string[];
      selectedId?: number;
      expectClarify?: boolean;
      expectedNickName?: string;
      expectedRecruitCount?: number;
      expectedDailyTimeRange?: [string, string];
      expectedDailyWorkDuration?: number;
    }> = [
      {
        name: '单候选且明确参考门店已有岗位',
        message: '在gt测试门店 下新建一个岗位，岗位名称是gt测试agent1，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.hourly] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2102,
        expectedNickName: 'gt测试agent1',
      },
      {
        name: '门店范围后接帮我新建仍按小时工选择模板',
        message: '在gt测试门店下帮我新建一个岗位，岗位名称是gt测试agent1，要求招聘2名兼职小时工，女性20到40岁，工作时间为8点 到\n12点',
        byQuery: { gt测试门店: [candidates.fullTime, candidates.hourly, candidates.partTime] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2102,
        expectedNickName: 'gt测试agent1',
        expectedRecruitCount: 2,
        expectedDailyTimeRange: ['08:00', '12:00'],
        expectedDailyWorkDuration: 4,
      },
      {
        name: '多候选按全职选择全职模板',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent3，全职类型，招5人，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.hourly, candidates.fullTime, candidates.partTime] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2101,
        expectedNickName: 'gt测试agent3',
        expectedRecruitCount: 5,
      },
      {
        name: '多候选按兼职选择兼职模板',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent4，兼职招3人，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.fullTime, candidates.partTime] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2103,
        expectedNickName: 'gt测试agent4',
        expectedRecruitCount: 3,
      },
      {
        name: '多候选按工种选择收银员模板',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent5，工种收银员，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.partTime, candidates.cashier] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2104,
        expectedNickName: 'gt测试agent5',
      },
      {
        name: '多候选没有区分信息时要求用户选择',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent6，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.fullTime, candidates.hourly] },
        expectedQueries: ['gt测试门店'],
        expectClarify: true,
      },
      {
        name: '同为小时工分不出唯一模板时要求用户选择',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent7，招小时工5名，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.hourly, candidates.anotherHourly] },
        expectedQueries: ['gt测试门店'],
        expectClarify: true,
      },
      {
        name: '门店搜不到时不回退到岗位名乱继承',
        message: '在不存在门店下新建岗位，岗位名称是理货员，其他信息参考该门店已有岗位',
        byQuery: {
          不存在门店: [],
          理货员: [candidates.otherStore],
        },
        expectedQueries: ['不存在门店'],
        expectClarify: true,
      },
      {
        name: '没有参考或用工提示时单候选也不自动继承',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent8',
        byQuery: { gt测试门店: [candidates.hourly] },
        expectedQueries: ['gt测试门店'],
        expectClarify: true,
      },
      {
        name: '招聘人数作为弱信号辅助选择',
        message: '在gt测试门店下新建岗位，岗位名称是gt测试agent9，兼职招2人，其他信息参考该门店已有岗位',
        byQuery: { gt测试门店: [candidates.partTime, candidates.cashier] },
        expectedQueries: ['gt测试门店'],
        selectedId: 2104,
        expectedNickName: 'gt测试agent9',
        expectedRecruitCount: 2,
      },
    ];

    for (const testCase of cases) {
      const queryCalls: string[] = [];
      const detailCalls: number[] = [];
      const draftStore = new PositionDraftStore(30 * 60 * 1000);
      const apiClient = {
        getJobList: async (params: { searchJobName?: string }) => {
          queryCalls.push(params.searchJobName ?? '');
          return {
            result: testCase.byQuery[params.searchJobName ?? ''] ?? [],
            total: testCase.byQuery[params.searchJobName ?? '']?.length ?? 0,
          };
        },
        getJobDetail: async (jobBasicInfoId: number) => {
          detailCalls.push(jobBasicInfoId);
          return createCompleteDetail(jobBasicInfoId);
        },
        getJobTypes: async () => [
          { id: 12, name: '理货员', raw: {} },
          { id: 13, name: '服务员', raw: {} },
          { id: 14, name: '收银员', raw: {} },
          { id: 15, name: '分拣员', raw: {} },
        ],
        getJobTemplateByJobType: async () => ({ jobContent: '负责门店基础工作。' }),
      } as unknown as PositionApiClient;
      const service = new PositionService({
        config: baseConfig,
        positionApiClient: apiClient,
        draftStore,
        logger: { warn: () => undefined } as never,
      });

      const response = await service.chat({
        sessionId: `s-store-source-${testCase.name}`,
        message: testCase.message,
        channel: 'test',
      });
      const values = draftStore.getBySession(`s-store-source-${testCase.name}`)?.values;

      assert.deepEqual(queryCalls, testCase.expectedQueries, testCase.name);
      if (testCase.selectedId !== undefined) {
        assert.deepEqual(detailCalls, [testCase.selectedId], testCase.name);
        assert.equal(response.intent, 'create_preview', testCase.name);
        assert.equal(values?.positionName, testCase.expectedNickName, testCase.name);
        if (testCase.expectedRecruitCount !== undefined) {
          assert.equal(values?.recruitStoreAllocations?.[0]?.recruitCount, testCase.expectedRecruitCount, testCase.name);
        }
        if (testCase.expectedDailyTimeRange) {
          assert.deepEqual(values?.dailyTimeRange, testCase.expectedDailyTimeRange, testCase.name);
        }
        if (testCase.expectedDailyWorkDuration !== undefined) {
          assert.equal(values?.dailyWorkDuration, testCase.expectedDailyWorkDuration, testCase.name);
        }
      } else {
        assert.deepEqual(detailCalls, [], testCase.name);
        assert.equal(response.needsClarification, true, testCase.name);
        if (testCase.expectClarify && (testCase.byQuery[testCase.expectedQueries[0]]?.length ?? 0) > 0) {
          assert.match(response.reply, /请选择一个作为模板/, testCase.name);
        }
      }
    }
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

  it('keeps the draft and returns a readable reply when create commit API fails', async () => {
    let createCalls = 0;
    const draftStore = new PositionDraftStore(30 * 60 * 1000);
    const apiClient = {
      searchStores: async () => [
        {
          id: 1,
          name: '人民广场店',
          raw: {},
        },
      ],
      createJob: async () => {
        createCalls += 1;
        if (createCalls === 1) {
          throw new Error('麻麻呀，服务器暂时跑丢了～');
        }
        return true;
      },
    } as unknown as PositionApiClient;

    const service = new PositionService({
      config: baseConfig,
      positionApiClient: apiClient,
      draftStore,
      logger: { warn: () => undefined } as never,
    });
    const sessionId = 's-create-commit-api-failure';

    const preview = await service.chat({
      sessionId,
      message: `新建岗位 ${JSON.stringify(createCompleteValues())}`,
      channel: 'test',
    });
    assert.equal(preview.needsConfirmation, true);

    const failed = await service.chat({
      sessionId,
      message: '确认保存',
      channel: 'test',
    });

    assert.equal(failed.intent, 'clarify');
    assert.equal(failed.needsConfirmation, true);
    assert.match(failed.reply, /岗位提交失败/);
    assert.match(failed.reply, /草稿仍然保留/);
    assert.match(failed.reply, /服务器暂时跑丢/);
    assert.match(failed.reply, /本次提交摘要/);
    assert.match(failed.reply, /projectId/);
    assert.match(failed.reply, /stores/);
    assert.match(failed.reply, /排查用 curl/);
    assert.match(failed.reply, /https:\/\/gateway\.example\/sponge\/admin\/job\/create/);
    assert.match(failed.reply, /Duliday-Token: <DULIDAY_TOKEN>/);
    assert.doesNotMatch(failed.reply, /test-token/);
    assert.match(failed.reply, /--data-raw/);
    assert.ok(draftStore.getBySession(sessionId));

    const retried = await service.chat({
      sessionId,
      message: '确认保存',
      channel: 'test',
    });

    assert.equal(retried.intent, 'commit');
    assert.equal(createCalls, 2);
    assert.equal(draftStore.getBySession(sessionId), undefined);
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
