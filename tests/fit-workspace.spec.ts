import { test, expect, type Page } from "@playwright/test";
import { CloudFixture } from "./helpers/cloudFixture";
import { signInObserver, view, setting, events } from "./helpers/observerUi";
async function fit(page: Page) {
  const result = await page.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector(".ws-main")!.getBoundingClientRect();
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        ".ws-main,.ws-panel,.ws-header,.ws-main-nav",
      ),
    ].filter((e) => e.getClientRects().length);
    const clipped = [
      ...document.querySelectorAll<HTMLElement>(
        ".ws-main button,.ws-main input,.ws-main select,.ws-main dd,.ws-main p,.ws-main h2",
      ),
    ]
      .filter((e) => e.getClientRects().length && !e.closest(".vehicle-map"))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.top < main.top - 1 ||
          r.bottom > main.bottom + 1 ||
          r.left < main.left - 1 ||
          r.right > main.right + 1
        );
      })
      .map((e) => e.textContent?.slice(0, 70));
    return {
      page:
        root.scrollHeight > innerHeight + 1 ||
        root.scrollWidth > innerWidth + 1,
      clipped,
      panels: targets
        .filter(
          (e) =>
            e.scrollHeight > e.clientHeight + 1 ||
            e.scrollWidth > e.clientWidth + 1,
        )
        .map((e) => ({
          class: e.className,
          height: [e.scrollHeight, e.clientHeight],
          width: [e.scrollWidth, e.clientWidth],
        })),
    };
  });
  expect(result).toEqual({ page: false, clipped: [], panels: [] });
}
for (const viewport of [
  { width: 320, height: 568 },
  { width: 667, height: 375 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 900 },
]) {
  test(`every observer view fits ${viewport.width}x${viewport.height}`, async ({
    page,
    context,
  }, testInfo) => {
    const f = new CloudFixture();
    for (let i = 1; i < 25; i++)
      f.events.push({
        ...f.events[0],
        id: `event-${i}`,
        sequence: i + 1,
        imu_id: ((i % 3) + 1) as 1 | 2 | 3,
        magnitude: i === 24 ? null : 1.2,
      });
    await f.install(context);
    await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
    await page.setViewportSize(viewport);
    await signInObserver(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByLabel("Session overview", { exact: true }),
    ).toBeVisible();
    await fit(page);
    await page.screenshot({ path: testInfo.outputPath("overview.png") });
    await view(page, "GPS");
    for (const pane of ["Map", "Speed", "Accuracy", "Fix details"]) {
      await page
        .getByRole("navigation", { name: "GPS views" })
        .getByRole("button", { name: pane, exact: true })
        .click();
      await fit(page);
    }
    await view(page, "IMUs");
    for (const sensor of ["1", "2", "3"])
      for (const info of ["current", "thresholds"]) {
        await page
          .getByLabel("IMU sensor", { exact: true })
          .selectOption(sensor);
        await page.getByLabel("IMU information").selectOption(info);
        await fit(page);
      }
    await events(page);
    await expect(
      page.getByLabel("Selected event details", { exact: true }),
    ).toBeVisible();
    await fit(page);
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    await fit(page);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page
      .getByLabel("Filter by time", { exact: true })
      .selectOption("custom");
    await fit(page);
    for (const pane of ["Timeline", "Event map", "History"]) {
      await page.getByRole("button", { name: pane, exact: true }).click();
      await fit(page);
    }
    await page.locator(".ws-session-card").click();
    await expect(
      page.getByLabel("Session overview", { exact: true }),
    ).toBeVisible();
    await fit(page);
    for (const panel of ["new", "sharing", "account", "tools", "help"]) {
      await setting(page, panel);
      await fit(page);
    }
    await context.setOffline(true);
    for (const screen of ["Overview", "GPS", "IMUs", "Events", "Settings"]) {
      await view(page, screen);
      await expect(page.getByLabel("Connection and GPS status")).toContainText(
        "GPS unavailable",
      );
      await fit(page);
    }
  });
}
test("long collections page through every event, session and observer", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  f.sessions[0].label =
    "A long recorded session name for verifying all information stays accessible inside the selected view";
  for (let i = 1; i < 14; i++) {
    f.events.push({
      ...f.events[0],
      id: `event-${i}`,
      sequence: i + 1,
      recorded_at: new Date(Date.now() - i * 1000).toISOString(),
      magnitude: i === 13 ? null : 1.2,
    });
    f.sessions.push({
      ...f.sessions[0],
      id: `session-${i}`,
      label: `Recorded session ${i}`,
    });
    f.observers.push({ ...f.observers[0], user_id: `observer-${i}` });
  }
  await f.install(context);
  await page.setViewportSize({ width: 375, height: 667 });
  await signInObserver(page);
  await events(page);
  for (let i = 1; i < 14; i++) {
    await page.getByRole("button", { name: "Next event", exact: true }).click();
    await fit(page);
  }
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("Not supplied");
  await expect(
    page.getByRole("button", { name: "Next event", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "History", exact: true }).click();
  for (let i = 1; i < 14; i++) {
    await page
      .getByRole("button", { name: "Next session", exact: true })
      .click();
    await fit(page);
  }
  await expect(
    page.getByRole("button", { name: "Next session", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Search sessions", { exact: true }).fill("A long");
  await page.locator(".ws-session-card").click();
  await expect(
    page.getByLabel("Session overview", { exact: true }),
  ).toContainText(f.sessions[0].label);
  await fit(page);
  await setting(page, "sharing");
  for (let i = 1; i < 14; i++) {
    await page
      .getByRole("button", { name: "Next observer", exact: true })
      .click();
    await fit(page);
  }
  await expect(page.locator(".cloud-observer-list")).toContainText(
    "observer-13",
  );
  await page
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await expect(page.locator(".cloud-observer-list")).toContainText(
    "observer-12",
  );
  await fit(page);
});
test("keyboard-sized viewport keeps the active threshold and Done reachable", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await page.setViewportSize({ width: 375, height: 667 });
  await signInObserver(page);
  await view(page, "IMUs");
  await page.getByLabel("IMU information").selectOption("thresholds");
  await page.getByLabel("IMU 1 T1", { exact: true }).focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, "height", {
      configurable: true,
      get: () => 330,
    });
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(
    page.getByRole("button", { name: "Done editing", exact: true }),
  ).toBeVisible();
  await fit(page);
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.evaluate(() => {
    delete (visualViewport as unknown as { height?: number }).height;
    visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(
    page.getByRole("navigation", { name: "Observer navigation" }),
  ).toBeVisible();
});
test("measurements and configuration have single homes, with sensor-report links instead of copies", async ({
  page,
  context,
}) => {
  const f = new CloudFixture();
  await f.install(context);
  await signInObserver(page);
  await expect(
    page.getByLabel("Session overview", { exact: true }),
  ).not.toContainText("2.14");
  await view(page, "IMUs");
  await expect(page.locator(".ws-imu")).not.toContainText("2.14");
  await page.getByLabel("IMU sensor", { exact: true }).selectOption("2");
  await page
    .getByRole("button", { name: "View sensor reports", exact: true })
    .click();
  await expect(
    page.getByLabel("Selected event details", { exact: true }),
  ).toContainText("2.14 g");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByLabel("Filter by IMU", { exact: true })).toHaveValue(
    "2",
  );
  await setting(page, "account");
  await expect(page.getByLabel("Settings panel")).not.toContainText(
    "Thresholds",
  );
  await view(page, "GPS");
  await page.getByRole("button", { name: "Fix details", exact: true }).click();
  await expect(page.locator(".ws-fix-details")).not.toContainText("Speed");
  await expect(page.locator(".ws-fix-details")).not.toContainText("Accuracy");
});
