import type { RequestSummary } from "../types";
import { normalizeJobNumber } from "../workspaces/model";
import { customerNameKey } from "./customerDirectory";

export interface RecordIdentity {
  id: string;
  jobNumber: string;
  name: string;
  address: string;
}

/** Honor explicit links; older unlinked work can be found without rewriting history. */
export function requestBelongsToRecord(
  request: { workspaceId?: string; job: Pick<RequestSummary["job"], "jobNumber" | "customer" | "address"> },
  record: RecordIdentity,
): boolean {
  if (request.workspaceId) return request.workspaceId === record.id;
  const number = normalizeJobNumber(record.jobNumber);
  const requestNumber = normalizeJobNumber(request.job.jobNumber);
  if (number || requestNumber) return !!number && number === requestNumber;
  return !!customerNameKey(record.name) && !!customerNameKey(record.address) &&
    customerNameKey(request.job.customer) === customerNameKey(record.name) &&
    customerNameKey(request.job.address) === customerNameKey(record.address);
}
