import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";
import Vibe64TargetScriptsNavLink from "/src/components/studio/Vibe64TargetScriptsNavLink.vue";

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
  }
}

export {
  MainClientProvider,
  registerMainClientComponent
};

registerMainClientComponent("local.main.ui.menu-link-item", () => MenuLinkItem);
registerMainClientComponent("local.main.ui.surface-aware-menu-link-item", () => SurfaceAwareMenuLinkItem);
registerMainClientComponent("local.main.ui.tab-link-item", () => TabLinkItem);
registerMainClientComponent("local.main.ui.vibe64-target-scripts-nav-link", () => Vibe64TargetScriptsNavLink);
