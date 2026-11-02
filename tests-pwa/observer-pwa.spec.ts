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

test("installed worker does not cache authenticated telemetry and offline never confirms live GPS", async ({
  page,
  context,
}) => {
  const fixture = new CloudFixture();
  await fixture.install(context);
  await page.route(/https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//, (r) =>
    r.abort(),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  // Authenticate while the service worker controls the production build.
  await page
    .getByLabel("Email address", { exact: true })
    .fill("observer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Observer · read only", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save thresholds", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("IMU 2 event status", { exact: true }),
  ).toContainText("Current: Unknown");
  const phoneNav = page.getByRole("navigation", { name: "Phone navigation" });
  await phoneNav.getByRole("button", { name: "GPS", exact: true }).click();
  await expect.poll(() => fixture.socketCount).toBe(1);
  fixture.addGps(fixture.point(3, 37.779, -122.418));
  await expect(page.locator(".cloud-map-card .map-footer")).toContainText(
    "3 GPS fixes",
  );
  fixture.addEvent({
    ...fixture.events[0],
    id: "40000000-0000-4000-8000-000000000002",
    sequence: 2,
    imu_id: 1,
    severity: "warning",
    magnitude: 1.2,
    recorded_at: new Date().toISOString(),
  });
  await expect(
    page.getByLabel("IMU 1 event status", { exact: true }),
  ).toContainText("1.20");
  await phoneNav.getByRole("button", { name: "Events", exact: true }).click();
  await page
    .getByRole("button", { name: "Session history", exact: true })
    .click();
  await expect(
    page.getByLabel("Session review", { exact: true }),
  ).toContainText("2.14 g");
  await page
    .getByRole("button", { name: "Event analysis", exact: true })
    .click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(2);
  await phoneNav.getByRole("button", { name: "GPS", exact: true }).click();
  fixture.gps.at(-1)!.recorded_at = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh mobile records", exact: true })
    .click();
  await expect(page.locator(".cloud-map-card .vehicle-map__status")).toHaveText(
    "Recent GPS fix",
  );
  await context.setOffline(true);
  await expect(
    page.getByText("Browser offline · Live updates are unconfirmed.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".cloud-map-card .vehicle-map__status")).toHaveText(
    "GPS unavailable",
  );
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.setOffline(false);
  fixture.gps.at(-1)!.recorded_at = new Date().toISOString();
  await page
    .getByRole("button", { name: "Refresh mobile records", exact: true })
    .click();
  await expect(page.locator(".cloud-map-card .vehicle-map__status")).toHaveText(
    "Recent GPS fix",
  );
  await page.reload();
  await expect(
    page.getByText("Observer · read only", { exact: true }),
  ).toBeVisible();
  await phoneNav.getByRole("button", { name: "Settings", exact: true }).click();
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
