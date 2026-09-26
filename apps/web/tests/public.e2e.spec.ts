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
  await expect(firstTier).toContainText("₱40.00");
  await expect(firstTier).toContainText("60");
  await expect(firstTier).toContainText("₱2,400.00");

  const lastTier = schedule.locator("tbody tr").last();
  await expect(lastTier).toContainText("VIP 10");
  await expect(lastTier).toContainText("₱15,000.00");
  await expect(lastTier).toContainText("₱1,850.00");
  await expect(lastTier).toContainText("60");
  await expect(lastTier).toContainText("₱111,000.00");

  const levels = page.locator(".company-plans-level-grid");
  await expect(levels).toContainText("Level 1");
  await expect(levels).toContainText("27%");
  await expect(levels).toContainText("Level 2");
  await expect(levels).toContainText("2%");
  await expect(levels).toContainText("Level 3");
  await expect(levels).toContainText("1%");
  await expect(levels).not.toContainText("not credited");
});
