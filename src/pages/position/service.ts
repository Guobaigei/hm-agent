import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { AppConfig } from '../core/config.ts';
import {
  buildPositionFormValuesFromDetail,
  mapPositionResultSummary,
  PositionApiClient,
} from './client.ts';
import { PositionDraftStore } from './draftStore.ts';
import {
  buildPositionPreview,
  createDefaultPositionFormValues,
  createPositionDiff,
  formatFieldValue,
  mergePositionValues,
  normalizeCanonicalValues,
  validatePositionValues,
} from './form.ts';
import { parsePositionMessage } from './parser.ts';
import type {
  PositionCreatePlanner,
  PositionCreatePlanningResult,
  PositionSearchPlanner,
  PositionSearchPlanningResult,
} from './planner.ts';
import { buildCreateJobPayload, buildUpdateJobPayload } from './payload.ts';
import {
  buildPositionQueryPlan,
  type PositionQueryCandidate,
  type PositionQueryPlan,
} from './queryPlanner.ts';
import type {
  FieldIssue,
  ParsedPositionMessage,
  PendingPositionDraft,
  PositionCommitAction,
  PositionFieldDiff,
  PositionFormValues,
  PositionResultSummary,
  PositionSearchParams,
  PositionToolRequest,
  PositionToolResponse,
} from './types.ts';
import {
  formatMarkdownTable,
  hasMeaningfulValue,
  normalizeForMatch,
  normalizeNumber,
  normalizeString,
  pruneEmpty,
} from './utils.ts';

type PositionServiceDependencies = {
  config: AppConfig;
  positionApiClient: PositionApiClient;
  draftStore: PositionDraftStore;
  searchPlanner?: PositionSearchPlanner;
  createPlanner?: PositionCreatePlanner;
  logger: Logger;
};

type ResolveResult = {
  patch: Partial<PositionFormValues>;
  issues: FieldIssue[];
  usedTools: string[];
};

type SearchResolveResult = {
  search: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
  issues: FieldIssue[];
  usedTools: string[];
};

type SearchExecutionResult = {
  results: PositionResultSummary[];
  total: number;
  usedTools: string[];
  attemptedLabels: string[];
  resolutionIssues: FieldIssue[];
  failedError?: unknown;
};

type OptionEntity = {
  id: number;
  name: string;
  raw?: Record<string, unknown>;
};

type ProjectBrandOption = OptionEntity;

type StoreOptionEntity = OptionEntity & {
  address?: string;
  exactAddress?: string;
};

type CreateSourceDiscoveryResult = {
  values?: PositionFormValues;
  originalValues?: PositionFormValues;
  usedTools: string[];
  response?: PositionToolResponse;
};

export class PositionService {
  constructor(private readonly dependencies: PositionServiceDependencies) {}

  async chat(request: PositionToolRequest): Promise<PositionToolResponse> {
    assertPositionReadiness(this.dependencies.config);

    try {
      return await this.dispatchChat(request);
    } catch (error) {
      if (isRecoverablePositionApiError(error)) {
        return buildPositionApiFailureResponse(error);
      }
      throw error;
    }
  }

  private async dispatchChat(request: PositionToolRequest): Promise<PositionToolResponse> {
    const pendingDraft = this.dependencies.draftStore.getBySession(request.sessionId);
    const parsed = await this.parseWithOptionalPlanners(request.message, pendingDraft);

    if (parsed.intent === 'cancel') {
      if (pendingDraft) {
        this.dependencies.draftStore.delete(pendingDraft);
      }
      return {
        reply: '已取消当前岗位预览，不会提交任何变更。',
        intent: 'cancel',
        needsClarification: false,
        needsConfirmation: false,
        usedTools: [],
      };
    }

    if (parsed.intent === 'commit') {
      return this.commitDraft(request.sessionId, parsed);
    }

    if (pendingDraft && shouldApplyCreateSourceToPendingDraft(request.message, parsed, pendingDraft)) {
      return this.applyCreateSourceToPendingDraft(pendingDraft, parsed, request.message);
    }

    if (pendingDraft && shouldAskPendingDraftEditTarget(parsed)) {
      return this.askPendingDraftEditTarget(pendingDraft);
    }

    if (pendingDraft && shouldPatchPendingDraft(parsed)) {
      return this.updatePendingDraft(pendingDraft, parsed);
    }

    if (pendingDraft && shouldDescribePendingDraft(request.message, parsed)) {
      return this.describePendingDraft(pendingDraft);
    }

    if (parsed.intent === 'create_preview') {
      return this.createPreview(request.sessionId, parsed);
    }

    if (parsed.intent === 'edit_preview') {
      return this.editPreview(request.sessionId, parsed);
    }

    if (shouldShowPositionDetail(request.message, parsed)) {
      return this.showPositionDetail(request.sessionId, request.message, parsed);
    }

    if (parsed.intent === 'search') {
      return this.searchPositions(request.sessionId, parsed);
    }

    return {
      reply: '请说明要查询、新建还是编辑岗位；编辑时请提供岗位 ID。',
      intent: 'clarify',
      needsClarification: true,
      needsConfirmation: false,
      usedTools: [],
    };
  }

  private async parseWithOptionalPlanners(
    message: string,
    pendingDraft?: PendingPositionDraft,
  ): Promise<ParsedPositionMessage> {
    let parsed = parsePositionMessage(message);

    if (this.dependencies.createPlanner && shouldUseCreatePlanner(message, parsed, pendingDraft)) {
      const plan = await this.dependencies.createPlanner.planCreate({ message, parsed });
      if (plan) {
        parsed = mergeCreatePlanningResult(message, parsed, plan, pendingDraft);
      }
    }

    if (!this.dependencies.searchPlanner || !shouldUseSearchPlanner(message, parsed)) {
      return parsed;
    }
    const plan = await this.dependencies.searchPlanner.planSearch({ message, parsed });
    return plan ? mergeSearchPlanningResult(parsed, plan) : parsed;
  }

  private async searchPositions(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const resolved = await this.resolveSearchReferences(parsed);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认查询条件：', resolved.issues, resolved.usedTools);
    }

    const plan = buildPositionQueryPlan({
      parsed,
      resolvedSearch: resolved.search,
    });
    if (!plan.candidates.length) {
      return {
        reply: '请提供至少一个岗位查询条件：岗位 ID、岗位名称、项目、品牌、城市区域或状态。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: resolved.usedTools,
      };
    }

    const execution = await this.executePositionSearchPlan(plan);
    const usedTools = [...resolved.usedTools, ...execution.usedTools];

    if (!execution.results.length && execution.failedError) {
      return buildPositionApiFailureResponse(execution.failedError);
    }

    if (!execution.results.length && execution.resolutionIssues.length) {
      return buildClarifyResponse('需要先确认查询条件：', execution.resolutionIssues, usedTools);
    }

    this.dependencies.draftStore.setLastResults(sessionId, execution.results);
    const reply = buildSearchReply(execution.results, execution.total, execution.attemptedLabels);

    return {
      reply,
      intent: 'search',
      needsClarification: false,
      needsConfirmation: false,
      results: execution.results,
      usedTools,
    };
  }

  private async executePositionSearchPlan(
    plan: PositionQueryPlan,
  ): Promise<SearchExecutionResult> {
    const usedTools: string[] = [];
    const attemptedLabels: string[] = [];
    const resolutionIssues: FieldIssue[] = [];
    const attemptedParams = new Set<string>();
    let failedError: unknown;

    for (const candidate of plan.candidates) {
      const resolved = await this.resolveSearchCandidate(candidate);
      usedTools.push(...resolved.usedTools);
      resolutionIssues.push(...resolved.issues);
      if (resolved.failedError) {
        failedError = resolved.failedError;
      }
      if (!resolved.params) {
        continue;
      }

      const params: PositionSearchParams = {
        pageNum: 1,
        pageSize: 10,
        ...resolved.params,
      };
      const paramsKey = stableSearchParamsKey(params);
      if (attemptedParams.has(paramsKey)) {
        continue;
      }
      attemptedParams.add(paramsKey);
      attemptedLabels.push(candidate.label);

      try {
        const data = await this.dependencies.positionApiClient.getJobList(params);
        usedTools.push('position.getJobList');
        const results = data.result.map(mapPositionResultSummary);
        if (results.length) {
          return {
            results,
            total: data.total,
            usedTools,
            attemptedLabels,
            resolutionIssues: [],
          };
        }
      } catch (error) {
        if (!isRecoverablePositionApiError(error)) {
          throw error;
        }
        failedError = error;
      }
    }

    return {
      results: [],
      total: 0,
      usedTools,
      attemptedLabels,
      resolutionIssues,
      failedError,
    };
  }

  private async resolveSearchCandidate(
    candidate: PositionQueryCandidate,
  ): Promise<{
    params?: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
    issues: FieldIssue[];
    usedTools: string[];
    failedError?: unknown;
  }> {
    if (candidate.kind === 'params') {
      return {
        params: candidate.params,
        issues: [],
        usedTools: [],
      };
    }

    if (candidate.kind === 'jobName') {
      return {
        params: {
          ...candidate.params,
          searchJobName: candidate.params.searchJobName ?? candidate.keyword,
        },
        issues: [],
        usedTools: [],
      };
    }

    const label = candidate.kind === 'brandName' ? '品牌' : '项目';
    const keyword = normalizeString(candidate.keyword);
    if (!keyword) {
      return { issues: [], usedTools: [] };
    }

    const searchFn =
      candidate.kind === 'brandName'
        ? this.dependencies.positionApiClient.searchBrands?.bind(this.dependencies.positionApiClient)
        : this.dependencies.positionApiClient.searchProjects?.bind(this.dependencies.positionApiClient);
    const toolName = candidate.kind === 'brandName' ? 'position.searchBrands' : 'position.searchProjects';
    if (!searchFn) {
      return candidate.strictEntityResolution
        ? {
            issues: [{
              field: label,
              label,
              message: `当前不支持解析“${keyword}”对应的${label}`,
            }],
            usedTools: [],
          }
        : { issues: [], usedTools: [] };
    }

    try {
      const options = await searchFn(keyword);
      const issues: FieldIssue[] = [];
      const selected = candidate.strictEntityResolution
        ? selectUniqueOption(options, keyword, label, issues)
        : selectFallbackOption(options, keyword);
      if (!selected) {
        return {
          issues,
          usedTools: [toolName],
        };
      }

      return {
        params: {
          ...candidate.params,
          ...(candidate.kind === 'brandName'
            ? { brandIds: [selected.id] }
            : { projectIds: [selected.id] }),
          searchJobName: undefined,
        },
        issues: [],
        usedTools: [toolName],
      };
    } catch (error) {
      if (!isRecoverablePositionApiError(error)) {
        throw error;
      }
      return {
        issues: candidate.strictEntityResolution
          ? [{
              field: label,
              label,
              message: `解析“${keyword}”对应的${label}时接口失败：${error instanceof Error ? error.message : String(error)}`,
            }]
          : [],
        usedTools: [toolName],
        failedError: error,
      };
    }
  }

  private async resolveSearchReferences(parsed: ParsedPositionMessage): Promise<SearchResolveResult> {
    const search: SearchResolveResult['search'] = {};
    const issues: FieldIssue[] = [];
    const usedTools: string[] = [];

    if (parsed.references.cityNames?.length) {
      const cities = flattenCities(await this.dependencies.positionApiClient.getProvinceList());
      usedTools.push('position.getProvinceList');
      const cityIds: number[] = [];
      for (const cityName of parsed.references.cityNames) {
        const selected = selectUniqueOption(cities, cityName, '城市', issues);
        if (selected) {
          cityIds.push(selected.id);
        }
      }
      if (cityIds.length) {
        search.cityIdList = Array.from(new Set(cityIds));
      }
    }

    return { search, issues, usedTools };
  }

  private async showPositionDetail(
    sessionId: string,
    message: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const lastResults = this.dependencies.draftStore.getLastResults(sessionId);
    const focusedPosition = this.dependencies.draftStore.getFocusedPosition(sessionId);
    const targetJobId =
      parseDetailJobId(message) ??
      parsed.jobBasicInfoId ??
      parsed.search.jobBasicInfoIds?.[0] ??
      focusedPosition?.jobBasicInfoId ??
      (lastResults.length === 1 ? lastResults[0].jobBasicInfoId : undefined);

    if (!targetJobId && hasParsedSearchCondition(parsed)) {
      return this.searchPositionsForDetail(sessionId, parsed);
    }

    if (!targetJobId) {
      if (lastResults.length > 1) {
        return {
          reply: [
            '最近一次查询命中了多个岗位，请指定要查看详情的岗位 ID。',
            '',
            buildSearchCandidateTable(lastResults),
          ].join('\n'),
          intent: 'clarify',
          needsClarification: true,
          needsConfirmation: false,
          results: lastResults,
          usedTools: [],
        };
      }

      return {
        reply: '请先查询一个岗位，或直接说明要查看详情的岗位 ID，例如：查看岗位 ID 1914 的详细信息。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: [],
      };
    }

    return this.loadPositionDetail({
      sessionId,
      jobBasicInfoId: targetJobId,
      summary: lastResults.find(item => item.jobBasicInfoId === targetJobId) ?? focusedPosition?.summary,
      usedTools: ['position.getJobDetail'],
    });
  }

  private async searchPositionsForDetail(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const searchResponse = await this.searchPositions(sessionId, parsed);
    const results = searchResponse.results ?? [];

    if (searchResponse.needsClarification || results.length === 0) {
      return searchResponse;
    }

    if (results.length > 1) {
      return {
        ...searchResponse,
        reply: [
          searchResponse.reply,
          '',
          '匹配到多条岗位，请指定岗位 ID 查看详情。',
        ].join('\n'),
        needsClarification: true,
      };
    }

    const [result] = results;
    return this.loadPositionDetail({
      sessionId,
      jobBasicInfoId: result.jobBasicInfoId,
      summary: result,
      usedTools: [...(searchResponse.usedTools ?? []), 'position.getJobDetail'],
    });
  }

  private async loadPositionDetail(input: {
    sessionId: string;
    jobBasicInfoId: number;
    summary?: PositionResultSummary;
    usedTools: string[];
  }): Promise<PositionToolResponse> {
    const { sessionId, jobBasicInfoId, summary, usedTools } = input;
    const detail = await this.dependencies.positionApiClient.getJobDetail(jobBasicInfoId);
    const detailValues = buildPositionFormValuesFromDetail(detail);
    if (!detailValues) {
      return {
        reply: `未获取到岗位 ID ${jobBasicInfoId} 的详细信息。请确认岗位 ID 是否正确。`,
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools,
      };
    }

    const values = normalizeCanonicalValues(detailValues as PositionFormValues);
    this.dependencies.draftStore.setFocusedPosition(sessionId, jobBasicInfoId, summary);
    const preview = buildPositionPreview({
      draftId: String(jobBasicInfoId),
      mode: 'edit',
      title: '岗位详情',
      values,
      action: 'save',
    });

    return {
      reply: buildDetailReply(jobBasicInfoId, values, summary),
      intent: 'search',
      needsClarification: false,
      needsConfirmation: false,
      preview,
      usedTools,
    };
  }

  private async createPreview(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const inherited = await this.resolveInheritedCreateSource(sessionId, parsed);
    if (inherited.response) {
      return inherited.response;
    }

    const baseValues = inherited.values ?? createDefaultPositionFormValues();
    const resolved = await this.resolveCreateReferences(parsed, baseValues);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认新建岗位中的选项：', resolved.issues, [
        ...inherited.usedTools,
        ...resolved.usedTools,
      ]);
    }

    const values = normalizeCanonicalValues(
      mergePositionValues(baseValues, {
        ...parsed.patch,
        ...resolved.patch,
      }),
    );
    const userPatch = mergeUserPatch(undefined, {
      ...parsed.patch,
      ...resolved.patch,
    });

    if (!inherited.values) {
      const discovered = await this.discoverCreateSourceForIncompleteValues(
        sessionId,
        parsed,
        values,
        userPatch,
        resolved.usedTools,
      );
      if (discovered.response) {
        return discovered.response;
      }
      if (discovered.values) {
        return this.storeAndReturnPreview({
          sessionId,
          mode: 'create',
          action: parsed.action ?? 'save',
          values: discovered.values,
          originalValues: discovered.originalValues,
          userPatch,
          jobBasicInfoId: undefined,
          sendMsgToSupplier: parsed.sendMsgToSupplier,
          usedTools: [...resolved.usedTools, ...discovered.usedTools],
        });
      }
    }

    return this.storeAndReturnPreview({
      sessionId,
      mode: 'create',
      action: parsed.action ?? 'save',
      values,
      originalValues: inherited.originalValues,
      userPatch,
      jobBasicInfoId: undefined,
      sendMsgToSupplier: parsed.sendMsgToSupplier,
      usedTools: [...inherited.usedTools, ...resolved.usedTools],
    });
  }

  private async resolveInheritedCreateSource(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<{
    values?: PositionFormValues;
    originalValues?: PositionFormValues;
    usedTools: string[];
    response?: PositionToolResponse;
  }> {
    if (!parsed.sourceJobBasicInfoId && !parsed.inheritFromContext) {
      return { usedTools: [] };
    }

    const sourceJobBasicInfoId = parsed.sourceJobBasicInfoId ?? this.getContextSourceJobId(sessionId);
    if (!sourceJobBasicInfoId) {
      const lastResults = this.dependencies.draftStore.getLastResults(sessionId);
      if (lastResults.length > 1) {
        return {
          usedTools: [],
          response: {
            reply: [
              '最近一次查询命中了多个岗位，请指定要继承的岗位 ID。',
              '',
              buildSearchCandidateTable(lastResults),
              '',
              '例如：照着岗位 ID 1909 新建，把招聘人数改为 5 人。',
            ].join('\n'),
            intent: 'clarify',
            needsClarification: true,
            needsConfirmation: false,
            results: lastResults,
            usedTools: [],
          },
        };
      }

      return {
        usedTools: [],
        response: {
          reply: [
            '请说明要继承哪个岗位 ID，或先查看一个岗位详情后再说“照着这个岗位新建”。',
            '',
            '可用说法：',
            '- 照着岗位 ID 1909 新建，把招聘人数改为 5 人',
            '- 复制岗位 ID 1909，门店换成人民广场店',
            '- 先查看岗位 ID 1909 的详情，再说“照着这个岗位新建”',
          ].join('\n'),
          intent: 'clarify',
          needsClarification: true,
          needsConfirmation: false,
          usedTools: [],
        },
      };
    }

    const source = await this.loadCreateSourceValues(sourceJobBasicInfoId);
    if (source.response) {
      return source;
    }

    return {
      values: source.values,
      originalValues: source.values,
      usedTools: source.usedTools,
    };
  }

  private async discoverCreateSourceForIncompleteValues(
    sessionId: string,
    parsed: ParsedPositionMessage,
    values: PositionFormValues,
    userPatch: Partial<PositionFormValues>,
    priorUsedTools: string[],
  ): Promise<CreateSourceDiscoveryResult> {
    const { missingFields, validationErrors } = validatePositionValues(values);
    if (!missingFields.length && !validationErrors.length) {
      return { usedTools: [] };
    }

    if (missingFields.some(field => isCoreCreateEntityField(field.field))) {
      return { usedTools: [] };
    }

    const sourceKeywords = buildCreateSourceSearchKeywords(parsed, values);
    if (sourceKeywords.length) {
      const found = await this.searchCreateSourceCandidates(sourceKeywords);
      if (found.candidates.length === 1) {
        const source = await this.loadCreateSourceValues(found.candidates[0].jobBasicInfoId);
        if (source.response) {
          return {
            response: source.response,
            usedTools: [...found.usedTools, ...source.usedTools],
          };
        }

        const mergedValues = normalizeCanonicalValues(
          mergePositionValues(source.values!, userPatch),
        );
        return {
          values: mergedValues,
          originalValues: source.values,
          usedTools: [...found.usedTools, ...source.usedTools],
        };
      }

      if (found.candidates.length > 1) {
        const stored = await this.storeAndReturnPreview({
          sessionId,
          mode: 'create',
          action: parsed.action ?? 'save',
          values,
          originalValues: undefined,
          userPatch,
          jobBasicInfoId: undefined,
          sendMsgToSupplier: parsed.sendMsgToSupplier,
          usedTools: [...priorUsedTools, ...found.usedTools],
        });
        this.dependencies.draftStore.setLastResults(sessionId, found.candidates);
        return {
          usedTools: found.usedTools,
          response: {
            ...stored,
            reply: buildCreateSourceCandidateReply(stored.draftId!, found.candidates),
            intent: 'clarify',
            needsClarification: true,
            needsConfirmation: false,
            results: found.candidates,
            usedTools: [...priorUsedTools, ...found.usedTools],
          },
        };
      }

      if (found.usedTools.length) {
        priorUsedTools.push(...found.usedTools);
      }
    }

    const contextSourceJobId = this.getContextSourceJobId(sessionId);
    if (contextSourceJobId) {
      const stored = await this.storeAndReturnPreview({
        sessionId,
        mode: 'create',
        action: parsed.action ?? 'save',
          values,
          originalValues: undefined,
          userPatch,
          jobBasicInfoId: undefined,
        sendMsgToSupplier: parsed.sendMsgToSupplier,
        usedTools: priorUsedTools,
      });
      return {
        usedTools: [],
        response: {
          ...stored,
          reply: buildCreateSourceSuggestionReply(stored.draftId!, contextSourceJobId),
          intent: 'clarify',
          needsClarification: true,
          needsConfirmation: false,
          usedTools: priorUsedTools,
        },
      };
    }

    return { usedTools: [] };
  }

  private async searchCreateSourceCandidates(keywords: string[]): Promise<{
    candidates: PositionResultSummary[];
    usedTools: string[];
  }> {
    if (typeof this.dependencies.positionApiClient.getJobList !== 'function') {
      return { candidates: [], usedTools: [] };
    }

    const usedTools: string[] = [];
    const candidates: PositionResultSummary[] = [];
    const seen = new Set<number>();

    for (const keyword of keywords) {
      const data = await this.dependencies.positionApiClient.getJobList({
        pageNum: 1,
        pageSize: 5,
        searchJobName: keyword,
      });
      usedTools.push('position.getJobList');
      for (const result of data.result.map(mapPositionResultSummary)) {
        if (!result.jobBasicInfoId || seen.has(result.jobBasicInfoId)) {
          continue;
        }
        seen.add(result.jobBasicInfoId);
        candidates.push(result);
      }
      if (candidates.length) {
        break;
      }
    }

    return { candidates, usedTools };
  }

  private async loadCreateSourceValues(sourceJobBasicInfoId: number): Promise<{
    values?: PositionFormValues;
    usedTools: string[];
    response?: PositionToolResponse;
  }> {
    const detail = await this.dependencies.positionApiClient.getJobDetail(sourceJobBasicInfoId);
    const sourceValues = buildPositionFormValuesFromDetail(detail);
    if (!sourceValues) {
      return {
        usedTools: ['position.getJobDetail'],
        response: {
          reply: `未获取到来源岗位 ID ${sourceJobBasicInfoId} 的详细信息，无法继承新建。请确认岗位 ID 是否正确。`,
          intent: 'clarify',
          needsClarification: true,
          needsConfirmation: false,
          usedTools: ['position.getJobDetail'],
        },
      };
    }

    return {
      values: prepareInheritedCreateValues(
        normalizeCanonicalValues(
          mergePositionValues(createDefaultPositionFormValues(), sourceValues),
        ),
      ),
      usedTools: ['position.getJobDetail'],
    };
  }

  private async applyCreateSourceToPendingDraft(
    pendingDraft: PendingPositionDraft,
    parsed: ParsedPositionMessage,
    message: string,
  ): Promise<PositionToolResponse> {
    const sourceJobBasicInfoId =
      parsed.sourceJobBasicInfoId ??
      parseCreateSourceJobId(message) ??
      (parsed.inheritFromContext ? this.getContextSourceJobId(pendingDraft.sessionId) : undefined);
    const sourceId = sourceJobBasicInfoId ?? this.getContextSourceJobId(pendingDraft.sessionId);
    if (!sourceId) {
      return {
        reply: [
          `当前已有新建岗位草稿（draftId: ${pendingDraft.draftId}），但我还不知道要参考哪个岗位。`,
          '请回复要参考的岗位 ID，例如：其他信息跟 1914 一致。',
        ].join('\n'),
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        draftId: pendingDraft.draftId,
        usedTools: [],
      };
    }

    const source = await this.loadCreateSourceValues(sourceId);
    if (source.response) {
      return {
        ...source.response,
        draftId: pendingDraft.draftId,
      };
    }

    const resolved = await this.resolveCreateReferences(parsed, source.values);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认补充信息中的选项：', resolved.issues, [
        ...source.usedTools,
        ...resolved.usedTools,
      ]);
    }

    const draftOverrides = pendingDraft.userPatch ?? extractDraftOverrides(pendingDraft.values);
    const userPatch = mergeUserPatch(draftOverrides, {
      ...parsed.patch,
      ...resolved.patch,
    });
    const values = normalizeCanonicalValues(
      mergePositionValues(source.values!, {
        ...userPatch,
      }),
    );

    return this.storeAndReturnPreview({
      sessionId: pendingDraft.sessionId,
      mode: 'create',
      action: parsed.action ?? pendingDraft.action,
      values,
      originalValues: source.values,
      userPatch,
      jobBasicInfoId: undefined,
      sendMsgToSupplier: parsed.sendMsgToSupplier ?? pendingDraft.sendMsgToSupplier,
      existingDraftId: pendingDraft.draftId,
      usedTools: [...source.usedTools, ...resolved.usedTools],
    });
  }

  private getContextSourceJobId(sessionId: string): number | undefined {
    const focusedPosition = this.dependencies.draftStore.getFocusedPosition(sessionId);
    if (focusedPosition) {
      return focusedPosition.jobBasicInfoId;
    }

    const lastResults = this.dependencies.draftStore.getLastResults(sessionId);
    return lastResults.length === 1 ? lastResults[0].jobBasicInfoId : undefined;
  }

  private async editPreview(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const jobBasicInfoId = parsed.jobBasicInfoId ?? this.dependencies.draftStore.getFocusedPosition(sessionId)?.jobBasicInfoId;
    if (!jobBasicInfoId) {
      const lastResults = this.dependencies.draftStore.getLastResults(sessionId);
      if (lastResults.length > 1) {
        return {
          reply: [
            '最近一次查询命中了多个岗位，请先指定要编辑的岗位 ID。',
            '',
            buildSearchCandidateTable(lastResults),
            '',
            '例如：编辑岗位 ID 1914，把用工形式改为全职。',
          ].join('\n'),
          intent: 'clarify',
          needsClarification: true,
          needsConfirmation: false,
          results: lastResults,
          usedTools: [],
        };
      }

      return {
        reply: [
          '请提供要编辑的岗位 ID，或先查看某个岗位详情后再说要修改哪里。',
          '',
          '可用说法：',
          '- 编辑岗位 ID 123，把招聘人数改为 10 人',
          '- 先查看岗位 ID 123 的详情，再说“把用工形式改为全职”',
          '- 帮我修改下 123 的岗位信息，将用工形式改为全职',
          '- 修改 123 这个岗位，薪资改为 25 元/时',
        ].join('\n'),
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: [],
      };
    }

    const detail = await this.dependencies.positionApiClient.getJobDetail(jobBasicInfoId);
    const summary =
      this.dependencies.draftStore
        .getLastResults(sessionId)
        .find(item => item.jobBasicInfoId === jobBasicInfoId) ??
      this.dependencies.draftStore.getFocusedPosition(sessionId)?.summary;
    const originalValues = normalizeCanonicalValues(
      mergePositionValues(
        createDefaultPositionFormValues(),
        buildPositionFormValuesFromDetail(detail) ?? {},
      ),
    );
    const resolved = await this.resolveReferences(parsed, originalValues);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认编辑岗位中的选项：', resolved.issues, [
        'position.getJobDetail',
        ...resolved.usedTools,
      ]);
    }

    const values = normalizeCanonicalValues(
      mergePositionValues(originalValues, {
        ...parsed.patch,
        ...resolved.patch,
      }),
    );

    this.dependencies.draftStore.setFocusedPosition(sessionId, jobBasicInfoId, summary);

    return this.storeAndReturnPreview({
      sessionId,
      mode: 'edit',
      action: parsed.action ?? 'save',
      values,
      originalValues,
      userPatch: mergeUserPatch(undefined, {
        ...parsed.patch,
        ...resolved.patch,
      }),
      jobBasicInfoId,
      sendMsgToSupplier: parsed.sendMsgToSupplier,
      usedTools: ['position.getJobDetail', ...resolved.usedTools],
    });
  }

  private async updatePendingDraft(
    pendingDraft: PendingPositionDraft,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const resolved =
      pendingDraft.mode === 'create'
        ? await this.resolveCreateReferences(parsed, pendingDraft.values)
        : await this.resolveReferences(parsed, pendingDraft.values);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认补充信息中的选项：', resolved.issues, resolved.usedTools);
    }

    const values = normalizeCanonicalValues(
      mergePositionValues(pendingDraft.values, {
        ...parsed.patch,
        ...resolved.patch,
      }),
    );
    const userPatch = mergeUserPatch(pendingDraft.userPatch, {
      ...parsed.patch,
      ...resolved.patch,
    });

    return this.storeAndReturnPreview({
      sessionId: pendingDraft.sessionId,
      mode: pendingDraft.mode,
      action: parsed.action ?? pendingDraft.action,
      values,
      originalValues: pendingDraft.originalValues,
      userPatch,
      jobBasicInfoId: pendingDraft.jobBasicInfoId,
      sendMsgToSupplier: parsed.sendMsgToSupplier ?? pendingDraft.sendMsgToSupplier,
      existingDraftId: pendingDraft.draftId,
      usedTools: resolved.usedTools,
    });
  }

  private askPendingDraftEditTarget(
    pendingDraft: PendingPositionDraft,
  ): PositionToolResponse {
    return {
      reply: [
        `当前已有待确认的岗位预览（draftId: ${pendingDraft.draftId}）。`,
        '',
        '如果你要在这个岗位上继续修改，请直接告诉我要改哪些信息。',
        '',
        '可用说法：',
        '- 把招聘人数改为 10 人',
        '- 把薪资改为 25 元/时',
        '- 把用工形式改为兼职，兼职类型选小时工，至少上岗 6 个月',
        '',
        '如果上一版已经确认无误，回复“确认保存”；如果要放弃当前预览，回复“取消”。',
      ].join('\n'),
      intent: 'clarify',
      needsClarification: true,
      needsConfirmation: false,
      draftId: pendingDraft.draftId,
      diff: pendingDraft.diff,
      usedTools: [],
    };
  }

  private async commitDraft(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const pendingDraft = this.dependencies.draftStore.getBySession(sessionId);
    if (!pendingDraft) {
      return {
        reply: '当前没有待确认的岗位预览。请先发起新建或编辑岗位。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: [],
      };
    }

    const action = parsed.action ?? pendingDraft.action;
    const sendMsgToSupplier =
      parsed.sendMsgToSupplier ?? pendingDraft.sendMsgToSupplier;
    const { missingFields, validationErrors } = validatePositionValues(pendingDraft.values);

    if (missingFields.length || validationErrors.length) {
      return {
        reply: buildMissingReply('当前岗位信息还不能提交，请先补齐以下内容：', missingFields, validationErrors),
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        draftId: pendingDraft.draftId,
        preview: buildPositionPreview({
          draftId: pendingDraft.draftId,
          mode: pendingDraft.mode,
          title: pendingDraft.mode === 'create' ? '新建岗位预览' : '编辑岗位预览',
          values: pendingDraft.values,
          action,
        }),
        missingFields,
        validationErrors,
        diff: pendingDraft.diff,
        usedTools: [],
      };
    }

    if (action === 'publish' && sendMsgToSupplier === undefined) {
      const updated = {
        ...pendingDraft,
        action,
        updatedAt: Date.now(),
      };
      this.dependencies.draftStore.set(updated);
      return {
        reply: '确认发布前，请明确是否通知供应商：回复“通知供应商并发布”或“不通知供应商并发布”。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: true,
        draftId: pendingDraft.draftId,
        preview: buildPositionPreview({
          draftId: pendingDraft.draftId,
          mode: pendingDraft.mode,
          title: pendingDraft.mode === 'create' ? '新建岗位预览' : '编辑岗位预览',
          values: pendingDraft.values,
          action,
        }),
        diff: pendingDraft.diff,
        usedTools: [],
      };
    }

    const publishNow = action === 'publish';
    const payload =
      pendingDraft.mode === 'create'
        ? buildCreateJobPayload(pendingDraft.values, {
            publishNow,
            sendMsgToSupplier,
          })
        : buildUpdateJobPayload(pendingDraft.values, {
            jobBasicInfoId: pendingDraft.jobBasicInfoId,
            publishNow,
            sendMsgToSupplier,
          });

    if (pendingDraft.mode === 'create') {
      await this.dependencies.positionApiClient.createJob(payload);
    } else {
      await this.dependencies.positionApiClient.updateJob(payload);
    }

    this.dependencies.draftStore.delete(pendingDraft);

    return {
      reply:
        pendingDraft.mode === 'create'
          ? publishNow
            ? '岗位已新建并发布。'
            : '岗位已新建并保存。'
          : publishNow
            ? '岗位已编辑并发布。'
            : '岗位已编辑并保存。',
      intent: 'commit',
      needsClarification: false,
      needsConfirmation: false,
      usedTools: [
        pendingDraft.mode === 'create'
          ? 'position.createJob'
          : 'position.updateJob',
      ],
    };
  }

  private describePendingDraft(pendingDraft: PendingPositionDraft): PositionToolResponse {
    const { missingFields, validationErrors } = validatePositionValues(pendingDraft.values);
    const preview = buildPositionPreview({
      draftId: pendingDraft.draftId,
      mode: pendingDraft.mode,
      title: pendingDraft.mode === 'create' ? '新建岗位预览' : '编辑岗位预览',
      values: pendingDraft.values,
      action: pendingDraft.action,
    });

    if (missingFields.length || validationErrors.length) {
      return {
        reply: buildMissingReply(
          `当前岗位预览还需要补充以下内容（draftId: ${pendingDraft.draftId}）：`,
          missingFields,
          validationErrors,
        ),
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        draftId: pendingDraft.draftId,
        preview,
        missingFields,
        validationErrors,
        diff: pendingDraft.diff,
        usedTools: [],
      };
    }

    if (pendingDraft.action === 'publish' && pendingDraft.sendMsgToSupplier === undefined) {
      return {
        reply: '当前岗位信息已补齐。确认发布前还需要明确是否通知供应商：回复“通知供应商并发布”或“不通知供应商并发布”。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: true,
        draftId: pendingDraft.draftId,
        preview,
        diff: pendingDraft.diff,
        usedTools: [],
      };
    }

    return {
      reply: `当前岗位预览已满足提交条件（draftId: ${pendingDraft.draftId}）。确认无误后回复“确认保存”；如需发布，回复“确认发布”。`,
      intent: pendingDraft.mode === 'create' ? 'create_preview' : 'edit_preview',
      needsClarification: false,
      needsConfirmation: true,
      draftId: pendingDraft.draftId,
      preview,
      diff: pendingDraft.diff,
      usedTools: [],
    };
  }

  private async storeAndReturnPreview(input: {
    sessionId: string;
    mode: 'create' | 'edit';
    action: PositionCommitAction;
    values: PositionFormValues;
    originalValues?: PositionFormValues;
    userPatch?: Partial<PositionFormValues>;
    jobBasicInfoId?: number;
    sendMsgToSupplier?: boolean;
    existingDraftId?: string;
    usedTools: string[];
  }): Promise<PositionToolResponse> {
    const { missingFields, validationErrors } = validatePositionValues(input.values);
    const diff = input.originalValues
      ? createPositionDiff(input.originalValues, input.values)
      : [];
    const draftId = input.existingDraftId ?? randomUUID();
    const now = Date.now();
    const draft: PendingPositionDraft = {
      draftId,
      sessionId: input.sessionId,
      mode: input.mode,
      action: input.action,
      values: input.values,
      originalValues: input.originalValues,
      userPatch: input.userPatch,
      jobBasicInfoId: input.jobBasicInfoId,
      sendMsgToSupplier: input.sendMsgToSupplier,
      createdAt: now,
      updatedAt: now,
      missingFields,
      validationErrors,
      diff,
    };
    this.dependencies.draftStore.set(draft);

    const preview = buildPositionPreview({
      draftId,
      mode: input.mode,
      title: input.mode === 'create' ? '新建岗位预览' : '编辑岗位预览',
      values: input.values,
      action: input.action,
      diff,
    });
    const reply = buildPreviewReply(preview, input.values, missingFields, validationErrors, diff);

    return {
      reply,
      intent: input.mode === 'create' ? 'create_preview' : 'edit_preview',
      needsClarification: missingFields.length > 0 || validationErrors.length > 0,
      needsConfirmation: missingFields.length === 0 && validationErrors.length === 0,
      draftId,
      preview,
      missingFields,
      validationErrors,
      diff,
      usedTools: input.usedTools,
    };
  }

  private async resolveCreateReferences(
    parsed: ParsedPositionMessage,
    currentValues?: PositionFormValues,
  ): Promise<ResolveResult> {
    const patch: Partial<PositionFormValues> = {};
    const issues: FieldIssue[] = [];
    const usedTools: string[] = [];
    let selectedProject: OptionEntity | undefined;

    if (parsed.references.projectName) {
      const projects = await this.dependencies.positionApiClient.searchProjects(parsed.references.projectName);
      usedTools.push('position.searchProjects');
      selectedProject = selectUniqueOption(projects, parsed.references.projectName, '项目', issues, {
        notFoundMessage: `当前系统未找到“${parsed.references.projectName}”对应的项目，请先创建后再回来创建岗位。`,
      });
      if (selectedProject) {
        patch.projectId = selectedProject.id;
        patch.projectName = selectedProject.name;
      }
    } else if (normalizeNumber(parsed.patch.projectId) !== undefined) {
      patch.projectId = normalizeNumber(parsed.patch.projectId);
    }

    const projectBrands = getProjectBrandOptions(selectedProject);
    const hasProjectBrandData = selectedProject ? hasRawProjectBrandData(selectedProject) : false;
    const projectChanged = isDifferentOptionValue(
      patch.projectId,
      currentValues?.projectId,
      Boolean(parsed.references.projectName || parsed.patch.projectId !== undefined),
    );
    const hasExplicitBrand = Boolean(parsed.references.brandName || parsed.patch.brandId !== undefined);
    const hasStoreLookup = hasExplicitStoreLookup(parsed);

    if (projectChanged && !hasExplicitBrand) {
      patch.brandId = undefined;
      patch.brandName = undefined;
    }
    if (projectChanged && !hasStoreLookup) {
      patch.recruitStoreAllocations = [];
      patch.workAddress = undefined;
    }

    if (parsed.references.brandName) {
      if (hasProjectBrandData) {
        const selected = selectUniqueOption(projectBrands, parsed.references.brandName, '品牌', issues, {
          notFoundMessage: `当前项目下没有“${parsed.references.brandName}”这个品牌，请先确认品牌是否属于该项目，或先创建后再回来创建岗位。`,
          requireMatch: true,
        });
        if (selected) {
          patch.brandId = selected.id;
          patch.brandName = selected.name;
        }
      } else {
        const brands = await this.dependencies.positionApiClient.searchBrands(parsed.references.brandName);
        usedTools.push('position.searchBrands');
        const selected = selectUniqueOption(brands, parsed.references.brandName, '品牌', issues, {
          notFoundMessage: `当前系统未找到“${parsed.references.brandName}”对应的品牌，请先创建后再回来创建岗位。`,
        });
        if (selected) {
          patch.brandId = selected.id;
          patch.brandName = selected.name;
        }
      }
    } else {
      const brandId = normalizeNumber(parsed.patch.brandId);
      if (brandId !== undefined) {
        if (hasProjectBrandData) {
          const selected = projectBrands.find(brand => brand.id === brandId);
          if (!selected) {
            issues.push({
              field: '品牌',
              label: '品牌',
              message: `当前项目下没有品牌 ID ${brandId}，请先确认品牌是否属于该项目，或先创建后再回来创建岗位。`,
            });
          } else {
            patch.brandId = selected.id;
            patch.brandName = selected.name;
          }
        } else {
          patch.brandId = brandId;
        }
      }
    }

    const brandChanged = isDifferentOptionValue(
      patch.brandId,
      currentValues?.brandId,
      hasExplicitBrand,
    );
    if (brandChanged && !hasStoreLookup) {
      patch.recruitStoreAllocations = [];
      patch.workAddress = undefined;
    }

    await this.resolveCreateJobTypeDefaults(parsed, currentValues, patch, issues, usedTools);
    await this.resolveCreateStores(parsed, currentValues, patch, issues, usedTools, {
      resetExistingStores: (projectChanged || brandChanged) && hasStoreLookup,
    });

    return { patch, issues, usedTools };
  }

  private async resolveCreateJobTypeDefaults(
    parsed: ParsedPositionMessage,
    currentValues: PositionFormValues | undefined,
    patch: Partial<PositionFormValues>,
    issues: FieldIssue[],
    usedTools: string[],
  ): Promise<void> {
    const needsDefaultNameOrContent =
      parsed.patch.positionName === undefined ||
      parsed.patch.workContent === undefined;
    const inferredCategoryName =
      parsed.references.positionCategoryName ??
      (parsed.patch.positionCategory === undefined ? normalizeString(parsed.patch.positionName) : undefined);

    if (!inferredCategoryName && parsed.patch.positionCategory === undefined) {
      return;
    }

    if (typeof this.dependencies.positionApiClient.getJobTypes !== 'function') {
      return;
    }

    const jobTypes = await this.dependencies.positionApiClient.getJobTypes();
    usedTools.push('position.getJobTypes');
    const selected = parsed.references.positionCategoryName
      ? selectUniqueOption(jobTypes, parsed.references.positionCategoryName, '职位类别', issues)
      : parsed.patch.positionCategory !== undefined
        ? jobTypes.find(item => item.id === normalizeNumber(parsed.patch.positionCategory))
        : inferredCategoryName
          ? selectOptionalSingleOption(jobTypes, inferredCategoryName)
          : undefined;

    if (!selected) {
      return;
    }

    patch.positionCategory = selected.id;
    patch.positionCategoryName = selected.name;

    if (
      parsed.patch.positionName === undefined &&
      (!hasMeaningfulValue(currentValues?.positionName) ||
        currentValues?.positionName === currentValues?.positionCategoryName)
    ) {
      patch.positionName = selected.name;
    }

    if (parsed.patch.workContent !== undefined || hasMeaningfulValue(currentValues?.workContent)) {
      return;
    }

    try {
      const template = await this.dependencies.positionApiClient.getJobTemplateByJobType(selected.id);
      usedTools.push('position.getJobTemplateByJobType');
      if (template.jobContent) {
        patch.workContent = template.jobContent;
      }
    } catch {
      // 职位类别模板只是辅助默认值，失败不阻断建岗。
    }
  }

  private async resolveCreateStores(
    parsed: ParsedPositionMessage,
    currentValues: PositionFormValues | undefined,
    patch: Partial<PositionFormValues>,
    issues: FieldIssue[],
    usedTools: string[],
    options: { resetExistingStores: boolean },
  ): Promise<void> {
    const patchRows = parsed.patch.recruitStoreAllocations;
    const storeNames = parsed.references.storeNames || [];
    const explicitStoreRowsNeedLookup = patchRows?.filter(row => row.storeId || row.storeName) || [];
    const unresolvedCurrentStoreRows =
      !storeNames.length && !explicitStoreRowsNeedLookup.length
        ? currentValues?.recruitStoreAllocations?.filter(row => row.storeName && !row.storeId) || []
        : [];
    const storeRowsNeedLookup = [
      ...explicitStoreRowsNeedLookup,
      ...unresolvedCurrentStoreRows,
    ];

    if (!storeNames.length && !storeRowsNeedLookup.length) {
      return;
    }

    const projectId = normalizeNumber(patch.projectId ?? currentValues?.projectId);
    const brandId = normalizeNumber(patch.brandId ?? currentValues?.brandId);
    if (projectId === undefined || brandId === undefined) {
      const nextStores = [...(patchRows || currentValues?.recruitStoreAllocations || [])];
      for (const storeName of storeNames) {
        mergeUnresolvedStoreName(nextStores, storeName);
      }
      if (nextStores.length) {
        patch.recruitStoreAllocations = nextStores;
      }
      return;
    }

    const nextStores = options.resetExistingStores
      ? [...(patchRows || [])]
      : [...(patchRows || currentValues?.recruitStoreAllocations || [])];

    for (const storeName of storeNames) {
      const stores = await this.dependencies.positionApiClient.searchStores({
        searchName: storeName,
        projectIds: [projectId],
        brandIds: [brandId],
      });
      usedTools.push('position.searchStores');
      const selected = selectUniqueOption(stores, storeName, '门店', issues, {
        notFoundMessage: `当前项目、品牌下没有“${storeName}”这个门店，请先在该项目、品牌下创建门店后再回来创建岗位。`,
      });
      if (!selected) {
        continue;
      }
      mergeSelectedStore(nextStores, selected);
    }

    for (const row of storeRowsNeedLookup) {
      if (storeNames.length && row.storeName) {
        continue;
      }

      const searchName = row.storeName || '';
      const stores = await this.dependencies.positionApiClient.searchStores({
        searchName,
        projectIds: [projectId],
        brandIds: [brandId],
      });
      usedTools.push('position.searchStores');
      const selected = row.storeId
        ? stores.find(store => store.id === row.storeId)
        : selectUniqueOption(stores, row.storeName || '', '门店', issues, {
            notFoundMessage: `当前项目、品牌下没有“${row.storeName}”这个门店，请先在该项目、品牌下创建门店后再回来创建岗位。`,
          });

      if (!selected) {
        if (row.storeId) {
          issues.push({
            field: '招聘门店',
            label: '招聘门店',
            message: `当前项目、品牌下没有门店 ID ${row.storeId}，请先在该项目、品牌下创建门店后再回来创建岗位。`,
          });
        }
        continue;
      }

      mergeSelectedStore(nextStores, selected);
    }

    if (nextStores.length) {
      patch.recruitStoreAllocations = nextStores;
      const workAddress = formatFullStoreAddress(nextStores[0]);
      if (workAddress) {
        patch.workAddress = workAddress;
      }
    }
  }

  private async resolveReferences(
    parsed: ParsedPositionMessage,
    currentValues?: PositionFormValues,
  ): Promise<ResolveResult> {
    const patch: Partial<PositionFormValues> = {};
    const issues: FieldIssue[] = [];
    const usedTools: string[] = [];

    if (parsed.references.projectName) {
      const projects = await this.dependencies.positionApiClient.searchProjects(parsed.references.projectName);
      usedTools.push('position.searchProjects');
      const selected = selectUniqueOption(projects, parsed.references.projectName, '项目', issues);
      if (selected) {
        patch.projectId = selected.id;
        patch.projectName = selected.name;
      }
    }

    if (parsed.references.brandName) {
      const brands = await this.dependencies.positionApiClient.searchBrands(parsed.references.brandName);
      usedTools.push('position.searchBrands');
      const selected = selectUniqueOption(brands, parsed.references.brandName, '品牌', issues);
      if (selected) {
        patch.brandId = selected.id;
        patch.brandName = selected.name;
      }
    }

    if (parsed.references.positionCategoryName) {
      const jobTypes = await this.dependencies.positionApiClient.getJobTypes();
      usedTools.push('position.getJobTypes');
      const selected = selectUniqueOption(jobTypes, parsed.references.positionCategoryName, '职位类别', issues);
      if (selected) {
        patch.positionCategory = selected.id;
        patch.positionCategoryName = selected.name;
      }
    }

    if (parsed.references.storeNames?.length) {
      const existingStores = parsed.patch.recruitStoreAllocations || currentValues?.recruitStoreAllocations || [];
      const nextStores = [...existingStores];
      for (const storeName of parsed.references.storeNames) {
        const stores = await this.dependencies.positionApiClient.searchStores({
          searchName: storeName,
          projectIds: normalizeNumber(patch.projectId ?? currentValues?.projectId)
            ? [normalizeNumber(patch.projectId ?? currentValues?.projectId)!]
            : undefined,
          brandIds: normalizeNumber(patch.brandId ?? currentValues?.brandId)
            ? [normalizeNumber(patch.brandId ?? currentValues?.brandId)!]
            : undefined,
        });
        usedTools.push('position.searchStores');
        const selected = selectUniqueOption(stores, storeName, '门店', issues);
        if (!selected) {
          continue;
        }
        const first = nextStores[0] ?? { id: String(selected.id) };
        nextStores[0] = {
          ...first,
          storeId: selected.id,
          storeName: selected.name,
          storeAddress: normalizeString(selected.raw?.address),
          storeExactAddress: normalizeString(selected.raw?.exactAddress),
        };
      }
      if (nextStores.length) {
        patch.recruitStoreAllocations = nextStores;
      }
    }

    return { patch, issues, usedTools };
  }
}

function getProjectBrandOptions(project?: OptionEntity): ProjectBrandOption[] {
  const rawBrands = getRawProjectBrands(project);

  return rawBrands
    .map((item): ProjectBrandOption | undefined => {
      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const record = item as Record<string, unknown>;
      const id = normalizeNumber(record.brandId ?? record.id ?? record.value);
      const name = normalizeString(record.brandName ?? record.name ?? record.label);

      return id === undefined || !name ? undefined : { id, name, raw: record };
    })
    .filter((item): item is ProjectBrandOption => Boolean(item));
}

function getRawProjectBrands(project?: OptionEntity): unknown[] {
  if (!project?.raw) {
    return [];
  }

  if (Array.isArray(project.raw.brands)) {
    return project.raw.brands;
  }

  if (Array.isArray(project.raw.brandList)) {
    return project.raw.brandList;
  }

  return [];
}

function hasRawProjectBrandData(project?: OptionEntity): boolean {
  return Boolean(
    project?.raw &&
      (Array.isArray(project.raw.brands) || Array.isArray(project.raw.brandList)),
  );
}

function isDifferentOptionValue(
  nextValue: unknown,
  currentValue: unknown,
  wasRequested: boolean,
): boolean {
  if (!wasRequested) {
    return false;
  }

  const next = normalizeNumber(nextValue);
  if (next === undefined) {
    return false;
  }

  const current = normalizeNumber(currentValue);
  return current !== undefined && current !== next;
}

function hasExplicitStoreLookup(parsed: ParsedPositionMessage): boolean {
  return Boolean(
    parsed.references.storeNames?.length ||
      parsed.patch.recruitStoreAllocations?.some(row => row.storeId || row.storeName),
  );
}

function isCoreCreateEntityField(field: string): boolean {
  return field === 'projectId' || field === 'brandId' || field === 'recruitStoreAllocations';
}

function mergeSelectedStore(
  rows: PositionFormValues['recruitStoreAllocations'],
  selected: StoreOptionEntity,
): void {
  if (!rows) {
    return;
  }

  const existingIndex = rows.findIndex(row => row.storeId === selected.id || row.storeName === selected.name);
  const reusableIndex = rows.findIndex(row => !row.storeId && (!row.storeName || row.storeName === selected.name));
  const targetIndex = existingIndex >= 0 ? existingIndex : reusableIndex >= 0 ? reusableIndex : rows.length;
  const template = rows[0];
  const current = rows[targetIndex] ?? {
    id: String(selected.id),
    recruitCount: template?.recruitCount,
    threshold: template?.threshold,
  };
  rows[targetIndex] = {
    ...current,
    storeId: selected.id,
    storeName: selected.name,
    storeAddress: normalizeString(selected.raw?.address) ?? selected.address,
    storeExactAddress: normalizeString(selected.raw?.exactAddress) ?? selected.exactAddress,
  };
}

function mergeUnresolvedStoreName(
  rows: PositionFormValues['recruitStoreAllocations'],
  storeName: string,
): void {
  if (!rows) {
    return;
  }

  const existing = rows.find(row => row.storeName === storeName);
  if (existing) {
    return;
  }

  const index = rows.findIndex(row => !row.storeId && !row.storeName);
  const targetIndex = index >= 0 ? index : rows.length;
  const current = rows[targetIndex] ?? { id: `store-${targetIndex + 1}` };
  rows[targetIndex] = {
    ...current,
    storeName,
  };
}

function formatFullStoreAddress(row?: {
  storeAddress?: string;
  storeExactAddress?: string;
}): string | undefined {
  return [row?.storeAddress, row?.storeExactAddress]
    .map(item => item?.trim())
    .filter(Boolean)
    .join('') || undefined;
}

function prepareInheritedCreateValues(values: PositionFormValues): PositionFormValues {
  return {
    ...values,
    jobName: undefined,
  };
}

function shouldApplyCreateSourceToPendingDraft(
  message: string,
  parsed: ParsedPositionMessage,
  pendingDraft: PendingPositionDraft,
): boolean {
  if (pendingDraft.mode !== 'create') {
    return false;
  }

  return Boolean(
    parsed.sourceJobBasicInfoId ||
      parsed.inheritFromContext ||
      parseCreateSourceJobId(message) ||
      /其他|其它|剩下|其余|补齐|模板|参考|一致|一样|相同/.test(message),
  );
}

function parseCreateSourceJobId(message: string): number | undefined {
  const explicit = matchNumber(message, /(?:岗位|职位)\s*(?:ID|id|编号)[:：#\s]*(\d{3,})/i);
  if (explicit !== undefined) {
    return explicit;
  }

  const hasTemplateWording = /用|选|选择|按照|照着|参考|跟|和|同|其他|其它|剩下|其余|模板|一致|一样|相同/.test(message);
  if (!hasTemplateWording) {
    return undefined;
  }

  return (
    matchNumber(message, /(?:用|选|选择|按照|照着|参考|跟|和|同)(?:岗位|职位)?\s*(?:ID|id|编号)?[:：#\s]*(\d{3,})/i) ??
    matchNumber(message, /(?:其他|其它|剩下|其余).*(?<![A-Za-z0-9-])(\d{3,})(?![A-Za-z0-9-])/) ??
    (/^\D*\d{3,}\D*$/.test(message) ? matchNumber(message, /(?<![A-Za-z0-9-])(\d{3,})(?![A-Za-z0-9-])/) : undefined)
  );
}

function buildCreateSourceSearchKeywords(
  parsed: ParsedPositionMessage,
  values: PositionFormValues,
): string[] {
  const rawKeywords = [
    normalizeString(values.positionName),
    normalizeString(parsed.search.searchJobName),
    normalizeString(parsed.references.brandName),
    normalizeString(parsed.references.projectName),
    ...deriveBrandLikeKeywords(normalizeString(values.positionName)),
  ];

  return Array.from(new Set(
    rawKeywords
      .map(keyword => keyword?.replace(/岗位|职位|招聘/g, '').trim())
      .filter((keyword): keyword is string => Boolean(keyword && keyword.length >= 2)),
  ));
}

function deriveBrandLikeKeywords(positionName?: string): string[] {
  if (!positionName) {
    return [];
  }

  const result: string[] = [];
  const commonRolePattern = /(服务员|理货员|营业员|店员|迎宾|收银员|导购|配送员|分拣员|小时工|兼职|全职|寒假工|暑假工|长期工|短期工)/;
  const roleIndex = positionName.search(commonRolePattern);
  if (roleIndex > 0) {
    result.push(positionName.slice(0, roleIndex));
  }

  const dashedPrefix = positionName.split(/[-_—]/)[0]?.trim();
  if (dashedPrefix && dashedPrefix !== positionName) {
    result.push(dashedPrefix);
  }

  return result;
}

function extractDraftOverrides(values: PositionFormValues): Partial<PositionFormValues> {
  const baseline = normalizeCanonicalValues(createDefaultPositionFormValues());
  const overrides: Partial<PositionFormValues> = {};

  for (const [field, value] of Object.entries(values) as Array<[keyof PositionFormValues, unknown]>) {
    if (!hasMeaningfulValue(value) || isDeepEqual(value, baseline[field])) {
      continue;
    }
    (overrides as Record<string, unknown>)[field] = value;
  }

  return overrides;
}

function mergeUserPatch(
  base: Partial<PositionFormValues> | undefined,
  patch: Partial<PositionFormValues>,
): Partial<PositionFormValues> {
  const result = pruneEmpty(
    mergePositionValues(base ?? {}, patch),
  ) ?? {};

  for (const [field, value] of Object.entries(patch) as Array<[keyof PositionFormValues, unknown]>) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      (result as Record<string, unknown>)[field] = value;
    }
  }

  return result;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function shouldPatchPendingDraft(parsed: ParsedPositionMessage): boolean {
  return (
    parsed.intent === 'create_preview' ||
    parsed.intent === 'edit_preview' ||
    (parsed.intent === 'clarify' &&
      (Object.keys(parsed.patch).length > 0 || Object.keys(parsed.references).length > 0))
  );
}

function shouldAskPendingDraftEditTarget(parsed: ParsedPositionMessage): boolean {
  return (
    parsed.intent === 'edit_preview' &&
    Object.keys(parsed.patch).length === 0 &&
    !parsed.jobBasicInfoId &&
    !parsed.action &&
    !parsed.sendMsgToSupplier &&
    Object.keys(parsed.references).length === 0
  );
}

function shouldDescribePendingDraft(
  message: string,
  parsed: ParsedPositionMessage,
): boolean {
  return (
    /还需要|缺什么|补充哪些|哪些没填|当前预览|草稿|预览|继续/.test(message) ||
    (parsed.intent === 'clarify' && Object.keys(parsed.patch).length === 0)
  );
}

function shouldShowPositionDetail(message: string, parsed: ParsedPositionMessage): boolean {
  return Boolean(parsed.detailRequested) || /详情|详细|完整信息|列给我|展开/.test(message);
}

function shouldUseSearchPlanner(message: string, parsed: ParsedPositionMessage): boolean {
  if (parsed.intent !== 'search' && parsed.intent !== 'clarify') {
    return false;
  }

  if (parsed.intent !== 'search' && Object.keys(parsed.patch).length) {
    return false;
  }

  if (parsed.jobBasicInfoId || parsed.sourceJobBasicInfoId) {
    return false;
  }

  if (parsed.detailRequested && parsed.search.jobBasicInfoIds?.length) {
    return false;
  }

  const hasCondition = hasParsedSearchCondition(parsed);
  if (hasCondition && !hasOnlyWeakSearchJobName(parsed)) {
    return false;
  }

  return /岗位|职位|招聘|工种|查询|查|搜索|找|看看|看下|看一下|详情|详细|哪些|列表/.test(message);
}

function shouldUseCreatePlanner(
  message: string,
  parsed: ParsedPositionMessage,
  pendingDraft?: PendingPositionDraft,
): boolean {
  if (parsed.intent === 'cancel' || parsed.intent === 'commit' || parsed.intent === 'edit_preview') {
    return false;
  }

  if (parsed.jobBasicInfoId || parsed.sourceJobBasicInfoId || parsed.inheritFromContext) {
    return false;
  }

  if (pendingDraft?.mode === 'create') {
    return parsed.intent === 'create_preview' || parsed.intent === 'clarify';
  }

  return (
    parsed.intent === 'create_preview' ||
    (/新建|新增|创建|发布一个|发一个|(?:帮我|给我|请)?(?:先)?建(?:一个|个)?/.test(message) &&
      /岗位|职位|招聘|工种|门店|项目|品牌/.test(message))
  );
}

function mergeCreatePlanningResult(
  message: string,
  parsed: ParsedPositionMessage,
  plan: PositionCreatePlanningResult,
  pendingDraft?: PendingPositionDraft,
): ParsedPositionMessage {
  if (!plan.shouldCreatePosition) {
    return parsed;
  }

  const next: ParsedPositionMessage = {
    ...parsed,
    intent:
      parsed.intent === 'clarify' && pendingDraft?.mode === 'create'
        ? 'create_preview'
        : parsed.intent,
    patch: { ...parsed.patch },
    references: { ...parsed.references },
  };

  if (next.patch.projectId === undefined && plan.projectName) {
    next.references.projectName = plan.projectName;
  }
  if (next.patch.brandId === undefined && plan.brandName) {
    next.references.brandName = plan.brandName;
  }
  const shouldReplaceStores = /(?:门店|店铺)[^，,。；;\n]*(?:换成|换为|改成|改为|调整为|替换|更换)/.test(message);
  if (shouldReplaceStores && plan.storeNames?.length) {
    next.patch.recruitStoreAllocations = [];
  }
  if (plan.storeNames?.length && !next.patch.recruitStoreAllocations?.some(row => row.storeId)) {
    next.references.storeNames = plan.storeNames;
  }
  if (next.patch.positionCategory === undefined && plan.positionCategoryName) {
    next.references.positionCategoryName = plan.positionCategoryName;
  }

  assignPlannedPatch(next.patch, 'positionName', plan.positionName, { override: true });
  assignPlannedPatch(next.patch, 'workContent', plan.workContent);
  assignPlannedPatch(next.patch, 'genders', plan.genders);
  assignPlannedPatch(next.patch, 'ageMin', plan.ageMin);
  assignPlannedPatch(next.patch, 'ageMax', plan.ageMax);
  assignPlannedPatch(next.patch, 'dailyTimeRange', plan.dailyTimeRange);
  if (plan.dailyTimeRange && next.patch.dailyScheduleMode === undefined) {
    next.patch.dailyScheduleMode = '2';
  }
  assignPlannedPatch(next.patch, 'dailyWorkDuration', plan.dailyWorkDuration);
  assignPlannedPatch(next.patch, 'baseSalary', plan.baseSalary);
  assignPlannedPatch(next.patch, 'baseSalaryUnit', plan.baseSalaryUnit);
  assignPlannedPatch(next.patch, 'salaryMin', plan.salaryMin);
  assignPlannedPatch(next.patch, 'salaryMax', plan.salaryMax);
  assignPlannedPatch(next.patch, 'salaryRangeUnit', plan.salaryRangeUnit);
  assignPlannedPatch(next.patch, 'settlementCycle', plan.settlementCycle);
  assignPlannedPatch(next.patch, 'payDay', plan.payDay);
  assignPlannedPatch(next.patch, 'minWorkMonths', plan.minWorkMonths);

  if (plan.recruitCount !== undefined || plan.threshold !== undefined) {
    const row = next.patch.recruitStoreAllocations?.[0] ?? { id: 'store-1' };
    next.patch.recruitStoreAllocations = [
      {
        ...row,
        recruitCount: row.recruitCount ?? plan.recruitCount,
        threshold: row.threshold ?? plan.threshold,
      },
      ...(next.patch.recruitStoreAllocations?.slice(1) || []),
    ];
  }

  return next;
}

function assignPlannedPatch<K extends keyof PositionFormValues>(
  patch: Partial<PositionFormValues>,
  field: K,
  value: PositionFormValues[K] | undefined,
  options: { override?: boolean } = {},
): void {
  if ((options.override || patch[field] === undefined) && value !== undefined) {
    patch[field] = value;
  }
}

function mergeSearchPlanningResult(
  parsed: ParsedPositionMessage,
  plan: PositionSearchPlanningResult,
): ParsedPositionMessage {
  if (!plan.shouldSearchPosition) {
    return parsed;
  }

  const next: ParsedPositionMessage = {
    ...parsed,
    intent: parsed.intent === 'clarify' ? 'search' : parsed.intent,
    detailRequested: parsed.detailRequested || plan.detailRequested,
    search: { ...parsed.search },
    references: { ...parsed.references },
  };

  if ((!next.search.searchJobName || isWeakSearchJobName(next.search.searchJobName)) && plan.searchJobName) {
    next.search.searchJobName = plan.searchJobName;
  }
  if (!next.search.statuses?.length && plan.statuses?.length) {
    next.search.statuses = plan.statuses;
  }
  if (!next.references.projectName && !next.search.projectIds?.length && plan.projectName) {
    next.references.projectName = plan.projectName;
  }
  if (!next.references.brandName && !next.search.brandIds?.length && plan.brandName) {
    next.references.brandName = plan.brandName;
  }
  if (!next.references.cityNames?.length && plan.cityNames?.length) {
    next.references.cityNames = plan.cityNames;
  }

  return next;
}

function hasOnlyWeakSearchJobName(parsed: ParsedPositionMessage): boolean {
  return Boolean(
    parsed.search.searchJobName &&
      isWeakSearchJobName(parsed.search.searchJobName) &&
      !parsed.search.jobBasicInfoIds?.length &&
      !parsed.search.projectIds?.length &&
      !parsed.search.brandIds?.length &&
      !parsed.search.cityIdList?.length &&
      !parsed.search.statuses?.length &&
      !parsed.references.projectName &&
      !parsed.references.brandName &&
      !parsed.references.cityNames?.length,
  );
}

function isWeakSearchJobName(value: string): boolean {
  return /^(全职|兼职|小时工|寒假工|暑假工|长期工|短期工|岗位|职位|这个|该|此|信息|详情)$/.test(value.trim());
}

function parseDetailJobId(message: string): number | undefined {
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

  if (/详情|详细|完整信息|岗位信息|职位信息/.test(message)) {
    return matchNumber(message, /(?<![A-Za-z0-9-])(\d{3,})(?![A-Za-z0-9-])/);
  }

  return undefined;
}

function matchNumber(message: string, pattern: RegExp): number | undefined {
  const match = message.match(pattern);
  return match ? normalizeNumber(match[1]) : undefined;
}

function selectUniqueOption<T extends OptionEntity>(
  options: T[],
  query: string,
  label: string,
  issues: FieldIssue[],
  messages: { notFoundMessage?: string; requireMatch?: boolean } = {},
): T | undefined {
  if (!options.length) {
    issues.push({
      field: label,
      label,
      message: messages.notFoundMessage ?? `未找到“${query}”对应的${label}`,
    });
    return undefined;
  }

  const exact = options.filter(option => isExactOptionMatch(option.name, query));
  const bestExact = pickBestExactOption(exact);
  if (bestExact) {
    return bestExact;
  }

  const fuzzy = options.filter(option => isFuzzyOptionMatch(option.name, query));
  if (fuzzy.length === 1) {
    return fuzzy[0];
  }

  if (!messages.requireMatch && options.length === 1) {
    return options[0];
  }

  if (messages.requireMatch && !fuzzy.length) {
    issues.push({
      field: label,
      label,
      message: messages.notFoundMessage ?? `未找到“${query}”对应的${label}`,
    });
    return undefined;
  }

  const candidates = fuzzy.length ? fuzzy : options;
  issues.push({
    field: label,
    label,
    message: `“${query}”匹配到多个${label}：${candidates.slice(0, 5).map(item => `${item.name}(${item.id})`).join('、')}，请明确 ID。`,
  });
  return undefined;
}

function isExactOptionMatch(optionName: string, query: string): boolean {
  return (
    normalizeForMatch(optionName) === normalizeForMatch(query) ||
    normalizeOptionAlias(optionName) === normalizeOptionAlias(query)
  );
}

function isFuzzyOptionMatch(optionName: string, query: string): boolean {
  const normalizedOption = normalizeOptionAlias(optionName);
  const normalizedQuery = normalizeOptionAlias(query);
  return normalizedOption.includes(normalizedQuery) || normalizedQuery.includes(normalizedOption);
}

function pickBestExactOption<T extends OptionEntity>(options: T[]): T | undefined {
  if (options.length <= 1) {
    return options[0];
  }

  return (
    options.find(option => option.id % 10000 !== 0) ??
    options.find(option => option.id % 100 !== 0) ??
    options[0]
  );
}

function selectFallbackOption<T extends OptionEntity>(options: T[], query: string): T | undefined {
  if (!options.length) {
    return undefined;
  }

  const exact = options.filter(option => isExactOptionMatch(option.name, query));
  const bestExact = pickBestExactOption(exact);
  if (bestExact) {
    return bestExact;
  }

  const fuzzy = options.filter(option => isFuzzyOptionMatch(option.name, query));
  if (fuzzy.length === 1) {
    return fuzzy[0];
  }

  return options.length === 1 ? options[0] : undefined;
}

function selectOptionalSingleOption<T extends OptionEntity>(options: T[], query: string): T | undefined {
  const bestExact = pickBestExactOption(options.filter(option => isExactOptionMatch(option.name, query)));
  if (bestExact) {
    return bestExact;
  }

  const fuzzy = options.filter(option => isFuzzyOptionMatch(option.name, query));
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

function normalizeOptionAlias(value: string): string {
  return normalizeForMatch(value).replace(/(省|市|区|县|自治州|地区|盟)$/u, '');
}

function flattenCities(nodes: Array<{ id: number; name: string; children?: unknown[] }>): OptionEntity[] {
  const result: OptionEntity[] = [];

  function visit(node: { id: number; name: string; children?: unknown[] }) {
    result.push({ id: node.id, name: node.name });
    for (const child of node.children || []) {
      if (
        child &&
        typeof child === 'object' &&
        typeof (child as { id?: unknown }).id === 'number' &&
        typeof (child as { name?: unknown }).name === 'string'
      ) {
        visit(child as { id: number; name: string; children?: unknown[] });
      }
    }
  }

  nodes.forEach(visit);
  return result;
}

function buildSearchReply(
  results: PositionResultSummary[],
  total: number,
  attemptedLabels: string[] = [],
): string {
  if (!results.length) {
    const attemptedText = attemptedLabels.length
      ? `\n已尝试：${attemptedLabels.join('、')}。`
      : '';
    return `未查询到匹配岗位。${attemptedText}\n可以补充岗位 ID、项目、品牌、城市、岗位名称或状态继续查询。`;
  }

  const table = buildSearchCandidateTable(results);

  const suffix = total > results.length ? `\n\n共 ${total} 条，已展示前 ${results.length} 条。` : '';
  return `查询结果如下：\n\n${table}${suffix}\n\n可以继续说“将详细信息列给我”查看详情，或说“编辑岗位 ID ...”生成修改预览。`;
}

function buildCreateSourceCandidateReply(
  draftId: string,
  candidates: PositionResultSummary[],
): string {
  const exampleId = candidates[0]?.jobBasicInfoId ?? '岗位ID';
  return [
    `我已先记录新建岗位里的已知信息（draftId: ${draftId}）。`,
    '',
    '为了避免逐项填写，我找到以下可参考的已有岗位。请选择一个作为模板，我会继承项目、品牌、薪资、排班、流程、门店等信息，并保留你刚才明确说过的字段。',
    '',
    buildSearchCandidateTable(candidates),
    '',
    `可回复：用岗位 ID ${exampleId} 作为模板，或说“都不用，继续空白新建”。`,
  ].join('\n');
}

function buildCreateSourceSuggestionReply(
  draftId: string,
  sourceJobBasicInfoId: number,
): string {
  return [
    `我已先记录新建岗位里的已知信息（draftId: ${draftId}）。`,
    '',
    `当前信息还不足以保存。你刚查看过岗位 ID ${sourceJobBasicInfoId}，我可以用它补齐其他字段，并保留你已经说过的招聘人数、年龄、性别等信息。`,
    '',
    `如果要这样生成预览，回复“其他信息跟 ${sourceJobBasicInfoId} 一致”；如果不用模板，再继续补充项目、品牌、岗位名称、薪资、排班、门店等字段。`,
  ].join('\n');
}

function stableSearchParamsKey(params: PositionSearchParams): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function buildSearchCandidateTable(results: PositionResultSummary[]): string {
  return formatMarkdownTable(
    ['岗位ID', '岗位名称', '项目', '品牌', '城市区域', '状态', '薪资', '招聘人数'],
    results.map(item => [
      String(item.jobBasicInfoId || '-'),
      item.name,
      item.projectName || '-',
      item.brandName || '-',
      item.cityRegion || '-',
      item.statusText,
      item.salaryText || '-',
      item.recruitCount === undefined ? '-' : String(item.recruitCount),
    ]),
  );
}

function hasParsedSearchCondition(parsed: ParsedPositionMessage): boolean {
  return Boolean(
    parsed.search.jobBasicInfoIds?.length ||
      parsed.search.projectIds?.length ||
      parsed.search.brandIds?.length ||
      parsed.search.cityIdList?.length ||
      parsed.search.searchJobName ||
      parsed.search.statuses?.length ||
      parsed.references.projectName ||
      parsed.references.brandName ||
      parsed.references.cityNames?.length,
  );
}

function buildPreviewReply(
  preview: ReturnType<typeof buildPositionPreview>,
  values: PositionFormValues,
  missingFields: FieldIssue[],
  validationErrors: FieldIssue[],
  diff: PositionFieldDiff[],
): string {
  const sections = buildSemanticDetailSections(values);
  const diffText = buildSemanticDiffText(diff);
  const issueText = buildMissingReply(
    '当前不能保存的问题：',
    missingFields,
    validationErrors,
  );
  const hasIssues = missingFields.length > 0 || validationErrors.length > 0;

  if (hasIssues) {
    return [
      `${preview.title}（draftId: ${preview.draftId}）`,
      '',
      '我已识别到你的修改，但当前还有必填项或校验问题，先补齐后我再展示完整岗位预览。',
      diffText ? `\n\n${diffText}` : '',
      issueText ? `\n\n${issueText}` : '',
      '\n\n请补齐以上字段后再确认。',
    ].join('\n');
  }

  const confirmText =
    '\n\n确认无误后，回复“确认保存”；如需发布，回复“确认发布”，发布时还需要说明是否通知供应商。';

  return [
    `${preview.title}（draftId: ${preview.draftId}）`,
    '',
    '以下是修改后的岗位信息，请确认：',
    '',
    ...sections,
    diffText ? `\n\n${diffText}` : '',
    issueText ? `\n\n${issueText}` : '',
    confirmText,
  ].join('\n');
}

function buildSemanticDiffText(diff: PositionFieldDiff[]): string {
  if (!diff.length) {
    return '';
  }

  const lines = diff
    .map(item => describeFieldDiff(item))
    .filter((line): line is string => Boolean(line));

  return lines.length ? `变更说明：\n${lines.map(line => `- ${line}`).join('\n')}` : '';
}

function describeFieldDiff(diff: PositionFieldDiff): string | undefined {
  const before = normalizeDiffValue(diff.before);
  const after = normalizeDiffValue(diff.after);

  if (!before && !after) {
    return undefined;
  }

  if (!before && after) {
    return `${diff.label}设置为${after}`;
  }

  if (before && !after) {
    return isContextualField(diff.field)
      ? `${diff.label}不再适用（原为${before}）`
      : `${diff.label}已清空（原为${before}）`;
  }

  return `${diff.label}由${before}调整为${after}`;
}

function normalizeDiffValue(value: string): string | undefined {
  const text = value.trim();
  return text && text !== '-' ? text : undefined;
}

function isContextualField(field: string): boolean {
  return new Set([
    'partTimeType',
    'employmentDurationType',
    'minWorkMonths',
    'temporaryEmploymentStartTime',
    'temporaryEmploymentEndTime',
    'probationStatus',
    'probationSalaryConfig',
    'socialInsuranceList',
    'trialAddressMode',
    'trialAddress',
    'trialDuration',
    'trialUnit',
    'trialAssessment',
    'trialAssessmentRemark',
    'trainingAddressMode',
    'trainingAddress',
    'trainingDuration',
    'trainingUnit',
    'trainingContent',
    'interviewTimeMode',
    'interviewRoundConfigs',
  ]).has(field);
}

function buildDetailReply(
  jobBasicInfoId: number,
  values: PositionFormValues,
  summary?: PositionResultSummary,
): string {
  const title = values.jobName || summary?.name || values.positionName || '-';
  const statusText = summary?.statusText ? `，${summary.statusText}` : '';
  const sections = buildSemanticDetailSections(values, summary);

  if (!sections.length) {
    return `岗位详情：${jobBasicInfoId}\n\n未解析到可展示字段。`;
  }

  return [
    `岗位详情：${jobBasicInfoId}｜${title}${statusText}`,
    '',
    ...sections,
    '',
    `后续可以直接说“把薪资改为 25 元/时”或“把招聘人数改为 10 人”，我会基于岗位 ID ${jobBasicInfoId} 生成修改预览。`,
  ].join('\n');
}

function buildSemanticDetailSections(
  values: PositionFormValues,
  summary?: PositionResultSummary,
): string[] {
  const title = values.jobName || summary?.name || deriveDisplayPositionName(values) || values.positionName || '-';
  const workAddress = values.workAddress || formatWorkAddressFromStores(values);
  const overview = buildDetailSection('岗位信息', [
    detailLine('岗位名称', title),
    detailLine('项目', formatNameWithId(values.projectName || summary?.projectName, values.projectId)),
    detailLine('品牌', formatNameWithId(values.brandName || summary?.brandName, values.brandId)),
    detailLine('合作模式', fieldText(values, 'cooperationMode')),
    detailLine('城市区域', summary?.cityRegion),
    detailLine('招聘人数', summary?.recruitCount === undefined ? undefined : `${summary.recruitCount} 人`),
  ]);
  const employment = buildDetailSection('用工概览', [
    detailLine('用工形式', fieldText(values, 'employmentType')),
    detailLine('兼职类型', values.employmentType === 'part-time' ? fieldText(values, 'partTimeType') : undefined),
    detailLine('用工类型', values.employmentType === 'part-time' ? fieldText(values, 'employmentDurationType') : undefined),
    detailLine(
      '至少上岗',
      values.employmentType === 'part-time' && values.employmentDurationType === '1' && values.minWorkMonths !== undefined
        ? `${values.minWorkMonths} 个月`
        : undefined,
    ),
    detailLine(
      '临时用工时间',
      values.employmentType === 'part-time' && values.employmentDurationType === '2'
        ? compactText([values.temporaryEmploymentStartTime, values.temporaryEmploymentEndTime], ' 至 ')
        : undefined,
    ),
    detailLine('试用期', values.employmentType === 'full-time' ? fieldText(values, 'probationStatus') : undefined),
    detailLine('试工', fieldText(values, 'trialRequired')),
    detailLine('培训', fieldText(values, 'trainingRequired')),
  ]);
  const sections = [
    overview,
    employment,
    buildDetailSection('基础信息', [
      detailLine('岗位名称', values.positionName || title),
      detailLine('职位类别', formatPositionCategory(values)),
      detailLine('工作内容', fieldText(values, 'workContent')),
      detailLine('工作地址', workAddress),
    ]),
    buildDetailSection('薪资福利', [
      detailLine('结算与发薪', compactText([
        fieldText(values, 'settlementCycle'),
        formatPayDay(values),
      ])),
      detailLine('基本薪资', formatSalaryAmount(values.baseSalary, values.baseSalaryUnit)),
      detailLine('综合薪资', formatSalaryRange(values)),
      detailLine('阶梯薪资', formatLadderSalary(values)),
      detailLine('特殊时段薪资', formatSpecialPeriodSalary(values)),
      detailLine('法定节假日薪资', formatHolidaySalary(values)),
      detailLine('加班薪资', formatOvertimeSalary(values)),
      detailLine('商业保险', fieldText(values, 'commercialInsurance')),
      detailLine('社保和公积金', fieldText(values, 'socialInsuranceList')),
      detailLine('住宿', formatBenefit('housingBenefit', values)),
      detailLine('餐饮', formatBenefit('mealBenefit', values)),
      detailLine('交通补贴', formatTransportBenefit(values)),
      detailLine('福利备注', fieldText(values, 'memo')),
    ]),
    buildDetailSection('用人要求', [
      detailLine('年龄', formatRange(values.ageMin, values.ageMax, '岁')),
      detailLine('性别', fieldText(values, 'genders')),
      detailLine('学历', fieldText(values, 'education')),
      detailLine('社会身份', fieldText(values, 'socialIdentity')),
      detailLine('社保缴纳要求', formatStringList(values.socialInsurancePayments)),
      detailLine('证件', fieldText(values, 'certificateTypes')),
      detailLine('语言', fieldText(values, 'languages')),
      detailLine('语言备注', fieldText(values, 'languageRemark')),
      detailLine('软性技能', fieldText(values, 'softwareSkills')),
    ]),
    buildDetailSection('工作时长与排班', [
      detailLine('周/月排班', formatWeeklyMonthlySchedule(values)),
      detailLine('日排班', formatDailySchedule(values)),
    ]),
    buildDetailSection('面试 / 试工 / 培训 / 上岗', [
      detailLine('面试轮次', fieldText(values, 'interviewRounds')),
      detailLine(
        '面试时间',
        values.interviewRounds && values.interviewRounds !== '0' ? fieldText(values, 'interviewTimeMode') : undefined,
      ),
      detailLine('面试方式', formatInterviewRounds(values)),
      detailLine('试工安排', formatTrialProcess(values)),
      detailLine('培训安排', formatTrainingProcess(values)),
      detailLine('仪容仪表', humanReadableFreeText(values.onboardingGrooming)),
      detailLine('上岗材料', humanReadableFreeText(values.onboardingMaterials)),
      detailLine('面试入职流程', humanReadableFreeText(values.onboardingProcess)),
    ]),
    buildDetailSection('招聘门店与环境', [
      detailLine('招聘门店', formatRecruitStores(values)),
      detailLine('工作环境图片', formatStringList(values.workEnvironmentImages)),
    ]),
  ].filter((section): section is string => Boolean(section));

  return sections;
}

function buildDetailSection(title: string, lines: Array<string | undefined>): string {
  const visibleLines = lines.filter((line): line is string => Boolean(line));
  return visibleLines.length ? `### ${title}\n${visibleLines.join('\n')}` : '';
}

function detailLine(label: string, value: unknown): string | undefined {
  if (!hasMeaningfulValue(value)) {
    return undefined;
  }
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!text || text === '-') {
    return undefined;
  }
  return `- ${label}：${text}`;
}

function fieldText(values: PositionFormValues, field: keyof PositionFormValues): string | undefined {
  const value = values[field];
  if (!hasMeaningfulValue(value)) {
    return undefined;
  }
  const text = formatFieldValue(String(field), value);
  return text === '-' ? undefined : text;
}

function formatNameWithId(name?: string, id?: string | number): string | undefined {
  if (name && id !== undefined) {
    return `${name}（${String(id)}）`;
  }
  return name || (id === undefined ? undefined : String(id));
}

function deriveDisplayPositionName(values: PositionFormValues): string | undefined {
  const storeName = values.recruitStoreAllocations?.[0]?.storeName;
  const positionName = values.positionName;
  const employmentLabel =
    values.employmentType === 'part-time'
      ? formatFieldValue('partTimeType', values.partTimeType || '1')
      : values.employmentType === 'full-time'
        ? '全职'
        : undefined;
  const parts = [storeName, positionName, employmentLabel]
    .map(item => item?.trim())
    .filter((item): item is string => Boolean(item && item !== '-'));

  return parts.length >= 2 ? parts.join('-') : undefined;
}

function formatPositionCategory(values: PositionFormValues): string | undefined {
  if (!hasMeaningfulValue(values.positionCategory)) {
    return undefined;
  }

  if (values.positionCategoryName) {
    return formatNameWithId(values.positionCategoryName, values.positionCategory);
  }

  return `职位类别ID ${String(values.positionCategory)}`;
}

function humanReadableFreeText(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || /^\d+$/.test(text)) {
    return undefined;
  }
  return text;
}

function compactText(values: Array<string | undefined>, separator = '；'): string | undefined {
  const parts = values.map(item => item?.trim()).filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(separator) : undefined;
}

function formatPayDay(values: PositionFormValues): string | undefined {
  if (!values.payDay) {
    return undefined;
  }
  if (values.settlementCycle === '1') {
    if (values.payDay === '1') return '当日结';
    if (values.payDay === '2') return '次日结';
  }
  return `${values.payDay}号`;
}

function formatSalaryAmount(
  amount?: number,
  unit?: PositionFormValues['baseSalaryUnit'] | PositionFormValues['salaryRangeUnit'],
): string | undefined {
  if (amount === undefined) {
    return undefined;
  }
  const unitText = unit ? formatFieldValue('baseSalaryUnit', unit) : '';
  return `${amount}${unitText}`;
}

function formatSalaryRange(values: PositionFormValues): string | undefined {
  if (values.salaryMin === undefined && values.salaryMax === undefined) {
    return undefined;
  }
  const unit = values.salaryRangeUnit ? fieldText(values, 'salaryRangeUnit') : '';
  if (values.salaryMin !== undefined && values.salaryMax !== undefined) {
    return `${values.salaryMin}-${values.salaryMax}${unit}`;
  }
  return `${values.salaryMin ?? values.salaryMax}${unit}`;
}

function formatLadderSalary(values: PositionFormValues): string | undefined {
  if (values.hasLadderSalary === undefined) {
    return undefined;
  }
  if (String(values.hasLadderSalary) === '2') {
    return '无阶梯薪资';
  }
  const tiers = values.ladderSalaryTiers
    ?.map(row => compactText([
      formatRange(row.min, row.max),
      row.amount === undefined ? undefined : `${row.amount}`,
    ], '：'))
    .filter(Boolean)
    .join('；');
  return tiers || '有阶梯薪资';
}

function formatSpecialPeriodSalary(values: PositionFormValues): string | undefined {
  if (values.hasSpecialPeriodSalary === undefined) {
    return undefined;
  }
  if (String(values.hasSpecialPeriodSalary) === '0') {
    return '无特殊时段薪资';
  }
  return compactText([
    formatSalaryAmount(values.specialPeriodSalaryAmount, values.specialPeriodSalaryUnit),
    values.specialPeriodSalaryRemark,
  ]) || '有特殊时段薪资';
}

function formatHolidaySalary(values: PositionFormValues): string | undefined {
  if (!values.holidaySalaryType) {
    return undefined;
  }
  if (values.holidaySalaryType === '3') {
    return '无法定节假日薪资';
  }
  if (values.holidaySalaryType === '1' && values.holidaySalaryMultiplier !== undefined) {
    return `${values.holidaySalaryMultiplier}倍`;
  }
  return compactText([
    formatSalaryAmount(values.holidaySalaryAmount, values.holidaySalaryUnit),
    values.holidaySalaryRemark,
  ]) || '有法定节假日薪资';
}

function formatOvertimeSalary(values: PositionFormValues): string | undefined {
  if (!values.overtimeSalaryType) {
    return undefined;
  }
  if (values.overtimeSalaryType === '3') {
    return '无加班薪资';
  }
  if (values.overtimeSalaryType === '1' && values.overtimeSalaryMultiplier !== undefined) {
    return `${values.overtimeSalaryMultiplier}倍`;
  }
  return compactText([
    formatSalaryAmount(values.overtimeSalaryAmount, values.overtimeSalaryUnit),
    values.overtimeSalaryRemark,
  ]) || '有加班薪资';
}

function formatBenefit(
  field: 'housingBenefit' | 'mealBenefit',
  values: PositionFormValues,
): string | undefined {
  const benefit = fieldText(values, field);
  const subsidy =
    field === 'housingBenefit'
      ? formatSalaryAmount(values.housingSubsidy, values.housingSubsidyUnit)
      : formatSalaryAmount(values.mealSubsidy, values.mealSubsidyUnit);
  const remark = field === 'housingBenefit' ? values.housingBenefitRemark : values.mealBenefitRemark;
  return compactText([benefit, subsidy, remark]);
}

function formatTransportBenefit(values: PositionFormValues): string | undefined {
  return compactText([
    formatSalaryAmount(values.transportSubsidy, values.transportSubsidyUnit),
    values.transportBenefitRemark,
  ]);
}

function formatRange(min?: number, max?: number, unit = ''): string | undefined {
  if (min === undefined && max === undefined) {
    return undefined;
  }
  if (min !== undefined && max !== undefined) {
    return `${min}-${max}${unit}`;
  }
  return `${min ?? max}${unit}`;
}

function formatStringList(values?: Array<string | number>): string | undefined {
  return values?.length ? values.join('、') : undefined;
}

function formatWeeklyMonthlySchedule(values: PositionFormValues): string | undefined {
  if (values.weeklyMonthlyMode === '1') {
    return compactText([
      values.workDays !== undefined && values.restDays !== undefined
        ? `做 ${values.workDays} 天，休 ${values.restDays} 天`
        : undefined,
      fieldText(values, 'restMode'),
    ]);
  }
  if (values.weeklyMonthlyMode === '2') {
    return compactText([
      fieldText(values, 'workHourIntervalType'),
      fieldText(values, 'workHourRequirementType'),
      values.workHours === undefined ? undefined : `${values.workHours}${fieldText(values, 'workHoursUnit') ?? ''}`,
    ], '');
  }
  return fieldText(values, 'weeklyMonthlyMode');
}

function formatDailySchedule(values: PositionFormValues): string | undefined {
  return compactText([
    fieldText(values, 'dailyScheduleMode'),
    values.dailyWorkDuration === undefined ? undefined : `${values.dailyWorkDuration}小时`,
    values.dailyTimeRange?.length === 2 ? `${values.dailyTimeRange[0]}-${values.dailyTimeRange[1]}` : undefined,
    values.goOffWorkTimeType ? fieldText(values, 'goOffWorkTimeType') : undefined,
  ]);
}

function formatInterviewRounds(values: PositionFormValues): string | undefined {
  if (!values.interviewRoundConfigs?.length || values.interviewRounds === '0') {
    return undefined;
  }
  return values.interviewRoundConfigs
    .map((row, index) => compactText([
      `第 ${index + 1} 轮`,
      row.interviewMode ? formatFieldValue('interviewMode', row.interviewMode) : undefined,
      row.interviewRemark,
      row.interviewAddress,
    ], '：'))
    .filter((item): item is string => Boolean(item))
    .join('；');
}

function formatTrialProcess(values: PositionFormValues): string | undefined {
  if (values.trialRequired !== '1') {
    return fieldText(values, 'trialRequired');
  }
  return compactText([
    fieldText(values, 'trialAddressMode'),
    values.trialAddress,
    values.trialDuration === undefined ? undefined : `${values.trialDuration}${fieldText(values, 'trialUnit') ?? ''}`,
    fieldText(values, 'trialAssessment'),
    values.trialAssessmentRemark,
  ]);
}

function formatTrainingProcess(values: PositionFormValues): string | undefined {
  if (values.trainingRequired !== '1') {
    return fieldText(values, 'trainingRequired');
  }
  return compactText([
    fieldText(values, 'trainingAddressMode'),
    values.trainingAddress,
    values.trainingDuration === undefined ? undefined : `${values.trainingDuration}${fieldText(values, 'trainingUnit') ?? ''}`,
    values.trainingContent,
  ]);
}

function formatRecruitStores(values: PositionFormValues): string | undefined {
  return values.recruitStoreAllocations
    ?.map(row => compactText([
      row.storeName || (row.storeId === undefined ? undefined : `门店 ${row.storeId}`),
      row.recruitCount === undefined ? undefined : `招聘 ${row.recruitCount} 人`,
      row.threshold === undefined ? undefined : `阈值 ${formatThreshold(row.threshold)}`,
      row.storeExactAddress || row.storeAddress,
    ]))
    .filter((item): item is string => Boolean(item))
    .join('；');
}

function formatWorkAddressFromStores(values: PositionFormValues): string | undefined {
  const firstStore = values.recruitStoreAllocations?.[0];
  return firstStore?.storeExactAddress || firstStore?.storeAddress;
}

function formatThreshold(value?: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return `${value / 10}倍`;
}

function buildMissingReply(
  prefix: string,
  missingFields: FieldIssue[],
  validationErrors: FieldIssue[],
): string {
  const rows = [
    ...missingFields.map(issue => [issue.label, issue.message]),
    ...validationErrors.map(issue => [issue.label, issue.message]),
  ];

  if (!rows.length) {
    return '';
  }

  return `${prefix ? `${prefix}\n\n` : ''}${formatMarkdownTable(['字段', '问题'], rows)}`;
}

function buildClarifyResponse(
  prefix: string,
  issues: FieldIssue[],
  usedTools: string[],
): PositionToolResponse {
  return {
    reply: buildMissingReply(prefix, [], issues),
    intent: 'clarify',
    needsClarification: true,
    needsConfirmation: false,
    validationErrors: issues,
    usedTools,
  };
}

function isRecoverablePositionApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|Position request failed|request failed|请求失败|aborted|AbortError|ECONN|ETIMEDOUT|ENOTFOUND|ECONNRESET/i.test(message);
}

function buildPositionApiFailureResponse(error: unknown): PositionToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reply: [
      '岗位接口请求失败，当前没有完成查询或写入。',
      `错误：${message.slice(0, 160)}`,
      '可以稍后重试；如果连续出现，请检查网络/VPN、HM_BASE_URL 和登录 token 是否有效。',
    ].join('\n'),
    intent: 'clarify',
    needsClarification: true,
    needsConfirmation: false,
    usedTools: [],
  };
}

function assertPositionReadiness(config: AppConfig): void {
  if (!config.hmDulidayToken) {
    throw new Error('Missing HM_DULIDAY_TOKEN');
  }
  if (!config.hmBaseUrl) {
    throw new Error('Missing HM_BASE_URL');
  }
}
