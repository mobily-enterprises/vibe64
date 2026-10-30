// The Recording rail says how many requests it shows of how many, offers the
// next page, and lays rows out alike for every kind of request.
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { describe, expect, it } from "vitest";
import { mdiCogOutline } from "@mdi/js";

import Vibe64UsageRecordingResults from "../../packages/vibe64-system-graph/src/client/usage/Vibe64UsageRecordingResults.vue";
import recordingList from "../fixtures/usage-map/recording/api/list.json" with { type: "json" };
import requests from "../fixtures/usage-map/recording/api/requests.json" with { type: "json" };

const [recording] = recordingList.recordings;

async function render(props) {
  const app = createSSRApp(Vibe64UsageRecordingResults, { recordings: [recording], recordingId: recording.id, ...props });
  app.use(createVuetify({ ssr: true }));
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/gu, "").replace(/ data-v-[0-9a-f]+/gu, "");
}

const many = (count) => Array.from({ length: count }, (_, index) => ({
  id: `r_${String(index + 1).padStart(6, "0")}`, method: "GET", path: `/api/items/${index + 1}`, status: 200, interaction: null, functionCount: 2, fileCount: 1
}));

describe("Recording requests list", () => {
  it("says how many requests it shows of how many, with Show more", async () => {
    const html = await render({ requests: many(200), total: 450, hasMore: true });
    expect(html).toContain("Showing 200 of 450 requests");
    expect(html).toContain("Show more");
    const live = await render({ requests: many(200), total: 450, hasMore: true, newestFirst: true });
    expect(live).toContain("Showing 200 of 450 requests, newest first");
    const all = await render({ requests: requests.requests, total: requests.total });
    expect(all).not.toContain("Showing");
    expect(all).not.toContain("Show more");
    expect(await render({ requests: requests.requests, total: requests.total, newestFirst: true })).toContain("Newest requests first");
  });

  it("wraps paths between folders and marks start-up work without a method", async () => {
    const html = await render({ requests: requests.requests, interactions: requests.interactions });
    expect(html).toContain("/<wbr>api/<wbr>sessions<wbr>");
    expect(html).not.toContain(">ALL<");
    expect(html).toMatch(new RegExp(`usage-recordings__method[^>]*>(?:<[^>]*>)*<i class="${mdiCogOutline.slice(0, 24)}`, "u"));
    expect(html).toContain("Click: button &quot;Add&quot; (SessionList.vue)");
  });
});
