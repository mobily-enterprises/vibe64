import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SectionTabLinkItem from "/src/components/menus/SectionTabLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";

const MainClientProvider = defineProvider({
  id: "local.main.client",
  requires: {
    components: "client.components"
  },
  /** @param {{ components: import("@jskit-ai/kernel/client/types").ClientComponents }} capabilities */
  setup({ components }) {
    components.register("local.main.ui.menu-link-item", MenuLinkItem);
    components.register("local.main.ui.surface-aware-menu-link-item", SurfaceAwareMenuLinkItem);
    components.register("local.main.ui.tab-link-item", TabLinkItem);
    // A page's section tabs (page.section-nav): Material 3 primary tabs, not navigation bar destinations.
    components.register("local.main.ui.section-tab-link-item", SectionTabLinkItem);
  }
});

export { MainClientProvider };
