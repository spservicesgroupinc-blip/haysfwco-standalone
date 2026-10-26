import { test } from "node:test";
import assert from "node:assert/strict";
import { appsScriptRequest } from "../src/services/appsScriptQueue";

const endpoint = "https://example.test/exec";
test("Apps Script reads coalesce and saves run before waiting refreshes", async () => {
  const calls: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const first = appsScriptRequest(endpoint, "listCustomers", {}, async () => {
    calls.push("customers"); started(); await hold; return "customers";
  });
  await ready;
  const duplicate = appsScriptRequest(endpoint, "listCustomers", {}, async () => { throw new Error("Duplicate cloud read"); });
  assert.equal(duplicate, first);
  const read = appsScriptRequest(endpoint, "listWorkspaces", {}, async () => { calls.push("jobs"); });
  const save = appsScriptRequest(endpoint, "saveJobDocument", { mutationId: "same-retry-id" }, async () => { calls.push("document"); });
  release();
  await Promise.all([first, duplicate, read, save]);
  assert.deepEqual(calls, ["customers", "document", "jobs"]);
});

test("a temporary script lock collision retries the same mutation", async () => {
  let attempts = 0;
  const mutation = { mutationId: "immutable-id" };
  await appsScriptRequest(endpoint, "saveWorkspace", mutation, async () => {
    assert.equal(mutation.mutationId, "immutable-id");
    if (++attempts === 1) throw Object.assign(new Error("Busy"), { code: "BUSY" });
  });
  assert.equal(attempts, 2);
});
