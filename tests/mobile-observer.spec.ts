import { expect, test } from "@playwright/test";
import { CloudFixture, SESSION_ID } from "./helpers/cloudFixture";

test("phone overview fits the screen and bottom views preserve session and safety states", async ({
  page,
  context,
}, testInfo) => {
  const fixture = new CloudFixture();
  await fixture.install(context);
  await page.route(/https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//, (r) =>
    r.abort(),
  );
  await page.goto("/");
  await page.getByLabel("Telemetry source").selectOption("cloud");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("observer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("#cloud-session")).toHaveValue(SESSION_ID);
  await page.setViewportSize({ width: 390, height: 844 });
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  const overview = page.getByLabel("Mobile session overview", { exact: true });
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("article")).toHaveCount(3);
  await expect(overview).toContainText("2.14 g");
  const bounds = await overview.boundingBox();
  const navBounds = await nav.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(navBounds!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 375, height: 667 });
  const compactBounds = await overview.boundingBox();
  const compactNavBounds = await nav.boundingBox();
  expect(compactBounds!.y + compactBounds!.height).toBeLessThan(
    compactNavBounds!.y,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("phone-overview.png"),
    fullPage: true,
  });
  for (const view of ["GPS", "IMUs", "Events", "Settings", "Overview"]) {
    await nav.getByRole("button", { name: view, exact: true }).click();
    await expect(
      nav.getByRole("button", { name: view, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#cloud-session")).toHaveValue(SESSION_ID);
    if (view === "GPS")
      await expect(page.getByLabel("Recorded GPS instruments")).toBeVisible();
    if (view === "IMUs") {
      await expect(
        page.getByLabel("IMU 2 event status", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("IMU 2 event status", { exact: true }),
      ).toContainText("Current: Unknown");
    }
    if (view === "Events") {
      await expect(page.getByLabel("Event analysis filters")).toBeVisible();
      await page
        .getByRole("button", { name: "Session history", exact: true })
        .click();
      await expect(
        page.getByLabel("Session review", { exact: true }),
      ).toBeVisible();
    }
    if (view === "Settings") {
      await expect(
        page.getByLabel("Cloud driving session", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save thresholds", exact: true }),
      ).toHaveCount(0);
    }
    await expect(page.locator(".mobile-connection-strip")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await context.setOffline(true);
  for (const view of ["Overview", "GPS", "IMUs", "Events", "Settings"]) {
    await nav.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(".mobile-connection-strip")).toContainText(
      "Offline · Live updates unconfirmed",
    );
    await expect(page.locator(".mobile-connection-strip")).toContainText(
      "GPS unavailable",
    );
  }
  await context.setOffline(false);
  await nav.getByRole("button", { name: "GPS", exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(nav).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(nav).toBeHidden();
  await expect(
    page.getByRole("navigation", { name: "Cloud navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Live GPS route", exact: true }),
  ).toBeVisible();
});
