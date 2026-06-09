import { randomUUID } from 'node:crypto';

import {
  ADDRESS_MODE_OPTIONS,
  COMMERCIAL_INSURANCE_OPTIONS,
  COOPERATION_MODE_OPTIONS,
  DAILY_SCHEDULE_MODE_OPTIONS,
  DURATION_UNIT_OPTIONS,
  EDUCATION_OPTIONS,
  EMPLOYMENT_DURATION_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  INTERVIEW_MODE_OPTIONS,
  INTERVIEW_ROUND_OPTIONS,
  INTERVIEW_TIME_MODE_OPTIONS,
  PART_TIME_TYPE_OPTIONS,
  PROCESS_REQUIRED_OPTIONS,
  PROBATION_STATUS_OPTIONS,
  REST_MODE_OPTIONS,
  SALARY_RANGE_UNIT_OPTIONS,
  SALARY_UNIT_OPTIONS,
  SETTLEMENT_CYCLE_OPTIONS,
  SOCIAL_IDENTITY_OPTIONS,
  SOCIAL_INSURANCE_OPTIONS,
  TRIAL_ASSESSMENT_OPTIONS,
  WEEKLY_MONTHLY_MODE_OPTIONS,
  WORK_HOUR_INTERVAL_TYPE_OPTIONS,
  WORK_HOUR_REQUIREMENT_TYPE_OPTIONS,
  WORK_HOUR_UNIT_OPTIONS,
  getFieldLabel,
  getFieldTab,
  POSITION_FIELD_SCHEMA,
  POSITION_TAB_LABELS,
  type OptionItem,
} from './constants.ts';
import { getDictionaryLabel, resolveDictionaryString } from './dictionary.ts';
import type {
  FieldIssue,
  PositionDraftMode,
  PositionDraftPreview,
  PositionFieldDiff,
  PositionFormValues,
  PositionPreviewField,
  PositionStoreAllocation,
} from './types.ts';
import { hasMeaningfulValue, normalizeNumber, normalizeString } from './utils.ts';

export function createDefaultPositionFormValues(): PositionFormValues {
  return {
    employmentType: 'part-time',
    partTimeType: '5',
    employmentDurationType: '1',
    cooperationMode: '2',
    trialRequired: '0',
    trainingRequired: '0',
    settlementCycle: '3',
    baseSalaryUnit: '3',
    salaryRangeUnit: '3',
    hasLadderSalary: '2',
    hasSpecialPeriodSalary: '0',
    holidaySalaryType: '3',
    overtimeSalaryType: '3',
    commercialInsurance: '2',
    housingBenefit: '0',
    mealBenefit: '0',
    socialIdentity: '0',
    education: '1',
    marriageMode: '0',
    nativePlaceMode: '0',
    ethnicityMode: '0',
    nationality: 'unlimited',
    weeklyMonthlyMode: '1',
    workDays: 6,
    restDays: 1,
    restMode: '0',
    dailyScheduleMode: '2',
    goOffWorkTimeType: '1',
    interviewRounds: '0',
  };
}

export function mergePositionValues(
  base: PositionFormValues,
  patch: Partial<PositionFormValues>,
): PositionFormValues {
  return cleanPositionFormValues({
    ...base,
    ...patch,
    maleRequirement: {
      ...(base.maleRequirement || {}),
      ...(patch.maleRequirement || {}),
    },
    femaleRequirement: {
      ...(base.femaleRequirement || {}),
      ...(patch.femaleRequirement || {}),
    },
    probationSalaryConfig: {
      ...(base.probationSalaryConfig || {}),
      ...(patch.probationSalaryConfig || {}),
    },
    trainingSalaryConfig: {
      ...(base.trainingSalaryConfig || {}),
      ...(patch.trainingSalaryConfig || {}),
    },
    recruitStoreAllocations: mergeStoreAllocations(
      base.recruitStoreAllocations,
      patch.recruitStoreAllocations,
    ),
  });
}

function mergeStoreAllocations(
  baseRows?: PositionStoreAllocation[],
  patchRows?: PositionStoreAllocation[],
): PositionStoreAllocation[] | undefined {
  if (!patchRows) {
    return baseRows;
  }

  if (!baseRows?.length) {
    return patchRows;
  }

  const nextRows = [...baseRows];
  for (const [index, patchRow] of patchRows.entries()) {
    const matchedIndex = findStoreAllocationIndex(nextRows, patchRow, index);
    const targetIndex = matchedIndex >= 0 ? matchedIndex : index;
    const baseRow = nextRows[targetIndex];
    nextRows[targetIndex] = {
      ...(baseRow || { id: patchRow.id || `store-${targetIndex + 1}` }),
      ...dropUndefinedStoreAllocationFields(patchRow),
      id: patchRow.id || baseRow?.id || `store-${targetIndex + 1}`,
    };
  }

  return nextRows;
}

function dropUndefinedStoreAllocationFields(
  row: PositionStoreAllocation,
): Partial<PositionStoreAllocation> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as Partial<PositionStoreAllocation>;
}

function findStoreAllocationIndex(
  rows: PositionStoreAllocation[],
  patchRow: PositionStoreAllocation,
  fallbackIndex: number,
): number {
  if (patchRow.storeId !== undefined) {
    const byStoreId = rows.findIndex(row => row.storeId === patchRow.storeId);
    if (byStoreId >= 0) {
      return byStoreId;
    }
  }

  if (patchRow.id && patchRow.id !== 'store-1') {
    const byId = rows.findIndex(row => row.id === patchRow.id);
    if (byId >= 0) {
      return byId;
    }
  }

  return fallbackIndex < rows.length ? fallbackIndex : -1;
}

export function cleanPositionFormValues(values: PositionFormValues): PositionFormValues {
  const next: PositionFormValues = { ...values };

  if (next.employmentType === 'full-time') {
    next.partTimeType = undefined;
    next.employmentDurationType = '1';
    next.minWorkMonths = undefined;
    next.temporaryEmploymentStartTime = undefined;
    next.temporaryEmploymentEndTime = undefined;
  }

  if (next.employmentType !== 'part-time') {
    next.partTimeType = undefined;
  }

  if (next.employmentType !== 'part-time' || next.employmentDurationType !== '1') {
    next.minWorkMonths = undefined;
  }

  if (next.employmentType !== 'part-time' || next.employmentDurationType !== '2') {
    next.temporaryEmploymentStartTime = undefined;
    next.temporaryEmploymentEndTime = undefined;
  }

  if (next.employmentType !== 'full-time') {
    next.probationStatus = undefined;
    next.probationSalaryConfig = undefined;
    next.socialInsuranceList = undefined;
  } else if (next.probationStatus !== '2') {
    next.probationSalaryConfig = undefined;
  }

  if (next.trainingRequired !== '1') {
    next.trainingSalaryConfig = undefined;
    next.trainingAddressMode = undefined;
    next.trainingAddress = undefined;
    next.trainingDuration = undefined;
    next.trainingUnit = undefined;
    next.trainingContent = undefined;
  } else if (next.trainingAddressMode !== '2') {
    next.trainingAddress = undefined;
  }

  if (next.trialRequired !== '1') {
    next.trialSalaryAmount = undefined;
    next.trialSalaryUnit = undefined;
    next.trialSalaryRemark = undefined;
    next.trialBenefitConfig = undefined;
    next.trialAddressMode = undefined;
    next.trialAddress = undefined;
    next.trialDuration = undefined;
    next.trialUnit = undefined;
    next.trialAssessment = undefined;
    next.trialAssessmentRemark = undefined;
  } else {
    if (next.trialAddressMode !== '2') {
      next.trialAddress = undefined;
    }
    if (next.trialAssessment !== '4') {
      next.trialAssessmentRemark = undefined;
    }
  }

  if (!next.genders?.includes('1')) {
    next.maleRequirement = undefined;
  }

  if (!next.genders?.includes('2')) {
    next.femaleRequirement = undefined;
  }

  if (!['2', '3'].includes(String(next.socialIdentity))) {
    next.socialInsurancePayments = undefined;
  }

  if (!['1', '2'].includes(String(next.marriageMode))) {
    next.marriageStatus = undefined;
  }

  if (!['1', '2'].includes(String(next.nativePlaceMode))) {
    next.nativePlaces = undefined;
  }

  if (!['1', '2'].includes(String(next.ethnicityMode))) {
    next.ethnicities = undefined;
  }

  if (!next.certificateTypes?.includes('1')) {
    next.healthCertificateType = undefined;
  }

  if (!next.certificateTypes?.includes('3')) {
    next.driverLicenseType = undefined;
  }

  if (next.weeklyMonthlyMode !== '1') {
    next.workDays = undefined;
    next.restDays = undefined;
    next.restMode = undefined;
  }

  if (next.weeklyMonthlyMode !== '2') {
    next.workHourIntervalType = undefined;
    next.workHourRequirementType = undefined;
    next.workHours = undefined;
    next.workHoursUnit = undefined;
  }

  if (next.dailyScheduleMode !== '2') {
    next.dailyWorkDuration = undefined;
    next.dailyTimeRange = undefined;
    next.goOffWorkTimeType = undefined;
    next.shiftCodes = undefined;
  }

  if (next.dailyScheduleMode !== '1' && next.dailyScheduleMode !== '3') {
    next.attendanceRequirement = undefined;
    next.shiftInfos = undefined;
  } else {
    next.attendanceRequirement = next.dailyScheduleMode;
  }

  if (next.interviewRounds === '0') {
    next.interviewRoundConfigs = undefined;
    next.interviewTimeMode = undefined;
    next.interviewDeadlineEnabled = undefined;
    next.interviewCycleRules = undefined;
    next.interviewFixedSlots = undefined;
    next.interviewLabelIds = undefined;
    next.interviewBuiltinTagIds = undefined;
    next.interviewCustomTags = undefined;
  }

  if (Array.isArray(next.workEnvironmentImages)) {
    next.workEnvironmentImages = next.workEnvironmentImages.filter(Boolean).slice(0, 3);
  }

  return next;
}

export function validatePositionValues(values: PositionFormValues): {
  missingFields: FieldIssue[];
  validationErrors: FieldIssue[];
} {
  const missingFields: FieldIssue[] = [];
  const validationErrors: FieldIssue[] = [];

  function requireField(field: keyof PositionFormValues, message?: string) {
    if (!hasMeaningfulValue(values[field])) {
      missingFields.push({
        field: String(field),
        label: getFieldLabel(String(field)),
        message: message ?? buildMissingFieldMessage(String(field)),
      });
    }
  }

  requireField('projectId');
  requireField('brandId');
  requireField('positionName');
  requireField('positionCategory');
  requireField('workContent');
  requireField('employmentType');
  requireField('cooperationMode');
  requireField('trialRequired');
  requireField('trainingRequired');

  if (values.employmentType === 'part-time') {
    requireField('partTimeType');
    requireField('employmentDurationType');
    if (values.employmentDurationType === '1') {
      requireField('minWorkMonths');
    }
    if (values.employmentDurationType === '2') {
      requireField('temporaryEmploymentStartTime');
      requireField('temporaryEmploymentEndTime');
    }
  }

  if (values.employmentType === 'full-time') {
    requireField('probationStatus');
    requireField('socialInsuranceList');
  }

  requireField('settlementCycle');
  requireField('payDay');
  requireField('baseSalary');
  requireField('baseSalaryUnit');
  requireField('salaryMin');
  requireField('salaryMax');
  requireField('salaryRangeUnit');
  requireField('commercialInsurance');

  requireField('ageMin');
  requireField('ageMax');
  requireField('genders');
  requireField('education');
  requireField('socialIdentity');

  requireField('weeklyMonthlyMode');
  if (values.weeklyMonthlyMode === '1') {
    requireField('workDays');
    requireField('restDays');
    requireField('restMode');
  }
  if (values.weeklyMonthlyMode === '2') {
    requireField('workHourIntervalType');
    requireField('workHourRequirementType');
    requireField('workHours');
    requireField('workHoursUnit');
  }

  requireField('dailyScheduleMode');
  if (values.dailyScheduleMode === '2') {
    requireField('dailyWorkDuration');
    requireField('dailyTimeRange');
  }
  if (values.dailyScheduleMode === '1' || values.dailyScheduleMode === '3') {
    requireField('shiftInfos');
  }

  requireField('interviewRounds');
  if (values.interviewRounds && values.interviewRounds !== '0') {
    requireField('interviewTimeMode');
    requireField('interviewRoundConfigs');
  }

  if (values.trialRequired === '1') {
    requireField('trialAddressMode');
    requireField('trialDuration');
    requireField('trialUnit');
    requireField('trialAssessment');
  }

  if (values.trainingRequired === '1') {
    requireField('trainingAddressMode');
    requireField('trainingDuration');
    requireField('trainingUnit');
    requireField('trainingContent');
  }

  requireField('recruitStoreAllocations');

  if (
    typeof values.salaryMin === 'number' &&
    typeof values.salaryMax === 'number' &&
    values.salaryMin > values.salaryMax
  ) {
    validationErrors.push({
      field: 'salaryMin',
      label: '综合薪资',
      message: '综合薪资下限不能大于上限',
    });
  }

  if (
    typeof values.ageMin === 'number' &&
    typeof values.ageMax === 'number' &&
    values.ageMin > values.ageMax
  ) {
    validationErrors.push({
      field: 'ageMin',
      label: '年龄',
      message: '年龄下限不能大于上限',
    });
  }

  for (const row of values.recruitStoreAllocations || []) {
    if (!row.storeId && !row.storeName) {
      validationErrors.push({
        field: 'recruitStoreAllocations',
        label: '招聘门店',
        message: '招聘门店必须包含门店 ID 或门店名称',
      });
    }
    if (!row.recruitCount || row.recruitCount <= 0) {
      validationErrors.push({
        field: 'recruitStoreAllocations',
        label: '招聘人数',
        message: `门店 ${row.storeName || row.storeId || '-'} 缺少招聘人数`,
      });
    }
    if (!row.threshold) {
      validationErrors.push({
        field: 'recruitStoreAllocations',
        label: '招聘阈值',
        message: `门店 ${row.storeName || row.storeId || '-'} 缺少招聘阈值`,
      });
    }
  }

  return { missingFields, validationErrors };
}

const FIELD_OPTION_HINTS: Partial<Record<keyof PositionFormValues, OptionItem[]>> = {
  employmentType: EMPLOYMENT_TYPE_OPTIONS,
  partTimeType: PART_TIME_TYPE_OPTIONS,
  employmentDurationType: EMPLOYMENT_DURATION_OPTIONS,
  probationStatus: PROBATION_STATUS_OPTIONS,
  cooperationMode: COOPERATION_MODE_OPTIONS,
  trialRequired: PROCESS_REQUIRED_OPTIONS,
  trainingRequired: PROCESS_REQUIRED_OPTIONS,
  settlementCycle: SETTLEMENT_CYCLE_OPTIONS,
  baseSalaryUnit: SALARY_UNIT_OPTIONS,
  salaryRangeUnit: SALARY_RANGE_UNIT_OPTIONS,
  commercialInsurance: COMMERCIAL_INSURANCE_OPTIONS,
  genders: GENDER_OPTIONS,
  education: EDUCATION_OPTIONS,
  socialIdentity: SOCIAL_IDENTITY_OPTIONS,
  weeklyMonthlyMode: WEEKLY_MONTHLY_MODE_OPTIONS,
  restMode: REST_MODE_OPTIONS,
  workHourIntervalType: WORK_HOUR_INTERVAL_TYPE_OPTIONS,
  workHourRequirementType: WORK_HOUR_REQUIREMENT_TYPE_OPTIONS,
  workHoursUnit: WORK_HOUR_UNIT_OPTIONS,
  dailyScheduleMode: DAILY_SCHEDULE_MODE_OPTIONS,
  interviewRounds: INTERVIEW_ROUND_OPTIONS,
  interviewTimeMode: INTERVIEW_TIME_MODE_OPTIONS,
  trialAddressMode: ADDRESS_MODE_OPTIONS,
  trialUnit: DURATION_UNIT_OPTIONS,
  trialAssessment: TRIAL_ASSESSMENT_OPTIONS,
  trainingAddressMode: ADDRESS_MODE_OPTIONS,
  trainingUnit: DURATION_UNIT_OPTIONS,
};

const FIELD_TEXT_HINTS: Partial<Record<keyof PositionFormValues, string>> = {
  projectId: '可填写项目 ID 或项目名称，例如：项目 上海肯德基。',
  brandId: '可填写品牌 ID 或品牌名称，例如：品牌 肯德基。',
  positionName: '填写岗位短名称，例如：岗位名称 服务员。',
  positionCategory: '可填写职位类别 ID 或工种名称，例如：工种 服务员。',
  workContent: '填写岗位职责，例如：工作内容 负责门店服务和基础清洁。',
  minWorkMonths: '填写数字月数，例如：至少上岗 6 个月。',
  temporaryEmploymentStartTime: '填写短期用工开始日期，例如：2026-07-01。',
  temporaryEmploymentEndTime: '填写短期用工结束日期，例如：2026-08-31。',
  payDay: '日结可填“当日结/次日结”，月结可填每月几号，例如：发薪日 15 号。',
  baseSalary: '填写数字金额，例如：基本薪资 25 元/时。',
  salaryMin: '填写综合薪资下限，例如：综合薪资 4000-6000 元/月。',
  salaryMax: '填写综合薪资上限，例如：综合薪资 4000-6000 元/月。',
  socialInsuranceList: `可选：无、五险一金、${SOCIAL_INSURANCE_OPTIONS.map(item => item.label).join('、')}。可多选，例如：无社保公积金；或：缴纳养老保险、医疗保险、工伤保险。`,
  ageMin: '填写年龄下限，例如：18 到 45 岁。',
  ageMax: '填写年龄上限，例如：18 到 45 岁。',
  workDays: '填写做几天，例如：做 5 休 2。',
  restDays: '填写休几天，例如：做 5 休 2。',
  workHours: '填写工时数字，例如：每周至少 40 小时。',
  dailyWorkDuration: '填写每日工时，例如：每天 8 小时。',
  dailyTimeRange: '填写上下班时间，例如：09:00-18:00。',
  shiftInfos: '填写班次信息，例如：早班 09:00-18:00，晚班 13:00-22:00。',
  interviewRoundConfigs: `请补充每轮面试方式，可选：${formatOptionLabels(INTERVIEW_MODE_OPTIONS)}。例如：电话面试，说明 1121。`,
  trialDuration: '填写试工周期，例如：试工 1 天。',
  trainingDuration: '填写培训周期，例如：培训 2 天。',
  trainingContent: '填写培训内容，例如：培训内容 岗前流程和服务标准。',
  recruitStoreAllocations: '填写招聘门店和人数，例如：门店 ID 123，招聘 5 人，阈值 3 倍。',
};

function buildMissingFieldMessage(field: string): string {
  const label = getFieldLabel(field);
  const options = FIELD_OPTION_HINTS[field as keyof PositionFormValues];
  const textHint = FIELD_TEXT_HINTS[field as keyof PositionFormValues];

  if (options?.length) {
    return `请补充${label}，可选：${formatOptionLabels(options)}。${textHint ?? buildOptionExample(label, options)}`;
  }

  if (textHint) {
    return `请补充${label}。${textHint}`;
  }

  return `请补充${label}`;
}

function formatOptionLabels(options: OptionItem[]): string {
  return Array.from(new Set(options.map(item => item.label))).join('、');
}

function buildOptionExample(label: string, options: OptionItem[]): string {
  const first = options[0]?.label;
  return first ? `例如：${label} ${first}。` : '';
}

export function createPositionDiff(
  before: PositionFormValues,
  after: PositionFormValues,
): PositionFieldDiff[] {
  const fields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const diffs: PositionFieldDiff[] = [];

  for (const field of fields) {
    const beforeValue = formatFieldValue(field, before[field as keyof PositionFormValues]);
    const afterValue = formatFieldValue(field, after[field as keyof PositionFormValues]);

    if (beforeValue === afterValue) {
      continue;
    }

    diffs.push({
      field,
      label: getFieldLabel(field),
      before: beforeValue,
      after: afterValue,
    });
  }

  return diffs;
}

export function buildPositionPreview(input: {
  draftId?: string;
  mode: PositionDraftMode;
  title: string;
  values: PositionFormValues;
  action: 'save' | 'publish';
  diff?: PositionFieldDiff[];
}): PositionDraftPreview {
  const draftId = input.draftId ?? randomUUID();
  const previewFieldSet = new Set(POSITION_FIELD_SCHEMA.map(field => String(field.key)));
  const fieldEntries = Object.entries(input.values)
    .filter(([field, value]) => previewFieldSet.has(field) && hasMeaningfulValue(value))
    .map(([field, value]): PositionPreviewField => ({
      field,
      label: getFieldLabel(field),
      value: formatPreviewFieldValue(input.values, field, value),
    }));

  const groups = (Object.keys(POSITION_TAB_LABELS) as Array<keyof typeof POSITION_TAB_LABELS>)
    .map(tab => ({
      tab,
      label: POSITION_TAB_LABELS[tab],
      fields: fieldEntries.filter(field => getFieldTab(field.field) === tab),
    }))
    .filter(group => group.fields.length > 0);

  return {
    draftId,
    mode: input.mode,
    action: input.action,
    title: input.title,
    groups,
  };
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }

  if (field === 'employmentType') {
    return value === 'full-time' ? '全职' : value === 'part-time' ? '兼职' : String(value);
  }

  if (field === 'partTimeType') {
    if (String(value) === '1') {
      return '兼职';
    }
    return getDictionaryLabel('part_time_type', value) ?? String(value);
  }

  if (field === 'probationStatus') {
    return getDictionaryLabel('have_probation', value) ?? String(value);
  }

  if (field === 'cooperationMode') {
    return getDictionaryLabel('cooperation_mode', value) ?? String(value);
  }

  if (field === 'trialRequired' || field === 'trainingRequired') {
    return getDictionaryLabel('need_probation_work', value) ?? String(value);
  }

  if (field === 'settlementCycle') {
    return getDictionaryLabel('salary_period', value) ?? String(value);
  }

  if (field === 'employmentDurationType') {
    return value === '1' ? '长期工' : value === '2' ? '短期工' : String(value);
  }

  if (field === 'baseSalaryUnit' || field === 'salaryRangeUnit') {
    return getDictionaryLabel('salary_unit6', value) ?? String(value);
  }

  if (field === 'weeklyMonthlyMode') {
    return getDictionaryLabel('spone_week_month_arrangement_mode', value) ?? String(value);
  }

  if (field === 'restMode') {
    return getDictionaryLabel('spone_week_month_rest_mode', value) ?? String(value);
  }

  if (field === 'dailyScheduleMode') {
    return getDictionaryLabel('spone_arrangement_type', value) ?? String(value);
  }

  if (field === 'workHourIntervalType') {
    return getDictionaryLabel('spone_arrangement_cycle_type', value) ?? String(value);
  }

  if (field === 'workHourRequirementType') {
    return getDictionaryLabel('spone_on_work_limit_type', value) ?? String(value);
  }

  if (field === 'workHoursUnit') {
    return getDictionaryLabel('spone_on_work_time_unit', value) ?? String(value);
  }

  if (field === 'goOffWorkTimeType') {
    return getDictionaryLabel('spone_go_off_work_time_type', value) ?? String(value);
  }

  if (field === 'interviewRounds') {
    return getDictionaryLabel('spone_interview_total', value) ?? String(value);
  }

  if (field === 'interviewTimeMode') {
    return getDictionaryLabel('interview_time_mode', value) ?? String(value);
  }

  if (field === 'interviewMode') {
    return getDictionaryLabel('spone_interview_way', value) ?? String(value);
  }

  if (field === 'trialAddressMode') {
    return getDictionaryLabel('probation_work_mode', value) ?? String(value);
  }

  if (field === 'trainingAddressMode') {
    return getDictionaryLabel('train_mode', value) ?? String(value);
  }

  if (field === 'trialUnit') {
    return getDictionaryLabel('probation_work_period_unit', value) ?? String(value);
  }

  if (field === 'trainingUnit') {
    return getDictionaryLabel('train_period_unit', value) ?? String(value);
  }

  if (field === 'trialAssessment') {
    return getDictionaryLabel('probation_work_assessment', value) ?? String(value);
  }

  if (field === 'certificateTypes') {
    return (Array.isArray(value) ? value : [])
      .map(item => getDictionaryLabel('certificates', item) ?? String(item))
      .join('、') || '-';
  }

  if (field === 'languages') {
    return (Array.isArray(value) ? value : [])
      .map(item => getDictionaryLabel('spone_languages', item) ?? String(item))
      .join('、') || '-';
  }

  if (field === 'genders') {
    return (Array.isArray(value) ? value : [])
      .map(item => getDictionaryLabel('spone_gender_ids', item) ?? String(item))
      .join('、') || '-';
  }

  if (field === 'education') {
    return getDictionaryLabel('education', value) ?? String(value);
  }

  if (field === 'socialIdentity') {
    return getDictionaryLabel('social_figure', value) ?? String(value);
  }

  if (field === 'commercialInsurance') {
    return getDictionaryLabel('have_insurance', value) ?? String(value);
  }

  if (field === 'housingBenefit') {
    return getDictionaryLabel('accommodation', value) ?? String(value);
  }

  if (field === 'mealBenefit') {
    return getDictionaryLabel('catering', value) ?? String(value);
  }

  if (field === 'socialInsuranceList') {
    const values = Array.isArray(value) ? value : [];
    if (values.includes('none')) {
      return '无';
    }
    return values
      .map(item => getDictionaryLabel('insurance_fund', item) ?? String(item))
      .join('、') || '-';
  }

  if (field === 'recruitStoreAllocations') {
    return (Array.isArray(value) ? (value as PositionStoreAllocation[]) : [])
      .map(row => `${row.storeName || row.storeId || '-'} ${row.recruitCount ?? '-'}人 阈值${formatThreshold(row.threshold)}`)
      .join('；') || '-';
  }

  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
      .join('、');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatPreviewFieldValue(
  values: PositionFormValues,
  field: string,
  value: unknown,
): string {
  if (field === 'projectId' && values.projectName) {
    return `${values.projectName}(${String(value)})`;
  }

  if (field === 'brandId' && values.brandName) {
    return `${values.brandName}(${String(value)})`;
  }

  if (field === 'positionCategory' && values.positionCategoryName) {
    return `${values.positionCategoryName}(${String(value)})`;
  }

  return formatFieldValue(field, value);
}

function formatThreshold(value?: number): string {
  if (!value) {
    return '-';
  }
  return `${value / 10}倍`;
}

export function normalizeCanonicalValues(values: PositionFormValues): PositionFormValues {
  const next = { ...values };

  const employmentType = resolveDictionaryString('employment_type', next.employmentType);
  if (employmentType === '1') {
    next.employmentType = 'part-time';
  } else if (employmentType === '2') {
    next.employmentType = 'full-time';
  }

  next.partTimeType = resolveDictionaryString('part_time_type', next.partTimeType) as PositionFormValues['partTimeType'];
  next.cooperationMode = resolveDictionaryString('cooperation_mode', next.cooperationMode) as PositionFormValues['cooperationMode'];
  next.probationStatus = resolveDictionaryString('have_probation', next.probationStatus) as PositionFormValues['probationStatus'];
  next.trialRequired = resolveDictionaryString('need_probation_work', next.trialRequired) as PositionFormValues['trialRequired'];
  next.trainingRequired = resolveDictionaryString('need_training', next.trainingRequired) as PositionFormValues['trainingRequired'];
  next.settlementCycle = resolveDictionaryString('salary_period', next.settlementCycle) as PositionFormValues['settlementCycle'];
  next.baseSalaryUnit = resolveDictionaryString('salary_unit6', next.baseSalaryUnit) as PositionFormValues['baseSalaryUnit'];
  next.salaryRangeUnit = resolveDictionaryString('salary_unit3', next.salaryRangeUnit) as PositionFormValues['salaryRangeUnit'];
  next.commercialInsurance = resolveDictionaryString('have_insurance', next.commercialInsurance) as PositionFormValues['commercialInsurance'];

  next.projectId = normalizeNumber(next.projectId) ?? next.projectId;
  next.brandId = normalizeNumber(next.brandId) ?? next.brandId;
  next.positionCategory = normalizeNumber(next.positionCategory) ?? next.positionCategory;
  next.baseSalary = normalizeNumber(next.baseSalary);
  next.salaryMin = normalizeNumber(next.salaryMin);
  next.salaryMax = normalizeNumber(next.salaryMax);
  next.ageMin = normalizeNumber(next.ageMin);
  next.ageMax = normalizeNumber(next.ageMax);
  next.minWorkMonths = normalizeNumber(next.minWorkMonths);
  next.workDays = normalizeNumber(next.workDays);
  next.restDays = normalizeNumber(next.restDays);
  next.workHours = normalizeNumber(next.workHours);
  next.dailyWorkDuration = normalizeNumber(next.dailyWorkDuration);
  next.trialDuration = normalizeNumber(next.trialDuration);
  next.trainingDuration = normalizeNumber(next.trainingDuration);

  if (Array.isArray(next.genders)) {
    next.genders = next.genders
      .map(item => resolveDictionaryString('spone_gender_ids', item))
      .filter((item): item is '1' | '2' => item === '1' || item === '2');
  }

  return cleanPositionFormValues(next);
}
