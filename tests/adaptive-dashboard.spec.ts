import { test, expect } from "@playwright/test";

test("phone home stays focused and adapts to desktop without losing a request draft", async ({ page }) => {
  const requests = Array.from({ length: 7 }, (_, index) => ({
    id: `mobile-${index}`, revision: 1,
    createdAt: "2026-10-20T12:00:00Z", updatedAt: `2026-10-${26 - index}T12:00:00Z`,
    status: index === 0 ? "needs_information" : index === 6 ? "completed" : "submitted",
    estimatorName: "", changesCount: 1, attachmentsCount: 0,
    job: { customer: `Customer ${index + 1}`, jobNumber: `FW-26-${index}`, projectManager: "Jordan", address: "120 Main St", orderNumber: "" },
  }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/, route => {
    const request = route.request();
    const body = request.method() === "POST" ? JSON.parse(request.postData() || "{}") : Object.fromEntries(new URL(request.url()).searchParams);
    const result = body.action === "bootstrap" || body.action === "listRequests" ? { requests, jobs: [] }
      : body.action === "listCustomers" ? { customers: [] }
      : body.action === "listWorkspaces" ? { workspaces: [] }
      : body.action === "listTasks" ? { tasks: [] }
      : body.action === "getCustomerReference" ? { reference: null } : {};
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, ...result }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const home = page.getByRole("region", { name: "Phone home" });
  await expect(home).toBeVisible();
  await expect(home.getByRole("button", { name: /New request/ })).toBeVisible();
  expect((await home.getByRole("button", { name: /New request/ }).boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await expect(home.getByRole("button", { name: /^Open request/ })).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Operations overview" })).toBeHidden();
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  await expect(nav.getByRole("button", { name: "Requests", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Jobs", exact: true })).toBeVisible();
  for (const width of [320, 768, 860]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(home).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Company overview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Operations overview" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: "Operations overview" })).toBeHidden();
  for (const width of [861, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(home).toBeHidden();
    await expect(page.getByRole("region", { name: "Operations overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Operations overview" })).toBeHidden();
  await nav.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page).toHaveURL(/#\/review$/);
  await expect(page.getByRole("heading", { name: "Requests", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "Jobs", exact: true }).click();
  await expect(page).toHaveURL(/#\/workspaces$/);
  await nav.getByRole("button", { name: "New request", exact: true }).click();
  const note = page.getByRole("textbox", { name: "What changed?", exact: true });
  await note.fill("Keep this scope when the screen changes size.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(note).toHaveValue("Keep this scope when the screen changes size.");
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(note).toHaveValue("Keep this scope when the screen changes size.");
  expect(errors).toEqual([]);
});
