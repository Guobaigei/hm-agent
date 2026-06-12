import type {
  ParsedPositionMessage,
  PositionApiStatus,
  PositionCommitAction,
  PositionFormValues,
  PositionStoreAllocation,
} from './types.ts';
import { normalizeNumber, tryParseJsonObject, uniqueNumbers } from './utils.ts';

const STATUS_PATTERNS: Array<[PositionApiStatus, RegExp]> = [
  [1, /已发布|发布中|在招/],
  [2, /已下架|下架|关闭/],
  [0, /未发布|待发布/],
];
const KNOWN_CITY_NAMES = [
  '北京',
  '上海',
  '天津',
  '重庆',
  '广州',
  '深圳',
  '杭州',
  '南京',
  '苏州',
  '成都',
  '武汉',
  '西安',
  '长沙',
  '郑州',
  '青岛',
  '宁波',
  '厦门',
  '福州',
  '合肥',
];
const STANDALONE_JOB_ID_PATTERN = /(?<![A-Za-z0-9-])(\d{3,})(?![A-Za-z0-9-])/g;

export function parsePositionMessage(message: string): ParsedPositionMessage {
  const normalizedMessage = message.trim();
  const jsonPatch = tryParseJsonObject(normalizedMessage);
  const patch: Partial<PositionFormValues> = {};
  const search: ParsedPositionMessage['search'] = {};
  const references: ParsedPositionMessage['references'] = {};

  if (jsonPatch) {
    Object.assign(patch, jsonPatch);
  }

  Object.assign(patch, parseTextPatch(normalizedMessage));
  Object.assign(search, parseSearchParams(normalizedMessage));
  Object.assign(references, parseReferences(normalizedMessage, jsonPatch));

  const action = inferCommitAction(normalizedMessage);
  const sendMsgToSupplier = inferSupplierNotification(normalizedMessage);
  const detailRequested = inferDetailRequested(normalizedMessage);
  const sourceJobBasicInfoId = parseSourceJobId(normalizedMessage);
  const inheritFromContext = isContextInheritanceMessage(normalizedMessage, sourceJobBasicInfoId);
  const jobBasicInfoId = parsePrimaryJobId(normalizedMessage);
  const intent = inferIntent(normalizedMessage, {
    hasPatch: Object.keys(patch).length > 0,
    action,
    jobBasicInfoId,
    sourceJobBasicInfoId,
    inheritFromContext,
  });

  return {
    intent,
    action,
    sendMsgToSupplier,
    detailRequested,
    jobBasicInfoId,
    sourceJobBasicInfoId,
    inheritFromContext,
    search,
    patch,
    references,
  };
}

function inferDetailRequested(message: string): boolean {
  return /详情|详细|完整信息|列给我|展开|(?:这个|该|此)岗位(?:的)?信息|(?:这个|该|此)职位(?:的)?信息|(?:岗位|职位)信息[:：\s]+[^\s，,。；;]/.test(message);
}

function inferIntent(
  message: string,
  context: {
    hasPatch: boolean;
    action?: PositionCommitAction;
    jobBasicInfoId?: number;
    sourceJobBasicInfoId?: number;
    inheritFromContext?: boolean;
  },
): ParsedPositionMessage['intent'] {
  if (/取消|放弃|不要了|撤销/.test(message)) {
    return 'cancel';
  }

  if (
    /确认|提交|保存|发布/.test(message) &&
    !/新建|新增|创建|编辑|修改|更新|查|查询|搜索|找|列表|有哪些|哪些|已发布|未发布|待发布|发布中|在招|已下架|下架|关闭/.test(message)
  ) {
    return 'commit';
  }

  if (context.sourceJobBasicInfoId || context.inheritFromContext || isInheritanceCreateMessage(message)) {
    return 'create_preview';
  }

  if (/新建|新增|创建|发布一个|发一个|(?:帮我|给我|请)?(?:先)?建(?:一个|个)?/.test(message)) {
    return 'create_preview';
  }

  if (inferDetailRequested(message) && !isExplicitEditMessage(message)) {
    return 'search';
  }

  if (isExplicitEditMessage(message) || context.jobBasicInfoId && context.hasPatch) {
    return 'edit_preview';
  }

  if (/查|查询|搜索|找|列表|岗位/.test(message)) {
    return 'search';
  }

  return context.hasPatch ? 'create_preview' : 'clarify';
}

function inferCommitAction(message: string): PositionCommitAction | undefined {
  if (
    /已发布|未发布|待发布|发布中|在招/.test(message) &&
    /岗位|职位|哪些|列表|查询|查|搜索|找/.test(message) &&
    !/确认|提交|保存并发布|立即发布|发布当前|发布这个|发布该/.test(message)
  ) {
    return undefined;
  }

  if (/发布/.test(message)) {
    return 'publish';
  }

  if (/保存|提交|确认/.test(message)) {
    return 'save';
  }

  return undefined;
}

function inferSupplierNotification(message: string): boolean | undefined {
  if (/不通知供应商|无需通知供应商|不要通知供应商|不发供应商|(?:^|[，,。；;\s])不通知(?:[，,。；;\s]|$)/.test(message)) {
    return false;
  }

  if (/通知供应商|发送供应商|发供应商/.test(message)) {
    return true;
  }

  return undefined;
}

function parsePrimaryJobId(message: string): number | undefined {
  const explicitJobId = matchNumber(message, /岗位\s*(?:ID|id|编号)[:：#\s]*(\d+)/i);
  if (explicitJobId !== undefined) {
    return explicitJobId;
  }

  if (/项目\s*(?:ID|id)|品牌\s*(?:ID|id)|门店\s*(?:ID|id)|职位类别\s*(?:ID|id)|岗位类别\s*(?:ID|id)/i.test(message)) {
    return undefined;
  }

  const genericId = matchNumber(message, /(?:ID|id)[:：#\s]*(\d+)/i);
  if (genericId !== undefined) {
    return genericId;
  }

  if (isExplicitEditMessage(message) && /岗位|职位|岗位信息|职位信息/.test(message)) {
    return matchStandaloneJobId(message);
  }

  if (isDetailByStandaloneJobIdMessage(message)) {
    return matchStandaloneJobId(message);
  }

  return undefined;
}

function parseSourceJobId(message: string): number | undefined {
  if (!isInheritanceCreateMessage(message) && !isSourceInheritanceMessage(message)) {
    return undefined;
  }

  return (
    matchNumber(message, /(?:照着|按照|按|基于|参考|复制|克隆|继承)(?:一下|下)?(?:岗位|职位)?\s*(?:ID|id|编号)?[:：#\s]*(\d{3,})/i) ??
    matchNumber(message, /(?:岗位|职位)\s*(?:ID|id|编号)[:：#\s]*(\d{3,})(?:.*?)(?:复制|克隆|继承|新建|创建)/i) ??
    matchNumber(message, /(?:其他|其它|剩下|其余).*(?:跟|和|同|按|照着|参考)(?:岗位|职位)?\s*(?:ID|id|编号)?[:：#\s]*(\d{3,})/i) ??
    matchNumber(message, /(?:跟|和|同|按|照着|参考)(?:岗位|职位)?\s*(?:ID|id|编号)?[:：#\s]*(\d{3,})(?:.*?)(?:一致|一样|相同|补齐|就可以)/i) ??
    matchNumber(message, /(?:复制|克隆|继承|照着|按照|基于|参考)(?:.*?)(?<![A-Za-z0-9-])(\d{3,})(?![A-Za-z0-9-])/)
  );
}

function isContextInheritanceMessage(message: string, sourceJobBasicInfoId?: number): boolean {
  return (
    !sourceJobBasicInfoId &&
    (isInheritanceCreateMessage(message) || isSourceInheritanceMessage(message)) &&
    /这个岗位|该岗位|当前岗位|刚刚的岗位|刚才的岗位|上个岗位|最近的岗位|这个职位|该职位|其他信息|其它信息|剩下|其余/.test(message)
  );
}

function isInheritanceCreateMessage(message: string): boolean {
  return (
    /复制|克隆|继承|照着|按照|基于|参考/.test(message) &&
    /岗位|职位|新建|新增|创建/.test(message)
  );
}

function isSourceInheritanceMessage(message: string): boolean {
  return (
    /其他|其它|剩下|其余|补齐/.test(message) &&
    /一致|一样|相同|照着|按照|参考|跟|和|同/.test(message)
  );
}

function parseSearchParams(message: string): ParsedPositionMessage['search'] {
  const search: ParsedPositionMessage['search'] = {};
  const ids = parseJobIdList(message);
  if (ids.length) {
    search.jobBasicInfoIds = ids;
  }

  const projectIds = parseScopedIdList(message, /项目\s*(?:ID|id)[:：#\s]*([\d,\s，]+)/i);
  if (projectIds.length) {
    search.projectIds = projectIds;
  }

  const brandIds = parseScopedIdList(message, /品牌\s*(?:ID|id)[:：#\s]*([\d,\s，]+)/i);
  if (brandIds.length) {
    search.brandIds = brandIds;
  }

  const statuses = STATUS_PATTERNS
    .filter(([, pattern]) => pattern.test(message))
    .map(([status]) => status);
  if (statuses.length) {
    search.statuses = Array.from(new Set(statuses));
  }

  const searchJobName =
    matchText(message, /岗位名称[:：\s]*([^\s，,。；;]+)/) ??
    extractImplicitJobName(message);
  if (searchJobName && !ids.length) {
    search.searchJobName = cleanupName(searchJobName);
  }

  return search;
}

function parseReferences(
  message: string,
  jsonPatch?: Record<string, unknown>,
): ParsedPositionMessage['references'] {
  const references: ParsedPositionMessage['references'] = {};
  const compositeCreateName = extractCreateCompositeName(message);
  const projectName = jsonPatch?.projectId
    ? undefined
    : stringFromJson(jsonPatch, 'projectName') ??
      matchText(message, /项目(?:名称)?[:：\s]+([^\s，,。；;]+)/) ??
      matchText(message, /项目(?:名称)?(?:改为|改成|调整为|换成|换为|设为|设置为)[:：\s]*([^\s，,。；;]+)/) ??
      matchText(message, /(?:^|[，,。；;\s])项目(?:名称)?(?:是|为|叫)?\s*([\u4e00-\u9fa5A-Za-z0-9_-]+?项目)(?:[，,。；;\s]|$)/) ??
      matchText(message, /([\u4e00-\u9fa5A-Za-z0-9_-]+?)项目(?:下|的|里)?/);
  const brandName = jsonPatch?.brandId
    ? undefined
    : stringFromJson(jsonPatch, 'brandName') ??
      matchText(message, /品牌(?:名称)?[:：\s]+([^\s，,。；;]+)/) ??
      matchText(message, /品牌(?:名称)?(?:改为|改成|调整为|换成|换为|设为|设置为)[:：\s]*([^\s，,。；;]+)/) ??
      matchText(message, /(?:^|[，,。；;\s])品牌(?:名称)?(?:是|为|叫)?\s*([^\s，,。；;]+)/) ??
      matchText(message, /([\u4e00-\u9fa5A-Za-z0-9_-]+?)品牌(?:下|的|里)?/) ??
      compositeCreateName?.brandName;
  const positionCategoryName =
    jsonPatch?.positionCategory
      ? undefined
      : stringFromJson(jsonPatch, 'positionCategoryName') ??
        matchText(message, /(?:职位类别|岗位类别|工种)[:：\s]*([^\s，,。；;]+)/) ??
        compositeCreateName?.positionName;
  const storeName =
    jsonPatch?.recruitStoreAllocations
      ? undefined
      : stringFromJson(jsonPatch, 'storeName') ??
        matchText(message, /(?:门店|店铺)(?:名称)?[:：\s]+([^\s，,。；;]+)/) ??
        matchText(message, /(?:门店|店铺)(?:名称)?(?:改为|改成|调整为|换成|换为|设为|设置为)[:：\s]*([^\s，,。；;]+)/) ??
        matchText(message, /(?:^|[，,。；;\s])(?:门店|店铺)(?:名称)?(?:是|为|叫)?\s*([^\s，,。；;]+)/) ??
        compositeCreateName?.storeName;

  const cleanedProjectName = projectName ? cleanupReferenceName(projectName) : undefined;
  const cleanedBrandName = brandName ? cleanupReferenceName(brandName) : undefined;
  const explicitCityName = matchText(message, /(?:城市|地区|区域|城市区域)[:：\s]+([^\s，,。；;]+)/);
  const cityName = explicitCityName ?? (jsonPatch || cleanedProjectName ? undefined : extractKnownCityName(message));

  if (cleanedProjectName) {
    references.projectName = cleanedProjectName;
  }
  if (cleanedBrandName) {
    references.brandName = cleanedBrandName;
  }
  if (positionCategoryName) {
    references.positionCategoryName = cleanupName(positionCategoryName);
  }
  if (cityName) {
    references.cityNames = [cleanupName(cityName)];
  }
  if (storeName) {
    references.storeNames = [cleanupName(storeName)];
  }

  return references;
}

function parseTextPatch(message: string): Partial<PositionFormValues> {
  const patch: Partial<PositionFormValues> = {};
  const compositeCreateName = extractCreateCompositeName(message);

  const projectId = matchNumber(message, /项目\s*(?:ID|id)[:：#\s]*(\d+)/i);
  if (projectId !== undefined) {
    patch.projectId = projectId;
  }

  const brandId = matchNumber(message, /品牌\s*(?:ID|id)[:：#\s]*(\d+)/i);
  if (brandId !== undefined) {
    patch.brandId = brandId;
  }

  const jobTypeId = matchNumber(message, /(?:职位类别|岗位类别|工种)\s*(?:ID|id)[:：#\s]*(\d+)/i);
  if (jobTypeId !== undefined) {
    patch.positionCategory = jobTypeId;
  }

  const positionName =
    matchText(message, /岗位名称[:：\s]*([^\n，,。；;]+)/) ??
    matchText(message, /(?:岗位名称|岗位名)(?:改为|改成|调整为|设为|设置为|命名为|叫)[:：\s]*([^\n，,。；;]+)/) ??
    compositeCreateName?.positionName ??
    matchText(message, /(?:新建|新增|创建)(?:一个)?([^\s，,。；;]+?)(?:岗位|职位)/);
  if (positionName) {
    const cleanedPositionName = cleanupName(positionName);
    if (cleanedPositionName) {
      patch.positionName = cleanedPositionName;
    }
  }

  const workContent = matchText(message, /(?:工作内容|岗位内容|职责)[:：\s]*([^。；;\n]+)/);
  if (workContent) {
    patch.workContent = workContent.trim();
  }

  if (/小时工/.test(message)) {
    patch.employmentType = 'part-time';
    patch.partTimeType = '5';
  } else if (/寒假工/.test(message)) {
    patch.employmentType = 'part-time';
    patch.partTimeType = '3';
  } else if (/暑假工/.test(message)) {
    patch.employmentType = 'part-time';
    patch.partTimeType = '4';
  } else if (/兼职/.test(message)) {
    patch.employmentType = 'part-time';
  } else if (/全职/.test(message)) {
    patch.employmentType = 'full-time';
  }

  if (/长期工|长期/.test(message)) {
    patch.employmentDurationType = '1';
  }
  if (/短期工|短期|临时/.test(message)) {
    patch.employmentDurationType = '2';
  }

  const minWorkMonths = matchNumber(message, /(?:至少上岗|上岗至少|最少上岗)(\d+)\s*个?月/);
  if (minWorkMonths !== undefined) {
    patch.minWorkMonths = minWorkMonths;
  }

  const dateRange = message.match(/(\d{4}-\d{1,2}-\d{1,2})\s*(?:到|至|-|~)\s*(\d{4}-\d{1,2}-\d{1,2})/);
  if (dateRange) {
    patch.temporaryEmploymentStartTime = dateRange[1];
    patch.temporaryEmploymentEndTime = dateRange[2];
  }

  if (/无试用期|没有试用期|不设试用期/.test(message)) {
    patch.probationStatus = '1';
  } else if (/有试用期|试用期/.test(message)) {
    patch.probationStatus = '2';
  }

  if (/不需要试工|无需试工|无试工|没有试工/.test(message)) {
    patch.trialRequired = '0';
  } else if (/需要试工|有试工|试工/.test(message)) {
    patch.trialRequired = '1';
  }

  if (/不需要培训|无需培训|无培训|没有培训/.test(message)) {
    patch.trainingRequired = '0';
  } else if (/需要培训|有培训|培训/.test(message)) {
    patch.trainingRequired = '1';
  }

  if (/BPO|业务流程外包/i.test(message)) {
    patch.cooperationMode = '2';
  } else if (/RPO|招聘流程外包/i.test(message)) {
    patch.cooperationMode = '3';
  } else if (/免费代招/.test(message)) {
    patch.cooperationMode = '4';
  }

  if (/日结/.test(message)) {
    patch.settlementCycle = '1';
  } else if (/周结/.test(message)) {
    patch.settlementCycle = '2';
  } else if (/月结/.test(message)) {
    patch.settlementCycle = '3';
  } else if (/完工结/.test(message)) {
    patch.settlementCycle = '4';
  }

  if (/当日结|当天结|今天结/.test(message)) {
    patch.payDay = '1';
  } else if (/次日结|第二天结/.test(message)) {
    patch.payDay = '2';
  } else {
    const payDay = matchText(message, /(?:每月|每个月|发薪日|工资日)[:：\s]*(\d{1,2})号?/);
    if (payDay) {
      patch.payDay = payDay;
    }
  }

  const salary = message.match(/(?:基本薪资|薪资|工资)(?:改为|改成|调整为|设为|设置为|为|是)?[:：\s]*(\d+(?:\.\d+)?)\s*元?\s*\/?\s*(小时|时|天|日|月|单|次)?/);
  if (salary) {
    patch.baseSalary = Number(salary[1]);
    patch.baseSalaryUnit = normalizeSalaryUnit(salary[2]) ?? patch.baseSalaryUnit;
  }

  const salaryRange = message.match(/(?:综合薪资|薪资范围)(?:改为|改成|调整为|设为|设置为|为|是)?[:：\s]*(\d+(?:\.\d+)?)\s*(?:-|~|到|至)\s*(\d+(?:\.\d+)?)\s*元?\s*\/?\s*(天|日|周|月)?/);
  if (salaryRange) {
    patch.salaryMin = Number(salaryRange[1]);
    patch.salaryMax = Number(salaryRange[2]);
    patch.salaryRangeUnit = normalizeSalaryRangeUnit(salaryRange[3]) ?? patch.salaryRangeUnit;
  }

  if (/无商业保险|不买商业保险|商业保险不购买/.test(message)) {
    patch.commercialInsurance = '2';
  } else if (/商业保险|购买商业保险/.test(message)) {
    patch.commercialInsurance = '1';
  }

  const socialInsuranceList = parseSocialInsurance(message);
  if (socialInsuranceList.length) {
    patch.socialInsuranceList = socialInsuranceList;
  }

  const ageRange = parseAgeRange(message);
  if (ageRange) {
    patch.ageMin = ageRange[0];
    patch.ageMax = ageRange[1];
  }

  if (/男女不限|性别不限/.test(message)) {
    patch.genders = ['1', '2'];
  } else if (/只招男|男生|男性|男工|(?:招|招聘|需要|限)?[一二两三四五六七八九十\d]+\s*(?:名|个)?男(?!女|不限)/.test(message)) {
    patch.genders = ['1'];
  } else if (/只招女|女生|女性|女工|(?:招|招聘|需要|限)?[一二两三四五六七八九十\d]+\s*(?:名|个)?女(?!不限)/.test(message)) {
    patch.genders = ['2'];
  }

  const education = parseEducation(message);
  if (education) {
    patch.education = education;
  }

  if (/学生/.test(message)) {
    patch.socialIdentity = '1';
  } else if (/社会人士/.test(message)) {
    patch.socialIdentity = '2';
  } else if (/第二职业/.test(message)) {
    patch.socialIdentity = '3';
  } else if (/社会身份不限|身份不限/.test(message)) {
    patch.socialIdentity = '0';
  }

  parseSchedule(message, patch);
  parseProcess(message, patch);

  const storeAllocation = parseStoreAllocation(message);
  if (storeAllocation) {
    patch.recruitStoreAllocations = [storeAllocation];
  }

  const imageUrls = Array.from(message.matchAll(/https?:\/\/[^\s，,。；;]+/g)).map(match => match[0]);
  if (imageUrls.length) {
    patch.workEnvironmentImages = imageUrls.slice(0, 3);
  }

  return patch;
}

function parseJobIdList(message: string): number[] {
  const explicitJobIdText = matchText(message, /岗位\s*(?:ID|id|编号)[:：\s]*([\d,\s，]+)/i);
  const idText =
    explicitJobIdText ??
    (/项目\s*(?:ID|id)|品牌\s*(?:ID|id)|门店\s*(?:ID|id)|职位类别\s*(?:ID|id)|岗位类别\s*(?:ID|id)/i.test(message)
      ? undefined
      : matchText(message, /(?:ID|id)[:：\s]*([\d,\s，]+)/i));

  if (idText) {
    return parseNumberList(idText);
  }

  if (
    !isPositionSearchContext(message) ||
    hasNumberUnitContext(message) ||
    /项目\s*(?:ID|id)|品牌\s*(?:ID|id)|门店\s*(?:ID|id)|职位类别\s*(?:ID|id)|岗位类别\s*(?:ID|id)/i.test(message)
  ) {
    return [];
  }

  return findStandaloneJobIds(message);
}

function parseScopedIdList(message: string, pattern: RegExp): number[] {
  const idText = matchText(message, pattern);
  return idText ? parseNumberList(idText) : [];
}

function parseNumberList(value: string): number[] {
  return uniqueNumbers(
    value
      .split(/[\s,，]+/)
      .map(item => Number(item))
      .filter(item => Number.isFinite(item)),
  );
}

function isPositionSearchContext(message: string): boolean {
  return /岗位|职位|岗位信息|职位信息/.test(message) && /查|查询|搜索|找|看|根据|岗位信息|职位信息/.test(message);
}

function hasNumberUnitContext(message: string): boolean {
  return /\d+(?:\.\d+)?\s*(元|人|岁|小时|天|月|倍|号)/.test(message);
}

function parseSocialInsurance(message: string): string[] {
  if (/无社保公积金|无社保和公积金|不缴纳社保公积金|不交社保公积金|无社保|无公积金|不缴纳社保|不交社保/.test(message)) {
    return ['none'];
  }

  const values: string[] = [];
  if (/公积金/.test(message)) values.push('1');
  if (/养老/.test(message)) values.push('2');
  if (/医疗/.test(message)) values.push('3');
  if (/失业/.test(message)) values.push('4');
  if (/工伤/.test(message)) values.push('5');
  if (/生育/.test(message)) values.push('6');
  if (/五险一金|社保公积金/.test(message)) values.push('1', '2', '3', '4', '5', '6');
  return Array.from(new Set(values));
}

function parseEducation(message: string): string | undefined {
  if (/博士/.test(message)) return '7';
  if (/硕士|研究生/.test(message)) return '6';
  if (/本科/.test(message)) return '2';
  if (/大专/.test(message)) return '3';
  if (/高中/.test(message)) return '4';
  if (/初中以下/.test(message)) return '9';
  if (/初中/.test(message)) return '5';
  if (/中专|技校|职高/.test(message)) return '8';
  if (/高职/.test(message)) return '10';
  if (/学历不限|不限学历/.test(message)) return '1';
  return undefined;
}

function parseSchedule(message: string, patch: Partial<PositionFormValues>) {
  const workRest = message.match(/做\s*(\d+)\s*休\s*(\d+)/);
  if (workRest) {
    patch.weeklyMonthlyMode = '1';
    patch.workDays = Number(workRest[1]);
    patch.restDays = Number(workRest[2]);
    patch.restMode = '0';
  }

  const workHours = message.match(/(?:每周|每月)?(?:至少|至多)?\s*(\d+(?:\.\d+)?)\s*(小时|天)/);
  if (/工时区间/.test(message) && workHours) {
    patch.weeklyMonthlyMode = '2';
    patch.workHours = Number(workHours[1]);
    patch.workHoursUnit = workHours[2] === '天' ? '1' : '2';
    patch.workHourIntervalType = /每月|月/.test(message) ? '2' : '1';
    patch.workHourRequirementType = /至多/.test(message) ? '2' : '1';
  }

  const timeRange = message.match(/(\d{1,2}:\d{2})\s*(?:-|~|到|至)\s*(\d{1,2}:\d{2})/);
  if (timeRange) {
    patch.dailyScheduleMode = '2';
    patch.dailyTimeRange = [formatColonClockTime(timeRange[1]), formatColonClockTime(timeRange[2])];
  }

  const chineseTimeRange = message.match(/(\d{1,2})(?:点|时)(半|[0-5]?\d分?)?\s*(?:-|~|到|至)\s*(\d{1,2})(?:点|时)(半|[0-5]?\d分?)?/);
  if (!timeRange && chineseTimeRange) {
    patch.dailyScheduleMode = '2';
    patch.dailyTimeRange = [
      formatChineseClockTime(chineseTimeRange[1], chineseTimeRange[2]),
      formatChineseClockTime(chineseTimeRange[3], chineseTimeRange[4]),
    ];
  }

  const dailyDuration = matchNumber(message, /(?:每天|每日|日工作|灵活排班)\s*(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
  if (dailyDuration !== undefined) {
    patch.dailyScheduleMode = '2';
    patch.dailyWorkDuration = dailyDuration;
  }
}

function parseProcess(message: string, patch: Partial<PositionFormValues>) {
  if (/无面试|不面试|免面试/.test(message)) {
    patch.interviewRounds = '0';
  } else {
    const rounds = matchNumber(message, /(\d)\s*轮面试/);
    if (rounds !== undefined && rounds >= 0 && rounds <= 3) {
      patch.interviewRounds = String(rounds) as PositionFormValues['interviewRounds'];
    }
  }

  if (/电话面试/.test(message)) {
    patch.interviewRoundConfigs = [{ interviewMode: '3', interviewAddressMode: '1' }];
  } else if (/视频面试/.test(message)) {
    patch.interviewRoundConfigs = [{ interviewMode: '4', interviewAddressMode: '1' }];
  } else if (/线下面试|到店面试/.test(message)) {
    patch.interviewRoundConfigs = [{ interviewMode: '5', interviewAddressMode: '1' }];
  } else if (/AI面试/i.test(message)) {
    patch.interviewRoundConfigs = [{ interviewMode: '1', interviewAddressMode: '1' }];
  }

  if (/固定面试|固定时间/.test(message)) {
    patch.interviewTimeMode = '1';
  } else if (/周期面试|周期时间/.test(message)) {
    patch.interviewTimeMode = '2';
  } else if (/面试[^，,。；;\n]*等待通知|等待通知[^，,。；;\n]*面试|面试时间[^，,。；;\n]*等待通知/.test(message)) {
    patch.interviewTimeMode = '4';
  }

  const trialDuration = matchNumber(message, /试工(?:周期|时长)?[:：\s]*(\d+(?:\.\d+)?)\s*(天|小时)?/);
  if (trialDuration !== undefined) {
    patch.trialRequired = '1';
    patch.trialDuration = trialDuration;
    patch.trialUnit = /试工[^，,。；;]*小时/.test(message) ? 'hour' : 'day';
    patch.trialAddressMode = /试工[^，,。；;]*其他地址/.test(message) ? '2' : '1';
    patch.trialAssessment = /实操/.test(message) ? '2' : /笔试/.test(message) ? '1' : /无考核/.test(message) ? '3' : '3';
  }

  const trainingDuration = matchNumber(message, /培训(?:周期|时长)?[:：\s]*(\d+(?:\.\d+)?)\s*(天|小时)?/);
  if (trainingDuration !== undefined) {
    patch.trainingRequired = '1';
    patch.trainingDuration = trainingDuration;
    patch.trainingUnit = /培训[^，,。；;]*小时/.test(message) ? '2' : '1';
    patch.trainingAddressMode = /培训[^，,。；;]*其他地址/.test(message) ? '2' : '1';
  }

  const trainingContent = matchText(message, /培训内容[:：\s]*([^。；;\n]+)/);
  if (trainingContent) {
    patch.trainingRequired = '1';
    patch.trainingContent = trainingContent;
  }
}

function parseStoreAllocation(message: string): PositionStoreAllocation | undefined {
  const storeId = matchNumber(message, /门店\s*(?:ID|id)[:：#\s]*(\d+)/i);
  const recruitCount = matchCountNumber(message, /(?:招聘人数|招聘|招|人数)(?:改为|改成|调整为|设为|设置为|为|是)?[:：\s]*([一二两三四五六七八九十\d]+)\s*(?:名|个)?人?/);
  const thresholdValue = matchNumber(message, /(?:招聘阈值|阈值)[:：\s]*(\d+(?:\.\d+)?)\s*(?:倍)?/);

  if (storeId === undefined && recruitCount === undefined) {
    return undefined;
  }

  return {
    id: storeId ? String(storeId) : 'store-1',
    storeId,
    recruitCount,
    threshold: thresholdValue === undefined ? undefined : normalizeThresholdValue(thresholdValue),
  };
}

function parseAgeRange(message: string): [number, number] | undefined {
  const ageNumberPattern = String.raw`(?<!\d)(\d{1,2})(?!\d)`;
  const patterns = [
    new RegExp(String.raw`年龄(?:在|为|是)?\s*${ageNumberPattern}\s*(?:-|~|到|至)\s*${ageNumberPattern}\s*(?:岁|之间)?`),
    new RegExp(String.raw`${ageNumberPattern}\s*(?:-|~|到|至)\s*${ageNumberPattern}\s*(?:岁|之间)`),
  ];

  for (const pattern of patterns) {
    const matched = message.match(pattern);
    if (!matched) {
      continue;
    }
    const min = Number(matched[1]);
    const max = Number(matched[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return [min, max];
    }
  }

  return undefined;
}

function normalizeThresholdValue(value: number): number {
  return value <= 10 ? value * 10 : value;
}

type CompositeCreateName = {
  brandName: string;
  storeName: string;
  positionName: string;
};

function extractCreateCompositeName(message: string): CompositeCreateName | undefined {
  const createTail = matchText(message, /(?:新建|新增|创建|发布|发)(?:一个|一条)?(?:岗位|职位)[：:\s，,]*(.+)$/);
  const candidates = [
    matchText(message, /(?:新建|新增|创建|发布|发)(?:一个|一条)?(?:岗位|职位)[：:\s，,]+([^，,。；;\n]+)/),
    ...(createTail?.split(/[，,。；;\n]/) || []),
    matchText(message, /(?:新建|新增|创建|发布|发)(?:一个|一条)?\s*([^，,。；;\n]+?)(?:岗位|职位)/),
  ];

  for (const candidate of candidates) {
    const parsed = parseCompositeCreateNameCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function parseCompositeCreateNameCandidate(value?: string): CompositeCreateName | undefined {
  if (!value) {
    return undefined;
  }

  const parts = cleanupName(value)
    .replace(/^(?:岗位|职位)[：:\s]*/, '')
    .split(/[-_—–]+/)
    .map(part => cleanupName(part))
    .filter(Boolean);

  if (parts.length < 3) {
    return undefined;
  }

  const brandName = parts[0];
  const storeName = parts[1];
  let positionParts = parts.slice(2);
  if (positionParts.length > 1 && isEmploymentNameSuffix(positionParts[positionParts.length - 1])) {
    positionParts = positionParts.slice(0, -1);
  }

  const positionName = cleanupName(positionParts.join('-'));
  if (!brandName || !storeName || !positionName) {
    return undefined;
  }

  return { brandName, storeName, positionName };
}

function isEmploymentNameSuffix(value: string): boolean {
  return /^(全职|兼职|小时工|寒假工|暑假工|长期工|短期工|临时工)$/.test(value);
}

function formatChineseClockTime(hourText: string, minuteText?: string): string {
  const hour = Number(hourText);
  const minute = minuteText === '半' ? 30 : (normalizeNumber(minuteText?.replace('分', '')) ?? 0);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatColonClockTime(value: string): string {
  const [hour = '0', minute = '00'] = value.split(':');
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function normalizeSalaryUnit(value?: string): PositionFormValues['baseSalaryUnit'] | undefined {
  if (!value) return undefined;
  if (value === '天' || value === '日') return '1';
  if (value === '月') return '3';
  if (value === '小时' || value === '时') return '4';
  if (value === '单') return '5';
  if (value === '次') return '6';
  return undefined;
}

function normalizeSalaryRangeUnit(value?: string): PositionFormValues['salaryRangeUnit'] | undefined {
  if (!value || value === '月') return '3';
  if (value === '天' || value === '日') return '1';
  if (value === '周') return '2';
  return undefined;
}

function matchNumber(message: string, pattern: RegExp): number | undefined {
  const matched = message.match(pattern);
  if (!matched) {
    return undefined;
  }
  return normalizeNumber(matched[1]);
}

function matchCountNumber(message: string, pattern: RegExp): number | undefined {
  const matched = message.match(pattern);
  if (!matched) {
    return undefined;
  }
  return normalizeNumber(matched[1]) ?? parseChineseSmallNumber(matched[1]);
}

function parseChineseSmallNumber(value: string): number | undefined {
  const normalized = value.trim();
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized in digits) {
    return digits[normalized];
  }
  if (normalized === '十') {
    return 10;
  }
  const tenMatch = normalized.match(/^十([一二两三四五六七八九])$/);
  if (tenMatch) {
    return 10 + digits[tenMatch[1]];
  }
  const tensMatch = normalized.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/);
  if (tensMatch) {
    return digits[tensMatch[1]] * 10 + (tensMatch[2] ? digits[tensMatch[2]] : 0);
  }
  return undefined;
}

function matchStandaloneJobId(message: string): number | undefined {
  return findStandaloneJobIds(message)[0];
}

function isDetailByStandaloneJobIdMessage(message: string): boolean {
  return (
    /详情|详细|完整信息|岗位信息|职位信息|看下|看一下|看看|查看|检查/.test(message) &&
    !hasNumberUnitContext(message) &&
    findStandaloneJobIds(message).length > 0
  );
}

function findStandaloneJobIds(message: string): number[] {
  return uniqueNumbers(
    Array.from(message.matchAll(STANDALONE_JOB_ID_PATTERN))
      .map(match => Number(match[1]))
      .filter(item => Number.isFinite(item)),
  );
}

function matchText(message: string, pattern: RegExp): string | undefined {
  const matched = message.match(pattern);
  return matched?.[1]?.trim();
}

function extractImplicitJobName(message: string): string | undefined {
  if (/(?:品牌|项目)(?:下|的|里)?(?:的)?(?:所有|全部)?(?:岗位|职位)/.test(message)) {
    return undefined;
  }

  const patterns = [
    /(?:这个|该|此)?(?:岗位|职位)(?:的)?(?:信息|详情|详细|完整信息)[:：\s]+(.+)$/,
    /(?:岗位|职位)(?:信息|详情|详细|完整信息)[:：\s]+(.+)$/,
    /^(.+?)(?:查询|搜索|查|找|看|看看|看下|看一下|查看)(?:一下|下)?(?:这个|该|此)?(?:岗位|职位)?(?:详情|详细|完整信息|信息)$/,
    /(?:查询|搜索|查|找|看|看看|看下|看一下|查看)(?:一下|下)?(.+?)(?:岗位|职位)?(?:详情|详细|完整信息)/,
    /^(.+?)(?:这个|该|此)?(?:岗位|职位)(?:$|(?:看|看看|看下|看一下|查|查询|搜索|找|详情|详细|信息|列表|都有哪些|有哪些|有哪?些|哪些))/,
    /(?:查询|搜索|查|找|看|看看|看下|看一下)(?:一下|下)?(.+?)(?:岗位|职位)(?:信息|列表)?/,
  ];

  for (const pattern of patterns) {
    const matched = message.match(pattern);
    if (!matched) {
      continue;
    }

    const value = cleanupImplicitSearchName(matched[1]
      .replace(/^(根据|一下|下|帮我|我想让你帮我|我想让你|想让你|帮我看下|帮我看一下)/, '')
      .replace(/已发布|未发布|已下架|下架|在招/g, '')
      .replace(buildLeadingCityPattern(), '')
      .replace(STANDALONE_JOB_ID_PATTERN, ' ')
      .replace(/[^\s，,。；;]+?项目(?:下|的|里)?/g, '')
      .replace(/[^\s，,。；;]+?品牌(?:下|的|里)?/g, '')
      .replace(/城市区域|城市|地区|区域/g, '')
      .replace(/^(的|下的)?(所有|全部|哪些|都有哪些|有哪?些)+/, '')
      .trim());

    if (value && value.length <= 80 && !['询', '一下', '下', '这个', '该', '此'].includes(value)) {
      return value;
    }
  }

  return undefined;
}

function buildLeadingCityPattern(): RegExp {
  return new RegExp(`^(${KNOWN_CITY_NAMES.join('|')})市?的?`);
}

function cleanupImplicitSearchName(value: string): string {
  return cleanupName(value)
    .replace(buildLeadingCityPattern(), '')
    .replace(/(?:这个|该|此)?(?:岗位|职位)$/, '')
    .replace(/(?:查询|搜索|查一下|查下|查|找一下|找下|找|看一下|看下|看|看看)(?:这个|该|此)?$/, '')
    .replace(/(?:相关)(?:的)?$/, '')
    .replace(/(?:这个|该|此)$/, '')
    .replace(/(?:的)?(?:所有|全部|都有哪些|有哪些|有哪?些|哪些)$/, '')
    .replace(/(?:相关)(?:的)?$/, '')
    .trim();
}

function isExplicitEditMessage(message: string): boolean {
  return (
    /编辑|改成|改为|调整为|设置为|设为/.test(message) ||
    /(?:修改|更新|调整)(?:一下|下|这个|该|此|岗位|职位|\s|ID|id|编号|(?=\d))/.test(message) ||
    /帮我(?:把|将).+?(?:改|调整|设置)/.test(message)
  );
}

function extractKnownCityName(message: string): string | undefined {
  return KNOWN_CITY_NAMES.find(city => message.includes(city));
}

function stringFromJson(json: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = json?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanupName(value: string): string {
  return value
    .replace(/^(我想让你帮我|我想让你|想让你|你帮我|帮我|你|请|麻烦你)?(查询|搜索|查一下|查下|查|找一下|找下|找|看一下|看下|看|看看)?/, '')
    .replace(/^(一下|一个|这个|下|的|所有|全部|都有哪些|有哪些|哪些)/, '')
    .replace(/(?:的)?(?:所有|全部|都有哪些|有哪些|有哪?些|哪些)$/, '')
    .replace(/[，,。；;]$/, '')
    .trim();
}

function cleanupReferenceName(value: string): string | undefined {
  let text = cleanupName(value);
  const city = KNOWN_CITY_NAMES.find(item => text.startsWith(`${item}的`) || text.startsWith(`${item}市的`));
  if (city) {
    text = text.replace(new RegExp(`^${city}市?的`), '').trim();
  }

  return text && !/^(岗位|职位|岗位信息|职位信息)$/.test(text) ? text : undefined;
}
