// The props and events of the session's Autopilot view (Vibe64AutopilotView.vue).
const vibe64AutopilotViewEmits = [
  "busy-change",
  "chat-attention",
  "execution-attention",
  "project-attention"
];
const vibe64AutopilotViewProps = {
  active: {
    default: true,
    type: Boolean
  },
  agentConnectionError: {
    default: "",
    type: String
  },
  agentConnectionStatus: {
    default: "connected",
    type: String
  },
  retryAgentConnection: {
    default: () => {},
    type: Function
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  cancelAgentMessage: {
    default: async () => false,
    type: Function
  },
  conversationRuntime: { required: true, type: Object },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  createSessionTeleportTarget: {
    default: "",
    type: String
  },
  interruptAgentTurn: {
    default: async () => false,
    type: Function
  },
  page: {
    default: () => ({}),
    type: Object
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  usageRecordingTeleportTarget: {
    default: "",
    type: String
  },
  promptHintPolicy: {
    default: () => ({
      enabled: true,
      ready: false,
      revision: 0,
      version: 0
    }),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  projectPane: {
    default: "preview",
    type: String
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  refreshSessionWork: {
    default: async () => null,
    type: Function
  },
  retryWorkspaceSetup: {
    default: async () => false,
    type: Function
  },
  saveSessionWork: {
    default: async () => false,
    type: Function
  },
  updateSessionWork: {
    default: async () => false,
    type: Function
  },
  sendAgentMessage: {
    default: async () => false,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  sessionArchive: {
    default: () => ({}),
    type: Object
  },
  sessionRenewal: {
    default: () => ({}),
    type: Object
  },
  sessionSelectionArchived: {
    default: false,
    type: Boolean
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  workState: {
    default: () => ({}),
    type: Object
  }
};

export {
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
