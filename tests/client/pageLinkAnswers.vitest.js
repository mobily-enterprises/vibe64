import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readPage: vi.fn() }));
vi.mock("../../packages/vibe64-pages/src/client/pagesRequests.js", () => ({ readPage: mocks.readPage }));
import { pageLinkAnswers, readPageLink } from "../../packages/vibe64-pages/src/client/pageLinkAnswers.js";

const link = { path: "/fixture/pages/report", projectSlug: "fixture", pageId: "report" };

it("cards of one page share the read on the way, and a later card reads the page again", async () => {
  const first = Promise.withResolvers();
  mocks.readPage.mockReturnValueOnce(first.promise);
  const reads = [readPageLink(link), readPageLink(link), readPageLink(link)];
  expect(mocks.readPage).toHaveBeenCalledTimes(1);
  expect(pageLinkAnswers[link.path]).toEqual({ loading: true });
  first.resolve({ page: { id: "report", title: "Report" } });
  await Promise.all(reads);
  expect(pageLinkAnswers[link.path]).toEqual({ page: { id: "report", title: "Report" } });
  mocks.readPage.mockResolvedValueOnce({ page: { id: "report", title: "Report, updated" } });
  await readPageLink(link);
  expect(mocks.readPage).toHaveBeenCalledTimes(2);
  expect(pageLinkAnswers[link.path].page.title).toBe("Report, updated");
});
