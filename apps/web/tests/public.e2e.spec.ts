import { expect, test } from "@playwright/test";

test("public navigation and disclosures load", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Clarity before capital/i })).toBeVisible();
  await page.getByRole("link", { name: "Risk" }).click();
  await expect(page.getByRole("heading", { name: /Investment outcomes are uncertain/i })).toBeVisible();
});

test("login form exposes the demonstration boundary", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/Local demo accounts/i)).toBeVisible();
});
