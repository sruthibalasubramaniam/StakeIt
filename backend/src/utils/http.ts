import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { PAGINATION } from '../config/constants';

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function resolvePagination(query: Record<string, unknown>): Pagination {
  const rawPage = Number(query.page ?? PAGINATION.defaultPage);
  const rawSize = Number(query.pageSize ?? query.limit ?? PAGINATION.defaultPageSize);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : PAGINATION.defaultPage;
  const pageSize = Number.isFinite(rawSize) && rawSize > 0 ? Math.min(Math.floor(rawSize), PAGINATION.maxPageSize) : PAGINATION.defaultPageSize;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, pagination: Pagination) {
  return {
    items,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
      hasNext: pagination.page * pagination.pageSize < total,
    },
  };
}

/** Normalises `?a=1&b=2` / `?a=1,2` style filters into a string array. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => toStringArray(entry));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (['true', '1', 'yes', 'on'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no', 'off'].includes(value.toLowerCase())) return false;
  }
  return fallback;
}
