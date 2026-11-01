import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import MenuLinkItem from "/src/components/menus/MenuLinkItem.vue";
import SurfaceAwareMenuLinkItem from "/src/components/menus/SurfaceAwareMenuLinkItem.vue";
import TabLinkItem from "/src/components/menus/TabLinkItem.vue";
import TopActionLinkItem from "/src/components/menus/TopActionLinkItem.vue";
import Vibe64ActiveSessionNavItem from "/src/components/studio/Vibe64ActiveSessionNavItem.vue";
import {
  attachVibe64RealtimeQueryRecovery
} from "../vibe64RealtimeQueries.js";

const detachQueryRecoveryByRealtime = new WeakMap();

const MainClientProvider = defineProvider({
  id: "local.main.client",
  requires: {
    components: "client.components",
    queryClient: "client.query",
    realtime: "client.realtime"
  },
  setup({ components, queryClient, realtime }) {
    components.register("local.main.ui.menu-link-item", MenuLinkItem);
    components.register("local.main.ui.surface-aware-menu-link-item", SurfaceAwareMenuLinkItem);
    components.register("local.main.ui.tab-link-item", TabLinkItem);
    components.register("local.main.ui.top-action-link-item", TopActionLinkItem);
    components.register("local.main.vibe64.active-session-nav-item", Vibe64ActiveSessionNavItem);
    detachQueryRecoveryByRealtime.set(
      realtime,
      attachVibe64RealtimeQueryRecovery({ queryClient, realtime })
    );
  },
  // Setup always attaches the query recovery, so shutdown always detaches it.
  shutdown({ realtime }) {
    detachQueryRecoveryByRealtime.get(realtime)();
    detachQueryRecoveryByRealtime.delete(realtime);
  }
});

export {
  MainClientProvider
};
