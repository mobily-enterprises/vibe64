import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";

const registry = createPlacementRegistry();
const { addPlacement } = registry;

export { addPlacement };

export default function getPlacements() {
  return registry.build();
}

addPlacement({
  id: "realtime.connection.indicator",
  target: "shell.status",
  kind: "component",
  surfaces: ["*"],
  order: 950,
  componentToken: "realtime.web.connection.indicator"
});

// jskit:ui-generator.page.link:home:/dashboard/session
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.session.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 100,
    props: {
      label: "Session Details",
      icon: "mdi-view-list-outline",
      surface: "home",
      scopedSuffix: "/dashboard/session",
      unscopedSuffix: "/dashboard/session",
      to: "./session",
    },
  });
}
// jskit:ui-generator.page.link:home:/dashboard/configure
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.configure.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 200,
    props: {
      label: "Configure",
      icon: "mdi-view-list-outline",
      surface: "home",
      scopedSuffix: "/dashboard/configure",
      unscopedSuffix: "/dashboard/configure",
      to: "./configure",
    },
  });
}
// jskit:ui-generator.page.link:home:/dashboard/run
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.run.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 500,
    props: {
      label: "Run",
      icon: "mdi-view-list-outline",
      surface: "home",
      scopedSuffix: "/dashboard/run",
      unscopedSuffix: "/dashboard/run",
      to: "./run",
    },
  });
}
