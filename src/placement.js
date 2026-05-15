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

addPlacement({
  id: "jskit-ai-studio.home.menu.completed",
  target: "shell.primary-nav",
  kind: "link",
  surfaces: ["home"],
  order: 150,
  props: {
    label: "Completed",
    icon: "mdi-check-circle-outline",
    surface: "home",
    scopedSuffix: "/completed",
    unscopedSuffix: "/completed",
    to: "/home/completed"
  }
});
// jskit:ui-generator.page.link:home:/abandoned
{
  addPlacement({
    id: "ui-generator.page.home.abandoned.link",
    target: "shell.primary-nav",
    kind: "link",
    surfaces: ["home"],
    order: 155,
    props: {
      label: "Abandoned",
      icon: "mdi-view-list-outline",
      surface: "home",
      scopedSuffix: "/abandoned",
      unscopedSuffix: "/abandoned",
      to: "/home/abandoned"
    }
  });
}
