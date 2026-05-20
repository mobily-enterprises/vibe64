import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "ai-studio.home.menu.setup",
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
  id: "ai-studio.home.menu.configure",
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
  id: "ai-studio.home.menu.history",
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
  id: "ai-studio.home.menu.home",
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

addPlacement({
  id: "ui-generator.page.home.target-scripts.link",
  target: "shell.secondary-nav",
  kind: "component",
  surfaces: ["home"],
  order: 60,
  componentToken: "local.main.ui.ai-studio-target-scripts-nav-link"
});
