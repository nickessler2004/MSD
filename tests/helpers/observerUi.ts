import { expect, type Page } from "@playwright/test";
export async function signInObserver(
  page: Page,
  email = "owner@example.test",
  password = "fixture-password",
) {
  await page.goto("/");
  await page.getByLabel("Telemetry source").selectOption("cloud");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (!password.startsWith("wrong"))
    await expect(
      page.getByRole("navigation", { name: "Observer navigation" }),
    ).toBeVisible();
}
export async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Observer navigation" })
    .getByRole("button", { name, exact: true })
    .click();
}
export async function setting(page: Page, panel: string) {
  await view(page, "Settings");
  await page.getByLabel("Settings panel").selectOption(panel);
}
export async function gps(page: Page) {
  await view(page, "GPS");
  await page
    .getByRole("navigation", { name: "GPS views" })
    .getByRole("button", { name: "Map", exact: true })
    .click();
}
export async function events(page: Page) {
  await view(page, "Events");
  await page.getByRole("button", { name: "Reports", exact: true }).click();
}
