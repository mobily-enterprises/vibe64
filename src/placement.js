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
  id: "vibe64.session-info",
  target: "vibe64.session-dashboard",
  kind: "component",
  surfaces: ["home"],
  order: 100,
  componentToken: "local.main.ui.vibe64-session-info-dashboard"
});
