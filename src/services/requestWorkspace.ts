import type { ChangeRequest, JobEntry } from "../types";
import { listLocalCustomers } from "../crm/store";
import { createCustomer } from "../crm";
import { customerIdForPick } from "./customerDirectory";
import { openUnifiedRecord } from "./unifiedRecords";

/** Create the durable record before queuing a request, keeping retries on the same job. */
let linking: Promise<unknown> = Promise.resolve();
export function ensureRequestWorkspace(request: ChangeRequest): Promise<ChangeRequest> {
  const next = linking.then(() => linkRequest(request));
  linking = next.catch(() => undefined);
  return next;
}

async function linkRequest(request: ChangeRequest): Promise<ChangeRequest> {
  if (request.workspaceId) return request;
  const job = request.job;
  const customers = (await listLocalCustomers()).map(customer => ({ ...customer, jobCount: 0, openTaskCount: 0 }));
  let customerId = request.customerId || customerIdForPick(null, customers, job.customer);
  if (!customerId && job.customer.trim()) {
    customerId = (await createCustomer({ name: job.customer, phone: job.customerPhone, email: job.customerEmail, address: job.address })).id;
  }
  const directory: JobEntry = {
    id: request.jobDirectoryId || request.id, jobNumber: job.jobNumber,
    customer: job.customer, address: job.address, customerPhone: job.customerPhone || "",
    customerEmail: job.customerEmail || "", projectManager: job.projectManager,
    estimator: job.branchContact, carrier: job.carrier, claim: job.claim,
    contractAmount: job.originalContract, active: true, status: "Active", updatedAt: request.updatedAt,
  };
  const workspace = await openUnifiedRecord({
    id: `request:${request.id}`, directory, customerId, name: job.customer,
    jobNumber: job.jobNumber, address: job.address, phone: directory.customerPhone,
    email: directory.customerEmail, updatedAt: request.updatedAt, status: "Active",
  });
  return { ...request, workspaceId: workspace.id, customerId: workspace.customerId || customerId };
}
