import type {
  ParsedPositionMessage,
  PositionSearchParams,
} from './types.ts';
import { normalizeString } from './utils.ts';

export type PositionQueryCandidateKind =
  | 'params'
  | 'jobName'
  | 'brandName'
  | 'projectName';

export type PositionQueryCandidate = {
  kind: PositionQueryCandidateKind;
  label: string;
  params: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
  keyword?: string;
  strictEntityResolution?: boolean;
};

export type PositionQueryPlan = {
  candidates: PositionQueryCandidate[];
};

type BuildPositionQueryPlanInput = {
  parsed: ParsedPositionMessage;
  resolvedSearch?: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
};

export function buildPositionQueryPlan(input: BuildPositionQueryPlanInput): PositionQueryPlan {
  const { parsed } = input;
  const baseParams = mergeSearchParams(parsed.search, input.resolvedSearch);
  const candidates: PositionQueryCandidate[] = [];

  if (baseParams.jobBasicInfoIds?.length) {
    return {
      candidates: [
        {
          kind: 'params',
          label: `岗位 ID ${baseParams.jobBasicInfoIds.join('、')}`,
          params: baseParams,
        },
      ],
    };
  }

  if (baseParams.brandIds?.length || baseParams.projectIds?.length) {
    candidates.push({
      kind: 'params',
      label: describeParamsCandidate(baseParams),
      params: baseParams,
    });
  }

  const explicitBrandName = normalizeString(parsed.references.brandName);
  const explicitProjectName = normalizeString(parsed.references.projectName);
  const jobNameKeyword = normalizeString(baseParams.searchJobName);
  const filterParams = omitEntityAndKeyword(baseParams);

  if (explicitBrandName) {
    candidates.push({
      kind: 'brandName',
      label: `品牌“${explicitBrandName}”`,
      params: filterParams,
      keyword: explicitBrandName,
      strictEntityResolution: true,
    });
    candidates.push({
      kind: 'jobName',
      label: `岗位名称包含“${explicitBrandName}”`,
      params: filterParams,
      keyword: explicitBrandName,
    });
  }

  if (explicitProjectName) {
    candidates.push({
      kind: 'projectName',
      label: `项目“${explicitProjectName}”`,
      params: filterParams,
      keyword: explicitProjectName,
      strictEntityResolution: true,
    });
    candidates.push({
      kind: 'jobName',
      label: `岗位名称包含“${explicitProjectName}”`,
      params: filterParams,
      keyword: explicitProjectName,
    });
  }

  if (jobNameKeyword) {
    const jobNameParams = {
      ...filterParams,
      searchJobName: jobNameKeyword,
    };
    candidates.push({
      kind: 'jobName',
      label: `岗位名称包含“${jobNameKeyword}”`,
      params: jobNameParams,
      keyword: jobNameKeyword,
    });

    candidates.push({
      kind: 'brandName',
      label: `品牌“${jobNameKeyword}”`,
      params: filterParams,
      keyword: jobNameKeyword,
    });

    candidates.push({
      kind: 'projectName',
      label: `项目“${jobNameKeyword}”`,
      params: filterParams,
      keyword: jobNameKeyword,
    });

    if (baseParams.cityIdList?.length) {
      const relaxedFilterParams = {
        ...filterParams,
        cityIdList: undefined,
      };
      const relaxedJobNameParams = {
        ...jobNameParams,
        cityIdList: undefined,
      };
      candidates.push({
        kind: 'jobName',
        label: `岗位名称包含“${jobNameKeyword}”（放宽城市条件）`,
        params: relaxedJobNameParams,
        keyword: jobNameKeyword,
      });
      candidates.push({
        kind: 'brandName',
        label: `品牌“${jobNameKeyword}”（放宽城市条件）`,
        params: relaxedFilterParams,
        keyword: jobNameKeyword,
      });
      candidates.push({
        kind: 'projectName',
        label: `项目“${jobNameKeyword}”（放宽城市条件）`,
        params: relaxedFilterParams,
        keyword: jobNameKeyword,
      });
    }
  }

  if (!candidates.length && hasAnyPlanParams(baseParams)) {
    candidates.push({
      kind: 'params',
      label: describeParamsCandidate(baseParams),
      params: baseParams,
    });
  }

  return {
    candidates: dedupeCandidates(candidates),
  };
}

function mergeSearchParams(
  left: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>,
  right?: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>,
): Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>> {
  return {
    ...left,
    ...right,
    jobBasicInfoIds: uniqueNumbers([...(left.jobBasicInfoIds ?? []), ...(right?.jobBasicInfoIds ?? [])]),
    projectIds: uniqueNumbers([...(left.projectIds ?? []), ...(right?.projectIds ?? [])]),
    brandIds: uniqueNumbers([...(left.brandIds ?? []), ...(right?.brandIds ?? [])]),
    cityIdList: uniqueNumbers([...(left.cityIdList ?? []), ...(right?.cityIdList ?? [])]),
    statuses: uniqueNumbers([...(left.statuses ?? []), ...(right?.statuses ?? [])]) as PositionSearchParams['statuses'],
    searchJobName: right?.searchJobName ?? left.searchJobName,
  };
}

function omitEntityAndKeyword(
  params: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>,
): Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>> {
  return {
    cityIdList: params.cityIdList,
    statuses: params.statuses,
  };
}

function hasAnyPlanParams(
  params: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>,
): boolean {
  return Boolean(
    params.projectIds?.length ||
      params.brandIds?.length ||
      params.cityIdList?.length ||
      params.searchJobName ||
      params.statuses?.length,
  );
}

function describeParamsCandidate(
  params: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>,
): string {
  const parts: string[] = [];
  if (params.projectIds?.length) {
    parts.push(`项目 ID ${params.projectIds.join('、')}`);
  }
  if (params.brandIds?.length) {
    parts.push(`品牌 ID ${params.brandIds.join('、')}`);
  }
  if (params.cityIdList?.length) {
    parts.push(`城市 ID ${params.cityIdList.join('、')}`);
  }
  if (params.statuses?.length) {
    parts.push(`状态 ${params.statuses.join('、')}`);
  }
  if (params.searchJobName) {
    parts.push(`岗位名称包含“${params.searchJobName}”`);
  }
  return parts.join('，') || '岗位查询条件';
}

function dedupeCandidates(candidates: PositionQueryCandidate[]): PositionQueryCandidate[] {
  const seen = new Set<string>();
  const result: PositionQueryCandidate[] = [];
  for (const candidate of candidates) {
    const key = stableCandidateId(candidate.kind, {
      ...candidate.params,
      keyword: candidate.keyword,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function stableCandidateId(prefix: string, value: unknown): string {
  return `${prefix}:${JSON.stringify(sortObject(value))}`;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }
  return value;
}

function uniqueNumbers(values: number[]): number[] | undefined {
  const result = Array.from(new Set(values.filter(value => Number.isFinite(value))));
  return result.length ? result : undefined;
}
