const refreshing = new Map<string, Promise<void>>();
const refreshedAt = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryDelays = new Map<string, number>();

/** Coalesce background refreshes; subscribers read the device copy without starting a fetch loop. */
export function backgroundRefresh(key: string, refresh: () => Promise<void>, force = false): Promise<void> {
  const active = refreshing.get(key);
  if (active) return active;
  if (!force && Date.now() - (refreshedAt.get(key) ?? 0) < 30_000) return Promise.resolve();
  const timer = retryTimers.get(key);
  if (timer) clearTimeout(timer);
  retryTimers.delete(key);
  // Back off failed reads too, instead of retrying on every local notification.
  refreshedAt.set(key, Date.now());
  const next = Promise.resolve().then(refresh).then(() => {
    refreshedAt.set(key, Date.now());
    retryDelays.delete(key);
  }, error => {
    const code = (error as { code?: string })?.code;
    if (typeof window !== "undefined" && !["NOT_FOUND", "VALIDATION", "DEPLOYMENT_REQUIRED", "SETUP_REQUIRED"].includes(code || "")) {
      const delay = retryDelays.get(key) ?? 3000;
      retryDelays.set(key, Math.min(delay * 2, 60_000));
      const retry = setTimeout(() => {
        retryTimers.delete(key);
        if (typeof navigator === "undefined" || navigator.onLine !== false)
          void backgroundRefresh(key, refresh, true).catch(() => undefined);
        else refreshedAt.delete(key);
      }, delay);
      if (typeof retry === "object" && "unref" in retry) retry.unref();
      retryTimers.set(key, retry);
    }
    throw error;
  }).finally(() => refreshing.delete(key));
  refreshing.set(key, next);
  return next;
}
