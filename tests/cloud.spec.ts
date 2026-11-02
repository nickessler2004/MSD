import { expect, test } from "@playwright/test";
import { CloudFixture, SESSION_ID } from "./helpers/cloudFixture";
import {
  signInObserver as signIn,
  view,
  setting,
  gps,
  events,
} from "./helpers/observerUi";

test("cloud sign-in preserves captured route, original events and unknown-current IMUs", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await gps(page);
  await page.getByRole("button", { name: "Fix details", exact: true }).click();
  await expect(page.locator(".ws-fix-details")).toContainText("37.77910");
  await view(page, "IMUs");
  for (const id of ["1", "2", "3"]) {
    await page.getByLabel("IMU sensor", { exact: true }).selectOption(id);
    await expect(
      page.getByLabel(`IMU ${id} event status`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel(`IMU ${id} event status`, { exact: true }),
    ).toContainText("Current: Unknown");
  }
  await events(page);
  const report = page.getByLabel("Selected event details", { exact: true });
  await expect(report).toContainText("IMU 2");
  await expect(report).toContainText("High impact");
  await expect(report).toContainText("37.77910");
  await expect(
    page.locator(".axis-reading,.sparkline,.traffic-light .green.lit"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("failed credentials expose an error and sign-out clears the cloud session", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page, "owner@example.test", "wrong-password");
  await expect(page.getByRole("alert")).toContainText(/invalid login/i);
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await setting(page, "account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.locator(".observer-workspace,.vehicle-map")).toHaveCount(0);
});
test("realtime reaches two observers and source-time order survives duplicates and delayed uploads", async ({
  page,
  context,
  browser,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page);
  await gps(page);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:5175" });
  await f.install(other);
  const observer = await other.newPage();
  try {
    await signIn(observer, "observer@example.test");
    await gps(observer);
    await page
      .getByRole("button", { name: "Fix details", exact: true })
      .click();
    await observer
      .getByRole("button", { name: "Fix details", exact: true })
      .click();
    await expect.poll(() => f.socketCount).toBeGreaterThanOrEqual(2);
    const newest = f.point(3, 37.7788, -122.4186);
    f.addGps(newest);
    for (const target of [page, observer])
      await expect(target.locator(".ws-fix-details")).toContainText("37.77880");
    f.addGps({
      ...f.point(4, 37.78, -122.42, new Date(Date.now() - 30000).toISOString()),
      received_at: new Date().toISOString(),
    });
    f.addGps({ ...newest });
    const event = {
      ...f.events[0],
      id: "40000000-0000-4000-8000-000000000002",
      sequence: 2,
      imu_id: 3 as const,
      recorded_at: new Date().toISOString(),
      magnitude: 1.8,
      severity: "warning" as const,
    };
    f.addEvent(event);
    f.addEvent({ ...event });
    for (const target of [page, observer]) {
      await expect(target.locator(".ws-fix-details")).toContainText("37.77880");
      await events(target);
      await expect(
        target.getByLabel("Selected event details", { exact: true }),
      ).toContainText("IMU 3");
      await expect(target.getByLabel("Event pagination")).toContainText(
        "1 / 2",
      );
    }
    await page.reload();
    await page.getByLabel("Telemetry source").selectOption("cloud");
    await events(page);
    await expect(page.getByLabel("Event pagination")).toContainText("1 / 2");
  } finally {
    await other.close();
  }
});
test("read-only observers cannot upload, configure thresholds or share", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page, "observer@example.test");
  for (const panel of ["sharing", "tools"]) {
    await setting(page, panel);
    for (const label of [
      "Start cloud test drive",
      "Save cloud thresholds",
      "Share session",
    ])
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
  }
  await setting(page, "sharing");
  await expect(
    page.getByText("Read-only observer", { exact: true }),
  ).toBeVisible();
  expect(
    f.requests.filter((r) => r.path.includes("/rpc/") && r.method === "POST"),
  ).toHaveLength(0);
});
test("cloud simulation uploads one-second GPS only into simulated sessions", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page);
  await setting(page, "tools");
  await page
    .getByRole("button", { name: "Start cloud test drive", exact: true })
    .click();
  await expect
    .poll(
      () => f.requests.filter((r) => r.path.endsWith("/rpc/ingest_gps")).length,
      { timeout: 10000 },
    )
    .toBeGreaterThanOrEqual(3);
  await page
    .getByRole("button", { name: "Stop cloud test drive", exact: true })
    .click();
  const requests = f.requests.filter((r) => r.path.endsWith("/rpc/ingest_gps"));
  const points = requests.flatMap(
    (r) => (r.body as { p_points: { recorded_at: string }[] }).p_points,
  );
  expect(points.length).toBeGreaterThanOrEqual(3);
  const interval =
    Date.parse(points[1].recorded_at) - Date.parse(points[0].recorded_at);
  expect(interval).toBeGreaterThanOrEqual(800);
  expect(interval).toBeLessThan(2500);
  expect(
    f.requests.some((r) => r.path.endsWith("/rpc/ingest_connection")),
  ).toBe(true);
  await page.waitForTimeout(1300);
  expect(
    f.requests.filter((r) => r.path.endsWith("/rpc/ingest_gps")),
  ).toHaveLength(requests.length);
});
test("local and cloud sources remain separate on a phone", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await setting(page, "account");
  await page.getByLabel("Telemetry source").selectOption("simulation");
  await expect(
    page.getByRole("heading", { name: "All systems normal" }),
  ).toBeVisible();
  await expect(page.locator(".axis-reading")).toHaveCount(3);
  await page.getByLabel("Telemetry source").selectOption("cloud");
  await expect(page.locator(".observer-workspace")).toBeVisible();
  await expect(page.locator(".axis-reading")).toHaveCount(0);
});
test("owners configure all three IMUs and share without rewriting historical thresholds", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page);
  await view(page, "IMUs");
  await page.getByLabel("IMU information").selectOption("thresholds");
  for (const id of [1, 2, 3]) {
    await page
      .getByLabel("IMU sensor", { exact: true })
      .selectOption(String(id));
    await page
      .getByLabel(`IMU ${id} T1`, { exact: true })
      .fill(String(id / 10 + 0.5));
    await page
      .getByLabel(`IMU ${id} T2`, { exact: true })
      .fill(String(id / 10 + 2));
  }
  await page
    .getByRole("button", { name: "Save cloud thresholds", exact: true })
    .click();
  await expect
    .poll(
      () =>
        f.requests.filter((r) => r.path.endsWith("/rpc/set_imu_thresholds"))
          .length,
    )
    .toBe(1);
  expect(
    f.thresholds.map(({ imu_id, t1, t2 }) => ({ imu_id, t1, t2 })),
  ).toEqual([
    { imu_id: 1, t1: 0.6, t2: 2.1 },
    { imu_id: 2, t1: 0.7, t2: 2.2 },
    { imu_id: 3, t1: 0.8, t2: 2.3 },
  ]);
  expect(f.events[0]).toMatchObject({ t1: 0.8, t2: 1.8, severity: "critical" });
  await setting(page, "sharing");
  await page
    .getByLabel("Existing account email", { exact: true })
    .fill("observer@example.test");
  await page
    .getByRole("button", { name: "Share session", exact: true })
    .click();
  await expect
    .poll(
      () =>
        f.requests.filter((r) => r.path.endsWith("/rpc/share_session")).length,
    )
    .toBe(1);
  expect(
    f.requests.find((r) => r.path.endsWith("/rpc/share_session"))?.body,
  ).toMatchObject({
    p_session_id: SESSION_ID,
    p_email: "observer@example.test",
  });
});
test("device sessions never generate uploads and read failures never fall back to demo", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  f.sessions[0].data_source = "device";
  await f.install(context);
  await signIn(page);
  await expect(page.locator(".ws-source")).toHaveText("DEVICE");
  await setting(page, "tools");
  await expect(
    page.getByRole("button", { name: "Start cloud test drive", exact: true }),
  ).toHaveCount(0);
  f.failSnapshots = true;
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "Connection error",
  );
  await page.getByRole("button", { name: "Open messages" }).click();
  await expect(page.getByLabel("Full messages")).toContainText(/unavailable/i);
  await expect(
    page.locator(".axis-reading,.traffic-light .green.lit"),
  ).toHaveCount(0);
});
test("recent delivery of old source records stays unavailable for current motion", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  const old = new Date(Date.now() - 30000).toISOString();
  for (const point of f.gps) {
    point.recorded_at = old;
    point.received_at = new Date().toISOString();
  }
  f.connections[0].recorded_at = old;
  f.connections[0].received_at = new Date().toISOString();
  await f.install(context);
  await signIn(page);
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "GPS unavailable",
  );
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "Gateway unconfirmed",
  );
  await gps(page);
  await page.getByRole("button", { name: "Fix details", exact: true }).click();
  await expect(page.locator(".ws-fix-details")).toContainText(
    "Historical / unavailable · Not live",
  );
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.locator(".msd-vehicle-icon")).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator(".msd-vehicle-icon")
        .evaluateAll((nodes) =>
          nodes.every((n) => getComputedStyle(n).opacity === "0"),
        ),
    )
    .toBe(true);
  await view(page, "IMUs");
  for (const id of ["1", "2", "3"]) {
    await page.getByLabel("IMU sensor", { exact: true }).selectOption(id);
    await expect(
      page.getByLabel(`IMU ${id} event status`, { exact: true }),
    ).toContainText("Current: Unknown");
  }
});

test("owners create and complete device sessions without simulated telemetry", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signIn(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await setting(page, "new");
  await page
    .getByLabel("Session name", { exact: true })
    .fill("Authorized device session");
  await page
    .getByLabel("Cloud data source", { exact: true })
    .selectOption("device");
  await page
    .getByRole("button", { name: "New cloud session", exact: true })
    .click();
  await expect(page.locator(".ws-session-name")).toHaveText(
    "Authorized device session",
  );
  await setting(page, "tools");
  await expect(
    page.getByRole("button", { name: "Start cloud test drive", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Complete session", exact: true })
    .click();
  await expect
    .poll(
      () =>
        f.sessions.find((s) => s.label === "Authorized device session")
          ?.ended_at,
    )
    .toBeTruthy();
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "GPS unavailable",
  );
  expect(f.requests.filter((r) => r.path.includes("/rpc/ingest"))).toHaveLength(
    0,
  );
});
