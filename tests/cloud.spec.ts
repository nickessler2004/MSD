import { expect, test, type Page } from "@playwright/test";
import { CloudFixture, SESSION_ID } from "./helpers/cloudFixture";

async function signIn(
  page: Page,
  email = "owner@example.test",
  password = "fixture-password",
) {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Telemetry source" })
    .selectOption("cloud");
  await expect(
    page.getByRole("heading", { name: "Observer dashboard" }),
  ).toBeVisible();
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function expectSession(page: Page) {
  await expect(
    page.getByRole("combobox", { name: "Cloud driving session" }),
  ).toHaveValue(SESSION_ID);
  await expect(
    page.getByRole("heading", { name: "Live GPS route", exact: true }),
  ).toBeVisible();
}

test("cloud sign-in loads persisted route, event locations, and three unknown IMUs without fabricating samples", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  await expectSession(page);
  await expect(page.locator(".vehicle-map__coordinates")).toContainText(
    "37.77910",
  );
  for (const imu of [1, 2, 3]) {
    const card = page.getByLabel(`IMU ${imu} event status`, { exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/unknown|unavailable/i);
  }
  await expect(page.locator(".axis-reading")).toHaveCount(0);
  await expect(page.locator(".sparkline")).toHaveCount(0);
  await expect(page.locator(".traffic-light .green.lit")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Event analysis", exact: true })
    .click();
  const table = page.getByRole("table");
  await expect(table).toContainText("IMU 2");
  await expect(table).toContainText(/high impact|critical/i);
  await expect(table).toContainText("37.7791");
  await expect(
    page.getByText("SIMULATED CLOUD DATA", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("failed credentials expose an error and sign-out clears the cloud session", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page, "owner@example.test", "wrong-password");
  await expect(page.getByRole("alert")).toContainText(/invalid login/i);
  await expect(
    page.getByRole("combobox", { name: "Cloud driving session" }),
  ).toHaveCount(0);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expectSession(page);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Cloud driving session" }),
  ).toHaveCount(0);
  await expect(page.locator(".vehicle-map")).toHaveCount(0);
  await expect(
    page.getByText("Shared test drive", { exact: true }),
  ).toHaveCount(0);
});

test("realtime updates reach two authorized observers and source-time ordering survives duplicates and delayed uploads", async ({
  page,
  context,
  browser,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  const observerContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5175",
  });
  await backend.install(observerContext);
  const observer = await observerContext.newPage();
  try {
    await signIn(observer, "observer@example.test");
    await expectSession(observer);
    await expect.poll(() => backend.socketCount).toBeGreaterThanOrEqual(2);
    const newest = backend.point(3, 37.7788, -122.4186);
    backend.addGps(newest);
    for (const target of [page, observer])
      await expect(target.locator(".vehicle-map__coordinates")).toContainText(
        "37.77880",
      );
    backend.addGps({
      ...backend.point(
        4,
        37.78,
        -122.42,
        new Date(Date.now() - 30_000).toISOString(),
      ),
      received_at: new Date().toISOString(),
    });
    backend.addGps({ ...newest });
    const event = {
      ...backend.events[0],
      id: "40000000-0000-4000-8000-000000000002",
      sequence: 2,
      imu_id: 3 as const,
      recorded_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      magnitude: 1.8,
      severity: "warning" as const,
    };
    backend.addEvent(event);
    backend.addEvent({ ...event });
    for (const target of [page, observer]) {
      await expect(target.locator(".vehicle-map__coordinates")).toContainText(
        "37.77880",
      );
      await target
        .getByRole("button", { name: "Event analysis", exact: true })
        .click();
      const rows = target.getByRole("table").getByRole("row");
      await expect(rows).toHaveCount(3); // Header + two unique events.
      await expect(target.getByRole("table")).toContainText("IMU 3");
    }
    // A new page load rehydrates the persisted API state rather than generating demo history.
    await page.reload();
    await page
      .getByRole("combobox", { name: "Telemetry source" })
      .selectOption("cloud");
    await expectSession(page);
    await page
      .getByRole("button", { name: "Event analysis", exact: true })
      .click();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  } finally {
    await observerContext.close();
  }
});

test("read-only observers cannot start uploads or save session configuration", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page, "observer@example.test");
  await expectSession(page);
  for (const label of [
    "Start cloud test drive",
    "Save cloud thresholds",
    "Share session",
  ]) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (await button.count()) await expect(button).toBeDisabled();
  }
  await expect(page.getByText(/read.only observer/i).first()).toBeVisible();
  expect(
    backend.requests.filter(
      (request) => request.path.includes("/rpc/") && request.method === "POST",
    ),
  ).toHaveLength(0);
});

test("the cloud test drive uploads one-second GPS fixtures only to a simulated session", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  await page
    .getByRole("button", { name: "Start cloud test drive", exact: true })
    .click();
  await expect
    .poll(
      () =>
        backend.requests.filter((request) =>
          request.path.endsWith("/rpc/ingest_gps"),
        ).length,
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(3);
  await page
    .getByRole("button", { name: "Stop cloud test drive", exact: true })
    .click();
  const uploaded = backend.requests.filter((request) =>
    request.path.endsWith("/rpc/ingest_gps"),
  );
  const points = uploaded.flatMap(
    (request) =>
      (request.body as { p_points: Array<{ recorded_at: string }> }).p_points,
  );
  expect(points.length).toBeGreaterThanOrEqual(3);
  const interval =
    Date.parse(points[1].recorded_at) - Date.parse(points[0].recorded_at);
  expect(interval).toBeGreaterThanOrEqual(800);
  expect(interval).toBeLessThan(2500);
  expect(
    backend.requests.some((request) =>
      request.path.endsWith("/rpc/ingest_connection"),
    ),
  ).toBe(true);
  const countAtStop = uploaded.length;
  await page.waitForTimeout(1300);
  expect(
    backend.requests.filter((request) =>
      request.path.endsWith("/rpc/ingest_gps"),
    ),
  ).toHaveLength(countAtStop);
  await expect(
    page.getByRole("button", { name: "Start cloud test drive", exact: true }),
  ).toBeVisible();
});

test("local and cloud modes remain separate and cloud layout fits a phone", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const source = page.getByRole("combobox", { name: "Telemetry source" });
  await source.selectOption("simulation");
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  await expect(page.locator(".axis-reading")).toHaveCount(3);
  await source.selectOption("cloud");
  await expectSession(page);
  await expect(page.locator(".axis-reading")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("owners configure all three IMUs and grant observer access without rewriting historical thresholds", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  for (const imu of [1, 2, 3]) {
    await page
      .getByLabel(`IMU ${imu} T1`, { exact: true })
      .fill(String(imu / 10 + 0.5));
    await page
      .getByLabel(`IMU ${imu} T2`, { exact: true })
      .fill(String(imu / 10 + 2));
  }
  await page
    .getByRole("button", { name: "Save cloud thresholds", exact: true })
    .click();
  await expect
    .poll(
      () =>
        backend.requests.filter((request) =>
          request.path.endsWith("/rpc/set_imu_thresholds"),
        ).length,
    )
    .toBe(1);
  expect(
    backend.thresholds.map(({ imu_id, t1, t2 }) => ({ imu_id, t1, t2 })),
  ).toEqual([
    { imu_id: 1, t1: 0.6, t2: 2.1 },
    { imu_id: 2, t1: 0.7, t2: 2.2 },
    { imu_id: 3, t1: 0.8, t2: 2.3 },
  ]);
  expect(backend.events[0]).toMatchObject({
    t1: 0.8,
    t2: 1.8,
    severity: "critical",
  });
  await page
    .getByLabel("Existing account email", { exact: true })
    .fill("observer@example.test");
  await page
    .getByRole("button", { name: "Share session", exact: true })
    .click();
  await expect
    .poll(
      () =>
        backend.requests.filter((request) =>
          request.path.endsWith("/rpc/share_session"),
        ).length,
    )
    .toBe(1);
  expect(
    backend.requests.find((request) =>
      request.path.endsWith("/rpc/share_session"),
    )?.body,
  ).toMatchObject({
    p_session_id: SESSION_ID,
    p_email: "observer@example.test",
  });
});

test("device sessions never offer generated cloud uploads, and failed reads do not fall back to local telemetry", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  backend.sessions[0].data_source = "device";
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  await expect(
    page.getByText("DEVICE TELEMETRY", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start cloud test drive", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".axis-reading")).toHaveCount(0);
  backend.failSnapshots = true;
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/unavailable/i);
  await expect(page.locator(".vehicle-map")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Observer dashboard" }),
  ).toBeVisible();
  await expect(page.locator(".axis-reading")).toHaveCount(0);
  await expect(page.locator(".traffic-light .green.lit")).toHaveCount(0);
});

test("recent cloud delivery of old GPS and heartbeat records stays historical and never confirms current IMU motion", async ({
  page,
  context,
}) => {
  const backend = new CloudFixture();
  const oldSourceTime = new Date(Date.now() - 30_000).toISOString();
  for (const point of backend.gps) {
    point.recorded_at = oldSourceTime;
    point.received_at = new Date().toISOString();
  }
  backend.connections[0].recorded_at = oldSourceTime;
  backend.connections[0].received_at = new Date().toISOString();
  await backend.install(context);
  await signIn(page);
  await expectSession(page);
  await expect(page.locator(".cloud-sync")).toHaveText("Realtime connected");
  const gpsStatus = page.getByRole("article").filter({
    has: page.getByText("GPS availability", { exact: true }),
  });
  await expect(gpsStatus.locator(".stat-value")).toHaveText("Historical");
  const gatewayStatus = page.getByRole("article").filter({
    has: page.getByText("Gateway availability", { exact: true }),
  });
  await expect(gatewayStatus.locator(".stat-value")).toHaveText("Stale");
  await expect(page.locator(".vehicle-map__coordinates")).toHaveText(
    "Awaiting GPS data",
  );
  const marker = page.locator(".msd-vehicle-icon");
  await expect
    .poll(() =>
      marker.evaluateAll((markers) =>
        markers.every((element) => getComputedStyle(element).opacity === "0"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByText("2 GPS fixes · 1 event locations", { exact: true }),
  ).toBeVisible();
  for (const imu of [1, 2, 3]) {
    await expect(
      page.getByLabel(`IMU ${imu} event status`, { exact: true }),
    ).toContainText("Current: Unknown");
  }
  await expect(page.locator(".axis-reading")).toHaveCount(0);
  await expect(page.locator(".traffic-light .green.lit")).toHaveCount(0);
});
