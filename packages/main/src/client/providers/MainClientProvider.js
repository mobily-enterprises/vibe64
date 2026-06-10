import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";
import TopActionLinkItem from "/src/components/menus/TopActionLinkItem.vue";
import {
  registerVibe64CapabilitiesRealtimeListener
} from "../vibe64CapabilitiesRealtime.js";

const mainClientComponents = [];

function registerMainClientComponent(token, resolveComponent) {
  mainClientComponents.push({ token, resolveComponent });
}

class MainClientProvider {
  static id = "local.main.client";

  register(app) {
    for (const { token, resolveComponent } of mainClientComponents) {
      app.singleton(token, resolveComponent);
    }
    registerVibe64CapabilitiesRealtimeListener(app);
  }
}

export {
  MainClientProvider,
  registerMainClientComponent
};

registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);
registerMainClientComponent("local.main.ui.surface-aware-menu-link-item", () => SurfaceAwareMenuLinkItem);
registerMainClientComponent("local.main.ui.tab-link-item", () => TabLinkItem);
registerMainClientComponent("local.main.ui.top-action-link-item", () => TopActionLinkItem);
