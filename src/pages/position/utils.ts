import type { OptionItem } from './constants.ts';

export function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

export function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  return undefined;
}

export function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value
    .map(item => normalizeString(item))
    .filter((item): item is string => Boolean(item));

  return result.length ? Array.from(new Set(result)) : undefined;
}

export function normalizeNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const result = value
    .map(item => normalizeNumber(item))
    .filter((item): item is number => typeof item === 'number');

  return result.length ? Array.from(new Set(result)) : undefined;
}

export function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some(item => hasMeaningfulValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(item => hasMeaningfulValue(item));
  }

  return false;
}

export function pruneEmpty<T>(value: T): T | undefined {
  if (Array.isArray(value)) {
    const nextValue = value
      .map(item => pruneEmpty(item))
      .filter(item => item !== undefined);
    return (nextValue.length ? nextValue : undefined) as T | undefined;
  }

  if (value && typeof value === 'object') {
    const nextValue = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, pruneEmpty(item)])
        .filter(([, item]) => item !== undefined),
    );
    return (Object.keys(nextValue).length ? nextValue : undefined) as T | undefined;
  }

  return hasMeaningfulValue(value) ? value : undefined;
}

export function getPath(value: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = value;

  for (const segment of path) {
    if (!isObjectRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toTimeSeconds(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 47 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTimeFromSeconds(value: unknown): string | undefined {
  const seconds = normalizeNumber(value);
  if (seconds === undefined) {
    return normalizeString(value);
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export function findOption(options: OptionItem[], value: unknown): OptionItem | undefined {
  const rawValue = normalizeString(value);
  if (!rawValue) {
    return undefined;
  }

  const normalized = normalizeForMatch(rawValue);
  return options.find(option => {
    const optionValue = normalizeForMatch(String(option.value));
    const optionLabel = normalizeForMatch(option.label);
    return optionValue === normalized || optionLabel === normalized;
  });
}

export function findOptionLabel(options: OptionItem[], value: unknown): string | undefined {
  return findOption(options, value)?.label;
}

export function escapeMarkdownCell(value: string): string {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim() || '-';
}

export function formatMarkdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
  ].join('\n');
}

export function buildEndpointUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ''), normalizedBaseUrl);
}

export function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(value => Number.isFinite(value))));
}

export function tryParseJsonObject(message: string): Record<string, unknown> | undefined {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(message.slice(start, end + 1)) as unknown;
    return isObjectRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

