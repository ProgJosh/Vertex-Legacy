import { expect, test } from "@playwright/test";

test("public navigation and disclosures load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clarity before capital/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Risk" })).toHaveAttribute(
    "href",
    "/risk-disclosure",
  );
  await page.goto("/risk-disclosure");
  await expect(page.getByRole("heading", { name: /Investment outcomes are uncertain/i })).toBeVisible();
});

test("login form exposes the demonstration boundary", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/Local demo accounts/i)).toBeVisible();
});

test("company plans render the API-backed VIP and commission schedules", async ({ page }) => {
  await page.goto("/plans");

  const schedule = page.locator(".company-plans-table");
  await expect(
    schedule.getByText("Company VIP plan schedule · 10 tiers"),
  ).toBeVisible();
  await expect(schedule.locator("tbody tr")).toHaveCount(10);
  const firstTier = schedule.locator("tbody tr").first();
  await expect(firstTier).toContainText("VIP 1");
  await expect(firstTier).toContainText("₱250.00");
  await expect(firstTier).toContainText("₱20.00");
  await expect(firstTier).toContainText("60");
  await expect(firstTier).toContainText("₱1,200.00");

  const lastTier = schedule.locator("tbody tr").last();
  await expect(lastTier).toContainText("VIP 10");
  await expect(lastTier).toContainText("₱15,000.00");
  await expect(lastTier).toContainText("₱1,180.00");
  await expect(lastTier).toContainText("60");
  await expect(lastTier).toContainText("₱70,800.00");

  const levels = page.locator(".company-plans-level-grid");
  await expect(levels).toContainText("Level 1");
  await expect(levels).toContainText("27%");
  await expect(levels).toContainText("Level 2");
  await expect(levels).toContainText("2%");
  await expect(levels).toContainText("Level 3");
  await expect(levels).toContainText("1%");
  await expect(levels).not.toContainText("not credited");
});

test("manual cash-in offers only GCash and Maya and shows a QR for GCash only", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue securely" }).click();
  await page.waitForURL(/\/investor(?:\/|$)/);

  await page.goto("/investor/cash-in", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "Fund with GCash or Maya." })).toBeVisible();
  await expect(page.getByRole("radio", { name: /GCash/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Maya/ })).toBeVisible();

  await page.getByLabel("Cash-in amount (PHP)").fill("250");
  await page.getByRole("button", { name: "Continue with GCash" }).click();
  await expect(page.getByText("09171234567")).toBeVisible();
  await expect(page.getByAltText("GCash payment QR supplied by Vertex Legacy")).toBeVisible();

  await page.goto("/investor/cash-in", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByText("Maya", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Maya/ })).toBeChecked();
  await page.getByLabel("Cash-in amount (PHP)").fill("250");
  await page.getByRole("button", { name: "Continue with Maya" }).click();
  await expect(page.getByText("09981234567")).toBeVisible();
  await expect(page.getByAltText("GCash payment QR supplied by Vertex Legacy")).toHaveCount(0);
  await expect(page.getByText("Awaiting transfer")).toBeVisible();
});
