import type { Logger } from 'pino';

import {
  POSITION_STATUS_LABELS,
  SALARY_UNIT_OPTIONS,
} from './constants.ts';
import { resolveDictionaryString } from './dictionary.ts';
import type {
  PositionDetailResult,
  PositionFormValues,
  PositionInterviewRoundConfig,
  PositionItem,
  PositionListResult,
  PositionSalaryConfig,
  PositionSearchParams,
  PositionStatus,
} from './types.ts';
import {
  buildEndpointUrl,
  findOptionLabel,
  formatTimeFromSeconds,
  getPath,
  isObjectRecord,
  normalizeNumber,
  normalizeNumberArray,
  normalizeString,
  normalizeStringArray,
} from './utils.ts';

type PositionClientOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  logger: Logger;
};

type ListResponse<T> = {
  result?: T[] | { result?: T[]; list?: T[]; total?: number };
  list?: T[];
  total?: number;
  pageData?: {
    result?: T[];
    list?: T[];
    total?: number;
  };
};

type JobListResponseItem = Record<string, unknown> & {
  jobBasicInfoId?: number | string;
  jobName?: string;
  salary?: string | number;
  salaryUnit?: string | number;
  signUpNum?: string | number;
  requirementNum?: string | number;
  projectName?: string;
  brandName?: string;
  cooperationMode?: string | number;
  createAt?: string;
  status?: number | string;
  showStatus?: number | string;
  cityRegion?: string;
};

type OptionEntity = {
  id: number;
  name: string;
  raw: Record<string, unknown>;
};

type CityNode = {
  id: number;
  name: string;
  children?: CityNode[];
};

export class PositionApiError extends Error {
  readonly status?: number;
  readonly statusText?: string;
  readonly code?: number;
  readonly path?: string;
  readonly method?: 'GET' | 'POST';
  readonly responseBody?: unknown;
  readonly data?: unknown;

  constructor(message: string, details: {
    status?: number;
    statusText?: string;
    code?: number;
    path?: string;
    method?: 'GET' | 'POST';
    responseBody?: unknown;
    data?: unknown;
  } = {}) {
    super(message);
    this.name = 'PositionApiError';
    this.status = details.status;
    this.statusText = details.statusText;
    this.code = details.code;
    this.path = details.path;
    this.method = details.method;
    this.responseBody = details.responseBody;
    this.data = details.data;
  }
}

export class PositionApiClient {
  constructor(private readonly options: PositionClientOptions) {}

  async getJobList(params: PositionSearchParams): Promise<PositionListResult> {
    const data = await this.post<ListResponse<JobListResponseItem>>('/job/jobList', buildJobListRequestParams(params));
    const rows = getListRows(data);
    return {
      result: rows.map((item, index) => mapJobListItem(item, index)),
      total: getListTotal(data),
    };
  }

  async getJobDetail(jobBasicInfoId: number): Promise<PositionDetailResult> {
    const data = await this.post<unknown>('/job/detail', { jobBasicInfoId });
    return normalizePositionDetail(data);
  }

  async createJob(payload: Record<string, unknown>): Promise<boolean> {
    return this.postBoolean('/job/create', payload);
  }

  async updateJob(payload: Record<string, unknown>): Promise<boolean> {
    return this.postBoolean('/job/update', payload);
  }

  async searchProjects(searchName: string): Promise<OptionEntity[]> {
    const data = await this.post<ListResponse<Record<string, unknown>>>('/project/list', {
      pageNum: 1,
      pageSize: 20,
      searchName,
      queryAllProjects: true,
    });
    return getListRows(data).map(mapOptionEntity).filter((item): item is OptionEntity => Boolean(item));
  }

  async searchBrands(searchName: string): Promise<OptionEntity[]> {
    const data = await this.post<ListResponse<Record<string, unknown>>>('/brands/list', {
      pageNum: 1,
      pageSize: 20,
      searchName,
    });
    return getListRows(data).map(mapOptionEntity).filter((item): item is OptionEntity => Boolean(item));
  }

  async searchStores(params: {
    searchName: string;
    projectIds?: number[];
    brandIds?: number[];
  }): Promise<Array<OptionEntity & {
    address?: string;
    exactAddress?: string;
    projectId?: number;
    brandId?: number;
    cityId?: number;
  }>> {
    const data = await this.post<ListResponse<Record<string, unknown>>>('/store/list', {
      pageNum: 1,
      pageSize: 100,
      searchName: params.searchName,
      projectIds: params.projectIds,
      brandIds: params.brandIds,
    });
    const stores: Array<OptionEntity & {
      address?: string;
      exactAddress?: string;
      projectId?: number;
      brandId?: number;
      cityId?: number;
    }> = [];

    for (const item of getListRows(data)) {
        const entity = mapOptionEntity(item);
        if (!entity) {
          continue;
        }
        stores.push({
          ...entity,
          address: normalizeString(item.address),
          exactAddress: normalizeString(item.exactAddress),
          projectId: normalizeNumber(item.projectId),
          brandId: normalizeNumber(item.brandId),
          cityId: normalizeNumber(item.cityId),
        });
    }

    return stores;
  }

  async getJobTemplateByJobType(jobTypeId: number): Promise<{ jobContent?: string }> {
    const data = await this.get<unknown>(`/job/getJobTemplateByJobType?jobTypeId=${encodeURIComponent(String(jobTypeId))}`);

    return {
      jobContent: isObjectRecord(data) ? normalizeString(data.jobContent) : undefined,
    };
  }

  async getJobTypes(): Promise<OptionEntity[]> {
    const data = await this.post<unknown>('/job/jobtype/getlist', undefined);
    const groups = Array.isArray(data) ? data : [];
    const result: OptionEntity[] = [];
    for (const group of groups) {
      if (!isObjectRecord(group)) {
        continue;
      }
      const subTypes = Array.isArray(group.subTypes) ? group.subTypes : [];
      for (const subType of subTypes) {
        if (!isObjectRecord(subType)) {
          continue;
        }
        const id = normalizeNumber(subType.id);
        const name = normalizeString(subType.name);
        if (id !== undefined && name) {
          result.push({ id, name, raw: subType });
        }
      }
    }
    return result;
  }

  async getProvinceList(): Promise<CityNode[]> {
    const data = await this.get<unknown>('/configdate/province/list');
    const provinces = Array.isArray(data) ? data : [];
    return provinces
      .map(item => mapCityNode(item))
      .filter((item): item is CityNode => Boolean(item));
  }

  private async postBoolean(path: string, body: unknown): Promise<boolean> {
    const result = await this.post<unknown>(path, body);
    if (typeof result === 'boolean') {
      return result;
    }
    return true;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(buildEndpointUrl(this.options.baseUrl, path), {
        method,
        headers: this.buildHeaders(),
        signal: controller.signal,
        body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
      });

      const text = await response.text();
      const parsed = parseJsonResponseText(text);

      if (!response.ok) {
        throw new PositionApiError(`Position request failed with ${response.status} ${response.statusText}`, {
          status: response.status,
          statusText: response.statusText,
          path,
          method,
          responseBody: text.slice(0, 500),
        });
      }

      return unwrapApiResponse(parsed, { path, method }) as T;
    } catch (error) {
      this.options.logger.warn(
        {
          path,
          method,
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof PositionApiError ? error.code : undefined,
          status: error instanceof PositionApiError ? error.status : undefined,
          responseBody: error instanceof PositionApiError ? error.responseBody : undefined,
        },
        'Position request failed',
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Headers {
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });

    if (this.options.token) {
      headers.set('Duliday-Token', this.options.token);
    }

    return headers;
  }
}

export function buildJobListRequestParams(params: PositionSearchParams): Record<string, unknown> {
  return {
    pageNum: params.pageNum,
    pageSize: params.pageSize,
    ...(params.jobBasicInfoIds?.length ? { jobBasicInfoIds: params.jobBasicInfoIds } : {}),
    ...(params.projectIds?.length ? { projectIds: params.projectIds } : {}),
    ...(params.brandIds?.length ? { brandIds: params.brandIds } : {}),
    ...(params.cityIdList?.length ? { cityIdList: params.cityIdList } : {}),
    ...(params.searchJobName ? { searchJobName: params.searchJobName } : {}),
    ...(params.statuses?.length ? { statuses: params.statuses } : {}),
  };
}

export function mapPositionResultSummary(item: PositionItem) {
  return {
    jobBasicInfoId: item.jobBasicInfoId ?? 0,
    name: item.positionName || item.jobName || '-',
    projectName: item.projectName,
    brandName: item.brandName,
    cityRegion: item.cityRegion,
    status: item.status,
    statusText: POSITION_STATUS_LABELS[item.status],
    salaryText: item.salaryText,
    recruitCount: item.requirementNum,
  };
}

export function buildPositionFormValuesFromDetail(detail?: PositionDetailResult): Partial<PositionFormValues> | undefined {
  if (!detail?.requirement) {
    return undefined;
  }

  const requirement = detail.requirement;
  const basicInfo = requirement.basicInfo as Record<string, unknown> | undefined;
  const salaryWelfare = requirement.salaryWelfare as Record<string, unknown> | undefined;
  const hiringRequirement = requirement.hiringRequirement as Record<string, unknown> | undefined;
  const workTimeArrangement = requirement.workTimeArrangement as Record<string, unknown> | undefined;
  const processRequirement = requirement.processRequirement as Record<string, unknown> | undefined;
  const storeRequirement = requirement.storeRequirement as Record<string, unknown> | undefined;
  const jobSalaries = Array.isArray(salaryWelfare?.jobSalaries)
    ? (salaryWelfare.jobSalaries as Record<string, unknown>[])
    : [];
  const primarySalary = jobSalaries.find(item => normalizeNumber(item.type) === 0);
  const probationSalary = jobSalaries.find(item => normalizeNumber(item.type) === 1);
  const trainingSalary = jobSalaries.find(item => normalizeNumber(item.type) === 2);
  const jobProbationSalary = isObjectRecord(salaryWelfare?.jobProbationSalary)
    ? salaryWelfare.jobProbationSalary
    : undefined;
  const jobWelfare = isObjectRecord(salaryWelfare?.jobWelfare)
    ? salaryWelfare.jobWelfare
    : undefined;
  const laborForm = normalizeString(basicInfo?.laborForm);
  const employmentType =
    laborForm && ['1', '3', '4', '5'].includes(laborForm)
      ? 'part-time'
      : laborForm === '2'
        ? 'full-time'
        : undefined;
  const partTimeType =
    employmentType === 'part-time' && laborForm && ['3', '4', '5'].includes(laborForm)
      ? (laborForm as PositionFormValues['partTimeType'])
      : undefined;

  return {
    projectId: normalizeNumber(getPath(basicInfo || {}, ['project', 'projectId']) ?? basicInfo?.projectId),
    projectName: normalizeString(getPath(basicInfo || {}, ['project', 'projectName']) ?? basicInfo?.projectName),
    brandId: normalizeNumber(getPath(basicInfo || {}, ['brand', 'brandId']) ?? basicInfo?.brandId),
    brandName: normalizeString(getPath(basicInfo || {}, ['brand', 'brandName']) ?? basicInfo?.brandName),
    jobName: normalizeString(basicInfo?.jobName),
    positionName: normalizeString(basicInfo?.jobNickName),
    positionCategory: normalizeNumber(basicInfo?.jobType),
    positionCategoryName: normalizeString(
      basicInfo?.jobTypeName ??
        basicInfo?.positionCategoryName ??
        getPath(basicInfo || {}, ['jobType', 'name']) ??
        getPath(basicInfo || {}, ['jobType', 'label']),
    ),
    workContent: normalizeString(basicInfo?.jobContent),
    employmentType,
    partTimeType,
    probationStatus:
      employmentType === 'full-time'
        ? (normalizeString(basicInfo?.haveProbation) as PositionFormValues['probationStatus'])
        : undefined,
    cooperationMode: normalizeString(basicInfo?.cooperationMode) as PositionFormValues['cooperationMode'],
    trialRequired: normalizeString(basicInfo?.needProbationWork) as PositionFormValues['trialRequired'],
    trainingRequired: normalizeString(basicInfo?.needTraining) as PositionFormValues['trainingRequired'],
    employmentDurationType: normalizeString(workTimeArrangement?.employmentForm) as PositionFormValues['employmentDurationType'],
    minWorkMonths: normalizeNumber(workTimeArrangement?.minWorkMonths),
    temporaryEmploymentStartTime: normalizeString(workTimeArrangement?.temporaryEmploymentStartTime),
    temporaryEmploymentEndTime: normalizeString(workTimeArrangement?.temporaryEmploymentEndTime),
    ...mapDetailSalaryConfig(primarySalary),
    probationSalaryConfig: mapOptionalDetailSalaryConfig(probationSalary),
    trainingSalaryConfig: mapOptionalDetailSalaryConfig(trainingSalary),
    trialSalaryAmount: normalizeNumber(jobProbationSalary?.salary),
    trialSalaryUnit: normalizeString(jobProbationSalary?.salaryUnit) as PositionFormValues['trialSalaryUnit'],
    trialSalaryRemark: normalizeString(jobProbationSalary?.otherSalaryDescription),
    commercialInsurance: normalizeString(jobWelfare?.haveInsurance) as PositionFormValues['commercialInsurance'],
    socialInsuranceList: normalizeStringArray(jobWelfare?.insuranceFund),
    housingBenefit: normalizeString(jobWelfare?.accommodation) as PositionFormValues['housingBenefit'],
    housingSubsidy: normalizeNumber(jobWelfare?.accommodationSalary),
    housingSubsidyUnit: normalizeString(jobWelfare?.accommodationSalaryUnit) as PositionFormValues['housingSubsidyUnit'],
    housingBenefitRemark: normalizeString(jobWelfare?.accommodationAllowanceDesc),
    mealBenefit: normalizeString(jobWelfare?.catering) as PositionFormValues['mealBenefit'],
    mealSubsidy: normalizeNumber(jobWelfare?.cateringSalary),
    mealSubsidyUnit: normalizeString(jobWelfare?.cateringSalaryUnit) as PositionFormValues['mealSubsidyUnit'],
    mealBenefitRemark: normalizeString(jobWelfare?.cateringAllowanceDesc),
    transportSubsidy: normalizeNumber(jobWelfare?.trafficAllowanceSalary),
    transportSubsidyUnit: normalizeString(jobWelfare?.trafficAllowanceSalaryUnit) as PositionFormValues['transportSubsidyUnit'],
    transportBenefitRemark: normalizeString(jobWelfare?.trafficAllowance),
    memo: normalizeString(jobWelfare?.memo),
    trialBenefitConfig: mapTrialBenefitConfig(jobWelfare),
    ageMin: normalizeNumber(hiringRequirement?.minAge),
    ageMax: normalizeNumber(hiringRequirement?.maxAge),
    genders: normalizeStringArray(hiringRequirement?.genderIds) as PositionFormValues['genders'],
    maleRequirement: mapPhysicalRequirement({
      heightMin: hiringRequirement?.manMinHeight,
      heightMax: hiringRequirement?.manMaxHeight,
      weightMin: hiringRequirement?.manMinWeight,
      weightMax: hiringRequirement?.manMaxWeight,
    }),
    femaleRequirement: mapPhysicalRequirement({
      heightMin: hiringRequirement?.womanMinHeight,
      heightMax: hiringRequirement?.womanMaxHeight,
      weightMin: hiringRequirement?.womanMinWeight,
      weightMax: hiringRequirement?.womanMaxWeight,
    }),
    education: normalizeString(hiringRequirement?.educationId),
    socialIdentity: normalizeString(hiringRequirement?.figureId) as PositionFormValues['socialIdentity'],
    socialInsurancePayments: normalizeStringArray(hiringRequirement?.socialSecurityTypes),
    marriageMode: normalizeString(hiringRequirement?.marriageBearingType) as PositionFormValues['marriageMode'],
    marriageStatus: normalizeString(hiringRequirement?.marriageBearingStatus),
    nativePlaceMode: normalizeString(hiringRequirement?.nativePlaceRequirementType) as PositionFormValues['nativePlaceMode'],
    nativePlaces: normalizeStringArray(hiringRequirement?.nativePlaceIds),
    ethnicityMode: normalizeString(hiringRequirement?.nationRequirementType) as PositionFormValues['ethnicityMode'],
    ethnicities: normalizeStringArray(hiringRequirement?.nationIds),
    nationality: resolveDictionaryString(
      'spone_country_requirement_type',
      hiringRequirement?.countryRequirementType,
    ) as PositionFormValues['nationality'],
    commuteLimit: normalizeNumber(workTimeArrangement?.maxWorkTakingTime),
    experienceRequirement: mapExperienceRequirement(hiringRequirement),
    certificateTypes: normalizeStringArray(hiringRequirement?.certificates),
    healthCertificateType: normalizeString(hiringRequirement?.healthCertificateType) as PositionFormValues['healthCertificateType'],
    driverLicenseType: normalizeString(hiringRequirement?.driverLicenseType) as PositionFormValues['driverLicenseType'],
    languages: normalizeStringArray(hiringRequirement?.languages),
    languageRemark: normalizeString(hiringRequirement?.languageRemark),
    softwareSkills: normalizeString(hiringRequirement?.softSkill),
    weeklyMonthlyMode: normalizeString(workTimeArrangement?.weekMonthArrangementMode) as PositionFormValues['weeklyMonthlyMode'],
    workDays: normalizeNumber(workTimeArrangement?.perWeekWorkDays),
    restDays: normalizeNumber(workTimeArrangement?.perWeekRestDays),
    restMode: normalizeString(workTimeArrangement?.weekMonthRestMode) as PositionFormValues['restMode'],
    workHourIntervalType: normalizeString(workTimeArrangement?.arrangementCycleType) as PositionFormValues['workHourIntervalType'],
    workHourRequirementType: normalizeString(workTimeArrangement?.onWorkLimitType) as PositionFormValues['workHourRequirementType'],
    workHours: normalizeNumber(workTimeArrangement?.onWorkTime),
    workHoursUnit: normalizeString(workTimeArrangement?.onWorkTimeUnit) as PositionFormValues['workHoursUnit'],
    dailyScheduleMode: normalizeString(workTimeArrangement?.arrangementType) as PositionFormValues['dailyScheduleMode'],
    dailyWorkDuration: normalizeNumber(workTimeArrangement?.perDayMinWorkHours),
    dailyTimeRange:
      formatTimeFromSeconds(workTimeArrangement?.goToWorkStartTime) &&
      formatTimeFromSeconds(workTimeArrangement?.goOffWorkStartTime)
        ? [
            formatTimeFromSeconds(workTimeArrangement?.goToWorkStartTime)!,
            formatTimeFromSeconds(workTimeArrangement?.goOffWorkStartTime)!,
          ]
        : undefined,
    goOffWorkTimeType: normalizeString(workTimeArrangement?.goOffWorkTimeType) as PositionFormValues['goOffWorkTimeType'],
    shiftCodes: normalizeNumberArray(workTimeArrangement?.shiftCodes ?? workTimeArrangement?.rangeShiftTypes),
    interviewRounds: normalizeString(processRequirement?.interviewTotal) as PositionFormValues['interviewRounds'],
    interviewTimeMode: normalizeString(processRequirement?.interviewTimeMode) as PositionFormValues['interviewTimeMode'],
    interviewDeadlineEnabled: hasInterviewDeadline(processRequirement?.interviewTimes),
    interviewCycleRules: normalizeInterviewCycleRules(processRequirement?.interviewTimes),
    interviewFixedSlots: normalizeInterviewFixedSlots(processRequirement?.interviewTimes),
    interviewRoundConfigs: normalizeInterviewRoundConfigs(processRequirement),
    interviewCustomTags: normalizeDelimitedStringArray(processRequirement?.interviewExtLabel),
    trialAddressMode: normalizeString(processRequirement?.probationWorkMode) as PositionFormValues['trialAddressMode'],
    trialAddress: normalizeString(processRequirement?.probationWorkAddressText),
    trialDuration: normalizeNumber(processRequirement?.probationWorkPeriod),
    trialUnit: normalizeString(processRequirement?.probationWorkPeriodUnit) as PositionFormValues['trialUnit'],
    trialAssessment: normalizeString(processRequirement?.probationWorkAssessment) as PositionFormValues['trialAssessment'],
    trainingAddressMode: normalizeString(processRequirement?.trainMode) as PositionFormValues['trainingAddressMode'],
    trainingAddress: normalizeString(processRequirement?.trainAddress),
    trainingDuration: normalizeNumber(processRequirement?.trainPeriod),
    trainingUnit: normalizeString(processRequirement?.trainPeriodUnit) as PositionFormValues['trainingUnit'],
    trainingContent: normalizeString(processRequirement?.trainDesc),
    onboardingGrooming: normalizeString(processRequirement?.onWorkClothingExplain),
    onboardingMaterials: normalizeString(processRequirement?.onWorkInfo),
    onboardingProcess: normalizeString(processRequirement?.processDesc),
    recruitStoreAllocations: normalizeStoreAllocations(storeRequirement?.jobStores),
  };
}

function normalizeInterviewCycleRules(value: unknown): PositionFormValues['interviewCycleRules'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rows: NonNullable<PositionFormValues['interviewCycleRules']> = [];
  for (const [groupIndex, group] of value.filter(isObjectRecord).entries()) {
    const weekdays = Array.isArray(group.weekdays) ? group.weekdays : [undefined];
    const times = Array.isArray(group.times) ? group.times.filter(isObjectRecord) : [];
    for (const weekday of weekdays) {
      for (const [timeIndex, time] of times.entries()) {
        rows.push({
          id: `cycle-${groupIndex + 1}-${timeIndex + 1}`,
          weekday: normalizeString(weekday),
          startTime: formatTimeFromSeconds(time.start),
          endTime: formatTimeFromSeconds(time.end),
          deadlineDayOffset: normalizeDeadlineDayOffset(time.cycleDeadlineDay),
          deadlineTime: formatTimeFromSeconds(time.cycleDeadlineEnd),
        });
      }
    }
  }

  return rows.length ? rows : undefined;
}

function normalizeInterviewFixedSlots(value: unknown): PositionFormValues['interviewFixedSlots'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rows: NonNullable<PositionFormValues['interviewFixedSlots']> = [];
  for (const [groupIndex, group] of value.filter(isObjectRecord).entries()) {
    const times = Array.isArray(group.times) ? group.times.filter(isObjectRecord) : [];
    for (const [timeIndex, time] of times.entries()) {
      rows.push({
        id: `fixed-${groupIndex + 1}-${timeIndex + 1}`,
        interviewDate: normalizeString(group.interviewDate),
        startTime: formatTimeFromSeconds(time.start),
        endTime: formatTimeFromSeconds(time.end),
        deadline: normalizeString(time.fixedDeadline),
      });
    }
  }

  return rows.length ? rows : undefined;
}

function hasInterviewDeadline(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(isObjectRecord).some(group => {
    const times = Array.isArray(group.times) ? group.times.filter(isObjectRecord) : [];
    return times.some(time =>
      time.cycleDeadlineDay !== undefined ||
      time.cycleDeadlineEnd !== undefined ||
      time.fixedDeadline !== undefined,
    );
  }) || undefined;
}

function normalizeDeadlineDayOffset(value: unknown): '-2' | '-1' | '0' | undefined {
  const numberValue = normalizeNumber(value);
  if (numberValue === -2 || numberValue === -1 || numberValue === 0) {
    return String(numberValue) as '-2' | '-1' | '0';
  }
  return undefined;
}

function normalizeDelimitedStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }

  const text = normalizeString(value);
  if (!text) {
    return undefined;
  }

  const rows = text
    .split(/[,\s，]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return rows.length ? Array.from(new Set(rows)) : undefined;
}

function normalizeInterviewRoundConfigs(
  processRequirement?: Record<string, unknown>,
): PositionFormValues['interviewRoundConfigs'] {
  if (!processRequirement) {
    return undefined;
  }

  const rounds = [
    {
      interviewMode: normalizeString(processRequirement.firstInterviewWay),
      interviewRemark: normalizeString(processRequirement.firstInterviewDesc),
      interviewAddressMode: normalizeString(processRequirement.firstInterviewAddressMode),
      interviewAddress: normalizeString(processRequirement.interviewAddressText),
    },
    {
      interviewMode: normalizeString(processRequirement.secondInterviewWay),
      interviewRemark: normalizeString(processRequirement.secondInterviewDesc),
      interviewAddressMode: normalizeString(processRequirement.secondInterviewAddressMode),
      interviewAddress: normalizeString(processRequirement.secondInterviewAddressText),
    },
    {
      interviewMode: normalizeString(processRequirement.thirdInterviewWay),
      interviewRemark: normalizeString(processRequirement.thirdInterviewDesc),
      interviewAddressMode: normalizeString(processRequirement.thirdInterviewAddressMode),
      interviewAddress: normalizeString(processRequirement.thirdInterviewAddressText),
    },
  ].filter(round =>
    round.interviewMode ||
    round.interviewRemark ||
    round.interviewAddressMode ||
    round.interviewAddress,
  );

  return rounds.length
    ? rounds.map((round, index) => ({
        id: `round-${index + 1}`,
        interviewMode: round.interviewMode as PositionInterviewRoundConfig['interviewMode'],
        interviewRemark: round.interviewRemark,
        interviewAddressMode: round.interviewAddressMode as PositionInterviewRoundConfig['interviewAddressMode'],
        interviewAddress: round.interviewAddress,
      }))
    : undefined;
}

function parseJsonResponseText(text: string): unknown {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function unwrapApiResponse(payload: unknown, meta: {
  path: string;
  method: 'GET' | 'POST';
}): unknown {
  if (!isObjectRecord(payload) || !('code' in payload)) {
    return payload;
  }

  const code = normalizeNumber(payload.code);
  if (code === 0) {
    return payload.data;
  }

  const message = normalizeString(payload.message) ?? '请求失败';
  throw new PositionApiError(message, {
    code,
    path: meta.path,
    method: meta.method,
    responseBody: payload,
    data: payload.data,
  });
}

function getListRows<T>(data: ListResponse<T>): T[] {
  if (Array.isArray(data.pageData?.result)) {
    return data.pageData.result;
  }
  if (Array.isArray(data.pageData?.list)) {
    return data.pageData.list;
  }
  if (Array.isArray(data.result)) {
    return data.result;
  }
  if (!Array.isArray(data.result) && Array.isArray(data.result?.result)) {
    return data.result.result;
  }
  if (!Array.isArray(data.result) && Array.isArray(data.result?.list)) {
    return data.result.list;
  }
  if (Array.isArray(data.list)) {
    return data.list;
  }
  return [];
}

function getListTotal<T>(data: ListResponse<T>): number {
  if (typeof data.pageData?.total === 'number') {
    return data.pageData.total;
  }
  if (!Array.isArray(data.result) && typeof data.result?.total === 'number') {
    return data.result.total;
  }
  return typeof data.total === 'number' ? data.total : 0;
}

function mapJobListItem(item: JobListResponseItem, index: number): PositionItem {
  const jobBasicInfoId = normalizeNumber(item.jobBasicInfoId) || 0;
  const status = normalizeStatus(item.status);
  const salaryUnitLabel = findOptionLabel(SALARY_UNIT_OPTIONS, item.salaryUnit);
  const salary = normalizeNumber(item.salary);

  return {
    id: jobBasicInfoId ? String(jobBasicInfoId) : `job-${index + 1}`,
    jobBasicInfoId,
    jobId: jobBasicInfoId ? String(jobBasicInfoId) : undefined,
    jobName: normalizeString(item.jobName) || '',
    positionName: normalizeString(item.jobName) || '',
    baseSalary: salary,
    baseSalaryUnit: normalizeString(item.salaryUnit) as PositionItem['baseSalaryUnit'],
    salaryText: salary ? `${salary}${salaryUnitLabel || ''}` : undefined,
    requirementNum: normalizeNumber(item.requirementNum),
    signUpNum: normalizeNumber(item.signUpNum),
    projectName: normalizeString(item.projectName),
    brandName: normalizeString(item.brandName),
    cooperationMode: normalizeString(item.cooperationMode) as PositionItem['cooperationMode'],
    createdAt: normalizeString(item.createAt),
    updatedAt: normalizeString(item.createAt),
    status,
    showStatus: normalizeNumber(item.showStatus) === 1 ? 1 : 0,
    showToSupplier: normalizeNumber(item.showStatus) === 1,
    cityRegion: normalizeString(item.cityRegion),
  };
}

function normalizeStatus(value: unknown): PositionStatus {
  const status = normalizeNumber(value);
  if (status === 1) {
    return 'published';
  }
  if (status === 2) {
    return 'offline';
  }
  return 'unpublished';
}

function normalizePositionDetail(data: unknown): PositionDetailResult {
  if (!isObjectRecord(data)) {
    return {};
  }

  const looksLikeRequirementBody =
    isObjectRecord(data.basicInfo) ||
    isObjectRecord(data.salaryWelfare) ||
    isObjectRecord(data.hiringRequirement) ||
    isObjectRecord(data.workTimeArrangement) ||
    isObjectRecord(data.processRequirement) ||
    isObjectRecord(data.storeRequirement);
  const requirementSource =
    isObjectRecord(data.jobRequirement)
      ? data.jobRequirement
      : isObjectRecord(data.requirement)
        ? data.requirement
        : looksLikeRequirementBody
          ? data
          : undefined;

  return {
    jobBasicInfoId: normalizeNumber(data.jobBasicInfoId),
    jobDraftId: normalizeNumber(data.jobDraftId),
    immediate: normalizeNumber(data.immediate),
    requirement: requirementSource,
  };
}

function mapOptionEntity(item: Record<string, unknown>): OptionEntity | undefined {
  const id = normalizeNumber(item.id ?? item.value ?? item.projectId ?? item.brandId ?? item.storeId);
  const name = normalizeString(item.name ?? item.label ?? item.projectName ?? item.brandName ?? item.storeName);
  if (id === undefined || !name) {
    return undefined;
  }
  return { id, name, raw: item };
}

function mapCityNode(value: unknown): CityNode | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const id = normalizeNumber(value.id);
  const name = normalizeString(value.name);
  if (id === undefined || !name) {
    return undefined;
  }

  const childSource = Array.isArray(value.cities)
    ? value.cities
    : Array.isArray(value.regions)
      ? value.regions
      : [];

  return {
    id,
    name,
    children: childSource.map(item => mapCityNode(item)).filter((item): item is CityNode => Boolean(item)),
  };
}

function mapPhysicalRequirement(input: {
  heightMin?: unknown;
  heightMax?: unknown;
  weightMin?: unknown;
  weightMax?: unknown;
}): PositionFormValues['maleRequirement'] {
  const requirement = {
    heightMin: normalizeNumber(input.heightMin),
    heightMax: normalizeNumber(input.heightMax),
    weightMin: normalizeNumber(input.weightMin),
    weightMax: normalizeNumber(input.weightMax),
  };

  return Object.values(requirement).some(value => value !== undefined) ? requirement : undefined;
}

function mapExperienceRequirement(
  hiringRequirement?: Record<string, unknown>,
): PositionFormValues['experienceRequirement'] {
  if (!hiringRequirement) {
    return undefined;
  }

  const unit = normalizeNumber(hiringRequirement.minWorkTimeUnit);
  const requirement = {
    positionCategory: normalizeString(hiringRequirement.workExperienceJobType),
    duration: normalizeNumber(hiringRequirement.minWorkTime),
    unit:
      unit === 1
        ? 'year'
        : unit === 2
          ? 'month'
          : undefined,
  } as NonNullable<PositionFormValues['experienceRequirement']>;

  return Object.values(requirement).some(value => value !== undefined) ? requirement : undefined;
}

function mapDetailSalaryConfig(row?: Record<string, unknown>): Partial<PositionFormValues> {
  if (!row) {
    return {};
  }

  const salaryStairs = Array.isArray(row.jobSalaryStairs)
    ? row.jobSalaryStairs.filter(isObjectRecord)
    : undefined;
  const firstSalaryStair = salaryStairs?.[0];
  const specialSalaryList = Array.isArray(row.jobSpecialSalaryList)
    ? row.jobSpecialSalaryList.filter(isObjectRecord)
    : undefined;

  return {
    settlementCycle: normalizeString(row.salaryPeriod) as PositionFormValues['settlementCycle'],
    payDay: normalizePayDay(row),
    baseSalary: normalizeNumber(row.salary),
    baseSalaryUnit: normalizeString(row.salaryUnit) as PositionFormValues['baseSalaryUnit'],
    hasLadderSalary: normalizeString(row.haveStairSalary) as PositionFormValues['hasLadderSalary'],
    ladderSalaryType: normalizeString(
      firstSalaryStair?.fullWorkTimeUnit ?? firstSalaryStair?.perTimeUnit,
    ) as PositionFormValues['ladderSalaryType'],
    ladderSalaryTiers: normalizeSalaryTiers(salaryStairs),
    ladderSalaryRule: normalizeString(row.stairDescription) as PositionFormValues['ladderSalaryRule'],
    hasSpecialPeriodSalary:
      row.hasSpecialSalary === true
        ? '1'
        : row.hasSpecialSalary === false
          ? '0'
          : normalizeString(row.hasSpecialSalary) as PositionFormValues['hasSpecialPeriodSalary'],
    specialPeriodSalaryAmount: normalizeNumber(specialSalaryList?.[0]?.specialSalary),
    specialPeriodSalaryUnit: normalizeString(specialSalaryList?.[0]?.specialSalaryUnit) as PositionFormValues['specialPeriodSalaryUnit'],
    specialPeriodSalaryRemark: normalizeString(specialSalaryList?.[0]?.specialSalaryRemark),
    specialPeriods: normalizeTimePeriods(specialSalaryList),
    holidaySalaryType: normalizeString(row.holidaySalary) as PositionFormValues['holidaySalaryType'],
    holidaySalaryMultiplier: normalizeNumber(row.holidaySalaryMultiple),
    holidaySalaryAmount: normalizeNumber(row.holidayFixedSalary),
    holidaySalaryUnit: normalizeString(row.holidayFixedSalaryUnit) as PositionFormValues['holidaySalaryUnit'],
    holidaySalaryRemark: normalizeString(row.holidaySalaryDesc),
    overtimeSalaryType: normalizeString(row.overtimeSalary) as PositionFormValues['overtimeSalaryType'],
    overtimeSalaryMultiplier: normalizeNumber(row.overtimeSalaryMultiple),
    overtimeSalaryAmount: normalizeNumber(row.overtimeFixedSalary),
    overtimeSalaryUnit: normalizeString(row.overtimeFixedSalaryUnit) as PositionFormValues['overtimeSalaryUnit'],
    overtimeSalaryRemark: normalizeString(row.overtimeSalaryDesc),
    bonusSubsidyAmount: normalizeNumber(row.attendenceSalary),
    bonusSubsidyUnit: normalizeString(row.attendenceSalaryUnit) as PositionFormValues['bonusSubsidyUnit'],
    bonusSubsidyRemark: normalizeString(row.bonusDesc),
    commissionRemark: normalizeString(row.commission),
    performanceSalaryRemark: normalizeString(row.performance),
    salaryMin: normalizeNumber(row.minComprehensiveSalary),
    salaryMax: normalizeNumber(row.maxComprehensiveSalary),
    salaryRangeUnit: normalizeString(row.comprehensiveSalaryUnit) as PositionFormValues['salaryRangeUnit'],
  };
}

function mapOptionalDetailSalaryConfig(row?: Record<string, unknown>): PositionSalaryConfig | undefined {
  const mapped = mapDetailSalaryConfig(row);
  return Object.values(mapped).some(value => value !== undefined)
    ? mapped as PositionSalaryConfig
    : undefined;
}

function mapTrialBenefitConfig(jobWelfare?: Record<string, unknown>): PositionFormValues['trialBenefitConfig'] {
  if (!jobWelfare) {
    return undefined;
  }

  type TrialBenefitConfig = NonNullable<PositionFormValues['trialBenefitConfig']>;
  const config = {
    commercialInsurance: normalizeString(jobWelfare.probationInsuranceReceive) as TrialBenefitConfig['commercialInsurance'],
    housingBenefit: normalizeString(jobWelfare.probationAccommodationSalaryReceive) as TrialBenefitConfig['housingBenefit'],
    mealBenefit: normalizeString(jobWelfare.probationCateringSalaryReceive) as TrialBenefitConfig['mealBenefit'],
  };

  return Object.values(config).some(value => value !== undefined) ? config : undefined;
}

function normalizeSalaryTiers(value: unknown): PositionFormValues['ladderSalaryTiers'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rows = value
    .filter(isObjectRecord)
    .map((row, index) => ({
      id: normalizeString(row.id) || `tier-${index + 1}`,
      min: normalizeNumber(row.fullWorkTime),
      max: normalizeNumber(row.fullWorkMaxTime),
      amount: normalizeNumber(row.salary),
    }));

  return rows.length ? rows : undefined;
}

function normalizeTimePeriods(value: Array<Record<string, unknown>> | undefined): PositionFormValues['specialPeriods'] {
  const rows = value
    ?.map((row, index) => ({
      id: normalizeString(row.id) || `period-${index + 1}`,
      startTime: formatTimeFromSeconds(row.startTime),
      endTime: formatTimeFromSeconds(row.endTime),
    }))
    .filter(row => row.startTime || row.endTime);

  return rows?.length ? rows : undefined;
}

function normalizePayDay(row: Record<string, unknown>): string | undefined {
  return normalizeString(row.daySalaryPeriodTime ?? row.weedSalaryPeriodTime ?? row.monthSalaryPeriodTime);
}

function normalizeStoreAllocations(value: unknown): PositionFormValues['recruitStoreAllocations'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter(isObjectRecord)
    .map((row, index) => ({
      id: normalizeString(row.id) || `store-${index + 1}`,
      storeId: normalizeNumber(row.storeId),
      storeName: normalizeString(row.storeName),
      storeAddress: normalizeString(row.storeAddress),
      storeExactAddress: normalizeString(row.storeExactAddress),
      recruitCount: normalizeNumber(row.requirementNum ?? row.recruitCount),
      threshold: normalizeNumber(row.thresholdNum ?? row.threshold),
    }));
}
