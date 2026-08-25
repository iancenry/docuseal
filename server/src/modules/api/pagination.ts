import type { Request } from 'express';

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

export interface CursorPaging {
  limit: number;
  after: number | null;
  before: number | null;
}

function intOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function cursorPagingOf(req: Request): CursorPaging {
  const rawLimit = Number.parseInt(String((req.query as Record<string, unknown>).limit ?? ''), 10);
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  return {
    limit,
    after: intOrNull((req.query as Record<string, unknown>).after),
    before: intOrNull((req.query as Record<string, unknown>).before),
  };
}

export interface PaginationMeta {
  count: number;
  next: number | null;
  prev: number | null;
}

export function idPaginationMeta(rows: { id: number }[]): PaginationMeta {
  return {
    count: rows.length,
    next: rows.length > 0 ? (rows[rows.length - 1]?.id ?? null) : null,
    prev: rows.length > 0 ? (rows[0]?.id ?? null) : null,
  };
}

export function epochPaginationMeta(rows: { completedAt: Date | null }[]): PaginationMeta {
  return {
    count: rows.length,
    next: rows.length > 0 ? Math.floor((rows[rows.length - 1]?.completedAt?.getTime() ?? 0) / 1000) : null,
    prev: rows.length > 0 ? Math.floor((rows[0]?.completedAt?.getTime() ?? 0) / 1000) : null,
  };
}

export function likeTerm(keyword: string): string {
  return `%${keyword.toLowerCase().replace(/([\\%_])/g, '\\$1')}%`;
}
