import { test, expect } from "@playwright/test";
import { CloudFixture } from "./helpers/cloudFixture";
test("GPS instruments support time windows and fit mobile", async ({
  page,
  context,
}) => {
  const fixture = new CloudFixture();
  await fixture.install(context);
  await page.route(/https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//, (r) =>
    r.abort(),
  );
  await page.goto("/");
  await page.getByLabel("Telemetry source").selectOption("cloud");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Recorded GPS instruments")).toBeVisible();
  await page.getByLabel("GPS chart window").selectOption("10");

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation", { name: "Phone navigation" })
    .getByRole("button", { name: "GPS", exact: true })
    .click();
  await expect(page.getByLabel("Recorded GPS instruments")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
