type PendingCall = { priority: number; run: () => void };
const pending: PendingCall[] = [];
const reads = new Map<string, Promise<unknown>>();
let active = false;

const readAction = (action: string) => /^(list|open|fetch|get)/.test(action) || action === "bootstrap";

function pump() {
  if (active || !pending.length) return;
  pending.sort((a, b) => a.priority - b.priority);
  active = true;
  pending.shift()!.run();
}

function enqueue<T>(endpoint: string, priority: number, perform: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.push({ priority, run: () => {
      const execute = () => typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks.request(`hays-apps-script:${endpoint}`, perform)
        : perform();
      void Promise.resolve().then(execute).then(resolve, reject).finally(() => {
        active = false;
        queueMicrotask(pump);
      });
    } });
    queueMicrotask(pump);
  });
}

/** One Apps Script execution at a time, including across tabs. Save payloads stay immutable. */
export function appsScriptRequest<T>(
  endpoint: string,
  action: string,
  payload: Record<string, unknown>,
  perform: () => Promise<T>,
): Promise<T> {
  const url = new URL(endpoint);
  endpoint = url.origin + url.pathname;
  const read = readAction(action);
  const key = read ? JSON.stringify([endpoint, action, payload]) : "";
  const existing = reads.get(key);
  if (existing) return existing as Promise<T>;
  // File previews are interactive; directory refreshes can wait behind saved work.
  const priority = !read ? 0 : action.startsWith("fetch") ? 1 : 2;
  const retryBusy = async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await enqueue(endpoint, priority, perform); }
      catch (error) {
        if ((error as { code?: string })?.code !== "BUSY" || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
      }
    }
  };
  const result = retryBusy().finally(() => { if (key) reads.delete(key); });
  if (key) reads.set(key, result);
  return result;
}
