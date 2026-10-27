# Job dashboard management

The Overview page is the daily workspace for a job: tasks, notes, deadlines, owners, progress, and the next action. Keep the existing five job sections and the existing document/change-order paths. Use the established Hays colors and responsive layouts; tasks and the next action come before document history on phone screens.

## Included

- Job tasks with an owner and due date; edit, complete, and reopen tasks. Search and filter by status, overdue, today, and assignee.
- The next action is the earliest-due open task, including overdue work first. Undated work follows dated work. Task completion is labeled separately from job lifecycle status.
- Job plan: lifecycle stage, project manager, planned start, and target finish. Existing checklist dates and team fields remain authoritative, including in generated documents.
- Job notes and communication updates use the existing activity timeline, scoped to the permanent workspace ID.
- Customer-wide follow-ups remain separate and can be explicitly linked to the current job. General customer notes and complete customer history remain available.

## Persistence

Use existing CRM Tasks and Activities and existing workspace data. Both backend shapes already support workspaceId. Device saves and the background Apps Script queue remain in use; no new endpoint or backend deployment is needed. New task revisions anticipate their first server save so creating, editing, and completing work before cloud sync preserves the expected revision chain.

Task status remains open/done to keep the existing backend contract. No billing, crew scheduling, inventory, or additional top-level destination is introduced.

## Verification

Build with `npm run build`. Focused behavior checks: `node --import tsx --test tests/job-management.test.ts tests/crm-service.test.ts`. A browser smoke check is in `tests/job-management.spec.ts`. Broader application and real-device testing remain with the user.
