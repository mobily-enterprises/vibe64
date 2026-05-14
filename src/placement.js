import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "jskit-ai-studio.home.menu.bootup",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 40,
  props: {
    label: "Bootup",
    to: "/bootup",
    exact: true
  }
});

addPlacement({
  id: "jskit-ai-studio.home.menu.app-bootup",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 50,
  props: {
    label: "App Bootup",
    to: "/app-bootup",
    exact: true
  }
});

addPlacement({
  id: "jskit-ai-studio.home.menu.app-setup",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 60,
  props: {
    label: "App Setup",
    to: "/app-setup",
    exact: true
  }
});

addPlacement({
  id: "jskit-ai-studio.home.menu.history",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 70,
  props: {
    label: "Session History",
    to: "/home/history",
    exact: true
  }
});

addPlacement({
  id: "jskit-ai-studio.home.menu.home",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 40,
  props: {
    label: "Sessions",
    to: "/home",
    exact: true
  }
});
