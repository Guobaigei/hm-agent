import {
  ADDRESS_MODE_OPTIONS,
  BENEFIT_OPTIONS,
  BONUS_SUBSIDY_UNIT_OPTIONS,
  CERTIFICATE_OPTIONS,
  COMMERCIAL_INSURANCE_OPTIONS,
  COOPERATION_MODE_OPTIONS,
  DAILY_SCHEDULE_MODE_OPTIONS,
  DRIVER_LICENSE_OPTIONS,
  DURATION_UNIT_OPTIONS,
  EDUCATION_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  GO_OFF_WORK_TIME_TYPE_OPTIONS,
  HEALTH_CERTIFICATE_OPTIONS,
  INTERVIEW_MODE_OPTIONS,
  INTERVIEW_ROUND_OPTIONS,
  INTERVIEW_TIME_MODE_OPTIONS,
  LANGUAGE_OPTIONS,
  MATCH_MODE_OPTIONS,
  NATIONALITY_OPTIONS,
  PART_TIME_TYPE_OPTIONS,
  PROCESS_REQUIRED_OPTIONS,
  PROBATION_STATUS_OPTIONS,
  REST_MODE_OPTIONS,
  SALARY_UNIT_OPTIONS,
  SETTLEMENT_CYCLE_OPTIONS,
  SOCIAL_IDENTITY_OPTIONS,
  SOCIAL_INSURANCE_OPTIONS,
  THRESHOLD_OPTIONS,
  TRIAL_ASSESSMENT_OPTIONS,
  WEEKLY_MONTHLY_MODE_OPTIONS,
  WORK_HOUR_INTERVAL_TYPE_OPTIONS,
  WORK_HOUR_REQUIREMENT_TYPE_OPTIONS,
  WORK_HOUR_UNIT_OPTIONS,
  YES_NO_OPTIONS,
  type OptionItem,
} from './constants.ts';
import { normalizeForMatch, normalizeNumber, normalizeString } from './utils.ts';

type DictionaryAliasMap = Record<string, Record<string, string[]>>;

const DICTIONARY_OPTIONS: Record<string, OptionItem[]> = {
  cooperation_mode: COOPERATION_MODE_OPTIONS,
  labor_form: [...EMPLOYMENT_TYPE_OPTIONS, ...PART_TIME_TYPE_OPTIONS],
  employment_type: EMPLOYMENT_TYPE_OPTIONS,
  part_time_type: PART_TIME_TYPE_OPTIONS,
  have_probation: PROBATION_STATUS_OPTIONS,
  need_probation_work: PROCESS_REQUIRED_OPTIONS,
  salary_period: SETTLEMENT_CYCLE_OPTIONS,
  day_of_month: [
    { label: '当日结', value: '1', apiValue: 1 },
    { label: '次日结', value: '2', apiValue: 2 },
  ],
  salary_unit6: SALARY_UNIT_OPTIONS,
  salary_unit3: BONUS_SUBSIDY_UNIT_OPTIONS,
  have_insurance: COMMERCIAL_INSURANCE_OPTIONS,
  insurance_fund: SOCIAL_INSURANCE_OPTIONS,
  accommodation: BENEFIT_OPTIONS,
  catering: BENEFIT_OPTIONS,
  spone_probation_insurance_receive: YES_NO_OPTIONS,
  probation_accommodation_salary_receive: YES_NO_OPTIONS,
  spone_probation_catering_salary_receive: YES_NO_OPTIONS,
  spone_gender_ids: GENDER_OPTIONS,
  social_figure: SOCIAL_IDENTITY_OPTIONS,
  education: EDUCATION_OPTIONS,
  spone_marriage_bearing_type: MATCH_MODE_OPTIONS,
  spone_native_place_requirement_type: MATCH_MODE_OPTIONS,
  spone_nation_requirement_type: MATCH_MODE_OPTIONS,
  spone_country_requirement_type: NATIONALITY_OPTIONS,
  health_certificate_type: HEALTH_CERTIFICATE_OPTIONS,
  driver_license_type: DRIVER_LICENSE_OPTIONS,
  certificates: CERTIFICATE_OPTIONS,
  spone_languages: LANGUAGE_OPTIONS,
  spone_week_month_arrangement_mode: WEEKLY_MONTHLY_MODE_OPTIONS,
  spone_week_month_rest_mode: REST_MODE_OPTIONS,
  spone_arrangement_cycle_type: WORK_HOUR_INTERVAL_TYPE_OPTIONS,
  spone_on_work_limit_type: WORK_HOUR_REQUIREMENT_TYPE_OPTIONS,
  spone_on_work_time_unit: WORK_HOUR_UNIT_OPTIONS,
  spone_arrangement_type: DAILY_SCHEDULE_MODE_OPTIONS,
  spone_day_work_time_requirement: DAILY_SCHEDULE_MODE_OPTIONS,
  spone_go_off_work_time_type: GO_OFF_WORK_TIME_TYPE_OPTIONS,
  spone_interview_total: INTERVIEW_ROUND_OPTIONS,
  interview_time_mode: INTERVIEW_TIME_MODE_OPTIONS,
  spone_interview_way: INTERVIEW_MODE_OPTIONS,
  interview_address_mode: ADDRESS_MODE_OPTIONS,
  probation_work_mode: ADDRESS_MODE_OPTIONS,
  probation_work_address_mode: ADDRESS_MODE_OPTIONS,
  probation_work_assessment: TRIAL_ASSESSMENT_OPTIONS,
  probation_work_period_unit: DURATION_UNIT_OPTIONS,
  train_mode: ADDRESS_MODE_OPTIONS,
  train_period_unit: DURATION_UNIT_OPTIONS,
  threshold_num: THRESHOLD_OPTIONS,
};

const DICTIONARY_ALIASES: DictionaryAliasMap = {
  cooperation_mode: {
    '2': ['BPO', '业务流程外包'],
    '3': ['RPO', '招聘流程外包'],
    '4': ['免费代招'],
  },
  labor_form: {
    '2': ['全职'],
    '1': ['兼职'],
    '3': ['寒假工'],
    '4': ['暑假工'],
    '5': ['小时工', '小时兼职'],
  },
  employment_type: {
    '2': ['全职'],
    '1': ['兼职'],
  },
  part_time_type: {
    '3': ['寒假工'],
    '4': ['暑假工'],
    '5': ['小时工', '小时兼职'],
  },
  have_probation: {
    '2': ['有试用期', '有'],
    '1': ['无试用期', '无', '没有'],
  },
  need_probation_work: {
    '1': ['需要', '是', '有'],
    '0': ['不需要', '否', '无', '没有'],
  },
  salary_period: {
    '1': ['日结'],
    '2': ['周结'],
    '3': ['月结'],
    '4': ['完工结'],
  },
  salary_unit6: {
    '7': ['元'],
    '4': ['元/时', '元/小时', '每小时', '小时'],
    '1': ['元/天', '元/日', '每天'],
    '3': ['元/月', '每月'],
    '5': ['元/单', '每单'],
    '6': ['元/次', '每次'],
  },
  salary_unit3: {
    '7': ['元'],
    '4': ['元/时', '元/小时', '每小时'],
    '1': ['元/天', '元/日', '每天'],
    '2': ['元/周', '每周'],
    '3': ['元/月', '每月'],
  },
  have_insurance: {
    '1': ['独立客购买', '购买', '有商业保险'],
    '2': ['独立客不购买', '不购买', '无商业保险', '无'],
  },
  insurance_fund: {
    '1': ['公积金'],
    '2': ['养老保险'],
    '3': ['医疗保险'],
    '4': ['失业保险'],
    '5': ['工伤保险'],
    '6': ['生育保险'],
  },
  accommodation: {
    '1': ['提供住宿'],
    '2': ['提供住宿补贴', '住宿补贴'],
    '3': ['提供住宿或补贴', '住宿或补贴'],
    '0': ['无住宿福利', '无住宿', '无'],
  },
  catering: {
    '1': ['提供餐饮', '包餐'],
    '2': ['提供餐饮补贴', '餐补', '餐饮补贴'],
    '3': ['提供餐饮或补贴', '餐饮或补贴'],
    '0': ['无餐饮福利', '无餐饮', '无'],
  },
  spone_gender_ids: {
    '1': ['男性', '男生', '男'],
    '2': ['女性', '女生', '女'],
  },
  social_figure: {
    '0': ['不限'],
    '1': ['全日制在校学生', '学生'],
    '2': ['社会人士'],
    '3': ['第二职业'],
  },
  spone_country_requirement_type: {
    unlimited: ['不限'],
    'foreign-only': ['仅要外国人', '外国人'],
    'china-only': ['仅要中国人', '中国人'],
  },
  certificates: {
    '1': ['健康证'],
    '2': ['学生证'],
    '3': ['驾驶证', '驾照'],
  },
  spone_week_month_arrangement_mode: {
    '1': ['做N休M', '做 N 休 M', '做几休几'],
    '2': ['工时区间', '自定义时间'],
  },
  spone_arrangement_type: {
    '2': ['灵活排班', '固定排班'],
    '1': ['满足其中一个排班即可安排上岗', '任一'],
    '3': ['满足所有排班才可安排上岗', '全部'],
  },
  spone_go_off_work_time_type: {
    '1': ['当日'],
    '2': ['次日'],
  },
  spone_interview_total: {
    '0': ['无面试', '0轮'],
    '1': ['1轮', '一轮'],
    '2': ['2轮', '二轮'],
    '3': ['3轮', '三轮'],
  },
  interview_time_mode: {
    '1': ['固定时间', '固定'],
    '2': ['周期时间', '周期'],
    '4': ['等待通知'],
  },
  spone_interview_way: {
    '1': ['AI面试', 'AI'],
    '3': ['电话面试', '电话'],
    '4': ['视频面试', '视频'],
    '5': ['线下面试', '到店面试', '线下'],
  },
  interview_address_mode: {
    '1': ['同工作地址'],
    '2': ['其他地址'],
  },
  probation_work_assessment: {
    '1': ['笔试'],
    '2': ['实操'],
    '3': ['无考核', '无'],
    '4': ['其他'],
  },
  probation_work_period_unit: {
    '1': ['天', 'day'],
    '2': ['小时', 'hour'],
  },
  train_period_unit: {
    '1': ['天', 'day'],
    '2': ['小时', 'hour'],
  },
};

function optionMatches(option: OptionItem, rawValue: string, aliases: string[]) {
  const optionValue = normalizeForMatch(String(option.value));
  const optionLabel = normalizeForMatch(option.label);
  const value = normalizeForMatch(rawValue);

  if (optionValue === value || optionLabel === value) {
    return true;
  }

  return aliases.some(alias => {
    const normalizedAlias = normalizeForMatch(alias);
    return (
      optionLabel === normalizedAlias ||
      optionLabel.includes(normalizedAlias) ||
      normalizedAlias.includes(optionLabel) ||
      optionValue === normalizedAlias
    );
  });
}

export function resolveDictionaryValue(type: string, value: unknown): string | number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = normalizeNumber(value);
  if (numberValue != null) {
    return numberValue;
  }

  const rawValue = normalizeString(value);
  if (!rawValue) {
    return undefined;
  }

  const options = DICTIONARY_OPTIONS[type] || [];
  const aliasesByValue = DICTIONARY_ALIASES[type] || {};
  const aliases = [
    ...(aliasesByValue[rawValue] || []),
    ...Object.entries(aliasesByValue)
      .filter(([, values]) =>
        values.some(alias => normalizeForMatch(alias) === normalizeForMatch(rawValue)),
      )
      .flatMap(([key, values]) => [key, ...values]),
    rawValue,
  ];
  const matchedOption = options.find(option => optionMatches(option, rawValue, aliases));
  return matchedOption?.apiValue ?? matchedOption?.value;
}

function resolveDictionaryCanonicalValue(type: string, value: unknown): string | number | undefined {
  const numberValue = normalizeNumber(value);
  const options = DICTIONARY_OPTIONS[type] || [];
  if (numberValue != null) {
    const matchedByApiValue = options.find(option => option.apiValue === numberValue);
    if (matchedByApiValue) {
      return matchedByApiValue.value;
    }
  }

  const resolved = resolveDictionaryValue(type, value);
  if (resolved === undefined) {
    return undefined;
  }

  const matchedByApiValue = options.find(option =>
    option.apiValue !== undefined && String(option.apiValue) === String(resolved),
  );
  return matchedByApiValue?.value ?? resolved;
}

export function resolveDictionaryString(type: string, value: unknown): string | undefined {
  const resolved = resolveDictionaryCanonicalValue(type, value);
  return resolved === undefined ? undefined : String(resolved);
}

export function resolveDictionaryNumber(type: string, value: unknown): number | undefined {
  return normalizeNumber(resolveDictionaryValue(type, value));
}

export function resolveDictionaryArray(type: string, values: unknown): number[] | undefined {
  if (!Array.isArray(values) || values.length === 0) {
    return undefined;
  }

  const result = values
    .map(item => resolveDictionaryNumber(type, item))
    .filter((item): item is number => item !== undefined);

  return result.length ? Array.from(new Set(result)) : undefined;
}

export function getDictionaryLabel(type: string, value: unknown): string | undefined {
  const resolved = resolveDictionaryValue(type, value);
  if (resolved === undefined) {
    return undefined;
  }

  const options = DICTIONARY_OPTIONS[type] || [];
  const option = options.find(item =>
    String(item.value) === String(resolved) ||
    (item.apiValue !== undefined && String(item.apiValue) === String(resolved)),
  );
  return option?.label ?? String(value);
}
