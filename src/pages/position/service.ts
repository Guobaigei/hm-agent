import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import type { AppConfig } from '../core/config.ts';
import {
  buildPositionFormValuesFromDetail,
  mapPositionResultSummary,
  PositionApiClient,
} from './client.ts';
import { POSITION_STATUS_LABELS } from './constants.ts';
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
import { buildCreateJobPayload, buildUpdateJobPayload } from './payload.ts';
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
} from './utils.ts';

type PositionServiceDependencies = {
  config: AppConfig;
  positionApiClient: PositionApiClient;
  draftStore: PositionDraftStore;
  logger: Logger;
};

type ResolveResult = {
  patch: Partial<PositionFormValues>;
  search: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>>;
  issues: FieldIssue[];
  usedTools: string[];
};

type OptionEntity = {
  id: number;
  name: string;
  raw?: Record<string, unknown>;
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
    const parsed = parsePositionMessage(request.message);
    const pendingDraft = this.dependencies.draftStore.getBySession(request.sessionId);

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

    if (shouldShowPositionDetail(request.message)) {
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

  private async searchPositions(
    sessionId: string,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const resolved = await this.resolveReferences(parsed);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认查询条件：', resolved.issues, resolved.usedTools);
    }

    const params: PositionSearchParams = {
      pageNum: 1,
      pageSize: 10,
      ...parsed.search,
      ...resolved.search,
    };

    if (!hasAnySearchCondition(params)) {
      return {
        reply: '请提供至少一个岗位查询条件：岗位 ID、岗位名称、项目、品牌、城市区域或状态。',
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: resolved.usedTools,
      };
    }

    const data = await this.dependencies.positionApiClient.getJobList(params);
    let results: PositionResultSummary[] = data.result.map(mapPositionResultSummary);
    let total = data.total;
    const usedTools = ['position.getJobList', ...resolved.usedTools];

    if (!results.length) {
      const fallback = await this.searchPositionsByNameFallback(params, parsed);
      if (fallback) {
        results = fallback.results;
        total = fallback.total;
        usedTools.push(...fallback.usedTools);
      }
    }

    this.dependencies.draftStore.setLastResults(sessionId, results);
    const reply = buildSearchReply(results, total);

    return {
      reply,
      intent: 'search',
      needsClarification: false,
      needsConfirmation: false,
      results,
      usedTools,
    };
  }

  private async searchPositionsByNameFallback(
    params: PositionSearchParams,
    parsed: ParsedPositionMessage,
  ): Promise<{
    results: PositionResultSummary[];
    total: number;
    usedTools: string[];
  } | undefined> {
    const query = normalizeString(params.searchJobName);
    if (
      !query ||
      params.brandIds?.length ||
      params.projectIds?.length ||
      params.jobBasicInfoIds?.length ||
      parsed.references.brandName ||
      parsed.references.projectName
    ) {
      return undefined;
    }

    const usedTools: string[] = [];
    let latestAttempt: {
      results: PositionResultSummary[];
      total: number;
      usedTools: string[];
    } | undefined;

    if (typeof this.dependencies.positionApiClient.searchBrands === 'function') {
      const brands = await this.dependencies.positionApiClient.searchBrands(query);
      usedTools.push('position.searchBrands');
      const selectedBrand = selectFallbackOption(brands, query);
      if (selectedBrand) {
        latestAttempt = await this.retrySearchByResolvedName(params, {
          brandIds: [selectedBrand.id],
          usedTools: [...usedTools],
        });
        if (latestAttempt.results.length) {
          return latestAttempt;
        }
      }
    }

    if (typeof this.dependencies.positionApiClient.searchProjects === 'function') {
      const projects = await this.dependencies.positionApiClient.searchProjects(query);
      usedTools.push('position.searchProjects');
      const selectedProject = selectFallbackOption(projects, query);
      if (selectedProject) {
        latestAttempt = await this.retrySearchByResolvedName(params, {
          projectIds: [selectedProject.id],
          usedTools: [...usedTools],
        });
        if (latestAttempt.results.length) {
          return latestAttempt;
        }
      }
    }

    if (latestAttempt) {
      return latestAttempt;
    }

    return usedTools.length
      ? { results: [], total: 0, usedTools }
      : undefined;
  }

  private async retrySearchByResolvedName(
    params: PositionSearchParams,
    input: {
      brandIds?: number[];
      projectIds?: number[];
      usedTools: string[];
    },
  ): Promise<{
    results: PositionResultSummary[];
    total: number;
    usedTools: string[];
  }> {
    const fallbackParams: PositionSearchParams = {
      ...params,
      brandIds: input.brandIds,
      projectIds: input.projectIds,
      searchJobName: undefined,
    };
    const data = await this.dependencies.positionApiClient.getJobList(fallbackParams);
    return {
      results: data.result.map(mapPositionResultSummary),
      total: data.total,
      usedTools: [...input.usedTools, 'position.getJobList'],
    };
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

    const detail = await this.dependencies.positionApiClient.getJobDetail(targetJobId);
    const summary = lastResults.find(item => item.jobBasicInfoId === targetJobId) ?? focusedPosition?.summary;
    const detailValues = buildPositionFormValuesFromDetail(detail);
    if (!detailValues) {
      return {
        reply: `未获取到岗位 ID ${targetJobId} 的详细信息。请确认岗位 ID 是否正确。`,
        intent: 'clarify',
        needsClarification: true,
        needsConfirmation: false,
        usedTools: ['position.getJobDetail'],
      };
    }

    const values = normalizeCanonicalValues(detailValues as PositionFormValues);
    this.dependencies.draftStore.setFocusedPosition(sessionId, targetJobId, summary);
    const preview = buildPositionPreview({
      draftId: String(targetJobId),
      mode: 'edit',
      title: '岗位详情',
      values,
      action: 'save',
    });

    return {
      reply: buildDetailReply(targetJobId, values, summary),
      intent: 'search',
      needsClarification: false,
      needsConfirmation: false,
      preview,
      usedTools: ['position.getJobDetail'],
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
    const resolved = await this.resolveReferences(parsed, baseValues);
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
    return this.storeAndReturnPreview({
      sessionId,
      mode: 'create',
      action: parsed.action ?? 'save',
      values,
      originalValues: inherited.originalValues,
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

    const inheritedValues = prepareInheritedCreateValues(
      normalizeCanonicalValues(
        mergePositionValues(createDefaultPositionFormValues(), sourceValues),
      ),
    );

    return {
      values: inheritedValues,
      originalValues: inheritedValues,
      usedTools: ['position.getJobDetail'],
    };
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
      jobBasicInfoId,
      sendMsgToSupplier: parsed.sendMsgToSupplier,
      usedTools: ['position.getJobDetail', ...resolved.usedTools],
    });
  }

  private async updatePendingDraft(
    pendingDraft: PendingPositionDraft,
    parsed: ParsedPositionMessage,
  ): Promise<PositionToolResponse> {
    const resolved = await this.resolveReferences(parsed, pendingDraft.values);
    if (resolved.issues.length) {
      return buildClarifyResponse('需要先确认补充信息中的选项：', resolved.issues, resolved.usedTools);
    }

    const values = normalizeCanonicalValues(
      mergePositionValues(pendingDraft.values, {
        ...parsed.patch,
        ...resolved.patch,
      }),
    );

    return this.storeAndReturnPreview({
      sessionId: pendingDraft.sessionId,
      mode: pendingDraft.mode,
      action: parsed.action ?? pendingDraft.action,
      values,
      originalValues: pendingDraft.originalValues,
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

  private async resolveReferences(
    parsed: ParsedPositionMessage,
    currentValues?: PositionFormValues,
  ): Promise<ResolveResult> {
    const patch: Partial<PositionFormValues> = {};
    const search: Partial<Omit<PositionSearchParams, 'pageNum' | 'pageSize'>> = {};
    const issues: FieldIssue[] = [];
    const usedTools: string[] = [];

    if (parsed.references.projectName) {
      const projects = await this.dependencies.positionApiClient.searchProjects(parsed.references.projectName);
      usedTools.push('position.searchProjects');
      const selected = selectUniqueOption(projects, parsed.references.projectName, '项目', issues);
      if (selected) {
        patch.projectId = selected.id;
        patch.projectName = selected.name;
        search.projectIds = [selected.id];
      }
    }

    if (parsed.references.brandName) {
      const brands = await this.dependencies.positionApiClient.searchBrands(parsed.references.brandName);
      usedTools.push('position.searchBrands');
      const selected = selectUniqueOption(brands, parsed.references.brandName, '品牌', issues);
      if (selected) {
        patch.brandId = selected.id;
        patch.brandName = selected.name;
        search.brandIds = [selected.id];
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

    return { patch, search, issues, usedTools };
  }
}

function prepareInheritedCreateValues(values: PositionFormValues): PositionFormValues {
  return {
    ...values,
    jobName: undefined,
  };
}

function shouldPatchPendingDraft(parsed: ParsedPositionMessage): boolean {
  return (
    parsed.intent === 'create_preview' ||
    parsed.intent === 'edit_preview' ||
    (parsed.intent === 'clarify' && Object.keys(parsed.patch).length > 0)
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

function shouldShowPositionDetail(message: string): boolean {
  return /详情|详细|完整信息|列给我|展开/.test(message);
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
    return matchNumber(message, /(?<![\d.])(\d{3,})(?![\d.])/);
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
): T | undefined {
  if (!options.length) {
    issues.push({
      field: label,
      label,
      message: `未找到“${query}”对应的${label}`,
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

  if (options.length === 1) {
    return options[0];
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

function buildSearchReply(results: PositionResultSummary[], total: number): string {
  if (!results.length) {
    return '未查询到匹配岗位。可以补充岗位 ID、项目、品牌、城市、岗位名称或状态继续查询。';
  }

  const table = buildSearchCandidateTable(results);

  const suffix = total > results.length ? `\n\n共 ${total} 条，已展示前 ${results.length} 条。` : '';
  return `查询结果如下：\n\n${table}${suffix}\n\n可以继续说“将详细信息列给我”查看详情，或说“编辑岗位 ID ...”生成修改预览。`;
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

function hasAnySearchCondition(params: PositionSearchParams): boolean {
  return Boolean(
    params.jobBasicInfoIds?.length ||
      params.projectIds?.length ||
      params.brandIds?.length ||
      params.cityIdList?.length ||
      params.searchJobName ||
      params.statuses?.length,
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
  const title = values.jobName || summary?.name || values.positionName || '-';
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
