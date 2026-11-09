import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The open Vuetify menu or overlay. A menu that is closing keeps its list in the page until its fade-out ends, so an
 * option locator read from the whole page can match the closing list as well as the one just opened: pick options
 * through `openMenu(page)`.
 */
function openMenu(page: Page): Locator {
  return page.locator(".v-overlay--active");
}

/**
 * Dismisses save feedback when it is showing. Feedback drops a message that repeats within its two-second dedupe
 * window, so a second identical save may show none; a test must not wait for it.
 */
async function dismissFeedbackIfShown(page: Page) {
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
}

/**
 * Waits until feedback has timed out, so a control it covered receives the next click. The pointer leaves first: a
 * message stays while the pointer rests on it, and a click aimed at a control it covers parks the pointer there.
 * Each message times out on the page's own timer, so the caller installs the page clock before the feedback appears
 * and this moves that clock through one message's five seconds at a time.
 */
async function waitForFeedbackToClear(page: Page) {
  await page.mouse.move(0, 0);
  await expect(async () => {
    await page.clock.fastForward(5_000);
    await expect(page.locator(".v-snackbar__content")).toBeHidden({ timeout: 500 });
  }).toPass({ intervals: [100], timeout: 15_000 });
}

/**
 * Opens an expansion panel through its title button and waits until its content has finished expanding, so a control
 * inside it receives the next click. While it expands, the panel clips its content: Playwright's scroll into view
 * scrolls that clip, which no pointer can do, and the next frame's growth carries the control out from under the
 * pointer between press and release, so the click lands on the panel instead.
 */
async function expandPanel(title: Locator) {
  if (await title.getAttribute("aria-expanded") !== "true") await title.click();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  const panel = title.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' v-expansion-panel ')][1]");
  const text = panel.locator(".v-expansion-panel-text").first();
  await expect(text).toBeVisible();
  // Vuetify's expand transition writes the animating height inline and removes it when the transition ends.
  await expect(text).not.toHaveAttribute("style", /height/u);
}

/**
 * Closes a Vuetify menu with Escape when it is open, so that its activator opens it again on the next click. For 50 ms
 * after a menu closes, Vuetify ignores clicks on its activator (useActivator's reopen lock, which keeps the click
 * outside that closed it from opening it again at once). A person never clicks again that soon; a test does, and the
 * menu stays shut. The lock ends on a page timer set as the menu closes, which the activator's aria-expanded="false"
 * follows, so a page timer of the same length set after that ends after it. (A test that pauses the page clock moves
 * it past the lock instead.)
 */
async function closeMenu(page: Page, activator: Locator) {
  if (await activator.getAttribute("aria-expanded") === "true") await page.keyboard.press("Escape");
  await expect(activator).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
}

/**
 * Asserts that `read()` keeps answering `expected` for the whole of `durationMs`: an observed quiet period for
 * something that must not happen, which fails as soon as it does instead of sleeping and checking once.
 */
async function expectSteady<T>(read: () => T | Promise<T>, expected: T, durationMs: number) {
  const until = Date.now() + durationMs;
  do {
    expect(await read()).toEqual(expected);
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < until);
  expect(await read()).toEqual(expected);
}

export { closeMenu, dismissFeedbackIfShown, expandPanel, expectSteady, openMenu, waitForFeedbackToClear };
