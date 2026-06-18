import { createPlacementRegistry } from "@jskit-ai/shell-web/client/placement";
import {
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

// jskit:ui-generator.page.link:app:/dashboard/configure
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.configure.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 100,
    props: {
      label: "Configure",
      icon: mdiCogOutline,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/configure",
      unscopedSuffix: "/project/[slug]/dashboard/configure",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/run
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.run.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 500,
    props: {
      label: "Run",
      icon: mdiPlayBoxMultipleOutline,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/run",
      unscopedSuffix: "/project/[slug]/dashboard/run",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/remote
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.remote.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 400,
    props: {
      label: "Github repository",
      icon: mdiCloudUploadOutline,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/remote",
      unscopedSuffix: "/project/[slug]/dashboard/remote",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/history
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.history.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 600,
    props: {
      label: "Session History",
      icon: mdiHistory,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/history",
      unscopedSuffix: "/project/[slug]/dashboard/history",
      to: "",
    },
  });
}
// jskit:ui-generator.page.link:app:/dashboard/setup
{
  addPlacement({
    id: "ui-generator.page.app.dashboard.setup.link",
    target: "page.section-nav",
    owner: "app-dashboard",
    kind: "link",
    surfaces: ["app"],
    order: 700,
    props: {
      label: "Setup",
      icon: mdiTune,
      surface: "app",
      scopedSuffix: "/project/[slug]/dashboard/setup",
      unscopedSuffix: "/project/[slug]/dashboard/setup",
      to: "",
    },
  });
}
