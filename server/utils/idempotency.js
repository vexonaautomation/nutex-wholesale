// Duplicate-submission protection.
// Durable layer: the idempotency key is stored on the Orders / Payments row
// and checked (inside the commerce lock, on fresh data) before creating.
// Fast layer (below): concurrent identical requests share one in-flight
// promise, so a double-click returns the same result.
const inflight = new Map();
const completed = new Map();
const TTL_MS = 30 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of completed) if (now - v.at > TTL_MS) completed.delete(k);
}

export async function once(scope, key, fn) {
  if (!key) return fn();
  const id = `${scope}:${key}`;
  if (completed.has(id)) return completed.get(id).result;
  if (inflight.has(id)) return inflight.get(id);
  const promise = (async () => {
    try {
      const result = await fn();
      completed.set(id, { at: Date.now(), result });
      if (completed.size > 2000) sweep();
      return result;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, promise);
  return promise;
}

export function isValidIdempotencyKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(key);
}
