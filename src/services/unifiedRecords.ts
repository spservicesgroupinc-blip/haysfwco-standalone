import type { CustomerSummary } from "../crm/types";
import type { JobEntry } from "../types";
import type { Workspace, WorkspaceRow } from "../workspaces/types";
import { createWorkspace, normalizeJobNumber, workspaceFromDirectory } from "../workspaces/model";
import { customerIdOfOption, customerNameKey } from "./customerDirectory";
import { cachedWorkspaces, refreshWorkspaces, saveWorkspaceLocally } from "./workspaces";

export interface UnifiedRecord {
  id: string;
  workspace?: WorkspaceRow;
  directory?: JobEntry;
  customerId?: string;
  name: string;
  jobNumber: string;
  address: string;
  phone: string;
  email: string;
  updatedAt: string;
  status: string;
}

/** Saved workspaces are authoritative; imports and contacts fill unrepresented records. */
export function unifiedRecords(rows: WorkspaceRow[], jobs: JobEntry[], customers: CustomerSummary[]): UnifiedRecord[] {
  const idsByName = new Map<string, string | undefined>();
  for (const customer of customers) {
    const key = customerNameKey(customer.name);
    idsByName.set(key, idsByName.has(key) ? undefined : customer.id);
  }
  const customerFor = (pick: JobEntry | null, name: string) =>
    customerIdOfOption(pick?.id) || idsByName.get(customerNameKey(name));
  const records: UnifiedRecord[] = rows.map(row => {
    const { customer } = row.workspace.record;
    return { id: `workspace:${row.workspace.id}`, workspace: row,
      customerId: row.workspace.customerId || customerFor(null, customer.customerName),
      name: customer.customerName, jobNumber: customer.jobNumber, address: customer.lossAddress,
      phone: customer.mainPhone || customer.mobilePhone || customer.homePhone, email: customer.email,
      updatedAt: row.workspace.updatedAt, status: ({ lead: "Lead", in_progress: "In progress", complete: "Complete", closed: "Closed" })[row.workspace.stage || "lead"] };
  });
  const numbered = new Set(records.map(record => normalizeJobNumber(record.jobNumber)).filter(Boolean));
  for (const job of jobs) {
    const number = normalizeJobNumber(job.jobNumber);
    if (number && numbered.has(number)) continue;
    if (number) numbered.add(number);
    records.push({ id: `directory:${number || job.id}`, directory: job,
      customerId: customerFor(job, job.customer),
      name: job.customer, jobNumber: job.jobNumber, address: job.address,
      phone: job.customerPhone, email: job.customerEmail, updatedAt: job.updatedAt, status: job.status || (job.active ? "Active" : "Closed") });
  }
  const coveredCustomers = new Set(records.map(record => record.customerId));
  for (const customer of customers) {
    if (coveredCustomers.has(customer.id)) continue;
    records.push({ id: `customer:${customer.id}`, customerId: customer.id, name: customer.name,
      jobNumber: "", address: customer.address || "", phone: customer.phone || "", email: customer.email || "",
      updatedAt: customer.updatedAt, status: "Details in progress" });
  }
  return records.sort((a, b) => a.name.localeCompare(b.name) || a.jobNumber.localeCompare(b.jobNumber));
}

let opening: Promise<unknown> = Promise.resolve();

/** Both old customer links and directory rows resolve to the same permanent workspace. */
export function openUnifiedRecord(record: UnifiedRecord): Promise<Workspace> {
  const next = opening.then(async () => {
    let rows = await cachedWorkspaces();
    if (record.workspace) {
      const found = rows.find(row => row.workspace.id === record.workspace!.workspace.id);
      if (found) {
        if (!found.workspace.customerId && record.customerId) {
          const linked = { ...found.workspace, customerId: record.customerId };
          await saveWorkspaceLocally(linked, found.workspace);
          return linked;
        }
        return found.workspace;
      }
      return record.workspace.workspace;
    }
    const number = normalizeJobNumber(record.jobNumber);
    const findMatches = () => rows.filter(row => number
      ? normalizeJobNumber(row.workspace.record.customer.jobNumber) === number
      : !row.workspace.record.customer.jobNumber.trim() &&
        customerNameKey(row.workspace.record.customer.customerName) === customerNameKey(record.name) &&
        customerNameKey(row.workspace.record.customer.lossAddress) === customerNameKey(record.address) &&
        !!customerNameKey(record.name));
    let matches = findMatches();
    if (!matches.length && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      await refreshWorkspaces();
      rows = await cachedWorkspaces();
      matches = findMatches();
    }
    if (matches.length === 1) {
      const found = matches[0].workspace;
      if (!found.customerId && record.customerId) {
        const linked = { ...found, customerId: record.customerId };
        await saveWorkspaceLocally(linked, found);
        return linked;
      }
      return found;
    }
    if (matches.length > 1) throw new Error("More than one record matches. Open the row with the correct job number.");
    const workspace = record.directory ? workspaceFromDirectory(record.directory) : createWorkspace();
    if (!record.directory) Object.assign(workspace.record.customer, {
      customerName: record.name, mainPhone: record.phone, email: record.email, lossAddress: record.address,
    });
    workspace.customerId = record.customerId;
    await saveWorkspaceLocally(workspace);
    return workspace;
  });
  opening = next.catch(() => undefined);
  return next;
}
