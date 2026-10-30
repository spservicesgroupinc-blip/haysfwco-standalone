import { test, expect, type Page } from "@playwright/test";
import type { ChangeRequest, RequestStatus } from "../src/types";

const apiRoute = /\/__api__(?:\?|$)|https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/;

function request(id: string, status: RequestStatus = "submitted", customer = "York Ridge Apartments"): ChangeRequest {
  return {
    schemaVersion: 2, id, revision: 1, status,
    createdAt: "2026-10-01T12:00:00.000Z", updatedAt: "2026-10-01T12:00:00.000Z",
    submittedAt: "2026-10-01T12:00:00.000Z", estimatorName: status === "submitted" ? "" : "Jamie Estimator",
    informationQuestion: status === "needs_information" ? "What is the exact square footage?" : "",
    requestType: "change_order", customerCredits: false,
    job: {
      customer, customerPhone: "260-555-0144", customerEmail: "dana@example.com",
      address: "1200 York St, Fort Wayne, IN 46802", jobNumber: `F-26-${id}`,
      projectManager: "Dana Whitfield", branchName: "Hays + Sons Complete Restoration",
      branchAddress: "909 Production Road, Fort Wayne, IN 46808", branchPhone: "1-260-471-9110",
      branchContact: "", carrier: "", claim: "", orderNumber: "CO-01", date: "2026-10-01",
      insuranceRelated: true, originalContract: "167045.81", previousChanges: "0.00", addedDays: "0",
    },
    requestedChanges: [{ id: `change-${id}`, room: "Kitchen", action: "add", description: "Wet insulation behind the kitchen wall", reason: "Hidden damage", measurements: "", materials: "", scheduleImpact: "" }],
    attachments: [],
  };
}

function summary(value: ChangeRequest) {
  return { ...value, changesCount: value.requestedChanges.length, attachmentsCount: value.attachments.length };
}

async function installApi(page: Page, seeds = [request("r1")], failures: {
  claim?: boolean;
  claimConflict?: boolean;
  beforeOpen?: () => Promise<void>;
  beforeClaim?: () => Promise<void>;
} = {}) {
  const requests = new Map(seeds.map(value => [value.id, structuredClone(value)]));
  const writes: { action: string; body: Record<string, any> }[] = [];
  const violations: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()); });
  const mutations = new Map<string, ChangeRequest>();
  await page.route(apiRoute, async route => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    const body: Record<string, any> = incoming.method() === "POST" ? JSON.parse(incoming.postData() || "{}") : {};
    const action = String(body.action || url.searchParams.get("action") || "");
    const respond = (value: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
    if (action === "bootstrap" || action === "listRequests") return respond({ ok: true, requests: [...requests.values()].map(summary), jobs: [] });
    if (action === "openRequest") {
      await failures.beforeOpen?.();
      return respond({ ok: true, request: requests.get(String(body.id || url.searchParams.get("id"))) });
    }
    if (action === "saveWorkspace") return respond({ ok: true, workspace: { ...body.workspace, revision: body.expectedRevision + 1 } });
    if (action === "linkRequestWorkspace") {
      const current = requests.get(body.id)!;
      const linked = { ...current, workspaceId: body.workspaceId, revision: current.revision + 1 };
      requests.set(current.id, linked);
      return respond({ ok: true, request: linked });
    }
    if (["claimRequest", "saveRequest", "transitionRequest"].includes(action)) {
      writes.push({ action, body });
      if (action === "claimRequest") await failures.beforeClaim?.();
      if (action === "claimRequest" && failures.claimConflict) {
        failures.claimConflict = false;
        const current = requests.get(body.id)!;
        requests.set(current.id, { ...current, status: "in_review", revision: current.revision + 1, estimatorName: "Another estimator" });
        return respond({ ok: false, code: "CONFLICT", error: "Another estimator has started reviewing this request." });
      }
      if (action === "claimRequest" && failures.claim) {
        failures.claim = false;
        return respond({ ok: false, code: "SERVICE_ERROR", error: "Review could not be started. Please retry." });
      }
      if (mutations.has(body.mutationId)) return respond({ ok: true, request: mutations.get(body.mutationId) });
      const current = requests.get(String(body.id || body.request?.id));
      const invalid = !current ? "Request missing" : body.expectedRevision !== current.revision ? "A newer revision exists." : action === "claimRequest" && (current.status !== "submitted" || !String(body.estimatorName || "").trim()) ? "Invalid claim" : action === "saveRequest" && (body.request.status !== current.status || body.request.estimatorName !== current.estimatorName) ? "Save changed workflow fields" : action === "transitionRequest" && (["completed", "needs_information"].includes(body.status) && current.status !== "in_review") ? "Invalid status transition" : "";
      if (invalid) {
        violations.push(`${action}: ${invalid}`);
        return respond({ ok: false, code: "CONFLICT", error: invalid });
      }
      let next = structuredClone(current!);
      if (action === "claimRequest") next = { ...next, status: "in_review", estimatorName: body.estimatorName };
      if (action === "saveRequest") next = structuredClone(body.request);
      if (action === "transitionRequest") next = { ...next, status: body.status, informationQuestion: body.status === "needs_information" ? body.question : "" };
      next = { ...next, revision: current!.revision + 1, updatedAt: new Date().toISOString() };
      requests.set(next.id, next);
      mutations.set(body.mutationId, next);
      return respond({ ok: true, request: next });
    }
    if (action === "getCustomerReference") return respond({ ok: true, reference: { customers: [], updatedAt: "", updatedBy: "", fileName: "", version: "1" } });
    return respond({ ok: true, jobs: [], customers: [], workspaces: [], activities: [], tasks: [] });
  });
  return { requests, writes, violations, errors };
}

const dashboard = (page: Page) => page.getByRole("heading", { name: "Estimator dashboard", exact: true });
const queue = (page: Page) => page.getByRole("region", { name: "Estimator request queue" });
const filters = (page: Page) => page.getByRole("group", { name: "Filter estimator requests" });
const openRequest = (page: Page, customer = "York Ridge Apartments", id = "r1") => page.getByRole("button", { name: `Review request for ${customer} F-26-${id}`, exact: true });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("Estimator tab opens a dedicated request dashboard", async ({ page }) => {
  const api = await installApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Estimator", exact: true }).click();
  await expect(dashboard(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/estimator");
  await expect(openRequest(page)).toBeVisible();
  expect(api.writes).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("submitted requests open directly in the editor and save before completion", async ({ page }) => {
  const api = await installApi(page);
  await page.goto("/#/estimator");
  await openRequest(page).click();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  await expect(page.getByLabel("Estimator name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start work", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toBeDisabled();
  await page.getByLabel("Description 1", { exact: true }).fill("Replace 120 square feet of wet kitchen insulation.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toBeEnabled();
  expect(api.requests.get("r1")?.requestedChanges[0].description).toBe("Replace 120 square feet of wet kitchen insulation.");
  expect(api.requests.get("r1")?.estimatorName).toBe("Estimating team");
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await expect(page.getByText("This change order is finished and kept in the log for reference.")).toBeVisible();
  await page.getByRole("button", { name: "Back to estimator", exact: true }).click();
  await expect(dashboard(page)).toBeVisible();
  await expect(openRequest(page)).toHaveCount(0);
  await filters(page).getByRole("button", { name: /^Completed/ }).click();
  await expect(page.getByRole("button", { name: "View completed request for York Ridge Apartments F-26-r1", exact: true })).toBeVisible();
  expect(api.requests.get("r1")?.status).toBe("completed");
  expect(api.requests.get("r1")?.revision).toBe(4);
  expect(api.violations).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("filters, search, request ordering, refresh, and no matches use the same queue", async ({ page }) => {
  const older = request("r1", "submitted", "Oldest submission");
  const newer = { ...request("r2", "submitted", "Newest submission"), createdAt: "2026-10-02T12:00:00.000Z" };
  const api = await installApi(page, [newer, request("r3", "completed", "Completed project"), request("r4", "in_review", "Active review"), older]);
  await page.goto("/#/estimator");
  await expect(queue(page).getByRole("button")).toHaveCount(3);
  await expect(queue(page).getByRole("button").first()).toHaveAccessibleName("Review request for Oldest submission F-26-r1");
  await expect(filters(page).getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "true");
  await filters(page).getByRole("button", { name: /^Submitted/ }).click();
  await expect(queue(page).getByRole("button")).toHaveCount(2);
  await page.getByLabel("Search estimator requests").fill("f-26-r2");
  await expect(openRequest(page, "Newest submission", "r2")).toBeVisible();
  await expect(queue(page).getByRole("button")).toHaveCount(1);
  await page.getByLabel("Search estimator requests").fill("unmatched customer");
  await expect(page.getByRole("heading", { name: "No matching requests" })).toBeVisible();
  await page.getByRole("button", { name: "Show all requests", exact: true }).click();
  await expect(queue(page).getByRole("button")).toHaveCount(4);
  api.requests.set("r5", request("r5", "submitted", "New field request"));
  await page.getByRole("button", { name: "Refresh requests", exact: true }).click();
  await expect(openRequest(page, "New field request", "r5")).toBeVisible();
  expect(api.writes).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("empty dashboard explains where new requests appear", async ({ page }) => {
  const api = await installApi(page, []);
  await page.goto("/#/estimator");
  await expect(dashboard(page)).toBeVisible();
  await expect(page.getByRole("heading", { name: "No submitted requests yet", exact: true })).toBeVisible();
  await expect(page.getByText("Requests sent from New request appear here for the estimating team.", { exact: true })).toBeVisible();
  expect(api.errors).toEqual([]);
});

test("a failed automatic claim remains retryable without editing an unclaimed request", async ({ page }) => {
  const api = await installApi(page, [request("r1")], { claim: true });
  await page.goto("/#/estimator");
  await openRequest(page).click();
  await expect(page.getByText("Review could not be started. Please retry.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toHaveCount(0);
  expect(api.requests.get("r1")?.status).toBe("submitted");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  expect(api.requests.get("r1")?.status).toBe("in_review");
  expect(api.violations).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("existing reviews preserve their estimator and do not claim again after reload", async ({ page }) => {
  const api = await installApi(page, [request("r1", "in_review")]);
  await page.goto("/#/estimator");
  await openRequest(page).click();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#/estimator/r1");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  await page.goBack();
  await expect(dashboard(page)).toBeVisible();
  expect(api.requests.get("r1")?.estimatorName).toBe("Jamie Estimator");
  expect(api.writes).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("retrying a concurrent claim opens the latest review without reassigning its estimator", async ({ page }) => {
  const api = await installApi(page, [request("r1")], { claimConflict: true });
  await page.goto("/#/estimator");
  await openRequest(page).click();
  await expect(page.getByText("Another estimator has started reviewing this request.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  expect(api.requests.get("r1")?.estimatorName).toBe("Another estimator");
  expect(api.writes.filter(write => write.action === "claimRequest")).toHaveLength(1);
  expect(api.violations).toEqual([]);
  expect(api.errors).toEqual([]);
});

for (const delayedAction of ["openRequest", "claimRequest"] as const) {
  test(`leaving while ${delayedAction} is pending stays on Home after the response arrives`, async ({ page }) => {
    const started = deferred();
    const release = deferred();
    const pause = () => { started.resolve(); return release.promise; };
    const api = await installApi(page, [request("r1")], delayedAction === "openRequest" ? { beforeOpen: pause } : { beforeClaim: pause });
    await page.goto("/#/estimator");
    await openRequest(page).click();
    await started.promise;
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("status", { name: "Opening request…", exact: true })).toHaveCount(0);
    const response = page.waitForResponse(value => value.request().method() === (delayedAction === "openRequest" ? "GET" : "POST") && (delayedAction === "openRequest" ? value.url().includes("action=openRequest") : value.request().postData()?.includes('"action":"claimRequest"') === true));
    release.resolve();
    await response;
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#/");
    if (delayedAction === "openRequest") expect(api.writes).toEqual([]);
    expect(api.violations).toEqual([]);
    expect(api.errors).toEqual([]);
  });
}

test("an estimator can save notes then request missing information", async ({ page }) => {
  const api = await installApi(page);
  await page.goto("/#/estimator/r1");
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  await page.getByLabel("Description 1", { exact: true }).fill("Kitchen insulation needs quantities confirmed.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Request more information", exact: true }).click();
  await page.getByLabel("Information request", { exact: true }).fill("Please confirm square footage.");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "More information needed", exact: true })).toBeVisible();
  expect(api.requests.get("r1")?.informationQuestion).toBe("Please confirm square footage.");
  expect(api.requests.get("r1")?.status).toBe("needs_information");
  expect(api.requests.get("r1")?.requestedChanges[0].description).toBe("Kitchen insulation needs quantities confirmed.");
  expect(api.violations).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("waiting requests and completed records open without changing their status", async ({ page }) => {
  const api = await installApi(page, [request("r1", "needs_information"), request("r2", "completed", "Finished job")]);
  await page.goto("/#/estimator");
  await openRequest(page).click();
  await expect(page.getByRole("heading", { name: "More information needed", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to estimator", exact: true }).click();
  await filters(page).getByRole("button", { name: /^Completed/ }).click();
  await page.getByRole("button", { name: "View completed request for Finished job F-26-r2", exact: true }).click();
  await expect(page.getByText("This change order is finished and kept in the log for reference.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit request", exact: true })).toHaveCount(0);
  expect(api.writes).toEqual([]);
  expect(api.requests.get("r1")?.status).toBe("needs_information");
  expect(api.requests.get("r2")?.status).toBe("completed");
  expect(api.errors).toEqual([]);
});

test("leaving the estimator editor preserves unsaved changes when discard is declined", async ({ page }) => {
  const api = await installApi(page, [request("r1", "in_review")]);
  await page.goto("/#/estimator/r1");
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  await page.getByLabel("Description 1", { exact: true }).fill("Unsaved estimating notes");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Back to estimator", exact: true }).click();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Unsaved estimating notes");
  expect(new URL(page.url()).hash).toBe("#/estimator/r1");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Back to estimator", exact: true }).click();
  await expect(dashboard(page)).toBeVisible();
  expect(api.requests.get("r1")?.requestedChanges[0].description).toBe("Wet insulation behind the kitchen wall");
  expect(api.writes).toEqual([]);
  expect(api.errors).toEqual([]);
});

test("linking a job while editing keeps the link and retains the older draft as a conflict", async ({ page }) => {
  const api = await installApi(page, [request("r1", "in_review")]);
  await page.goto("/#/estimator/r1");
  await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
  await page.getByLabel("Description 1", { exact: true }).fill("Unsaved notes before connecting the job");
  await page.getByRole("button", { name: "Connect job details & documents", exact: true }).click();
  await page.getByLabel("Shared job", { exact: true }).selectOption("new");
  await page.getByRole("button", { name: "Connect to job", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open job details & documents →", exact: true })).toBeVisible();
  const workspaceId = api.requests.get("r1")?.workspaceId;
  expect(workspaceId).toBeTruthy();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "A newer revision exists." })).toBeVisible();
  await expect(page.getByLabel("Description 1", { exact: true })).toHaveValue("Unsaved notes before connecting the job");
  await expect(page.getByRole("button", { name: "Reload latest request", exact: true })).toBeVisible();
  expect(api.requests.get("r1")?.workspaceId).toBe(workspaceId);
  expect(api.requests.get("r1")?.requestedChanges[0].description).toBe("Wet insulation behind the kitchen wall");
  expect(api.violations).toEqual(["saveRequest: A newer revision exists."]);
  expect(api.errors).toEqual([]);
});

for (const width of [320, 390, 768, 861, 1024, 1120, 1440]) {
  test(`Estimator navigation and dashboard fit a ${width}px viewport`, async ({ page }) => {
    const api = await installApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Estimator", exact: true }).click();
    await expect(dashboard(page)).toBeVisible();
    await expect(openRequest(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const box = await openRequest(page).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBeTruthy();
    await page.screenshot({ path: `tmp/estimator-${width}.png`, fullPage: true });
    if (width === 320 || width === 1440) {
      await openRequest(page).click();
      await expect(page.getByRole("heading", { name: "Edit request", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `tmp/estimator-editor-${width}.png`, fullPage: true });
    }
    expect(api.errors).toEqual([]);
  });
}
