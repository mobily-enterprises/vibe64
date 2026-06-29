const VIBE64_CONNECTIONS_SERVICE = "feature.vibe64-connections.service";
const VIBE64_CONNECTION_PURPOSE_SESSION = "session";

function localConnectionRows() {
  return [
    {
      connected: true,
      id: "codex",
      label: "Codex",
      message: "Codex is available to the local editor.",
      ready: true,
      status: "connected"
    },
    {
      connected: true,
      id: "github",
      label: "Git",
      message: "Local git operations are available to the editor.",
      ready: true,
      status: "connected"
    }
  ];
}

function createLocalConnectionSetupService() {
  return Object.freeze({
    async getStatus() {
      const connections = localConnectionRows();
      return {
        connections,
        ok: true,
        ready: true
      };
    }
  });
}

function resolveConnectionSetupService(scope = null) {
  if (
    scope &&
    typeof scope.has === "function" &&
    typeof scope.make === "function" &&
    scope.has(VIBE64_CONNECTIONS_SERVICE)
  ) {
    return scope.make(VIBE64_CONNECTIONS_SERVICE);
  }
  return createLocalConnectionSetupService();
}

export {
  VIBE64_CONNECTIONS_SERVICE,
  VIBE64_CONNECTION_PURPOSE_SESSION,
  createLocalConnectionSetupService,
  resolveConnectionSetupService
};
