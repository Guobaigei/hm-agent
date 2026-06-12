import type { Logger } from 'pino';

import {
  POSITION_STATUS_LABELS,
  SALARY_UNIT_OPTIONS,
} from './constants.ts';
import type {
  PositionDetailResult,
  PositionFormValues,
  PositionInterviewRoundConfig,
  PositionItem,
  PositionListResult,
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
      const parsed = text ? (JSON.parse(text) as unknown) : undefined;

      if (!response.ok) {
        throw new Error(`Position request failed with ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
      }

      return unwrapApiResponse(parsed) as T;
    } catch (error) {
      this.options.logger.warn(
        { path, method, error: error instanceof Error ? error.message : String(error) },
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
    commercialInsurance: normalizeString((salaryWelfare?.jobWelfare as Record<string, unknown> | undefined)?.haveInsurance) as PositionFormValues['commercialInsurance'],
    socialInsuranceList: normalizeStringArray((salaryWelfare?.jobWelfare as Record<string, unknown> | undefined)?.insuranceFund),
    ageMin: normalizeNumber(hiringRequirement?.minAge),
    ageMax: normalizeNumber(hiringRequirement?.maxAge),
    genders: normalizeStringArray(hiringRequirement?.genderIds) as PositionFormValues['genders'],
    education: normalizeString(hiringRequirement?.educationId),
    socialIdentity: normalizeString(hiringRequirement?.figureId) as PositionFormValues['socialIdentity'],
    weeklyMonthlyMode: normalizeString(workTimeArrangement?.weekMonthArrangementMode) as PositionFormValues['weeklyMonthlyMode'],
    workDays: normalizeNumber(workTimeArrangement?.perWeekWorkDays),
    restDays: normalizeNumber(workTimeArrangement?.perWeekRestDays),
    restMode: normalizeString(workTimeArrangement?.weekMonthRestMode) as PositionFormValues['restMode'],
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
    interviewRounds: normalizeString(processRequirement?.interviewTotal) as PositionFormValues['interviewRounds'],
    interviewTimeMode: normalizeString(processRequirement?.interviewTimeMode) as PositionFormValues['interviewTimeMode'],
    interviewRoundConfigs: normalizeInterviewRoundConfigs(processRequirement),
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

function unwrapApiResponse(payload: unknown): unknown {
  if (!isObjectRecord(payload) || !('code' in payload)) {
    return payload;
  }

  const code = normalizeNumber(payload.code);
  if (code === 0) {
    return payload.data;
  }

  const message = normalizeString(payload.message) ?? '请求失败';
  throw new Error(message);
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

function mapDetailSalaryConfig(row?: Record<string, unknown>): Partial<PositionFormValues> {
  if (!row) {
    return {};
  }

  return {
    settlementCycle: normalizeString(row.salaryPeriod) as PositionFormValues['settlementCycle'],
    payDay: normalizePayDay(row),
    baseSalary: normalizeNumber(row.salary),
    baseSalaryUnit: normalizeString(row.salaryUnit) as PositionFormValues['baseSalaryUnit'],
    salaryMin: normalizeNumber(row.minComprehensiveSalary),
    salaryMax: normalizeNumber(row.maxComprehensiveSalary),
    salaryRangeUnit: normalizeString(row.comprehensiveSalaryUnit) as PositionFormValues['salaryRangeUnit'],
  };
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
