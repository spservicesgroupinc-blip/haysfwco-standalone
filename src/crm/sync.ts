import { backgroundRefresh } from "../services/backgroundRefresh";
import { ApiError } from "../services/storage";
import * as api from "./api";
import {
  listLocalCustomers, cacheCrmEntity, cacheCrmEntities, pendingCrmMutations, stageCrmMutation,
  acknowledgeCrmMutation, markCrmMutationFailed, subscribe as subscribeStore,
} from "./store";
import type { Activity, Customer, Task } from "./types";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export const notifyCrm = emit;
let initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let rerunRequested = false;
let retryDelay = 1000;
let bridge: (() => void) | undefined;
function schedule(delay = 0) {
  if (running) { rerunRequested = true; return; }
  if (!initialized) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void syncCrm().catch(() => undefined); }, delay);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
export function subscribeCrm(listener: () => void): () => void {
  bridge ??= subscribeStore(emit);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function startCrmSync(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  bridge ??= subscribeStore(emit);
  window.addEventListener("online", () => schedule());
  window.addEventListener("focus", () => schedule());
  schedule();
}
export async function stageCustomer(customer: Customer, expectedRevision: number): Promise<void> {
  await stageCrmMutation({ kind: "customer", entity: structuredClone(customer), expectedRevision, mutationId: crypto.randomUUID() });
  schedule();
}
export async function stageCustomers(records: { customer: Customer; expectedRevision: number }[]): Promise<void> {
  for (const row of records) await stageCustomer(row.customer, row.expectedRevision);
}
export async function stageTask(task: Task, expectedRevision: number): Promise<void> {
  await stageCrmMutation({ kind: "task", entity: structuredClone(task), expectedRevision, mutationId: crypto.randomUUID() });
  schedule();
}
export async function stageActivity(activity: Activity): Promise<void> {
  await stageCrmMutation({ kind: "activity", entity: structuredClone(activity), mutationId: crypto.randomUUID() });
  schedule();
}
export function refreshCustomersFromServer(force = false): Promise<void> {
  return backgroundRefresh("crm:customers", async () => {
    const summaries = await api.listCustomers();
    const existing = new Map((await listLocalCustomers()).map(customer => [customer.id, customer]));
    await cacheCrmEntities("customer", summaries.map(summary => {
      const local = existing.get(summary.id);
      return {
        ...local, ...summary, revision: summary.revision ?? local?.revision ?? 0,
        createdAt: summary.createdAt ?? local?.createdAt ?? summary.updatedAt,
        cityStateZip: summary.cityStateZip ?? local?.cityStateZip,
        mergedFromIds: summary.mergedFromIds ?? local?.mergedFromIds,
      };
    }));
  }, force);
}
export function refreshCustomerFromServer(customerId: string): Promise<void> {
  return backgroundRefresh(`crm:customer:${customerId}`, async () => {
    const customer = await api.openCustomer(customerId);
    if (customer) await cacheCrmEntity("customer", customer);
  });
}
export function refreshActivitiesForCustomer(customerId: string): Promise<void> {
  return backgroundRefresh(`crm:activities:${customerId}`, async () => {
    await cacheCrmEntities("activity", await api.listActivities(customerId));
  });
}
export function refreshTasksForCustomer(customerId: string): Promise<void> {
  return backgroundRefresh(`crm:tasks:${customerId}`, async () => {
    await cacheCrmEntities("task", await api.listTasks(customerId));
  });
}
/** Durable, ordered, retry-safe writes; conflicts stay in the outbox for review. */
export function syncCrm(): Promise<void> {
  if (running) return running;
  const execute = async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    let failure: unknown;
    const blocked = new Set<string>();
    for (const mutation of await pendingCrmMutations()) {
      const key = mutation.kind + ":" + mutation.entity.id;
      if (blocked.has(key)) continue;
      if (mutation.conflict) { blocked.add(key); continue; }
      try {
        const saved = mutation.kind === "customer"
          ? await api.saveCustomer(mutation.entity, mutation.expectedRevision, mutation.mutationId)
          : mutation.kind === "task"
            ? await api.saveTask(mutation.entity, mutation.expectedRevision, mutation.mutationId)
            : await api.addActivity(mutation.entity, mutation.mutationId);
        if (!saved || saved.id !== mutation.entity.id || (mutation.kind !== "activity" &&
          (!Number.isInteger((saved as Customer | Task).revision) || (saved as Customer | Task).revision < mutation.expectedRevision + 1)))
          throw new Error("The server did not acknowledge the expected customer save. Your changes are kept on this device.");
        await acknowledgeCrmMutation(mutation, saved);
      } catch (error) {
        const conflict = error instanceof ApiError && error.code === "CONFLICT";
        await markCrmMutationFailed(mutation, error instanceof Error ? error.message : String(error), conflict);
        blocked.add(key); failure = error;
      }
    }
    void refreshCustomersFromServer(true).catch(() => undefined);
    emit();
    if (failure) throw failure;
  };
  running = (typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("hays-crm-sync", execute) : execute())
    .then(() => { retryDelay = 1000; }, error => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void syncCrm().catch(() => undefined); }, retryDelay);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      retryDelay = Math.min(retryDelay * 2, 30000); throw error;
    }).finally(() => {
      running = undefined;
      if (rerunRequested) { rerunRequested = false; schedule(); }
    });
  return running;
}
