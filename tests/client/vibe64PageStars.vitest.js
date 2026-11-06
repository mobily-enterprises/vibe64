import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick } from "vue";
const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => ({ error: mocks.error }) }));
vi.mock("vuetify", () => ({ useTheme: () => ({ current: { value: { dark: false } } }) }));
import { preparePageView, takePreparedPageView, usePageStars } from "../../packages/vibe64-pages/src/client/pageStars.js";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const link = (pageId, lifeMs) => ({ ok: true, url: `https://pages.example/${pageId}`, expiresAt: new Date(Date.now() + lifeMs).toISOString() });
async function flush() { for (let i = 0; i < 8; i += 1) await nextTick(); }

describe("viewing links asked for ahead", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers({ now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });

  it("asks once, hands the link to one viewer only and keeps it two minutes at most", async () => {
    mocks.request.mockImplementation(async (url) => link(url.split("/").at(-2), 15 * 60 * 1000));
    preparePageView("ahead", "first", "light");
    preparePageView("ahead", "first", "light");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toMatch(/\/vibe64\/pages\/first\/view$/);
    expect(mocks.request.mock.calls[0][1]).toEqual({ method: "POST", body: { theme: "light" } });
    const onTheWay = takePreparedPageView("ahead", "first", "light");
    expect(await onTheWay.promise).toMatchObject({ url: "https://pages.example/first" });
    expect(takePreparedPageView("ahead", "first", "light")).toBeNull();

    preparePageView("ahead", "second", "light");
    await flush();
    expect(takePreparedPageView("ahead", "second", "dark")).toBeNull();
    expect(takePreparedPageView("ahead", "second", "light")).toEqual({ answer: expect.objectContaining({ url: "https://pages.example/second" }) });
    expect(takePreparedPageView("ahead", "second", "light")).toBeNull();

    preparePageView("ahead", "third", "light");
    await flush();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 1);
    expect(takePreparedPageView("ahead", "third", "light")).toBeNull();
  });

  it("never keeps a link within a minute of its own end, and forgets one that failed", async () => {
    mocks.request.mockResolvedValueOnce(link("short", 90 * 1000))
      .mockResolvedValueOnce(link("ending", 30 * 1000))
      .mockResolvedValueOnce({ ok: false, error: "This page is archived." });
    preparePageView("ending", "short", "dark");
    preparePageView("ending", "ending", "dark");
    preparePageView("ending", "failed", "dark");
    await flush();
    expect(takePreparedPageView("ending", "ending", "dark")).toBeNull();
    expect(takePreparedPageView("ending", "failed", "dark")).toBeNull();
    await vi.advanceTimersByTimeAsync(31 * 1000);
    expect(takePreparedPageView("ending", "short", "dark")).toBeNull();
  });
});

describe("starred pages", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("stars at once, shares one list per project and rolls back a failed star", async () => {
    const summary = { id: "summary", title: "Summary" };
    const results = { id: "results", title: "Results" };
    mocks.request.mockResolvedValueOnce({ ok: true, pages: [summary] });
    const scope = effectScope();
    const stars = scope.run(() => usePageStars("team"));
    await flush();
    expect(mocks.request.mock.calls[0][0]).toMatch(/\/vibe64\/pages\/stars$/);
    expect(stars.pages.value).toEqual([summary]);

    let finish;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const starring = stars.toggle(results);
    expect(stars.pages.value).toEqual([summary, results]);
    expect(stars.pendingIds.value).toEqual(["results"]);
    expect(mocks.request.mock.calls.at(-1)[0]).toMatch(/\/vibe64\/pages\/results\/star$/);
    expect(mocks.request.mock.calls.at(-1)[1]).toEqual({ method: "POST", body: { starred: true } });
    finish({ ok: true, pages: [summary, results] });
    await starring;
    expect(stars.pendingIds.value).toEqual([]);

    const again = scope.run(() => usePageStars("team"));
    await flush();
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(again.isStarred("results")).toBe(true);

    mocks.request.mockResolvedValueOnce({ ok: false, error: "The star could not be saved here." })
      .mockResolvedValueOnce({ ok: true, pages: [summary, results] });
    const unstarring = stars.toggle(summary);
    expect(again.pages.value).toEqual([results]);
    await unstarring;
    expect(again.pages.value).toEqual([summary, results]);
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ message: "The star could not be saved here." }), "The star could not be saved.");

    mocks.request.mockResolvedValueOnce({ ok: true, pages: [] });
    const other = scope.run(() => usePageStars("other-project"));
    await flush();
    expect(other.pages.value).toEqual([]);
    expect(other.isStarred("results")).toBe(false);
    scope.stop();
  });
});
