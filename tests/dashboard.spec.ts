import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  // Demonstrate that live simulation works with the bundled basemap and local fonts.
  await page.route(
    /https:\/\/(tile\.openstreetmap\.org|fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
    (route) => route.abort(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Every journey, in focus." }),
  ).toBeVisible();
});

test("streams moving GPS coordinates and all three acceleration axes without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("region", {
      name: "Live GPS map of the simulated vehicle in San Francisco",
    }),
  ).toBeVisible();
  const coordinates = page.locator(".vehicle-map__coordinates");
  await expect(coordinates).toHaveText(/37\.\d+° N, 122\.\d+° W/);
  const initial = await coordinates.textContent();
  await expect.poll(() => coordinates.textContent()).not.toBe(initial);
  for (const axis of ["Longitudinal", "Lateral", "Vertical"]) {
    const indicator = page
      .getByRole("article")
      .filter({ has: page.getByText(axis, { exact: true }) });
    await expect(indicator.locator(".axis-reading")).toHaveText(
      /[+-]\d+\.\d{2}g/,
    );
  }
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  await expect(page.getByText("Illustrated offline basemap")).toBeVisible();
  expect(errors).toEqual([]);
});

test("validates adjustable thresholds and applies warning and critical levels to the live feed", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Configure impact thresholds" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("spinbutton", { name: "T1 warning threshold" })
    .fill("2");
  await dialog
    .getByRole("spinbutton", { name: "T2 critical threshold" })
    .fill("1");
  await expect(dialog.getByRole("alert")).toHaveText("Use 0 < T1 < T2 ≤ 10 g.");
  await expect(
    dialog.getByRole("button", { name: "Save thresholds" }),
  ).toBeDisabled();
  await dialog
    .getByRole("spinbutton", { name: "T1 warning threshold" })
    .fill("0.5");
  await dialog
    .getByRole("spinbutton", { name: "T2 critical threshold" })
    .fill("2.5");
  await dialog.getByRole("button", { name: "Save thresholds" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".threshold-summary")).toContainText("0.5 g");
  await expect(page.locator(".threshold-summary")).toContainText("2.5 g");
  await page
    .getByRole("button", { name: "Simulate impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Moderate impact detected" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Configure impact thresholds" })
    .click();
  await dialog
    .getByRole("spinbutton", { name: "T2 critical threshold" })
    .fill("1.8");
  await dialog.getByRole("button", { name: "Save thresholds" }).click();
  await page
    .getByRole("button", { name: "Simulate impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "High impact detected" }),
  ).toBeVisible();
});

test("shows unavailable gray status and blocks impacts until the data feed reconnects", async ({
  page,
}) => {
  const feed = page.getByRole("switch", { name: "Simulated data feed" });
  await feed.click();
  await expect(feed).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("No data", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Waiting for data" }),
  ).toBeVisible();
  await expect(page.getByLabel("unavailable status")).toBeVisible();
  await expect(page.locator(".traffic-light .lit")).toHaveCount(0);
  await expect(page.getByText("Awaiting GPS data")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simulate impact", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".axis-reading")).toHaveText(["—g", "—g", "—g"]);
  await feed.click();
  await expect(feed).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simulate impact", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".vehicle-map__coordinates")).toHaveText(
    /37\.\d+° N/,
  );
});

test("logs an injected impact with timestamp and GPS, and filters by recorded severity", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Simulate impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "High impact detected" }),
  ).toBeVisible();
  const impactStat = page
    .getByRole("article")
    .filter({ has: page.getByText("Impacts detected", { exact: true }) });
  await expect(impactStat.locator(".stat-value")).toHaveText("01");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Impact events/ })
    .click();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(5); // Header, 3 seeded events, 1 current event.
  const newest = rows.nth(1);
  await expect(newest).toContainText("High impact");
  await expect(newest).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(newest).toContainText(/37\.\d{4}, -122\.\d{4}/);
  await expect(newest).toContainText("Simulated");
  await page
    .getByRole("combobox", { name: "Filter impact events" })
    .selectOption("warning");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("table")).not.toContainText("High impact");
  await page
    .getByRole("combobox", { name: "Filter impact events" })
    .selectOption("critical");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("table")).not.toContainText("Moderate");
});

test("new sessions preserve the completed drive and its impact count in history", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Simulate impact", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "High impact detected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const impactStat = page
    .getByRole("article")
    .filter({ has: page.getByText("Impacts detected", { exact: true }) });
  await expect(impactStat.locator(".stat-value")).toHaveText("00");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Driving sessions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Driving session history" }),
  ).toBeVisible();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(6); // Header + current + completed + three seeds.
  await expect(rows.nth(1)).toContainText("Recording");
  await expect(rows.nth(2)).toContainText("Completed");
  await expect(rows.nth(2).getByRole("cell").nth(3)).toHaveText("1");
});

test("automatic warning and critical pulses each create one event per excursion", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
  await page.reload();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const impactStat = page
    .getByRole("article")
    .filter({ has: page.getByText("Impacts detected", { exact: true }) })
    .locator(".stat-value");
  await expect(impactStat).toHaveText("00");
  await page.clock.runFor(31_500);
  await expect(impactStat).toHaveText("01");
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  await page.clock.runFor(30_000);
  await expect(impactStat).toHaveText("02");
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  // Multiple samples within one impact must not become multiple log entries.
  await page.clock.runFor(20_000);
  await expect(impactStat).toHaveText("02");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /Impact events/ })
    .click();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(1)).toContainText("High impact");
  await expect(rows.nth(2)).toContainText("Moderate");
});

test("missing telemetry pauses measured distance until fresh samples arrive", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
  await page.reload();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  const distanceStat = page
    .getByRole("article")
    .filter({ has: page.getByText("Distance traveled", { exact: true }) })
    .locator(".stat-value");
  await page.clock.runFor(5000);
  const distanceBeforeLoss = await distanceStat.textContent();
  await page.getByRole("switch", { name: "Simulated data feed" }).click();
  await page.clock.runFor(10_000);
  await expect(distanceStat).toHaveText(distanceBeforeLoss!);
  await page.getByRole("switch", { name: "Simulated data feed" }).click();
  await page.clock.runFor(5000);
  expect(await distanceStat.textContent()).not.toBe(distanceBeforeLoss);
});

test("exports a labeled JSON record with thresholds, sessions, and timestamped coordinates", async ({
  page,
}) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^msd-simulation-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const path = await download.path();
  expect(path).not.toBeNull();
  const data = JSON.parse(await readFile(path!, "utf8"));
  expect(data).toMatchObject({
    schemaVersion: 1,
    source: "simulation",
    thresholds: { t1: 0.8, t2: 1.8 },
  });
  expect(Number.isFinite(Date.parse(data.exportedAt))).toBe(true);
  expect(data.sessions).toHaveLength(4);
  expect(data.sessions[0]).toMatchObject({ endedAt: null, impactCount: 0 });
  expect(data.events).toHaveLength(3);
  expect(data.events[0]).toMatchObject({
    timestamp: expect.any(Number),
    position: { latitude: expect.any(Number), longitude: expect.any(Number) },
    severity: "critical",
  });
});

test("mobile layout fits a 390px screen and navigation and controls stay usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Every journey, in focus." }),
  ).toBeVisible();
  const pageFits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
  expect(await pageFits()).toBe(true);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await navigation.getByRole("button", { name: /Impact events/ }).click();
  await expect(
    page.getByRole("heading", { name: "Impact event log" }),
  ).toBeVisible();
  expect(await pageFits()).toBe(true);
  await navigation
    .getByRole("button", { name: "Driving sessions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Driving session history" }),
  ).toBeVisible();
  expect(await pageFits()).toBe(true);
  await navigation
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.getByRole("switch", { name: "Simulated data feed" }).click();
  await expect(
    page.getByRole("heading", { name: "Waiting for data" }),
  ).toBeVisible();
  expect(await pageFits()).toBe(true);
});
