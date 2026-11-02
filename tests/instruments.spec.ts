import { test, expect } from "@playwright/test";
import { CloudFixture } from "./helpers/cloudFixture";
import { signInObserver, view } from "./helpers/observerUi";
test("single GPS instruments retain selectable time windows and fit a phone", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signInObserver(page);
  await view(page, "GPS");
  await page.getByRole("button", { name: "Speed", exact: true }).click();
  await page.getByLabel("GPS chart window").selectOption("10");
  await expect(page.getByRole("img", { name: /Speed:/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Recorded GPS instruments")).toBeVisible();
  await page.getByRole("button", { name: "Accuracy", exact: true }).click();
  await expect(page.getByLabel("GPS chart window")).toHaveValue("10");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
});
