import type { Logger } from 'pino';

import type {
  HmAggregateSearchResult,
  HmEntityType,
  HmListClientConfig,
  HmRequestStrategy,
  HmSearchResult,
  NormalizedEntity,
} from '../core/types.ts';

// 每个实体只保留“路径 + 字段候选”这种配置数据，
// 这样公共请求流程可以复用，差异留给 mapper 处理。
const ENTITY_CONFIGS: Record<HmEntityType, HmListClientConfig> = {
  brand: {
    entityType: 'brand',
    path: 'brands/list',
    idCandidates: ['brandId', 'id', 'brandCode', 'code'],
    nameCandidates: ['brandName', 'name', 'title'],
    summaryCandidates: ['brandCode', 'companyName', 'status', 'remark'],
  },
  company: {
    entityType: 'company',
    path: 'companies/list',
    idCandidates: ['companyId', 'id', 'companyCode', 'code'],
    nameCandidates: ['companyName', 'name', 'title'],
    summaryCandidates: ['companyCode', 'legalPerson', 'status', 'remark'],
  },
  store: {
    entityType: 'store',
    path: 'store/list',
    idCandidates: ['storeId', 'id', 'storeCode', 'code'],
    nameCandidates: ['storeName', 'name', 'title'],
    summaryCandidates: ['storeCode', 'brandName', 'companyName', 'projectName', 'status'],
  },
  project: {
    entityType: 'project',
    path: 'project/list',
    idCandidates: ['projectId', 'id', 'projectCode', 'code'],
    nameCandidates: ['projectName', 'name', 'title'],
    summaryCandidates: ['projectCode', 'brandName', 'companyName', 'status', 'cityName'],
  },
};

type HmClientOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  requestStrategy: HmRequestStrategy;
  maxResults: number;
  logger: Logger;
};

type RequestAttempt = {
  mode: 'json' | 'form';
};

export class HmApiClient {
  constructor(private readonly options: HmClientOptions) {}

  async search(entityType: HmEntityType, searchName: string): Promise<HmSearchResult> {
    const config = ENTITY_CONFIGS[entityType];
    const payload = await this.fetchList(config, searchName);
    const matches = this.normalizeItems(config, payload.items, payload.source);

    return {
      entityType,
      searchName,
      total: matches.length,
      matches,
      needsClarification: matches.length > 1,
      clarificationCandidates: matches.slice(0, this.options.maxResults).map(entity => ({
        entityType: entity.entityType,
        id: entity.id,
        name: entity.name,
      })),
      guidance: buildGuidance(entityType, matches.length),
    };
  }

  async searchAll(searchName: string): Promise<HmAggregateSearchResult> {
    // 全量搜索是给“查一下 XX”这种模糊问题准备的。
    // 这里并发调用四类实体接口，再把结果合并给 Agent 决策。
    const entityTypes = Object.keys(ENTITY_CONFIGS) as HmEntityType[];
    const results = await Promise.all(entityTypes.map(entityType => this.search(entityType, searchName)));

    const totalByType = results.reduce<Record<HmEntityType, number>>(
      (accumulator, result) => {
        accumulator[result.entityType] = result.total;
        return accumulator;
      },
      {
        brand: 0,
        company: 0,
        store: 0,
        project: 0,
      },
    );

    const matches = results
      .flatMap(result => result.matches)
      .slice(0, this.options.maxResults * entityTypes.length);

    return {
      searchName,
      total: matches.length,
      totalByType,
      matches,
      guidance:
        matches.length === 0
          ? '未在品牌、公司、门店、项目中查到匹配结果。'
          : '已按全部实体类型搜索，请优先根据实体类型和名称选择目标对象。',
    };
  }

  private async fetchList(
    config: HmListClientConfig,
    searchName: string,
  ): Promise<{ items: Record<string, unknown>[]; source: string }> {
    // 目前已确认四个海绵列表接口都是 POST 请求。
    // `auto` 模式下只在不同 POST 载荷格式之间兜底，不再额外尝试 GET。
    const attempts = buildAttempts(this.options.requestStrategy);
    let lastError: Error | undefined;

    for (const attempt of attempts) {
      try {
        const response = await this.performAttempt(config.path, searchName, attempt);
        if (!response.ok) {
          const bodyText = await response.text();
          throw new Error(
            `HM request failed with ${response.status} ${response.statusText}: ${bodyText.slice(0, 200)}`,
          );
        }

        const json = (await response.json()) as unknown;
        // 海绵接口外壳可能不完全一致，所以先抽取列表，再交给实体映射。
        const items = extractItems(json);
        return {
          items,
          source: `/${stripLeadingSlash(config.path)}`,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown HM request error');
        this.options.logger.warn(
          {
            entityType: config.entityType,
            path: config.path,
            attempt,
            error: lastError.message,
          },
          'HM list request attempt failed',
        );
      }
    }

    throw lastError ?? new Error(`HM request failed for ${config.entityType}`);
  }

  private async performAttempt(
    path: string,
    searchName: string,
    attempt: RequestAttempt,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      // 这里不能直接用 new URL('/brands/list', 'https://host/sponge/admin')
      // 因为前导 / 会把 /sponge/admin 整段覆盖掉，最终变成根路径 /brands/list。
      const requestUrl = buildEndpointUrl(this.options.baseUrl, path);
      const headers = new Headers({
        Accept: 'application/json',
      });

      if (this.options.token) {
        headers.set('Duliday-Token', this.options.token);
      }

      if (attempt.mode === 'json') {
        headers.set('Content-Type', 'application/json');
        return await fetch(requestUrl, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({ searchName }),
        });
      }

      headers.set('Content-Type', 'application/x-www-form-urlencoded');
      const formData = new URLSearchParams({ searchName });
      return await fetch(requestUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: formData,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeItems(
    config: HmListClientConfig,
    items: Record<string, unknown>[],
    source: string,
  ): NormalizedEntity[] {
    return items
      .map(item => mapToNormalizedEntity(config, item, source))
      .filter((entity): entity is NormalizedEntity => Boolean(entity))
      .slice(0, this.options.maxResults);
  }
}

function buildEndpointUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(stripLeadingSlash(path), normalizedBaseUrl);
}

function stripLeadingSlash(path: string): string {
  return path.replace(/^\/+/, '');
}

function buildAttempts(strategy: HmRequestStrategy): RequestAttempt[] {
  switch (strategy) {
    case 'post-json':
      return [{ mode: 'json' }];
    case 'post-form':
      return [{ mode: 'form' }];
    case 'auto':
    default:
      return [
        { mode: 'json' },
        { mode: 'form' },
      ];
  }
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  // 这里做“宽松提取”：
  // 1. 先找常见路径，例如 data.list / data.records
  // 2. 再递归寻找第一个对象数组
  // 这样接口外壳有轻微差异时，V1 也不至于完全不可用。
  if (Array.isArray(payload)) {
    return payload.filter(isObjectRecord);
  }

  if (!isObjectRecord(payload)) {
    return [];
  }

  for (const path of [
    ['data', 'list'],
    ['data', 'records'],
    ['data', 'rows'],
    ['data', 'items'],
    ['data', 'result'],
    ['data', 'data'],
    ['list'],
    ['records'],
    ['rows'],
    ['items'],
    ['result'],
  ]) {
    const candidate = getPath(payload, path);
    if (Array.isArray(candidate)) {
      return candidate.filter(isObjectRecord);
    }
  }

  const discovered = discoverObjectArray(payload);
  return discovered ?? [];
}

function discoverObjectArray(value: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(value) && value.every(item => item === null || isObjectRecord(item))) {
    return value.filter(isObjectRecord);
  }

  if (!isObjectRecord(value)) {
    return undefined;
  }

  for (const nested of Object.values(value)) {
    const found = discoverObjectArray(nested);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function mapToNormalizedEntity(
  config: HmListClientConfig,
  item: Record<string, unknown>,
  source: string,
): NormalizedEntity | undefined {
  // 归一化的核心目的是把“不同接口字段名”压成 Agent 能稳定消费的一套结构。
  const id = pickFirstScalar(item, [...config.idCandidates, 'id', 'code']);
  const name = pickFirstScalar(item, [...config.nameCandidates, 'name', 'title']);

  if (!id || !name) {
    return undefined;
  }

  const summary = buildSummary(item, config.summaryCandidates);

  return {
    entityType: config.entityType,
    id,
    name,
    summary,
    source,
    raw: item,
  };
}

function buildSummary(item: Record<string, unknown>, candidates: string[]): string {
  // summary 只取少量关键信息，避免把整条 raw 数据原样塞回给模型。
  const parts: string[] = [];

  for (const key of candidates) {
    const value = item[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }

    parts.push(`${key}: ${String(value)}`);
    if (parts.length >= 3) {
      break;
    }
  }

  if (parts.length > 0) {
    return parts.join(' | ');
  }

  const fallbackParts = Object.entries(item)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return fallbackParts.join(' | ');
}

function pickFirstScalar(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
  }

  return undefined;
}

function getPath(value: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = value;

  for (const segment of path) {
    if (!isObjectRecord(cursor)) {
      return undefined;
    }

    cursor = cursor[segment];
  }

  return cursor;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildGuidance(entityType: HmEntityType, count: number): string {
  if (count === 0) {
    return `未查询到匹配的${entityType}数据。`;
  }

  if (count === 1) {
    return `已命中唯一${entityType}结果，可直接基于该实体回答。`;
  }

  return `命中多个${entityType}结果，请根据名称和 ID 提示用户澄清。`;
}
