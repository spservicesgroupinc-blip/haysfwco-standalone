import { test, expect, type Page } from "@playwright/test";
import { mockBackend } from "./helpers/backend";
import { parseCustomerCsv } from "../src/documents/services/customerReference";

const csv = "Status,Job Number,Customer,Customer Main Phone,Customer Email,Job Address,Loss City,Loss State,Loss ZIP,Estimator,ForePerson,Supervisor,Estimate Amount,Total Contract Sales,Insurance Carrier,Claim Number,Date Inspected\nWork in Progress,FW-AUTO-1,Automatic Customer,260-555-0123,auto@example.test,100 Test St,Fort Wayne,IN,46802,CSV Estimator,CSV Foreperson,CSV Supervisor,999.99,1234.56,CSV Carrier,CLAIM-AUTO-1,10/12/2026 12:00:00";

async function sandbox(page: Page) {
  const backend = mockBackend();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) && !url.pathname.includes("__api__")) return route.continue();
    if (!["fetch", "xhr"].includes(request.resourceType())) return route.abort();
    const body = request.method() === "POST" ? JSON.parse(request.postData() || "{}") : Object.fromEntries(url.searchParams);
    const result = request.method() === "POST" ? backend.post(body) : backend.get(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  return { backend, errors };
}

test("a recovered device draft picks up a corrected CSV contract before submission", async ({ page }) => {
  const { backend, errors } = await sandbox(page);
  const unknown = parseCustomerCsv(csv).customers.map(customer => ({ ...customer, contractPrice: null }));
  expect(backend.post({ action: "replaceCustomerReference", customers: unknown, fileName: "old.csv" }).ok).toBe(true);
  await page.goto("/#/simple");
  await page.getByRole("combobox").fill("FW-AUTO-1");
  await expect(page.locator(".sr-summary")).toContainText("Not provided");
  await page.getByLabel("What changed?", { exact: true }).fill("Keep this unfinished request and its scope.");
  await expect(page.locator(".sr-draft-status")).toContainText("Draft saved on this device");
  await page.goto("/#/workspaces?tool=reference");
  await page.getByLabel("Choose customer CSV", { exact: true }).setInputFiles({ name: "corrected.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Replace knowledge base", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved 1 customer/job rows" })).toBeVisible();
  await page.goto("/#/review");
  await page.getByRole("button", { name: "Resume draft", exact: true }).click();
  await expect(page.locator(".sr-summary")).toContainText("$1,234.56");
  await expect(page.getByLabel("What changed?", { exact: true })).toHaveValue("Keep this unfinished request and its scope.");
  await page.getByRole("button", { name: "Send to estimating", exact: true }).click();
  await expect.poll(() => backend.get({ action: "listRequests" }).requests.length).toBe(1);
  const summary = backend.get({ action: "listRequests" }).requests[0];
  expect(backend.get({ action: "openRequest", id: summary.id }).request.job.originalContract).toBe("1234.56");
  expect(errors).toEqual([]);
});

for (const entrypoint of ["reference", "jobs"]) {
  test(`${entrypoint} CSV automatically connects customers, quick requests and new job details`, async ({ page }) => {
    const { backend, errors } = await sandbox(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(entrypoint === "reference" ? "/#/workspaces?tool=reference" : "/#/jobs");
    if (entrypoint === "reference") {
      await page.getByLabel("Choose customer CSV", { exact: true }).setInputFiles({ name: "jobs.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Replace knowledge base", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved 1 customer/job rows" })).toBeVisible();
    } else {
      await page.getByLabel("Paste job report CSV").fill(csv);
      await page.getByRole("button", { name: "Import 1 job", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Successfully imported 1 jobs");
    }
    expect(backend.post({ action: "listCustomers" }).customers).toHaveLength(1);
    // Navigate within this app so the upload event, rather than a reload, supplies the lookup.
    await page.getByRole("button", { name: "New request", exact: true }).first().click();
    await page.getByRole("combobox").fill("FW-AUTO-1");
    await expect(page.locator(".sr-summary")).toContainText("260-555-0123");
    await expect(page.locator(".sr-summary")).toContainText("100 Test St");
    await expect(page.locator(".sr-summary")).toContainText("$1,234.56");
    if (entrypoint === "reference") {
      await page.screenshot({ path: "tmp/csv-contract-mobile.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: "tmp/csv-contract-desktop.png", fullPage: true });
    }
    await page.getByLabel("What changed?", { exact: true }).fill("Add the requested pantry shelving.");
    await page.getByRole("button", { name: "Send to estimating", exact: true }).click();
    await expect.poll(() => backend.get({ action: "listRequests" }).requests.length).toBe(1);
    const summary = backend.get({ action: "listRequests" }).requests[0];
    const submitted = backend.get({ action: "openRequest", id: summary.id }).request;
    expect(submitted.job).toMatchObject({
      originalContract: "1234.56", customer: "Automatic Customer", jobNumber: "FW-AUTO-1",
      customerPhone: "260-555-0123", customerEmail: "auto@example.test",
      projectManager: "CSV Foreperson", branchContact: "CSV Estimator",
      carrier: "CSV Carrier", claim: "CLAIM-AUTO-1",
    });
    expect(submitted.workspaceId).toBeTruthy();
    expect(submitted.customerId).toBeTruthy();
    await page.goto(`/#/requests/${submitted.id}`);
    await page.getByRole("button", { name: "Edit request", exact: true }).click();
    await expect(page.getByLabel("Original contract amount", { exact: true })).toHaveValue("1234.56");
    await page.goto("/#/workspaces");
    await expect(page.locator(".workspace-list-row").filter({ hasText: "FW-AUTO-1" })).toHaveCount(1);
    await page.locator(".workspace-list-row").filter({ hasText: "FW-AUTO-1" }).click();
    await expect(page).toHaveURL(new RegExp(submitted.workspaceId));
    await expect(page.getByRole("region", { name: "Job dashboard", exact: true })).toContainText("Recent changes");
    await expect(page.locator(".job-dashboard-stats").getByRole("button", { name: "1 Changes", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open documents", exact: true }).click();
    await expect(page.getByRole("region", { name: "Change order documents", exact: true })).toContainText("CO-01");
    const welcome = page.locator(".workspace-document-card").filter({ has: page.getByRole("heading", { name: "Customer Welcome Letter", exact: true }) });
    await welcome.getByRole("button", { name: "Save to job", exact: true }).click();
    await expect(page.locator(".workspace-panel").filter({ has: page.getByRole("heading", { name: "Saved document history", exact: true }) })).toContainText("Welcome");
    await page.reload();
    await expect(page.getByRole("region", { name: "Job dashboard", exact: true })).toContainText("Welcome");
    await page.screenshot({ path: `tmp/record-dashboard-${entrypoint}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("navigation", { name: "Job sections" }).getByRole("button", { name: "Job Details", exact: true }).click();
    await expect(page.getByLabel("Main phone", { exact: true })).toHaveValue("260-555-0123");
    await expect(page.getByLabel("Customer name", { exact: false })).toHaveValue("Automatic Customer");
    await expect(page.getByLabel("Loss address", { exact: false })).toHaveValue("100 Test St, Fort Wayne IN 46802");
    await expect(page.getByLabel("Original contract amount", { exact: true })).toHaveValue("1234.56");
    expect(errors).toEqual([]);
  });
}


test("starting a request creates its job dashboard and the device draft resumes there", async ({ page }) => {
  const { backend, errors } = await sandbox(page);
  expect(backend.post({ action: "replaceCustomerReference", customers: parseCustomerCsv(csv).customers, fileName: "jobs.csv" }).ok).toBe(true);
  await page.goto("/#/simple");
  await page.getByRole("combobox").fill("FW-AUTO-1");
  await page.getByLabel("What changed?", { exact: true }).fill("Unfinished request for the job dashboard");
  await expect(page.locator(".sr-draft-status")).toContainText("Draft saved on this device");
  await expect.poll(() => backend.post({ action: "listWorkspaces" }).workspaces.length).toBe(1);
  const workspaceId = backend.post({ action: "listWorkspaces" }).workspaces[0].id;
  await page.goto("/#/customers");
  await page.locator(".workspace-list-row").filter({ hasText: "FW-AUTO-1" }).click();
  await expect(page).toHaveURL(new RegExp(workspaceId));
  await page.getByRole("region", { name: "Draft requests on this device", exact: true }).getByRole("button").click();
  await expect(page.getByLabel("What changed?", { exact: true })).toHaveValue("Unfinished request for the job dashboard");
  await page.getByRole("button", { name: "Send to estimating", exact: true }).click();
  await expect.poll(() => backend.get({ action: "listRequests" }).requests.length).toBe(1);
  expect(backend.get({ action: "listRequests" }).requests[0].workspaceId).toBe(workspaceId);
  expect(backend.post({ action: "listWorkspaces" }).workspaces).toHaveLength(1);
  expect(errors).toEqual([]);
});
