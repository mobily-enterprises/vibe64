import { createSSRApp, defineComponent, h, reactive } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import {
  provideVibe64OpenedProjectSlug,
  useVibe64ProjectSlug
} from "../../src/composables/useVibe64ProjectScope.js";

async function projectSlugs({ opened }) {
  const route = reactive({ params: { slug: "mercbot" }, query: {} });
  let inside = null;
  const Child = defineComponent({
    setup() {
      inside = useVibe64ProjectSlug(route);
      return () => h("span");
    }
  });
  const Parent = defineComponent({
    setup() {
      if (opened) provideVibe64OpenedProjectSlug(route);
      return () => h(Child);
    }
  });
  await renderToString(createSSRApp(Parent));
  route.params.slug = "mercbot-inspector";
  return inside.value;
}

describe("opened project slug", () => {
  it("keeps an opened project's view on its project while the route names the next one", async () => {
    expect(await projectSlugs({ opened: true })).toBe("mercbot");
  });

  it("follows the route outside an opened project view", async () => {
    expect(await projectSlugs({ opened: false })).toBe("mercbot-inspector");
  });
});
