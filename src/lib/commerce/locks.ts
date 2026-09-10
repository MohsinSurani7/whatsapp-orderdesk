const conversationLocks = new Map<string, Promise<unknown>>();

export async function withConversationLock<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = conversationLocks.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const next = prev.then(() => gate);
  conversationLocks.set(conversationId, next.catch(() => undefined));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

const rateBuckets = new Map<string, number[]>();

export function isRateLimited(key: string, max = 40, windowMs = 60_000) {
  const now = Date.now();
  const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateBuckets.set(key, hits);
  return hits.length > max;
}
