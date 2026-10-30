// A recording's requests are read page by page, as the server pages them:
// Show more adds the next page, and a live recording reads newest first and
// keeps the rows already shown when new requests arrive.
import { configureHttpWebClient, getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api/app/demo${suffix}` }) }));
import { useVibe64UsageWeb } from "../../packages/vibe64-system-graph/src/client/usage/useVibe64UsageWeb.js";

const originalClient = getHttpWebClient();
afterEach(() => configureHttpWebClient(originalClient));

const requestRow = (number) => ({ id: `r_${String(number).padStart(6, "0")}`, method: "GET", path: `/api/items/${number}`, functionCount: 1, fileCount: 1, interaction: null });
const requestRows = (count, first = 1) => Array.from({ length: count }, (_, index) => requestRow(first + index));

// The server's requests read: offset cursors, newest first on request, and the total.
function serve(recorded) {
  const queries = [];
  configureHttpWebClient({
    async request(path, { query = {} } = {}) {
      queries.push(query);
      const rows = query.order === "newest" ? [...recorded].reverse() : recorded;
      const offset = Number(query.cursor || 0);
      const end = offset + Number(query.limit);
      return { requests: rows.slice(offset, end), interactions: [], nextCursor: end < rows.length ? String(end) : null, total: rows.length };
    }
  });
  return queries;
}

const ids = (data) => data.requests.map((row) => row.id);
const filter = (values = {}) => ({ recordingId: "rec_aaaaaaaaaaaaaaaaaaaa", q: "", includeEmpty: false, newestFirst: false, ...values });

describe("recording requests", () => {
  it("shows the first 200 with the total, and Show more adds pages until every request is shown", async () => {
    const queries = serve(requestRows(450));
    const { requests } = useVibe64UsageWeb({ sessionId: "s1" });
    await requests.run(filter());
    expect([requests.data.value.requests.length, requests.data.value.total, requests.data.value.nextCursor]).toEqual([200, 450, "200"]);
    expect(queries[0]).toEqual({ limit: 200 });
    await requests.more();
    await requests.more();
    expect(ids(requests.data.value)).toEqual(requestRows(450).map((row) => row.id));
    expect(requests.data.value.nextCursor).toBeNull();
    expect(await requests.more()).toBeNull();
    expect(queries).toHaveLength(3);
  });

  it("reads a live recording newest first and puts new requests on top of the rows shown", async () => {
    const recorded = requestRows(450);
    const queries = serve(recorded);
    const { requests } = useVibe64UsageWeb({ sessionId: "s1" });
    const live = filter({ newestFirst: true });
    await requests.run(live);
    expect(queries[0]).toEqual({ order: "newest", limit: 200 });
    expect(ids(requests.data.value).slice(0, 2)).toEqual(["r_000450", "r_000449"]);
    await requests.more();

    recorded.push(...requestRows(5, 451));
    await requests.refresh(live);
    const shown = ids(requests.data.value);
    expect(shown.slice(0, 6)).toEqual(["r_000455", "r_000454", "r_000453", "r_000452", "r_000451", "r_000450"]);
    expect([shown.length, new Set(shown).size, requests.data.value.total]).toEqual([405, 405, 455]);
    // The next page continues below the rows shown, without repeating them.
    await requests.more();
    expect(ids(requests.data.value)).toEqual([...recorded].reverse().map((row) => row.id));

    // More new requests than one page: the list starts again from the newest.
    recorded.push(...requestRows(300, 456));
    await requests.refresh(live);
    expect([ids(requests.data.value)[0], requests.data.value.requests.length, requests.data.value.nextCursor]).toEqual(["r_000755", 200, "200"]);
  });

  it("reads a request's own row with what it ran, to name it beyond the pages read", async () => {
    const reads = [];
    configureHttpWebClient({
      async request(path, { query = {} } = {}) {
        reads.push([path.split("/").pop(), query]);
        if (path.endsWith("/functions")) return { functions: [], total: 0, truncated: false };
        if (path.endsWith("/join")) return { joined: [], edges: [], subsystems: [] };
        return { requests: [requestRow(450)], interactions: [], nextCursor: null, total: 1 };
      }
    });
    const { result } = useVibe64UsageWeb({ sessionId: "s1" });
    await result.run({ recordingId: "rec_aaaaaaaaaaaaaaaaaaaa", requestId: "r_000450" });
    expect(result.data.value.request).toMatchObject({ id: "r_000450", path: "/api/items/450" });
    expect(reads).toContainEqual(["requests", { requestId: "r_000450", limit: 1 }]);
  });

  it("reads again from the start when the search or filter changed", async () => {
    serve(requestRows(450));
    const { requests } = useVibe64UsageWeb({ sessionId: "s1" });
    await requests.run(filter());
    await requests.more();
    await requests.refresh(filter({ includeEmpty: true }));
    expect([requests.data.value.requests.length, ids(requests.data.value)[0]]).toEqual([200, "r_000001"]);
  });
});
