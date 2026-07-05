interface CacheEntry {
  data: any;
  timestamp: number;
  promise?: Promise<any>;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_STALE_MS = 30_000;

function cacheKey(table: string, opts: any): string {
  return table + JSON.stringify(opts ?? {});
}

export async function sbCached(table: string, opts?: any, staleMs = DEFAULT_STALE_MS): Promise<any[]> {
  const key = cacheKey(table, opts);
  const entry = cache.get(key);
  const now = Date.now();

  if (entry?.promise) return entry.promise; // deduplication
  if (entry && now - entry.timestamp < staleMs) return entry.data; // cache hit

  // import sb dynamically to avoid circular imports
  const { sb } = await import('./helpers');
  const promise = sb(table, opts).then(data => {
    cache.set(key, { data, timestamp: Date.now() });
    return data;
  }).finally(() => {
    // clear promise ref
    const e = cache.get(key);
    if (e) e.promise = undefined;
  });

  cache.set(key, { data: entry?.data ?? [], timestamp: entry?.timestamp ?? 0, promise });
  return promise;
}

export function invalidateCache(table: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(table)) cache.delete(key);
  }
}

export function clearCache() {
  cache.clear();
}
