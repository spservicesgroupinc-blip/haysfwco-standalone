import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkspace } from "../src/workspaces/model";
import { applyJobPlan, planOf } from "../src/documents/services/jobPlan";

test("editing a deadline preserves a manager and stage refreshed during editing", () => {
  const workspace = createWorkspace();
  const baseline = planOf(workspace);
  const latest = structuredClone(workspace);
  latest.stage = "in_progress";
  latest.record.team.projectManager = "New manager";
  const saved = applyJobPlan(latest, { ...baseline, finish: "2026-12-01" }, baseline);
  assert.equal(saved.stage, "in_progress");
  assert.equal(saved.record.team.projectManager, "New manager");
  assert.equal(saved.record.checklist.finishDate, "2026-12-01");
});

test("competing edits to the same plan field require review", () => {
  const workspace = createWorkspace();
  const baseline = planOf(workspace);
  const latest = structuredClone(workspace);
  latest.record.team.projectManager = "Other manager";
  assert.throws(() => applyJobPlan(latest, { ...baseline, manager: "My manager" }, baseline), /changed.*review/i);
});

test("a changed start date cannot create an invalid range with a newer target finish", () => {
  const workspace = createWorkspace();
  const baseline = planOf(workspace);
  const latest = structuredClone(workspace);
  latest.record.checklist.finishDate = "2026-11-01";
  assert.throws(() => applyJobPlan(latest, { ...baseline, start: "2026-12-01" }, baseline), /finish.*start/i);
});
