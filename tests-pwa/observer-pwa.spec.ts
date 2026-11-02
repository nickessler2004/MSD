import { expect, test } from "@playwright/test";
import { CloudFixture } from "../tests/helpers/cloudFixture";

test("built application exposes install metadata, valid PNG icons, and direct SPA routes", async ({
  page,
  request,
}) => {
  await page.goto("/observer/session-review");
  await expect(page).toHaveTitle("MSD Observer");
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]'),
  ).toHaveAttribute("content", "MSD Observer");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    name: "MSD Observer",
    short_name: "MSD Observer",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]),
  );
  for (const icon of [
    ...manifest.icons,
    { src: "/icons/apple-touch-icon.png", sizes: "180x180" },
  ]) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
    const bytes = await response.body();
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    const [width, height] = icon.sizes.split("x").map(Number);
    expect(bytes.readUInt32BE(16)).toBe(width);
    expect(bytes.readUInt32BE(20)).toBe(height);
  }
});

test("installed worker preserves auth, permissions and live records without caching telemetry", async ({
  page,
  context,
}) => {
  const fixture = new CloudFixture();
  await fixture.install(context);
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page
    .getByLabel("Email address", { exact: true })
    .fill("observer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Observer navigation" });
  await nav.getByRole("button", { name: "IMUs", exact: true }).click();
  await page.getByLabel("IMU sensor", { exact: true }).selectOption("2");
  await expect(
    page.getByLabel("IMU 2 event status", { exact: true }),
  ).toContainText("Current: Unknown");
  await page.getByLabel("IMU information").selectOption("thresholds");
  await expect(
    page.getByRole("button", { name: "Save cloud thresholds", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "GPS", exact: true }).click();
  await page.getByRole("button", { name: "Fix details", exact: true }).click();
  await expect.poll(() => fixture.socketCount).toBe(1);
  fixture.addGps(fixture.point(3, 37.778, -122.418));
  await expect(page.locator(".ws-fix-details")).toContainText("37.77800");
  fixture.addEvent({
    ...fixture.events[0],
    id: "40000000-0000-4000-8000-000000000002",
    sequence: 2,
    imu_id: 1,
    severity: "warning",
    magnitude: 1.2,
    recorded_at: new Date().toISOString(),
  });
  await nav.getByRole("button", { name: "Events", exact: true }).click();
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("1.20 g");
  await expect(page.getByLabel("Event pagination")).toContainText("1 / 2");
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".ws-session-card").click();
  await expect(
    page.getByLabel("Session overview", { exact: true }),
  ).toContainText("Read-only observer");
  await context.setOffline(true);
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "Offline · Live updates unconfirmed",
  );
  await expect(page.getByLabel("Connection and GPS status")).toContainText(
    "GPS unavailable",
  );
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await context.setOffline(false);
  fixture.gps.at(-1)!.recorded_at = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh records", exact: true })
    .click();
  await expect(page.getByLabel("Connection and GPS status")).not.toContainText(
    "GPS unavailable",
  );
  await page.reload();
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Settings panel").selectOption("account");
  await expect(
    page.getByText("observer@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    fixture.requests.filter((r) => r.path.includes("/rpc/ingest")),
  ).toHaveLength(0);
});

test("offline relaunch has no service worker dashboard fallback", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await expect(
    page.reload({ waitUntil: "domcontentloaded" }),
  ).rejects.toThrow();
});
