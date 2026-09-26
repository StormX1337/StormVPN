import type { Paginated } from '@stormvpn/types';

export function pageArgs(query: { page: number; pageSize: number }): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function paginated<T>(
  items: T[],
  total: number,
  query: { page: number; pageSize: number },
): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}
