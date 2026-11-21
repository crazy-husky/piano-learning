import { expect, test } from "@playwright/test";

test("renders the app shell at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route("**/client/piano-learning/analytics.js", (route) =>
    route.fulfill({ body: "", contentType: "application/javascript" })
  );
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.locator("main")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("main")).toBeVisible();
});
