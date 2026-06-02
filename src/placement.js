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

addPlacement({
  id: "vibe64.accounts.top-action",
  target: "shell.global-actions",
  kind: "component",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.top-action-link-item",
  props: {
    label: "Accounts",
    icon: "mdi-account-key-outline",
    to: "/home/accounts",
    returnToCurrent: true,
    exact: true
  }
});

// jskit:ui-generator.page.link:home:/dashboard/configure
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.configure.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 100,
    props: {
      label: "Configure",
      icon: "mdi-cog-outline",
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
      icon: "mdi-play-box-multiple-outline",
      surface: "home",
      scopedSuffix: "/dashboard/run",
      unscopedSuffix: "/dashboard/run",
      to: "./run",
    },
  });
}
// jskit:ui-generator.page.link:home:/dashboard/remote
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.remote.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 400,
    props: {
      label: "Remote",
      icon: "mdi-cloud-upload-outline",
      surface: "home",
      scopedSuffix: "/dashboard/remote",
      unscopedSuffix: "/dashboard/remote",
      to: "./remote",
    },
  });
}
// jskit:ui-generator.page.link:home:/dashboard/history
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.history.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 600,
    props: {
      label: "Session History",
      icon: "mdi-history",
      surface: "home",
      scopedSuffix: "/dashboard/history",
      unscopedSuffix: "/dashboard/history",
      to: "./history",
    },
  });
}
// jskit:ui-generator.page.link:home:/dashboard/setup
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.setup.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 700,
    props: {
      label: "Setup",
      icon: "mdi-tune",
      surface: "home",
      scopedSuffix: "/dashboard/setup",
      unscopedSuffix: "/dashboard/setup",
      to: "./setup",
    },
  });
}
