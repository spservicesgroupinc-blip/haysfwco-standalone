import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { stageCustomer } from "../src/crm/sync";

test("a customer edit and its retry identity are stored durably together", async () => {
  await stageCustomer({ id: "durable-customer", revision: 0, name: "Durable Customer", createdAt: "2026-10-26", updatedAt: "2026-10-26" }, 0);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("hays-crm-v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    assert.ok(db.objectStoreNames.contains("outbox"), "Reload must retain the pending cloud save");
    const tx = db.transaction("outbox");
    const rows = await new Promise<any[]>((resolve, reject) => {
      const request = tx.objectStore("outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert.equal(rows[0].entity.id, "durable-customer");
    assert.ok(rows[0].mutationId);
  } finally { db.close(); }
});


test("cached customers render while their cloud refresh is still pending", { timeout: 2000 }, async () => {
  const { listCustomers } = await import("../src/crm/index");
  const { refreshCustomersFromServer } = await import("../src/crm/sync");
  const originalFetch = globalThis.fetch;
  let release!: (response: Response) => void;
  const cloud = new Promise<Response>(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return cloud; };
  try {
    const local = await listCustomers();
    assert.ok(local.some(customer => customer.id === "durable-customer"));
    await listCustomers();
    assert.equal(calls, 1, "Subscriber reads share one cloud refresh");
  } finally {
    release(new Response(JSON.stringify({ ok: true, customers: [] })));
    await refreshCustomersFromServer();
    globalThis.fetch = originalFetch;
  }
});
