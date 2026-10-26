import type { Activity, Customer, Task } from "./types";

const DATABASE = "hays-crm-v1";

let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 2);
    open.onupgradeneeded = () => {
      for (const name of ["customers", "activities", "tasks"])
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, { keyPath: "id" });
      if (!open.result.objectStoreNames.contains("outbox"))
        open.result.createObjectStore("outbox", { keyPath: "sequence", autoIncrement: true });
    };
    open.onsuccess = () => {
      open.result.onversionchange = () => { open.result.close(); connection = undefined; };
      resolve(open.result);
    };
    open.onerror = () => {
      connection = undefined;
      reject(open.error);
    };
  });
  return connection;
}

async function read<T>(
  store: string,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read device storage."));
  });
}

async function putValue<T>(store: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

/** Writes without notifying subscribers, so server refreshes don't re-trigger reads. */
async function putValueSilent<T>(store: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

async function deleteValue(store: string, id: string): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not write device storage."));
  });
}

const listeners = new Set<() => void>();
let channel: BroadcastChannel | undefined;

const emit = () => {
  listeners.forEach((listener) => listener());
  channel?.postMessage("changed");
};

export type CrmMutation = (
  | { kind: "customer"; entity: Customer; expectedRevision: number }
  | { kind: "task"; entity: Task; expectedRevision: number }
  | { kind: "activity"; entity: Activity }
) & { sequence?: number; mutationId: string; error?: string; conflict?: boolean };

const entityStore = (kind: CrmMutation["kind"]) => kind === "customer" ? "customers" : kind === "task" ? "tasks" : "activities";
export const pendingCrmMutations = () => read<CrmMutation[]>("outbox", store => store.getAll());

/** Entity and outbox commit atomically, so a reload cannot lose the cloud save. */
export async function stageCrmMutation(mutation: CrmMutation): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const name = entityStore(mutation.kind);
    const tx = db.transaction([name, "outbox"], "readwrite");
    tx.objectStore(name).put(mutation.entity);
    tx.objectStore("outbox").add(mutation);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not preserve the pending customer save."));
  });
  emit();
}

export async function acknowledgeCrmMutation(mutation: CrmMutation, saved: Customer | Task | Activity): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const name = entityStore(mutation.kind);
    const tx = db.transaction([name, "outbox"], "readwrite");
    const outbox = tx.objectStore("outbox");
    outbox.delete(mutation.sequence!);
    const remaining = outbox.getAll();
    remaining.onsuccess = () => {
      if (!(remaining.result as CrmMutation[]).some(row => row.kind === mutation.kind && row.entity.id === mutation.entity.id))
        tx.objectStore(name).put(saved);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not confirm the customer save on this device."));
  });
  emit();
}

export async function markCrmMutationFailed(mutation: CrmMutation, error: string, conflict: boolean): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("outbox", "readwrite");
    const store = tx.objectStore("outbox");
    const current = store.get(mutation.sequence!);
    current.onsuccess = () => { if (current.result) store.put({ ...current.result, error, conflict }); };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
  emit();
}

/** Cloud refreshes must never replace a pending correction or a newer revision. */
export async function cacheCrmEntity(kind: CrmMutation["kind"], entity: Customer | Task | Activity): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const name = entityStore(kind);
    const tx = db.transaction([name, "outbox"], "readwrite");
    const pending = tx.objectStore("outbox").getAll();
    pending.onsuccess = () => {
      if ((pending.result as CrmMutation[]).some(row => row.kind === kind && row.entity.id === entity.id)) return;
      const store = tx.objectStore(name);
      const current = store.get(entity.id);
      current.onsuccess = () => {
        if ((current.result?.revision ?? 0) <= ((entity as Customer | Task).revision ?? 0)) store.put(entity);
      };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export const listLocalCustomers = () =>
  read<Customer[]>("customers", (store) => store.getAll());

export const getLocalCustomer = (id: string) =>
  read<Customer | undefined>("customers", (store) => store.get(id));

export const putCustomer = async (customer: Customer): Promise<void> => {
  await putValue("customers", customer);
  emit();
};

/** Used by mergeCustomers to drop the merged-away source row. */
export const deleteCustomer = async (id: string): Promise<void> => {
  await deleteValue("customers", id);
  emit();
};

export const listLocalActivities = (customerId: string) =>
  read<Activity[]>("activities", (store) => store.getAll()).then((rows) =>
    rows.filter((activity) => activity.customerId === customerId),
  );

export const putActivity = async (activity: Activity): Promise<void> => {
  await putValue("activities", activity);
  emit();
};

export const listLocalTasks = (customerId: string) =>
  read<Task[]>("tasks", (store) => store.getAll()).then((rows) =>
    rows.filter((task) => task.customerId === customerId),
  );

/** Used for local openTaskCount enrichment. */
export const listAllLocalTasks = () =>
  read<Task[]>("tasks", (store) => store.getAll());

export const putTask = async (task: Task): Promise<void> => {
  await putValue("tasks", task);
  emit();
};

export const putCustomerSilent = (customer: Customer) =>
  putValueSilent("customers", customer);
export const putActivitySilent = (activity: Activity) =>
  putValueSilent("activities", activity);
export const putTaskSilent = (task: Task) =>
  putValueSilent("tasks", task);

/** Fires on CRM mutations in this tab and (via BroadcastChannel) across tabs. */
export const subscribe = (listener: () => void): (() => void) => {
  if (typeof BroadcastChannel !== "undefined" && !channel) {
    channel = new BroadcastChannel("hays-crm-events");
    channel.onmessage = () => listeners.forEach((item) => item());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
