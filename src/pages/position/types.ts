export type PositionStatus = 'unpublished' | 'published' | 'offline';
export type PositionApiStatus = 0 | 1 | 2;
export type PositionIntent =
  | 'search'
  | 'create_preview'
  | 'edit_preview'
  | 'commit'
  | 'clarify'
  | 'cancel';
export type PositionDraftMode = 'create' | 'edit';
export type PositionCommitAction = 'save' | 'publish';
export type PositionFormTabKey =
  | 'basic'
  | 'salary'
  | 'requirement'
  | 'schedule'
  | 'process'
  | 'recruitment';

export type FieldIssue = {
  field: string;
  label: string;
  message: string;
};

export type PositionPreviewField = {
  field: string;
  label: string;
  value: string;
};

export type PositionDraftPreview = {
  draftId: string;
  mode: PositionDraftMode;
  action: PositionCommitAction;
  title: string;
  groups: Array<{
    tab: PositionFormTabKey;
    label: string;
    fields: PositionPreviewField[];
  }>;
};

export type PositionFieldDiff = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type PositionToolResponse = {
  reply: string;
  intent: PositionIntent;
  needsClarification: boolean;
  needsConfirmation: boolean;
  draftId?: string;
  results?: PositionResultSummary[];
  preview?: PositionDraftPreview;
  missingFields?: FieldIssue[];
  validationErrors?: FieldIssue[];
  diff?: PositionFieldDiff[];
  usedTools?: string[];
};

export type PositionToolRequest = {
  sessionId: string;
  message: string;
  userId?: string;
  channel?: string;
};

export type PositionStoreAllocation = {
  id: string;
  storeId?: number;
  storeName?: string;
  storeAddress?: string;
  storeExactAddress?: string;
  recruitCount?: number;
  threshold?: number;
};

export type PositionSalaryTier = {
  id: string;
  min?: number;
  max?: number;
  amount?: number;
};

export type PositionTimePeriod = {
  id: string;
  startTime?: string;
  endTime?: string;
};

export type PositionPhysicalRequirement = {
  heightMin?: number;
  heightMax?: number;
  weightMin?: number;
  weightMax?: number;
};

export type PositionExperienceRequirement = {
  positionCategory?: string | number;
  duration?: number;
  unit?: 'year' | 'month';
};

export type PositionShiftInfo = {
  id: string;
  startTime?: string;
  endTime?: string;
};

export type PositionInterviewCycleRule = {
  id: string;
  weekday?: string;
  startTime?: string;
  endTime?: string;
  deadlineDayOffset?: '0' | '-1' | '-2';
  deadlineTime?: string;
};

export type PositionInterviewFixedSlot = {
  id: string;
  interviewDate?: string;
  startTime?: string;
  endTime?: string;
  deadline?: string;
};

export type PositionInterviewRoundConfig = {
  id?: string;
  interviewTimeMode?: '1' | '2' | '4';
  interviewCycleRules?: PositionInterviewCycleRule[];
  interviewDeadlineEnabled?: boolean;
  interviewFixedSlots?: PositionInterviewFixedSlot[];
  interviewMode?: '1' | '3' | '4' | '5';
  interviewRemark?: string;
  interviewAddressMode?: '1' | '2';
  interviewAddress?: string;
};

export type PositionSalaryConfig = {
  settlementCycle?: '1' | '2' | '3' | '4';
  payDay?: string;
  baseSalary?: number;
  baseSalaryUnit?: '1' | '3' | '4' | '5' | '6' | '7';
  hasLadderSalary?: '1' | '2';
  ladderSalaryType?: '1' | '2' | '3' | '4';
  ladderSalaryTiers?: PositionSalaryTier[];
  ladderSalaryRule?: '1' | '2';
  hasSpecialPeriodSalary?: '0' | '1' | 0 | 1;
  specialPeriodSalaryAmount?: number;
  specialPeriodSalaryUnit?: '1' | '4' | '5' | '6' | '7';
  specialPeriods?: PositionTimePeriod[];
  specialPeriodSalaryRemark?: string;
  holidaySalaryType?: '1' | '2' | '3';
  holidaySalaryMultiplier?: number;
  holidaySalaryAmount?: number;
  holidaySalaryUnit?: '1' | '4' | '5' | '6';
  holidaySalaryRemark?: string;
  overtimeSalaryType?: '1' | '2' | '3';
  overtimeSalaryMultiplier?: number;
  overtimeSalaryAmount?: number;
  overtimeSalaryUnit?: '1' | '4' | '5' | '6';
  overtimeSalaryRemark?: string;
  bonusSubsidyAmount?: number;
  bonusSubsidyUnit?: '1' | '2' | '3' | '4' | '7';
  bonusSubsidyRemark?: string;
  commissionRemark?: string;
  performanceSalaryRemark?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryRangeUnit?: '1' | '2' | '3';
};

export type PositionBenefitConfig = {
  commercialInsurance?: '1' | '2';
  socialInsuranceList?: string[];
  housingBenefit?: '0' | '1' | '2' | '3';
  housingSubsidy?: number;
  housingSubsidyUnit?: '1' | '3';
  housingBenefitRemark?: string;
  mealBenefit?: '0' | '1' | '2' | '3';
  mealSubsidy?: number;
  mealSubsidyUnit?: '1' | '3';
  mealBenefitRemark?: string;
  transportSubsidy?: number;
  transportSubsidyUnit?: '1' | '3';
  transportBenefitRemark?: string;
  memo?: string;
};

export type PositionTrialBenefitConfig = {
  commercialInsurance?: '0' | '1';
  housingBenefit?: '0' | '1';
  mealBenefit?: '0' | '1';
};

export type PositionFormValues = PositionBenefitConfig & {
  projectId?: string | number;
  projectName?: string;
  projectManagerName?: string;
  brandId?: string | number;
  brandName?: string;
  jobName?: string;
  positionName?: string;
  positionCategory?: string | number;
  positionCategoryName?: string;
  workContent?: string;
  workAddress?: string;
  employmentType?: 'full-time' | 'part-time';
  probationStatus?: '1' | '2';
  employmentDurationType?: '1' | '2';
  partTimeType?: '3' | '4' | '5';
  minWorkMonths?: number;
  temporaryEmploymentStartTime?: string;
  temporaryEmploymentEndTime?: string;
  cooperationMode?: '2' | '3' | '4';
  trialRequired?: '1' | '0';
  trainingRequired?: '1' | '0';
  settlementCycle?: '1' | '2' | '3' | '4';
  payDay?: string;
  baseSalary?: number;
  baseSalaryUnit?: '1' | '3' | '4' | '5' | '6' | '7';
  hasLadderSalary?: '1' | '2';
  ladderSalaryType?: '1' | '2' | '3' | '4';
  ladderSalaryTiers?: PositionSalaryTier[];
  ladderSalaryRule?: '1' | '2';
  hasSpecialPeriodSalary?: '0' | '1' | 0 | 1;
  specialPeriodSalaryAmount?: number;
  specialPeriodSalaryUnit?: '1' | '4' | '5' | '6' | '7';
  specialPeriods?: PositionTimePeriod[];
  specialPeriodSalaryRemark?: string;
  holidaySalaryType?: '1' | '2' | '3';
  holidaySalaryMultiplier?: number;
  holidaySalaryAmount?: number;
  holidaySalaryUnit?: '1' | '4' | '5' | '6';
  holidaySalaryRemark?: string;
  overtimeSalaryType?: '1' | '2' | '3';
  overtimeSalaryMultiplier?: number;
  overtimeSalaryAmount?: number;
  overtimeSalaryUnit?: '1' | '4' | '5' | '6';
  overtimeSalaryRemark?: string;
  bonusSubsidyAmount?: number;
  bonusSubsidyUnit?: '1' | '2' | '3' | '4' | '7';
  bonusSubsidyRemark?: string;
  commissionRemark?: string;
  performanceSalaryRemark?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryRangeUnit?: '1' | '2' | '3';
  probationSalaryConfig?: PositionSalaryConfig;
  trainingSalaryConfig?: PositionSalaryConfig;
  trialSalaryAmount?: number;
  trialSalaryUnit?: '1' | '4' | '5' | '6' | '7';
  trialSalaryRemark?: string;
  trialBenefitConfig?: PositionTrialBenefitConfig;
  ageMin?: number;
  ageMax?: number;
  genders?: Array<'1' | '2'>;
  maleRequirement?: PositionPhysicalRequirement;
  femaleRequirement?: PositionPhysicalRequirement;
  socialIdentity?: '0' | '1' | '2' | '3';
  socialInsurancePayments?: string[];
  education?: string;
  marriageMode?: '0' | '1' | '2';
  marriageStatus?: string;
  nativePlaceMode?: '0' | '1' | '2';
  nativePlaces?: string[];
  ethnicityMode?: '0' | '1' | '2';
  ethnicities?: string[];
  nationality?: 'unlimited' | 'foreign-only' | 'china-only';
  commuteLimit?: number;
  experienceRequirement?: PositionExperienceRequirement;
  certificateTypes?: string[];
  healthCertificateType?: '1' | '2';
  driverLicenseType?: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  languages?: string[];
  languageRemark?: string;
  softwareSkills?: string;
  weeklyMonthlyMode?: '1' | '2';
  workDays?: number;
  restDays?: number;
  restMode?: '0' | '1' | '2';
  workHourIntervalType?: '1' | '2';
  workHourRequirementType?: '1' | '2';
  workHours?: number;
  workHoursUnit?: '1' | '2';
  dailyScheduleMode?: '1' | '2' | '3';
  dailyWorkDuration?: number;
  dailyTimeRange?: [string, string];
  goOffWorkTimeType?: '1' | '2';
  shiftCodes?: number[];
  rangeShiftTypes?: Array<string | number>;
  attendanceRequirement?: '1' | '3';
  shiftInfos?: PositionShiftInfo[];
  interviewRounds?: '0' | '1' | '2' | '3';
  interviewTimeMode?: '1' | '2' | '4';
  interviewDeadlineEnabled?: boolean;
  interviewCycleRules?: PositionInterviewCycleRule[];
  interviewFixedSlots?: PositionInterviewFixedSlot[];
  interviewRoundConfigs?: PositionInterviewRoundConfig[];
  interviewLabelIds?: string[];
  interviewBuiltinTagIds?: string[];
  interviewCustomTags?: string[];
  trialAddressMode?: '1' | '2';
  trialAddress?: string;
  trialDuration?: number;
  trialUnit?: 'day' | 'hour';
  trialAssessment?: '1' | '2' | '3' | '4';
  trialAssessmentRemark?: string;
  trainingAddressMode?: '1' | '2';
  trainingAddress?: string;
  trainingDuration?: number;
  trainingUnit?: '1' | '2';
  trainingContent?: string;
  onboardingGrooming?: string;
  onboardingMaterials?: string;
  onboardingProcess?: string;
  recruitStoreAllocations?: PositionStoreAllocation[];
  workEnvironmentImages?: string[];
};

export type PositionItem = PositionFormValues & {
  id: string;
  jobBasicInfoId?: number;
  jobId?: string;
  salaryText?: string;
  genderRequirementText?: string;
  requirementNum?: number;
  signUpNum?: number;
  scheduleSummary?: string;
  cooperationModeText?: string;
  showStatus?: 0 | 1;
  cityRegion?: string;
  showToSupplier?: boolean;
  createdAt?: string;
  updatedAt?: string;
  status: PositionStatus;
};

export type PositionResultSummary = {
  jobBasicInfoId: number;
  name: string;
  projectName?: string;
  brandName?: string;
  cityRegion?: string;
  status: PositionStatus;
  statusText: string;
  salaryText?: string;
  recruitCount?: number;
};

export type PositionSearchParams = {
  jobBasicInfoIds?: number[];
  projectIds?: number[];
  brandIds?: number[];
  cityIdList?: number[];
  searchJobName?: string;
  statuses?: PositionApiStatus[];
  pageNum: number;
  pageSize: number;
};

export type PositionListResult = {
  result: PositionItem[];
  total: number;
};

export type PositionDetailResult = {
  jobBasicInfoId?: number;
  jobDraftId?: number;
  immediate?: number;
  requirement?: Record<string, unknown>;
};

export type PendingPositionDraft = {
  draftId: string;
  sessionId: string;
  mode: PositionDraftMode;
  action: PositionCommitAction;
  values: PositionFormValues;
  originalValues?: PositionFormValues;
  jobBasicInfoId?: number;
  sendMsgToSupplier?: boolean;
  createdAt: number;
  updatedAt: number;
  missingFields: FieldIssue[];
  validationErrors: FieldIssue[];
  diff: PositionFieldDiff[];
};

export type ParsedPositionMessage = {
  intent: PositionIntent;
  action?: PositionCommitAction;
  sendMsgToSupplier?: boolean;
  jobBasicInfoId?: number;
  sourceJobBasicInfoId?: number;
  inheritFromContext?: boolean;
  search: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
  patch: Partial<PositionFormValues>;
  references: {
    projectName?: string;
    brandName?: string;
    cityNames?: string[];
    positionCategoryName?: string;
    storeNames?: string[];
  };
};
