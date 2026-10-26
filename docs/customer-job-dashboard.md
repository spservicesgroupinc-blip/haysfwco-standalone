# Customer and job dashboards

Uploaded CSV rows, permanent workspaces, and customer contacts appear in the same searchable Jobs & Customers directory. A job number identifies a job; one customer may have several jobs. Opening an imported row creates its permanent workspace, and repeated opens reuse it. Saved corrections take precedence over replacement CSV data.

Choosing a CSV job in Quick Request starts its permanent workspace in the background. Unfinished requests appear on its dashboard as device drafts. New Quick Requests create or reuse a workspace before the submission is saved on the device. Submission synchronizes that workspace before saving the request, as required by the existing Apps Script API. The durable submission keeps the workspace ID for retries. Requests started from a workspace inherit both workspace and customer IDs.

The job dashboard shows change requests, request attachments and customer PDFs, saved production documents, contact details, and existing customer activity and follow-ups. Older unlinked requests appear by matching job number; existing explicit links take precedence. Unnumbered requests require matching customer and property address. Historical request contents are not rewritten.

CSV replacement never deletes saved workspaces, requests, or document history. Existing Apps Script actions and schemas are used; this feature requires no backend schema change.

Verify with `npm run build`, `node --import tsx --test tests/record-requests.test.ts tests/unified-records.test.ts`, and `npx playwright test tests/customer-csv-autofill.spec.ts`.
