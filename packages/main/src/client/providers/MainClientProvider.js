import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";

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
