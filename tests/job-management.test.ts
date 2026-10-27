import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activitiesForJob, taskSummary, tasksForJob } from "../src/crm/taskManagement";
import { addNote, createTask, toggleTask, updateTask } from "../src/crm";
import { listLocalTasks, pendingCrmMutations } from "../src/crm/store";
import { refreshCustomersFromServer, syncCrm } from "../src/crm/sync";
import { mockBackend } from "./helpers/backend";
import type { Task } from "../src/crm/types";

const task = (id: string, changes: Partial<Task> = {}): Task => ({
  id, customerId: "same-customer", workspaceId: "job-a", title: id, status: "open",
  createdAt: "2026-10-26T12:00:00Z", revision: 1, ...changes,
});

test("job tasks and updates stay separate from another job and general customer history", () => {
  const tasks = [task("job-task"), task("other-job", { workspaceId: "job-b" }), task("customer-task", { workspaceId: undefined })];
  assert.deepEqual(tasksForJob(tasks, "job-a").map(row => row.id), ["job-task"]);
  assert.deepEqual(activitiesForJob([
    { id: "note-a", customerId: "same-customer", workspaceId: "job-a", kind: "note", direction: "system", body: "Access confirmed", at: "2026-10-26" },
    { id: "note-b", customerId: "same-customer", workspaceId: "job-b", kind: "note", direction: "system", body: "Different job", at: "2026-10-26" },
  ], "job-a").map(row => row.id), ["note-a"]);
});

test("next actions prioritize overdue deadlines and task progress excludes completed deadlines", () => {
  const summary = taskSummary([
    task("no-date"), task("today", { dueDate: "2026-10-26" }),
    task("overdue", { dueDate: "2026-10-25" }), task("done", { status: "done", dueDate: "2026-10-01" }),
  ], "2026-10-26");
  assert.equal(summary.next?.id, "overdue");
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.open, 3);
  assert.equal(summary.percent, 25);
});

test("creating, editing, and completing a task before sync keeps consecutive revisions and its job link", async () => {
  const backend = mockBackend();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => new Response(JSON.stringify(backend.post(JSON.parse(String(init?.body)))));
  try {
    const created = await createTask("job-customer", { title: "Confirm access", workspaceId: "job-a", assignee: "Jordan", dueDate: "2026-10-27" });
    const edited = await updateTask(created, { title: "Confirm lockbox access", assignee: "Casey", dueDate: "2026-10-28" });
    const done = await toggleTask(edited);
    assert.equal(done.workspaceId, "job-a");
    const pending = (await pendingCrmMutations()).filter(row => row.kind === "task" && row.entity.id === created.id);
    assert.deepEqual(pending.map(row => row.kind === "task" && row.expectedRevision), [0, 1, 2]);
    const note = await addNote("job-customer", "Crew access confirmed", undefined, "job-a");
    await syncCrm();
    await refreshCustomersFromServer();
    const stored = (await listLocalTasks("job-customer")).find(row => row.id === created.id)!;
    assert.equal(stored.revision, 3);
    assert.equal(stored.status, "done");
    assert.equal(stored.assignee, "Casey");
    assert.equal(backend.post({ action: "listTasks", customerId: "job-customer" }).tasks[0].workspaceId, "job-a");
    assert.equal(backend.post({ action: "listActivities", customerId: "job-customer" }).activities.find((row: { id: string }) => row.id === note.id).workspaceId, "job-a");
  } finally { globalThis.fetch = originalFetch; }
});
