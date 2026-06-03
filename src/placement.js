import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";
import {
  mdiAccountKeyOutline,
  mdiCloudUploadOutline,
  mdiCogOutline,
  mdiHistory,
  mdiPlayBoxMultipleOutline,
  mdiTune
} from "@mdi/js";

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

// jskit:ui-generator.page.link:home:/dashboard/accounts
{
  addPlacement({
    id: "ui-generator.page.home.dashboard.accounts.link",
    target: "page.section-nav",
    owner: "home-dashboard",
    kind: "link",
    surfaces: ["home"],
    order: 50,
    props: {
      label: "Accounts",
      icon: mdiAccountKeyOutline,
      surface: "home",
      scopedSuffix: "/dashboard/accounts",
      unscopedSuffix: "/dashboard/accounts",
      to: "/home/dashboard/accounts",
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
    order: 100,
    props: {
      label: "Configure",
      icon: mdiCogOutline,
      surface: "home",
      scopedSuffix: "/dashboard/configure",
      unscopedSuffix: "/dashboard/configure",
      to: "/home/dashboard/configure",
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
      icon: mdiPlayBoxMultipleOutline,
      surface: "home",
      scopedSuffix: "/dashboard/run",
      unscopedSuffix: "/dashboard/run",
      to: "/home/dashboard/run",
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
      icon: mdiCloudUploadOutline,
      surface: "home",
      scopedSuffix: "/dashboard/remote",
      unscopedSuffix: "/dashboard/remote",
      to: "/home/dashboard/remote",
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
      icon: mdiHistory,
      surface: "home",
      scopedSuffix: "/dashboard/history",
      unscopedSuffix: "/dashboard/history",
      to: "/home/dashboard/history",
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
      icon: mdiTune,
      surface: "home",
      scopedSuffix: "/dashboard/setup",
      unscopedSuffix: "/dashboard/setup",
      to: "/home/dashboard/setup",
    },
  });
}
