import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustomer, updateCustomer } from "../src/crm";
import { syncCustomersFromJobs } from "../src/crm/jobSync";
import { getLocalCustomer } from "../src/crm/store";
import { syncCrm } from "../src/crm/sync";
import { mockBackend } from "./helpers/backend";
import type { JobEntry } from "../src/types";

test("new and imported customers can be edited before their first cloud save", async () => {
  const backend = mockBackend();
  const restore = backend.installFetch();
  try {
    const manual = await createCustomer({ name: "Manual customer" });
    await updateCustomer({ ...manual, phone: "260-555-0100" });
    const job = (name: string, values: Partial<JobEntry> = {}) => ({
      id: crypto.randomUUID(), jobNumber: crypto.randomUUID(), customer: name,
      address: "", customerPhone: "", customerEmail: "", projectManager: "",
      estimator: "", status: "Active", active: true, updatedAt: "2026-10-27", ...values,
    } as JobEntry);
    const imported = await syncCustomersFromJobs([job("Imported customer")]);
    await updateCustomer({ ...imported.created[0], phone: "260-555-0101" });
    const enriched = await createCustomer({ name: "Several jobs" });
    await syncCustomersFromJobs([
      job(enriched.name, { customerPhone: "260-555-0102" }),
      job(enriched.name, { customerEmail: "jobs@example.test" }),
      job(enriched.name, { address: "123 Main St" }),
    ]);
    await updateCustomer({ ...(await getLocalCustomer(enriched.id))!, cityStateZip: "Fort Wayne, IN" });
    await syncCrm();
    for (const [customer, revision, phone] of [[manual, 2, "260-555-0100"], [imported.created[0], 2, "260-555-0101"], [enriched, 3, "260-555-0102"]] as const) {
      const saved = backend.post({ action: "openCustomer", customerId: customer.id }).customer;
      assert.equal(saved.revision, revision);
      assert.equal(saved.phone, phone);
    }
    const saved = backend.post({ action: "openCustomer", customerId: enriched.id }).customer;
    assert.equal(saved.email, "jobs@example.test");
    assert.equal(saved.address, "123 Main St");
    assert.equal(saved.cityStateZip, "Fort Wayne, IN");
  } finally { restore(); }
});
