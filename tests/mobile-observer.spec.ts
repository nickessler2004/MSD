import { expect, test } from "@playwright/test";
import { CloudFixture } from "./helpers/cloudFixture";
import { signInObserver, view } from "./helpers/observerUi";
test("phone navigation retains session context and keeps read-only thresholds protected", async ({
  page,
  context,
}, testInfo) => {
  const f = new CloudFixture();
  await f.install(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await signInObserver(page, "observer@example.test");
  for (const screen of ["Overview", "GPS", "IMUs", "Events", "Settings"]) {
    await view(page, screen);
    await expect(
      page
        .getByRole("navigation", { name: "Observer navigation" })
        .getByRole("button", { name: screen, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".ws-session-name")).toHaveText(
      "Shared test drive",
    );
    await expect(page.getByLabel("Connection and GPS status")).toBeVisible();
  }
  await view(page, "IMUs");
  await page.getByLabel("IMU information").selectOption("thresholds");
  for (const id of ["1", "2", "3"]) {
    await page.getByLabel("IMU sensor", { exact: true }).selectOption(id);
    await expect(
      page.getByLabel(`IMU ${id} T1`, { exact: true }),
    ).toBeDisabled();
  }
  await view(page, "Overview");
  await expect(
    page.getByLabel("Session overview", { exact: true }),
  ).toContainText("Read-only observer");
  await page.screenshot({ path: testInfo.outputPath("phone-overview.png") });
});
