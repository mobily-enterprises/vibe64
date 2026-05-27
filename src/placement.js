import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "vibe64.home.menu.setup",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 40,
  props: {
    label: "Setup",
    to: "/setup",
    exact: true
  }
});

addPlacement({
  id: "vibe64.home.menu.configure",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 50,
  props: {
    label: "Configure",
    to: "/home?configure=project",
    exact: true
  }
});

addPlacement({
  id: "vibe64.home.menu.history",
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
  id: "vibe64.home.menu.home",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 40,
  props: {
    label: "Sessions",
    to: "/home",
    exact: false
  }
});

addPlacement({
  id: "ui-generator.page.home.target-scripts.link",
  target: "shell.secondary-nav",
  kind: "component",
  surfaces: ["home"],
  order: 60,
  componentToken: "local.main.ui.vibe64-target-scripts-nav-link"
});


addPlacement({
  id: "realtime.connection.indicator",
  target: "shell.status",
  kind: "component",
  surfaces: ["*"],
  order: 950,
  componentToken: "realtime.web.connection.indicator"
});
