import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
if (process.env.MSD_LIVE_VALIDATION !== "1")
  throw new Error(
    "Live dashboard validation requires MSD_LIVE_VALIDATION=1 and a successful mobile test:live run",
  );
const report = JSON.parse(readFileSync("work/live-validation.json", "utf8"));
const targets = [
  { name: "local production", url: "http://127.0.0.1:5176" },
  ...(process.env.MSD_DASHBOARD_URL
    ? [{ name: "existing deployed", url: process.env.MSD_DASHBOARD_URL }]
    : []),
];
for (const target of targets)
  for (const role of ["owner", "observer"] as const) {
    test(`${target.name} dashboard displays live project data for ${role}`, async ({
      page,
    }) => {
      const email =
        process.env[role === "owner" ? "MSD_TEST_EMAIL" : "MSD_OBSERVER_EMAIL"];
      const password =
        process.env[
          role === "owner" ? "MSD_TEST_PASSWORD" : "MSD_OBSERVER_PASSWORD"
        ];
      if (!email || !password)
        throw new Error("Missing configured validation account");
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route(
        /https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//,
        (r) => r.abort(),
      );
      // Chromium in this executor lacks the session proxy CA. Forward HTTP to the
      // real project with Node's configured CA/proxy, retaining TLS verification.
      // These are live requests/responses, not database fixtures. No auth trace is saved.
      if (process.env.MSD_NODE_HTTP_RELAY === "1")
        await page.route(`https://${report.project}/**`, async (route) => {
          const request = route.request();
          const response = await fetch(request.url(), {
            method: request.method(),
            headers: await request.allHeaders(),
            body: request.postData() ?? undefined,
          });
          const headers = Object.fromEntries(
            [...response.headers].filter(
              ([name]) =>
                ![
                  "content-encoding",
                  "transfer-encoding",
                  "content-length",
                  "connection",
                ].includes(name),
            ),
          );
          await route.fulfill({
            status: response.status,
            headers,
            body: Buffer.from(await response.arrayBuffer()),
          });
        });
      await page.goto(target.url);
      await page
        .getByRole("combobox", { name: "Telemetry source" })
        .selectOption("cloud");
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const selector = page.getByRole("combobox", {
        name: "Cloud driving session",
      });
      await expect(
        selector.locator(`option[value="${report.sessionId}"]`),
      ).toHaveCount(1);
      await selector.selectOption(report.sessionId);
      await expect(
        page.getByText("SIMULATED CLOUD DATA", { exact: true }),
      ).toBeVisible();
      // Finished source points are historical, so the live marker must stay unavailable.
      await expect(page.locator(".map-footer")).toContainText("2 GPS fixes");
      await expect(
        page.locator(".leaflet-overlay-pane path[fill=none]").first(),
      ).toBeVisible();
      await expect(page.locator(".vehicle-map__coordinates")).toContainText(
        "Awaiting GPS data",
      );
      for (const imu of [1, 2, 3])
        await expect(
          page.getByLabel(`IMU ${imu} event status`, { exact: true }),
        ).toContainText(/unknown|unavailable/i);
      await expect(page.locator(".axis-reading")).toHaveCount(0);
      await expect(page.locator(".traffic-light .green.lit")).toHaveCount(0);
      if (role === "observer")
        await expect(
          page.getByText("Read-only observer", { exact: true }),
        ).toBeVisible();
      await page
        .getByRole("button", { name: "Cloud events", exact: true })
        .click();
      const table = page.getByRole("table");
      for (const imu of [1, 2, 3])
        await expect(table).toContainText(`IMU ${imu}`);
      await expect(table).toContainText("Not supplied");
      await expect(table.locator("tbody tr")).toHaveCount(3);
      expect(errors).toEqual([]);
      // Only non-secret evidence is saved; no trace, browser auth storage, or login screenshots.
      writeFileSync(
        `work/dashboard-${target.name.replaceAll(" ", "-")}-${role}.json`,
        JSON.stringify(
          {
            validatedAt: new Date().toISOString(),
            target: target.name,
            url: target.url,
            role,
            sessionId: report.sessionId,
            events: 3,
            imuStates: "unknown",
            consolePageErrors: errors,
          },
          null,
          2,
        ) + "\n",
      );
    });
  }
