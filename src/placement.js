import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "jskit-ai-studio.home.menu.bootup-setup",
  target: "shell.secondary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 40,
  props: {
    label: "Bootup/Setup",
    to: "/bootup-setup",
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
// jskit:ui-generator.page.link:home:/npm-scripts
{
  addPlacement({
    id: "ui-generator.page.home.npm-scripts.link",
    target: "shell.secondary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 60,
    props: {
      label: "NPM Scripts",
      icon: "mdi-view-list-outline",
      surface: "home",
      scopedSuffix: "/npm-scripts",
      unscopedSuffix: "/npm-scripts"
    }
  });
}
