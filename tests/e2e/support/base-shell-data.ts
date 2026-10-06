const PLAYWRIGHT_PORT = String(process.env.PLAYWRIGHT_PORT || "4173").trim() || "4173";
const DEFAULT_BASE_URL = `http://127.0.0.1:${PLAYWRIGHT_PORT}`;
const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/u, "");
const WORKSPACE_SLUG = "example-target-app";
const DEVELOPMENT_PATH = `/app/project/${WORKSPACE_SLUG}`;
const DASHBOARD_PATH = `${DEVELOPMENT_PATH}/dashboard`;
const SCOPED_API_PREFIX = `/api/app/${WORKSPACE_SLUG}`;

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

const targetRoot = "/workspace/example-target-app";
const projectRuntimeRoot = "/workspace/vibe64-local-editor/state/projects/example-target-app-test";
const sessionRuntimeRoot = (sessionId: string) =>
  `${projectRuntimeRoot}/sessions/active/${sessionId}`;

const readyProjectSelectionPayload = {
  ok: true,
  currentProject: {
    external: false,
    name: "example-target-app",
    path: targetRoot,
    selected: true,
    slug: WORKSPACE_SLUG,
    source: "workspace"
  },
  hasSelection: true,
  projects: [{
    external: false,
    name: "example-target-app",
    path: targetRoot,
    selected: true,
    slug: WORKSPACE_SLUG,
    source: "workspace"
  }],
  projectsRoot: "/workspace/vibe64",
  targetRoot
};

const bootstrapPayload = {
  app: {
    features: {
      assistantEnabled: false,
      assistantRequiredPermission: "",
      socialEnabled: false,
      socialFederationEnabled: false
    }
  },
  profile: null,
  requestMeta: {
    hasRequest: false
  },
  session: {
    authenticated: false,
    oauthDefaultProvider: null,
    oauthProviders: []
  },
  surfaceAccess: {},
  userSettings: null
};

const currentAppPayload = {
  components: ["nodejs"],
  diagnostics: [],
  message: "",
  ok: true,
  ready: true,
  resources: [],
  root: targetRoot,
  runtimeRequirements: ["nodejs"],
  stackHash: "sha256:e2e-genesis-stack",
  status: "ready",
  targets: [{
    id: "web",
    label: "Web"
  }]
};

function archivedSession({
  sessionId,
  sessionName,
  status
}: {
  sessionId: string;
  sessionName: string;
  status: string;
}) {
  const createdAt = "2026-05-12T03:10:00.000Z";
  return {
    archived: true,
    archivedAt: "2026-05-12T03:20:00.000Z",
    manifest: {
      createdAt,
      product: "vibe64",
      revision: 2,
      schemaVersion: 1,
      sessionId,
      updatedAt: "2026-05-12T03:20:00.000Z"
    },
    metadata: {
      source_removed: "yes"
    },
    revision: 2,
    sessionId,
    sessionName,
    sourceReady: false,
    status,
    targetRoot,
    updatedAt: "2026-05-12T03:20:00.000Z"
  };
}

const archivedHistorySession = archivedSession({
  sessionId: "2026-05-12_03-11-00",
  sessionName: "Archived direct chat",
  status: "archived"
});

export {
  BASE_URL,
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX,
  WORKSPACE_SLUG,
  archivedHistorySession,
  bootstrapPayload,
  currentAppPayload,
  projectRuntimeRoot,
  readyProjectSelectionPayload,
  sessionRuntimeRoot,
  targetRoot,
  viewports
};

export {
  directChatSessionId,
  directChatSessionPayload
} from "./base-shell/codex-data.ts";
