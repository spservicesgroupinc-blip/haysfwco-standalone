import type { Workspace } from "../../workspaces/types";

export const planOf = (job: Workspace) => ({
  stage: job.stage || "lead", manager: job.record.team.projectManager,
  start: job.record.checklist.startDate, finish: job.record.checklist.finishDate,
});

export function applyJobPlan(latest: Workspace, edited: ReturnType<typeof planOf>, baseline: ReturnType<typeof planOf>): Workspace {
  const current = planOf(latest);
  const normalized = { ...edited, manager: edited.manager.trim() };
  const merged = { ...current };
  for (const field of Object.keys(normalized) as (keyof typeof normalized)[]) {
    if (normalized[field] === baseline[field]) continue;
    if (current[field] !== baseline[field] && current[field] !== normalized[field])
      throw new Error("This job plan changed while you were editing. Cancel to review the latest plan before saving.");
    Object.assign(merged, { [field]: normalized[field] });
  }
  if (merged.start && merged.finish && merged.finish < merged.start)
    throw new Error("The target finish must be on or after the start date.");
  return { ...latest, stage: merged.stage,
    record: { ...latest.record, team: { ...latest.record.team, projectManager: merged.manager },
      checklist: { ...latest.record.checklist, startDate: merged.start, finishDate: merged.finish } } };
}
