import { expect, test, type Page } from "@playwright/test";
import { CloudFixture, SESSION_ID } from "./helpers/cloudFixture";
import { ROUTE_COORDINATES } from "../src/services/telemetry";
test.use({ timezoneId: "UTC" });
function fixture() {
  const f = new CloudFixture();
  f.sessions[0].label = "Circuit validation / Session 04";
  f.sessions[0].started_at = new Date(Date.now() - 120000).toISOString();
  f.gps.splice(
    0,
    f.gps.length,
    ...ROUTE_COORDINATES.slice(0, 15).map((p, i) =>
      f.point(
        i + 1,
        p.latitude,
        p.longitude,
        new Date(Date.now() - (15 - i) * 1000).toISOString(),
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
async function signIn(page: Page, email = "owner@example.test") {
  await page.goto("/");
  await page.getByLabel("Telemetry source").selectOption("cloud");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Cloud driving session")).toHaveValue(
    SESSION_ID,
  );
}
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//, (r) =>
    r.abort(),
  );
});
test("event timeline filters and selection preserve historical readings and map missing locations honestly", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  for (const id of [1, 2, 3])
    await expect(
      page.getByLabel(`IMU ${id} event status`, { exact: true }),
    ).toContainText("Current: Unknown");
  await expect(
    page.getByLabel("IMU 3 event status", { exact: true }),
  ).toContainText("Magnitude not supplied");
  await page
    .getByRole("button", { name: "Event analysis", exact: true })
    .click();
  const table = page.getByRole("table");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await page.getByLabel("Filter by IMU", { exact: true }).selectOption("1");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: `Inspect warning event ${f.events[1].id}`,
      exact: true,
    })
    .click();
  const inspector = page.getByLabel("Selected event details", { exact: true });
  await expect(inspector).toContainText("1.80");
  await expect(inspector).toContainText("T1 0.80 g · T2 1.80 g");
  await expect(inspector).toContainText("Historical report");
  await expect(page.locator(".selected-map-event")).toHaveCount(1);
  await page.getByLabel("Filter by IMU", { exact: true }).selectOption("3");
  await page
    .getByRole("button", {
      name: `Inspect warning event ${f.events[2].id}`,
      exact: true,
    })
    .click();
  await expect(inspector).toContainText("No location supplied");
  await expect(inspector).toContainText("Not supplied");
  await expect(page.locator(".selected-map-event")).toHaveCount(0);
  await page
    .getByLabel("Filter by severity", { exact: true })
    .selectOption("critical");
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await expect(
    page.getByText("No events match these filters", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(page.locator(".sparkline")).toHaveCount(0);
  await expect(page.locator(".axis-reading")).toHaveCount(0);
});
test("custom event time bounds and empty ranges can be reset without changing telemetry", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  await page
    .getByRole("button", { name: "Event analysis", exact: true })
    .click();
  await page
    .getByLabel("Filter by time", { exact: true })
    .selectOption("custom");
  const stamp = Date.parse(f.events[1].recorded_at);
  await page
    .getByLabel("Events from", { exact: true })
    .fill(new Date(stamp - 1000).toISOString().slice(0, 19));
  await page
    .getByLabel("Events until", { exact: true })
    .fill(new Date(stamp + 1000).toISOString().slice(0, 19));
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(1);
  await page
    .getByLabel("Events from", { exact: true })
    .fill(new Date(stamp + 100000).toISOString().slice(0, 19));
  await expect(page.getByRole("alert")).toContainText(
    "end time must be on or after",
  );
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  expect(f.requests.filter((r) => r.path.includes("/rpc/ingest"))).toHaveLength(
    0,
  );
});
test("history review shows authorized route, peak and event counts and preserves export", async ({
  page,
  context,
}) => {
  const f = fixture();
  f.sessions[0].ended_at = new Date().toISOString();
  await f.install(context);
  await signIn(page, "observer@example.test");
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  const review = page.getByLabel("Session review", { exact: true });
  await expect(review).toContainText("2.14 g");
  await expect(review).toContainText(`${f.gps.length} GPS fixes`);
  await expect(review).toContainText("Simulated cloud telemetry");
  const download = page.waitForEvent("download");
  await review
    .getByRole("button", { name: "Export session", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain(SESSION_ID);
  await page
    .getByLabel("Search sessions", { exact: true })
    .fill("does not exist");
  await expect(
    page.getByText("No matching sessions", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search sessions", { exact: true }).fill("Circuit");
  await expect(
    page.getByRole("button", { name: /Circuit validation.*Session 04/ }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Review session events" }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(3);
  expect(f.requests.filter((r) => r.path.includes("/rpc/ingest"))).toHaveLength(
    0,
  );
});
test("dark desktop and touch layouts keep map and analysis accessible without page overflow", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await signIn(page);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("dark");
  await expect(
    page.getByRole("region", {
      name: "Live GPS route of cloud driving session",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Event analysis", exact: true })
    .click();
  await expect(page.getByLabel("Filter by IMU", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", {
      name: `Inspect warning event ${f.events[1].id}`,
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("1.80");
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

test("browser offline state immediately removes live GPS confirmation and recovers without inventing readings", async ({
  page,
  context,
}) => {
  const f = fixture();
  await f.install(context);
  await signIn(page);
  await context.setOffline(true);
  await expect(
    page.getByText("Browser offline · Live updates are unconfirmed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".cloud-map-card .vehicle-map__status")).toHaveText(
    "GPS unavailable",
  );
  for (const id of [1, 2, 3])
    await expect(
      page.getByLabel(`IMU ${id} event status`, { exact: true }),
    ).toContainText("Current: Unknown");
  await context.setOffline(false);
  f.gps.at(-1)!.recorded_at = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(
    page.getByText("Browser offline · Live updates are unconfirmed.", {
      exact: false,
    }),
  ).toHaveCount(0);
  await expect(page.locator(".cloud-map-card .vehicle-map__status")).toHaveText(
    "Recent GPS fix",
  );
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
