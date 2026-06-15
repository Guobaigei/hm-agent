import type { PositionFormTabKey, PositionFormValues } from './types.ts';

export type OptionItem = {
  label: string;
  value: string | number;
  apiValue?: number;
};

export type PositionAgentField = {
  key: keyof PositionFormValues;
  label: string;
  tab: PositionFormTabKey;
  examples?: string[];
};

export const POSITION_TAB_LABELS: Record<PositionFormTabKey, string> = {
  basic: '基础信息',
  salary: '薪资福利',
  requirement: '用人要求',
  schedule: '排班',
  process: '流程',
  recruitment: '招聘',
};

export const EMPLOYMENT_TYPE_OPTIONS: OptionItem[] = [
  { label: '全职', value: '2' },
  { label: '兼职', value: '1' },
];

export const PART_TIME_TYPE_OPTIONS: OptionItem[] = [
  { label: '寒假工', value: '3' },
  { label: '暑假工', value: '4' },
  { label: '小时工', value: '5' },
];

export const PROBATION_STATUS_OPTIONS: OptionItem[] = [
  { label: '无试用期', value: '1' },
  { label: '有试用期', value: '2' },
];

export const EMPLOYMENT_DURATION_OPTIONS: OptionItem[] = [
  { label: '长期工', value: '1' },
  { label: '短期工', value: '2' },
];

export const COOPERATION_MODE_OPTIONS: OptionItem[] = [
  { label: '业务流程外包（BPO）', value: '2' },
  { label: '招聘流程外包（RPO）', value: '3' },
  { label: '免费代招', value: '4' },
];

export const PROCESS_REQUIRED_OPTIONS: OptionItem[] = [
  { label: '需要', value: '1' },
  { label: '不需要', value: '0' },
];

export const SETTLEMENT_CYCLE_OPTIONS: OptionItem[] = [
  { label: '日结', value: '1' },
  { label: '周结', value: '2' },
  { label: '月结', value: '3' },
  { label: '完工结', value: '4' },
];

export const SALARY_UNIT_OPTIONS: OptionItem[] = [
  { label: '元/天', value: '1' },
  { label: '元/月', value: '3' },
  { label: '元/时', value: '4' },
  { label: '元/单', value: '5' },
  { label: '元/次', value: '6' },
  { label: '元', value: '7' },
];

export const BONUS_SUBSIDY_UNIT_OPTIONS: OptionItem[] = [
  { label: '元/天', value: '1' },
  { label: '元/周', value: '2' },
  { label: '元/月', value: '3' },
  { label: '元/时', value: '4' },
  { label: '元', value: '7' },
];

export const SALARY_RANGE_UNIT_OPTIONS: OptionItem[] = [
  { label: '元/天', value: '1' },
  { label: '元/周', value: '2' },
  { label: '元/月', value: '3' },
];

export const YES_NO_OPTIONS: OptionItem[] = [
  { label: '是', value: '1' },
  { label: '否', value: '0' },
];

export const COMMERCIAL_INSURANCE_OPTIONS: OptionItem[] = [
  { label: '独立客购买', value: '1' },
  { label: '独立客不购买', value: '2' },
];

export const SOCIAL_INSURANCE_OPTIONS: OptionItem[] = [
  { label: '公积金', value: '1' },
  { label: '养老保险', value: '2' },
  { label: '医疗保险', value: '3' },
  { label: '失业保险', value: '4' },
  { label: '工伤保险', value: '5' },
  { label: '生育保险', value: '6' },
];

export const BENEFIT_OPTIONS: OptionItem[] = [
  { label: '无', value: '0' },
  { label: '提供', value: '1' },
  { label: '提供补贴', value: '2' },
  { label: '提供或补贴', value: '3' },
];

export const GENDER_OPTIONS: OptionItem[] = [
  { label: '男性', value: '1', apiValue: 1 },
  { label: '女性', value: '2', apiValue: 2 },
];

export const SOCIAL_IDENTITY_OPTIONS: OptionItem[] = [
  { label: '不限', value: '0' },
  { label: '全日制在校学生', value: '1' },
  { label: '社会人士', value: '2' },
  { label: '第二职业', value: '3' },
];

export const EDUCATION_OPTIONS: OptionItem[] = [
  { label: '不限', value: '1' },
  { label: '本科', value: '2' },
  { label: '大专', value: '3' },
  { label: '高中', value: '4' },
  { label: '初中', value: '5' },
  { label: '硕士', value: '6' },
  { label: '博士', value: '7' },
  { label: '中专/技校/职高', value: '8' },
  { label: '初中以下', value: '9' },
  { label: '高职', value: '10' },
];

export const MATCH_MODE_OPTIONS: OptionItem[] = [
  { label: '不限', value: '0' },
  { label: '不要', value: '1' },
  { label: '仅要', value: '2' },
];

export const NATIONALITY_OPTIONS: OptionItem[] = [
  { label: '不限', value: 'unlimited', apiValue: 0 },
  { label: '仅要外国人', value: 'foreign-only', apiValue: 1 },
  { label: '仅要中国人', value: 'china-only', apiValue: 2 },
];

export const CERTIFICATE_OPTIONS: OptionItem[] = [
  { label: '健康证', value: '1' },
  { label: '学生证', value: '2' },
  { label: '驾驶证', value: '3' },
];

export const HEALTH_CERTIFICATE_OPTIONS: OptionItem[] = [
  { label: '食品健康证', value: '1' },
  { label: '零售健康证', value: '2' },
];

export const DRIVER_LICENSE_OPTIONS: OptionItem[] = [
  { label: 'A1', value: '1' },
  { label: 'A2', value: '2' },
  { label: 'A3', value: '3' },
  { label: 'B1', value: '4' },
  { label: 'B2', value: '5' },
  { label: 'C1', value: '6' },
  { label: 'C2', value: '7' },
];

export const LANGUAGE_OPTIONS: OptionItem[] = [
  { label: '普通话', value: '1' },
  { label: '英语', value: '2' },
  { label: '粤语', value: '3' },
];

export const WEEKLY_MONTHLY_MODE_OPTIONS: OptionItem[] = [
  { label: '做 N 休 M', value: '1' },
  { label: '工时区间', value: '2' },
];

export const REST_MODE_OPTIONS: OptionItem[] = [
  { label: '不限', value: '0' },
  { label: '周中休', value: '1' },
  { label: '周末休', value: '2' },
];

export const WORK_HOUR_INTERVAL_TYPE_OPTIONS: OptionItem[] = [
  { label: '每周', value: '1' },
  { label: '每月', value: '2' },
];

export const WORK_HOUR_REQUIREMENT_TYPE_OPTIONS: OptionItem[] = [
  { label: '至少', value: '1' },
  { label: '至多', value: '2' },
];

export const WORK_HOUR_UNIT_OPTIONS: OptionItem[] = [
  { label: '天', value: '1' },
  { label: '小时', value: '2' },
];

export const DAILY_SCHEDULE_MODE_OPTIONS: OptionItem[] = [
  { label: '满足其中一个排班即可安排上岗', value: '1' },
  { label: '灵活排班', value: '2' },
  { label: '满足所有排班才可安排上岗', value: '3' },
];

export const GO_OFF_WORK_TIME_TYPE_OPTIONS: OptionItem[] = [
  { label: '当日', value: '1' },
  { label: '次日', value: '2' },
];

export const INTERVIEW_ROUND_OPTIONS: OptionItem[] = [
  { label: '无面试', value: '0' },
  { label: '1轮', value: '1' },
  { label: '2轮', value: '2' },
  { label: '3轮', value: '3' },
];

export const INTERVIEW_TIME_MODE_OPTIONS: OptionItem[] = [
  { label: '固定时间', value: '1' },
  { label: '周期时间', value: '2' },
  { label: '等待通知', value: '4' },
];

export const INTERVIEW_MODE_OPTIONS: OptionItem[] = [
  { label: 'AI面试', value: '1' },
  { label: '电话面试', value: '3' },
  { label: '视频面试', value: '4' },
  { label: '线下面试', value: '5' },
];

export const ADDRESS_MODE_OPTIONS: OptionItem[] = [
  { label: '同工作地址', value: '1' },
  { label: '其他地址', value: '2' },
];

export const TRIAL_ASSESSMENT_OPTIONS: OptionItem[] = [
  { label: '笔试', value: '1' },
  { label: '实操', value: '2' },
  { label: '无考核', value: '3' },
  { label: '其他', value: '4' },
];

export const DURATION_UNIT_OPTIONS: OptionItem[] = [
  { label: '天', value: '1' },
  { label: '小时', value: '2' },
];

export const THRESHOLD_OPTIONS: OptionItem[] = Array.from({ length: 18 }, (_, index) => {
  const multiplier = 1.5 + index * 0.5;
  return { label: `${multiplier}倍`, value: multiplier * 10 };
});

export const POSITION_STATUS_LABELS = {
  unpublished: '未发布',
  published: '已发布',
  offline: '已下架',
} as const;

export const POSITION_FIELD_SCHEMA: PositionAgentField[] = [
  { key: 'projectId', label: '项目', tab: 'basic', examples: ['上海配送项目'] },
  { key: 'brandId', label: '品牌', tab: 'basic' },
  { key: 'positionName', label: '岗位名称', tab: 'basic' },
  { key: 'positionCategory', label: '职位类别', tab: 'basic' },
  { key: 'workContent', label: '工作内容', tab: 'basic' },
  { key: 'employmentType', label: '用工形式', tab: 'basic' },
  { key: 'partTimeType', label: '兼职类型', tab: 'basic' },
  { key: 'employmentDurationType', label: '用工类型', tab: 'basic' },
  { key: 'minWorkMonths', label: '至少上岗月', tab: 'basic' },
  { key: 'temporaryEmploymentStartTime', label: '短期开始日期', tab: 'basic' },
  { key: 'temporaryEmploymentEndTime', label: '短期结束日期', tab: 'basic' },
  { key: 'probationStatus', label: '试用期', tab: 'basic' },
  { key: 'cooperationMode', label: '合作模式', tab: 'basic' },
  { key: 'trialRequired', label: '试工', tab: 'basic' },
  { key: 'trainingRequired', label: '培训', tab: 'basic' },
  { key: 'settlementCycle', label: '结算周期', tab: 'salary' },
  { key: 'payDay', label: '发薪日', tab: 'salary' },
  { key: 'baseSalary', label: '基本薪资', tab: 'salary' },
  { key: 'baseSalaryUnit', label: '基本薪资单位', tab: 'salary' },
  { key: 'salaryMin', label: '综合薪资下限', tab: 'salary' },
  { key: 'salaryMax', label: '综合薪资上限', tab: 'salary' },
  { key: 'salaryRangeUnit', label: '综合薪资单位', tab: 'salary' },
  { key: 'commercialInsurance', label: '商业保险', tab: 'salary' },
  { key: 'socialInsuranceList', label: '社保和公积金', tab: 'salary' },
  { key: 'housingBenefit', label: '住宿福利', tab: 'salary' },
  { key: 'mealBenefit', label: '餐饮福利', tab: 'salary' },
  { key: 'transportSubsidy', label: '交通补贴', tab: 'salary' },
  { key: 'memo', label: '福利备注', tab: 'salary' },
  { key: 'ageMin', label: '年龄下限', tab: 'requirement' },
  { key: 'ageMax', label: '年龄上限', tab: 'requirement' },
  { key: 'genders', label: '性别', tab: 'requirement' },
  { key: 'education', label: '学历', tab: 'requirement' },
  { key: 'socialIdentity', label: '社会身份', tab: 'requirement' },
  { key: 'certificateTypes', label: '证件', tab: 'requirement' },
  { key: 'languages', label: '语言', tab: 'requirement' },
  { key: 'softwareSkills', label: '软性技能', tab: 'requirement' },
  { key: 'weeklyMonthlyMode', label: '周/月排班模式', tab: 'schedule' },
  { key: 'workDays', label: '做 N 天', tab: 'schedule' },
  { key: 'restDays', label: '休 M 天', tab: 'schedule' },
  { key: 'restMode', label: '休息模式', tab: 'schedule' },
  { key: 'workHourIntervalType', label: '工时区间类型', tab: 'schedule' },
  { key: 'workHourRequirementType', label: '工时要求', tab: 'schedule' },
  { key: 'workHours', label: '工时', tab: 'schedule' },
  { key: 'workHoursUnit', label: '工时单位', tab: 'schedule' },
  { key: 'dailyScheduleMode', label: '日排班模式', tab: 'schedule' },
  { key: 'dailyWorkDuration', label: '灵活排班时长', tab: 'schedule' },
  { key: 'dailyTimeRange', label: '上下班时间', tab: 'schedule' },
  { key: 'interviewRounds', label: '面试轮次', tab: 'process' },
  { key: 'interviewTimeMode', label: '面试时间模式', tab: 'process' },
  { key: 'interviewRoundConfigs', label: '面试配置', tab: 'process' },
  { key: 'trialAddressMode', label: '试工地址', tab: 'process' },
  { key: 'trialDuration', label: '试工周期', tab: 'process' },
  { key: 'trialAssessment', label: '试工考核', tab: 'process' },
  { key: 'trainingAddressMode', label: '培训地址', tab: 'process' },
  { key: 'trainingDuration', label: '培训周期', tab: 'process' },
  { key: 'trainingContent', label: '培训内容', tab: 'process' },
  { key: 'onboardingGrooming', label: '仪容仪表', tab: 'process' },
  { key: 'onboardingMaterials', label: '上岗材料', tab: 'process' },
  { key: 'onboardingProcess', label: '面试入职流程', tab: 'process' },
  { key: 'recruitStoreAllocations', label: '招聘门店', tab: 'recruitment' },
  { key: 'workEnvironmentImages', label: '工作环境图片', tab: 'recruitment' },
];

export function getFieldLabel(field: string): string {
  return POSITION_FIELD_SCHEMA.find(item => item.key === field)?.label ?? field;
}

export function getFieldTab(field: string): PositionFormTabKey {
  return POSITION_FIELD_SCHEMA.find(item => item.key === field)?.tab ?? 'basic';
}
