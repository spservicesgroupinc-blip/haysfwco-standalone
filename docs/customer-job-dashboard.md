# Customer and job dashboards

Uploaded CSV rows, permanent workspaces, and customer contacts appear in the same searchable Jobs & Customers directory. A job number identifies a job; one customer may have several jobs. Opening an imported row creates its permanent workspace, and repeated opens reuse it. Saved corrections take precedence over replacement CSV data.

Choosing a CSV job in Quick Request starts its permanent workspace in the background. Unfinished requests appear on its dashboard as device drafts. New Quick Requests create or reuse a workspace before the submission is saved on the device. Submission synchronizes that workspace before saving the request, as required by the existing Apps Script API. The durable submission keeps the workspace ID for retries. Requests started from a workspace inherit both workspace and customer IDs.

The job dashboard shows change requests, request attachments and customer PDFs, saved production documents, contact details, and existing customer activity and follow-ups. Older unlinked requests appear by matching job number; existing explicit links take precedence. Unnumbered requests require matching customer and property address. Historical request contents are not rewritten.

CSV replacement never deletes saved workspaces, requests, or document history. Existing Apps Script actions and schemas are used; this feature requires no backend schema change.

Verify with `npm run build`, `node --import tsx --test tests/record-requests.test.ts tests/unified-records.test.ts`, and `npx playwright test tests/customer-csv-autofill.spec.ts`.


## Background synchronization

Customer lists, contacts, activities, and tasks read IndexedDB first. A deduplicated background refresh updates them, at most once per 30 seconds for normal reads; explicit import identity checks can force refresh. Cloud data is cached in batches and only actual changes notify subscribers, preventing notification/fetch loops. The directory renders 50 records initially and keeps contact-management tools unloaded until opened.

All request, CRM, job, document, and reference-file calls use one Apps Script request queue. Saves take precedence over waiting directory reads; identical reads share a request. A browser lock coordinates tabs on the same origin. Request timeouts start when the execution actually begins, and script BUSY responses retry the same payload. Existing Apps Script locks remain responsible for coordinating other devices.

The job/document worker drains new saves queued during a running pass before completing. Document metadata refreshes independently from job detail refreshes and starts automatically when a new local job receives its server revision. Temporary refresh failures retry in the background with backoff; going online or returning to the app also resumes pending work. Conflicting edits still require review and never overwrite saved corrections automatically.

This synchronization update adds no backend schema, but the deployed script must include the CRM routes already present in `apps-script/Code.gs`. An October 27, 2026 read-only check of the default endpoint confirmed `listWorkspaces` and GET `listRequests` succeed while POST `listCustomers` returns `Unknown action`. Update the existing Apps Script deployment to the current source, preserving its URL and spreadsheet, before expecting customer synchronization to work. A GitHub push does not update Apps Script. See `docs/google-sheets-setup.md`. Application and real-device testing remain with the user.
