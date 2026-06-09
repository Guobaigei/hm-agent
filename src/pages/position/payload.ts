import {
  resolveDictionaryArray,
  resolveDictionaryNumber,
} from './dictionary.ts';
import { cleanPositionFormValues } from './form.ts';
import type {
  PositionFormValues,
  PositionInterviewRoundConfig,
  PositionSalaryConfig,
  PositionStoreAllocation,
  PositionTimePeriod,
} from './types.ts';
import { normalizeNumber, pruneEmpty, toTimeSeconds } from './utils.ts';

type PayloadOptions = {
  jobBasicInfoId?: number | null;
  publishNow: boolean;
  sendMsgToSupplier?: boolean;
};

export function buildCreateJobPayload(values: PositionFormValues, options: PayloadOptions) {
  return pruneEmpty({
    immediate: options.publishNow ? 1 : 0,
    sendMsgToSupplier: options.publishNow ? Boolean(options.sendMsgToSupplier) : false,
    jobRequirement: buildJobRequirementPayload(values),
  }) as Record<string, unknown>;
}

export function buildUpdateJobPayload(values: PositionFormValues, options: PayloadOptions) {
  return pruneEmpty({
    immediate: options.publishNow ? 1 : 0,
    sendMsgToSupplier: options.publishNow ? Boolean(options.sendMsgToSupplier) : false,
    jobRequirement: buildJobRequirementPayload(values, {
      jobBasicInfoId: options.jobBasicInfoId,
    }),
  }) as Record<string, unknown>;
}

export function buildJobRequirementPayload(
  rawValues: PositionFormValues,
  options: { jobBasicInfoId?: number | null } = {},
) {
  const values = cleanPositionFormValues(rawValues);
  const basicInfo = mapBasicInfo(values, options.jobBasicInfoId);
  const salaryWelfare = mapSalaryWelfare(values);
  const hiringRequirement = mapHiringRequirement(values);
  const workTimeArrangement = mapWorkTimeArrangement(values);
  const processRequirement = mapProcessRequirement(values);
  const storeRequirement = {
    jobStores: mapJobStores(values.recruitStoreAllocations),
  };
  const jobEnvImages = mapJobEnvImages(values);

  return pruneEmpty({
    basicInfo,
    salaryWelfare,
    hiringRequirement,
    workTimeArrangement,
    processRequirement,
    storeRequirement,
    jobEnvImages,
  }) as Record<string, unknown>;
}

function mapBasicInfo(values: PositionFormValues, jobBasicInfoId?: number | null) {
  return pruneEmpty({
    id: normalizeNumber(jobBasicInfoId),
    project: {
      projectId: normalizeNumber(values.projectId),
    },
    brand: {
      brandId: normalizeNumber(values.brandId),
    },
    jobName: values.jobName || values.positionName,
    jobNickName: values.positionName,
    jobType: normalizeNumber(values.positionCategory),
    jobContent: values.workContent,
    laborForm:
      values.employmentType === 'part-time'
        ? resolveDictionaryNumber('labor_form', values.partTimeType ?? '1')
        : resolveDictionaryNumber('labor_form', '2'),
    haveProbation:
      values.employmentType === 'full-time'
        ? resolveDictionaryNumber('have_probation', values.probationStatus)
        : undefined,
    cooperationMode: resolveDictionaryNumber('cooperation_mode', values.cooperationMode),
    needProbationWork: resolveDictionaryNumber('need_probation_work', values.trialRequired),
    needTraining: resolveDictionaryNumber('need_training', values.trainingRequired),
  });
}

function mapPayDay(config: PositionSalaryConfig) {
  if (!config.payDay) {
    return {};
  }

  if (config.settlementCycle === '1') {
    return { daySalaryPeriodTime: normalizeNumber(config.payDay) };
  }

  if (config.settlementCycle === '2') {
    return { weedSalaryPeriodTime: normalizeWeekday(config.payDay) };
  }

  return { monthSalaryPeriodTime: normalizeNumber(config.payDay) };
}

function mapSalaryConfig(config: PositionSalaryConfig | undefined, type: 0 | 1 | 2) {
  if (!config) {
    return undefined;
  }

  return pruneEmpty({
    type,
    salaryPeriod: resolveDictionaryNumber('salary_period', config.settlementCycle),
    ...mapPayDay(config),
    salary: config.baseSalary,
    salaryUnit: resolveDictionaryNumber('salary_unit6', config.baseSalaryUnit),
    haveStairSalary: config.hasLadderSalary === '1' ? 1 : config.hasLadderSalary === '2' ? 2 : undefined,
    jobSalaryStairs:
      config.hasLadderSalary === '1'
        ? config.ladderSalaryTiers?.map(tier =>
            pruneEmpty({
              fullWorkTime: tier.min,
              fullWorkMaxTime: tier.max,
              fullWorkTimeUnit: resolveDictionaryNumber('salary_unit6', config.ladderSalaryType),
              perTimeUnit: resolveDictionaryNumber('salary_unit6', config.ladderSalaryType),
              salary: tier.amount,
              salaryUnit: resolveDictionaryNumber('salary_unit6', config.baseSalaryUnit),
            }),
          )
        : undefined,
    stairDescription: normalizeNumber(config.ladderSalaryRule),
    hasSpecialSalary:
      config.hasSpecialPeriodSalary === '1' || config.hasSpecialPeriodSalary === 1,
    jobSpecialSalaryList:
      config.hasSpecialPeriodSalary === '1' || config.hasSpecialPeriodSalary === 1
        ? mapTimePeriods(config.specialPeriods)?.map(period =>
            pruneEmpty({
              ...period,
              specialSalary: config.specialPeriodSalaryAmount,
              specialSalaryUnit: resolveDictionaryNumber('salary_unit6', config.specialPeriodSalaryUnit),
              specialSalaryRemark: config.specialPeriodSalaryRemark,
            }),
          )
        : undefined,
    holidaySalary: normalizeNumber(config.holidaySalaryType),
    holidaySalaryMultiple: config.holidaySalaryMultiplier,
    holidayFixedSalary: config.holidaySalaryAmount,
    holidayFixedSalaryUnit: resolveDictionaryNumber('salary_unit6', config.holidaySalaryUnit),
    holidaySalaryDesc: config.holidaySalaryRemark,
    overtimeSalary: normalizeNumber(config.overtimeSalaryType),
    overtimeSalaryMultiple: config.overtimeSalaryMultiplier,
    overtimeFixedSalary: config.overtimeSalaryAmount,
    overtimeFixedSalaryUnit: resolveDictionaryNumber('salary_unit6', config.overtimeSalaryUnit),
    overtimeSalaryDesc: config.overtimeSalaryRemark,
    attendenceSalary: config.bonusSubsidyAmount,
    attendenceSalaryUnit: resolveDictionaryNumber('salary_unit3', config.bonusSubsidyUnit),
    bonusDesc: config.bonusSubsidyRemark,
    commission: config.commissionRemark,
    performance: config.performanceSalaryRemark,
    minComprehensiveSalary: config.salaryMin,
    maxComprehensiveSalary: config.salaryMax,
    comprehensiveSalaryUnit: resolveDictionaryNumber('salary_unit3', config.salaryRangeUnit),
  });
}

function mapSalaryWelfare(values: PositionFormValues) {
  const primarySalary = mapSalaryConfig(values, 0);
  const probationSalary =
    values.employmentType === 'full-time' && values.probationStatus === '2'
      ? mapSalaryConfig(values.probationSalaryConfig, 1)
      : undefined;
  const trainingSalary =
    values.trainingRequired === '1'
      ? mapSalaryConfig(values.trainingSalaryConfig, 2)
      : undefined;

  return pruneEmpty({
    jobSalaries: [primarySalary, probationSalary, trainingSalary].filter(Boolean),
    jobProbationSalary:
      values.trialRequired === '1'
        ? pruneEmpty({
            salary: values.trialSalaryAmount,
            salaryUnit: resolveDictionaryNumber('salary_unit6', values.trialSalaryUnit),
            otherSalaryDescription: values.trialSalaryRemark,
          })
        : undefined,
    jobWelfare: pruneEmpty({
      haveInsurance: resolveDictionaryNumber('have_insurance', values.commercialInsurance),
      insuranceFund:
        values.employmentType === 'full-time' && !values.socialInsuranceList?.includes('none')
          ? resolveDictionaryArray('insurance_fund', values.socialInsuranceList)
          : undefined,
      accommodation: resolveDictionaryNumber('accommodation', values.housingBenefit),
      accommodationSalary: values.housingSubsidy,
      accommodationSalaryUnit: resolveDictionaryNumber('salary_unit3', values.housingSubsidyUnit),
      accommodationAllowanceDesc: values.housingBenefitRemark,
      catering: resolveDictionaryNumber('catering', values.mealBenefit),
      cateringSalary: values.mealSubsidy,
      cateringSalaryUnit: resolveDictionaryNumber('salary_unit3', values.mealSubsidyUnit),
      cateringAllowanceDesc: values.mealBenefitRemark,
      trafficAllowanceSalary: values.transportSubsidy,
      trafficAllowanceSalaryUnit: resolveDictionaryNumber('salary_unit3', values.transportSubsidyUnit),
      trafficAllowance: values.transportBenefitRemark,
      memo: values.memo,
      probationInsuranceReceive:
        values.trialRequired === '1'
          ? resolveDictionaryNumber('spone_probation_insurance_receive', values.trialBenefitConfig?.commercialInsurance)
          : undefined,
      probationAccommodationSalaryReceive:
        values.trialRequired === '1'
          ? resolveDictionaryNumber('probation_accommodation_salary_receive', values.trialBenefitConfig?.housingBenefit)
          : undefined,
      probationCateringSalaryReceive:
        values.trialRequired === '1'
          ? resolveDictionaryNumber('spone_probation_catering_salary_receive', values.trialBenefitConfig?.mealBenefit)
          : undefined,
    }),
  });
}

function mapHiringRequirement(values: PositionFormValues) {
  const hasMaleRequirement = values.genders?.includes('1');
  const hasFemaleRequirement = values.genders?.includes('2');
  const hasSocialInsuranceRequirement =
    values.socialIdentity === '2' || values.socialIdentity === '3';

  return pruneEmpty({
    minAge: values.ageMin,
    maxAge: values.ageMax,
    genderIds: resolveDictionaryArray('spone_gender_ids', values.genders),
    manMinHeight: hasMaleRequirement ? values.maleRequirement?.heightMin : undefined,
    manMaxHeight: hasMaleRequirement ? values.maleRequirement?.heightMax : undefined,
    manMinWeight: hasMaleRequirement ? values.maleRequirement?.weightMin : undefined,
    manMaxWeight: hasMaleRequirement ? values.maleRequirement?.weightMax : undefined,
    womanMinHeight: hasFemaleRequirement ? values.femaleRequirement?.heightMin : undefined,
    womanMaxHeight: hasFemaleRequirement ? values.femaleRequirement?.heightMax : undefined,
    womanMinWeight: hasFemaleRequirement ? values.femaleRequirement?.weightMin : undefined,
    womanMaxWeight: hasFemaleRequirement ? values.femaleRequirement?.weightMax : undefined,
    figureId: resolveDictionaryNumber('social_figure', values.socialIdentity),
    socialSecurityTypes: hasSocialInsuranceRequirement
      ? values.socialInsurancePayments?.map(item => normalizeNumber(item)).filter((item): item is number => item !== undefined)
      : undefined,
    socialSecurityRequirementType: hasSocialInsuranceRequirement
      ? values.socialInsurancePayments?.includes('1')
        ? 0
        : 1
      : undefined,
    educationId: resolveDictionaryNumber('education', values.education),
    marriageBearingType: resolveDictionaryNumber('spone_marriage_bearing_type', values.marriageMode),
    marriageBearingStatus:
      values.marriageMode === '1' || values.marriageMode === '2'
        ? normalizeNumber(values.marriageStatus)
        : undefined,
    nativePlaceRequirementType: resolveDictionaryNumber('spone_native_place_requirement_type', values.nativePlaceMode),
    nativePlaceIds:
      values.nativePlaceMode === '1' || values.nativePlaceMode === '2'
        ? values.nativePlaces?.map(item => normalizeNumber(item)).filter((item): item is number => item !== undefined)
        : undefined,
    nationRequirementType: resolveDictionaryNumber('spone_nation_requirement_type', values.ethnicityMode),
    nationIds:
      values.ethnicityMode === '1' || values.ethnicityMode === '2'
        ? values.ethnicities?.map(item => normalizeNumber(item)).filter((item): item is number => item !== undefined)
        : undefined,
    countryRequirementType: resolveDictionaryNumber('spone_country_requirement_type', values.nationality),
    workExperienceJobType: normalizeNumber(values.experienceRequirement?.positionCategory),
    minWorkTime: values.experienceRequirement?.duration,
    minWorkTimeUnit:
      values.experienceRequirement?.unit === 'year'
        ? 1
        : values.experienceRequirement?.unit === 'month'
          ? 2
          : undefined,
    certificates: values.certificateTypes
      ?.map(item => normalizeNumber(item))
      .filter((item): item is number => item !== undefined),
    healthCertificateType: values.certificateTypes?.includes('1')
      ? resolveDictionaryNumber('health_certificate_type', values.healthCertificateType)
      : undefined,
    driverLicenseType: values.certificateTypes?.includes('3')
      ? resolveDictionaryNumber('driver_license_type', values.driverLicenseType)
      : undefined,
    languages: resolveDictionaryArray('spone_languages', values.languages),
    languageRemark: values.languageRemark,
    softSkill: values.softwareSkills,
  });
}

function mapWorkTimeArrangement(values: PositionFormValues) {
  const isWorkRestSchedule = values.weeklyMonthlyMode === '1';
  const isWorkHourSchedule = values.weeklyMonthlyMode === '2';
  const isDailyRangeSchedule = values.dailyScheduleMode === '2';

  return pruneEmpty({
    employmentForm:
      values.employmentType === 'full-time'
        ? 1
        : values.employmentDurationType === '2'
          ? 2
          : values.employmentDurationType === '1'
            ? 1
            : undefined,
    minWorkMonths:
      values.employmentType === 'part-time' && values.employmentDurationType === '1'
        ? values.minWorkMonths
        : undefined,
    temporaryEmploymentStartTime:
      values.employmentType === 'part-time' && values.employmentDurationType === '2'
        ? values.temporaryEmploymentStartTime
        : undefined,
    temporaryEmploymentEndTime:
      values.employmentType === 'part-time' && values.employmentDurationType === '2'
        ? values.temporaryEmploymentEndTime
        : undefined,
    maxWorkTakingTime: values.commuteLimit,
    perWeekWorkDays: isWorkRestSchedule ? values.workDays : undefined,
    perWeekRestDays: isWorkRestSchedule ? values.restDays : undefined,
    weekMonthArrangementMode: resolveDictionaryNumber('spone_week_month_arrangement_mode', values.weeklyMonthlyMode),
    weekMonthRestMode: isWorkRestSchedule
      ? resolveDictionaryNumber('spone_week_month_rest_mode', values.restMode)
      : undefined,
    arrangementCycleType: isWorkHourSchedule
      ? resolveDictionaryNumber('spone_arrangement_cycle_type', values.workHourIntervalType)
      : undefined,
    onWorkLimitType: isWorkHourSchedule
      ? resolveDictionaryNumber('spone_on_work_limit_type', values.workHourRequirementType)
      : undefined,
    onWorkTime: isWorkHourSchedule ? values.workHours : undefined,
    onWorkTimeUnit: isWorkHourSchedule
      ? resolveDictionaryNumber('spone_on_work_time_unit', values.workHoursUnit)
      : undefined,
    arrangementType: resolveDictionaryNumber('spone_arrangement_type', values.dailyScheduleMode),
    perDayMinWorkHours: isDailyRangeSchedule ? values.dailyWorkDuration : undefined,
    goToWorkStartTime: isDailyRangeSchedule ? toTimeSeconds(values.dailyTimeRange?.[0]) : undefined,
    goOffWorkStartTime: isDailyRangeSchedule ? toTimeSeconds(values.dailyTimeRange?.[1]) : undefined,
    goOffWorkTimeType: isDailyRangeSchedule
      ? resolveDictionaryNumber('spone_go_off_work_time_type', values.goOffWorkTimeType)
      : undefined,
    shiftCodes: isDailyRangeSchedule ? values.shiftCodes : undefined,
    dayWorkTimeRequirement:
      values.dailyScheduleMode === '1' || values.dailyScheduleMode === '3'
        ? resolveDictionaryNumber('spone_day_work_time_requirement', values.dailyScheduleMode)
        : undefined,
    fixedArrangementTimes:
      values.dailyScheduleMode === '1' ? mapShiftInfos(values.shiftInfos) : undefined,
    combinedArrangementTimes:
      values.dailyScheduleMode === '3' ? mapShiftInfos(values.shiftInfos) : undefined,
  });
}

function mapProcessRequirement(values: PositionFormValues) {
  const interviewRounds = Number(values.interviewRounds || 0);
  const hasInterview = Number.isFinite(interviewRounds) && interviewRounds > 0;
  const roundConfigs = hasInterview
    ? values.interviewRoundConfigs?.slice(0, interviewRounds)
    : undefined;
  const firstRound = roundConfigs?.[0];
  const secondRound = roundConfigs?.[1];
  const thirdRound = roundConfigs?.[2];

  return pruneEmpty({
    interviewTotal: resolveDictionaryNumber('spone_interview_total', values.interviewRounds),
    interviewTimeMode: hasInterview
      ? resolveDictionaryNumber('interview_time_mode', values.interviewTimeMode)
      : undefined,
    firstInterviewWay: mapRoundMode(firstRound),
    secondInterviewWay: mapRoundMode(secondRound),
    thirdInterviewWay: mapRoundMode(thirdRound),
    firstInterviewDesc: firstRound?.interviewRemark,
    secondInterviewDesc: secondRound?.interviewRemark,
    thirdInterviewDesc: thirdRound?.interviewRemark,
    firstInterviewAddressMode: resolveDictionaryNumber('interview_address_mode', firstRound?.interviewAddressMode),
    secondInterviewAddressMode: resolveDictionaryNumber('interview_address_mode', secondRound?.interviewAddressMode),
    thirdInterviewAddressMode: resolveDictionaryNumber('interview_address_mode', thirdRound?.interviewAddressMode),
    interviewAddressText: firstRound?.interviewAddress,
    secondInterviewAddressText: secondRound?.interviewAddress,
    thirdInterviewAddressText: thirdRound?.interviewAddress,
    interviewExtLabel:
      hasInterview && values.interviewCustomTags?.length
        ? values.interviewCustomTags.join(',')
        : undefined,
    probationWorkMode:
      values.trialRequired === '1'
        ? resolveDictionaryNumber('probation_work_mode', values.trialAddressMode)
        : undefined,
    probationWorkAddressText:
      values.trialRequired === '1' && values.trialAddressMode === '2'
        ? values.trialAddress
        : undefined,
    probationWorkPeriod: values.trialRequired === '1' ? values.trialDuration : undefined,
    probationWorkPeriodUnit:
      values.trialRequired === '1'
        ? resolveDictionaryNumber('probation_work_period_unit', values.trialUnit)
        : undefined,
    probationWorkAssessment:
      values.trialRequired === '1'
        ? resolveDictionaryNumber('probation_work_assessment', values.trialAssessment)
        : undefined,
    probationWorkAssessmentText:
      values.trialRequired === '1' && values.trialAssessment === '4'
        ? values.trialAssessmentRemark
        : undefined,
    trainMode:
      values.trainingRequired === '1'
        ? resolveDictionaryNumber('train_mode', values.trainingAddressMode)
        : undefined,
    trainAddress:
      values.trainingRequired === '1' && values.trainingAddressMode === '2'
        ? values.trainingAddress
        : undefined,
    trainPeriod: values.trainingRequired === '1' ? values.trainingDuration : undefined,
    trainPeriodUnit:
      values.trainingRequired === '1'
        ? resolveDictionaryNumber('train_period_unit', values.trainingUnit)
        : undefined,
    trainDesc: values.trainingRequired === '1' ? values.trainingContent : undefined,
    onWorkClothingExplain: values.onboardingGrooming,
    onWorkInfo: values.onboardingMaterials,
    processDesc: values.onboardingProcess,
  });
}

function mapJobStores(rows: PositionStoreAllocation[] | undefined) {
  const result: Record<string, unknown>[] = [];

  for (const row of rows || []) {
    const mapped = pruneEmpty({
        storeId: row.storeId,
        storeName: row.storeName,
        storeAddress: row.storeAddress,
        storeExactAddress: row.storeExactAddress,
        requirementNum: row.recruitCount,
        thresholdNum: resolveDictionaryNumber('threshold_num', row.threshold),
      });

    if (mapped) {
      result.push(mapped);
    }
  }

  return result.length ? result : undefined;
}

function mapJobEnvImages(values: PositionFormValues) {
  return values.workEnvironmentImages?.slice(0, 3).map((url, index) =>
    pruneEmpty({
      imageUrl: url,
      image: url,
      sort: index + 1,
      type: 1,
    }),
  );
}

function mapTimePeriods(periods?: PositionTimePeriod[]) {
  return periods?.map(period =>
    pruneEmpty({
      startTime: toTimeSeconds(period.startTime),
      endTime: toTimeSeconds(period.endTime),
    }),
  );
}

function mapShiftInfos(rows?: Array<{ startTime?: string; endTime?: string }>) {
  return rows?.map(item =>
    pruneEmpty({
      startTime: toTimeSeconds(item.startTime),
      endTime: toTimeSeconds(item.endTime),
    }),
  );
}

function mapRoundMode(round?: PositionInterviewRoundConfig) {
  return resolveDictionaryNumber('spone_interview_way', round?.interviewMode);
}

function normalizeWeekday(value: string): number | undefined {
  const weekdayMap: Record<string, number> = {
    '0': 0,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5,
    '6': 6,
    周一: 0,
    周二: 1,
    周三: 2,
    周四: 3,
    周五: 4,
    周六: 5,
    周日: 6,
    星期一: 0,
    星期二: 1,
    星期三: 2,
    星期四: 3,
    星期五: 4,
    星期六: 5,
    星期日: 6,
  };

  return weekdayMap[value];
}
