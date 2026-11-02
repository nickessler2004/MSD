import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CloudFixture, SESSION_ID } from "./helpers/cloudFixture";
import { signInObserver as signIn, view, events } from "./helpers/observerUi";
import { ROUTE_COORDINATES } from "../src/services/telemetry";
test.use({ timezoneId: "UTC" });
function fixture() {
  const f = new CloudFixture();
  f.sessions[0].label = "Circuit validation / Session 04";
  f.sessions[0].started_at = new Date(Date.now() - 120000).toISOString();
  f.gps.splice(
    0,
    f.gps.length,
    ...ROUTE_COORDINATES.map((p, i) =>
      f.point(
        i + 1,
        p.latitude,
        p.longitude,
        new Date(Date.now() - (9 - i) * 1000).toISOString(),
      ),
    ),
  );
  f.events[0].recorded_at = new Date(Date.now() - 20000).toISOString();
  f.events.push({
    ...f.events[0],
    id: "40000000-0000-4000-8000-000000000002",
    sequence: 2,
    imu_id: 1,
    severity: "warning",
    magnitude: 1.8,
    recorded_at: new Date(Date.now() - 10000).toISOString(),
    latitude: ROUTE_COORDINATES[5].latitude,
    longitude: ROUTE_COORDINATES[5].longitude,
  });
  f.events.push({
    ...f.events[0],
    id: "40000000-0000-4000-8000-000000000003",
    sequence: 3,
    imu_id: 3,
    severity: "warning",
    magnitude: null,
    latitude: null,
    longitude: null,
    recorded_at: new Date(Date.now() - 5000).toISOString(),
  });
  return f;
}
test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
});
test("event filters and pagination preserve original readings and missing GPS honestly", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  await events(page);
  const report = page.getByLabel("Selected event details", { exact: true });
  await expect(report).toContainText("Not supplied");
  await expect(report).toContainText("No location supplied");
  await page.getByRole("button", { name: "Event map", exact: true }).click();
  await expect(
    page.getByLabel("Event location", { exact: true }),
  ).toContainText("Cannot highlight");
  await expect(page.locator(".selected-map-event")).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Filter by IMU", { exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(report).toContainText("1.80 g");
  await expect(report).toContainText("T1 0.80 g · T2 1.80 g");
  await expect(report).toContainText("Historical report");
  await page.getByRole("button", { name: "Event map", exact: true }).click();
  await expect(page.locator(".selected-map-event")).toHaveCount(1);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByLabel("Filter by severity", { exact: true })
    .selectOption("critical");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(
    page.getByText("No events match these filters", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(page.getByLabel("Event pagination")).toContainText("1 / 3");
  await expect(page.locator(".sparkline,.axis-reading")).toHaveCount(0);
});
test("inclusive custom event bounds, invalid ranges and reset do not alter telemetry", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  await events(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByLabel("Filter by time", { exact: true })
    .selectOption("custom");
  const stamp = Date.parse(f.events[1].recorded_at);
  await page
    .getByLabel("Events from", { exact: true })
    .fill(new Date(stamp).toISOString().slice(0, 19).replace(/:00$/, ""));
  await page
    .getByLabel("Events until", { exact: true })
    .fill(
      new Date(stamp + 1000).toISOString().slice(0, 19).replace(/:00$/, ""),
    );
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByLabel("Event pagination")).toContainText("1 / 1");
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("IMU 1");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByLabel("Events from", { exact: true })
    .fill(
      new Date(stamp + 100000).toISOString().slice(0, 19).replace(/:00$/, ""),
    );
  await expect(page.getByRole("alert")).toContainText(
    "end time must be on or after",
  );
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  await expect(page.getByLabel("Event pagination")).toContainText("1 / 3");
  expect(f.requests.filter((r) => r.path.includes("/rpc/ingest"))).toHaveLength(
    0,
  );
});
test("searchable history reviews authorized records and preserves export", async ({
  page,
  context,
}) => {
  const f = fixture();
  f.sessions[0].ended_at = new Date().toISOString();
  await f.install(context);
  await signIn(page, "observer@example.test");
  await events(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByLabel("Search sessions", { exact: true })
    .fill("does not exist");
  await expect(
    page.getByText("No matching sessions", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search sessions", { exact: true }).fill("Circuit");
  await page.locator(".ws-session-card").click();
  const review = page.getByLabel("Session overview", { exact: true });
  await expect(review).toContainText("Completed");
  await expect(review).toContainText("Read-only observer");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export session", exact: true })
    .click();
  const saved = await download;
  expect(saved.suggestedFilename()).toContain(SESSION_ID);
  const payload = JSON.parse(await readFile((await saved.path())!, "utf8"));
  expect(payload.events).toHaveLength(3);
  expect(payload.gps).toHaveLength(f.gps.length);
  expect(
    payload.events.some(
      (e: { magnitude: number | null }) => e.magnitude === 2.14,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "View session events", exact: true })
    .click();
  await expect(page.getByLabel("Event pagination")).toContainText("1 / 3");
});
test("keyboard navigation and event paging remain usable across desktop and phone", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("dark");
  await page.setViewportSize({ width: 390, height: 844 });
  const button = page
    .getByRole("navigation", { name: "Observer navigation" })
    .getByRole("button", { name: "Events", exact: true });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("IMU 3");
  await page.getByRole("button", { name: "Next event", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("IMU 1");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
});
test("offline immediately unconfirms GPS and recovery requires a new source fix", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  await context.setOffline(true);
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "Offline · Live updates unconfirmed",
  );
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "GPS unavailable",
  );
  await view(page, "IMUs");
  await expect(
    page.getByLabel("IMU 1 event status", { exact: true }),
  ).toContainText("Current: Unknown");
  await context.setOffline(false);
  f.gps.at(-1)!.recorded_at = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByLabel("Connection and GPS status")).not.toContainText(
    "GPS unavailable",
  );
});
test("local session review never substitutes a planned route for uncaptured history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Driving sessions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review session", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByText("GPS route not retained for this session", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("Select an event");
});

test("new local sessions retain captured routes for review and JSON export", async ({
  page,
}) => {
  await page.goto("/");
  await page.clock.install({ time: new Date("2026-10-28T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-28T12:01:00Z"));
  await page.reload();
  await page.clock.runFor(5000);
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Driving sessions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review session", exact: true })
    .nth(1)
    .click();
  await expect(
    page.getByText("10 captured demo positions", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Recorded demo event locations",
      exact: true,
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export data", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("msd-simulation");
});
