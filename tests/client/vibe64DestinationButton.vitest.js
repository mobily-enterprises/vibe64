import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { expect, it } from "vitest";
import Vibe64DestinationButton from "../../src/components/studio/Vibe64DestinationButton.vue";

const aliases = { dashboard: "icon-dashboard", hub: "icon-hub", viewList: "icon-view-list", arrowBack: "icon-arrow-back" };

function render(place) {
  const view = createSSRApp({ render: () => h(Vibe64DestinationButton, { place }) });
  view.use(createVuetify({ ssr: true, icons: { aliases } }));
  return renderToString(view);
}

it.each([
  ["dashboard", "Dashboard", "icon-dashboard"],
  ["architecture", "Architecture", "icon-hub"],
  ["issue-list", "All issues", "icon-view-list"],
  ["pull-request-list", "All pull requests", "icon-view-list"]
])("names %s by its place, with the place's icon and no back arrow", async (place, label, icon) => {
  const html = await render(place);
  expect(html).toMatch(new RegExp(`<button[^>]*type="button"[^>]*>[\\s\\S]*${label}[\\s\\S]*</button>`, "u"));
  expect(html).toContain(icon);
  expect(html).not.toContain("icon-arrow-back");
  expect(html).not.toMatch(/\bBack\b/u);
});

it("knows only its named places, so it can never be labelled Back", () => {
  const { validator } = Vibe64DestinationButton.props.place;
  expect(["dashboard", "architecture", "issue-list", "pull-request-list"].every(validator)).toBe(true);
  for (const place of ["back", "Back", "previous", "", "toString"]) expect(validator(place)).toBe(false);
});
