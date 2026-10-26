import { test } from "node:test";
import assert from "node:assert/strict";
import { requestBelongsToRecord } from "../src/services/recordRequests";

const record = { id: "workspace-a", jobNumber: "FW-1", name: "Alex", address: "10 Main St" };
test("historical requests match the normalized job number", () => {
  assert.equal(requestBelongsToRecord({ job: { jobNumber: " fw-1 ", customer: "Old spelling", address: "" } }, record), true);
});
test("explicit workspace links win over matching names or job numbers", () => {
  assert.equal(requestBelongsToRecord({ workspaceId: "other", job: { jobNumber: "FW-1", customer: "Alex", address: "10 Main St" } }, record), false);
});
test("different jobs for the same customer remain separate", () => {
  assert.equal(requestBelongsToRecord({ job: { jobNumber: "FW-2", customer: "Alex", address: "10 Main St" } }, record), false);
});
test("unnumbered requests require both name and address, never an empty name", () => {
  const request = { job: { jobNumber: "", customer: " alex ", address: "10 main st" } };
  assert.equal(requestBelongsToRecord(request, { ...record, jobNumber: "" }), true);
  assert.equal(requestBelongsToRecord(request, record), false);
  assert.equal(requestBelongsToRecord({ job: { jobNumber: "", customer: "", address: "" } }, { ...record, jobNumber: "", name: "", address: "" }), false);
});
