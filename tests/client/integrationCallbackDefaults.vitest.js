import { effectScope, nextTick, reactive, ref } from "vue";
import { expect, it, vi } from "vitest";

// This exercises form state only; rendered Vuetify controls are covered by browser fixtures.
vi.mock("vuetify/components/VAlert", () => ({ VAlert: {} }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: {} }));
vi.mock("vuetify/components/VBtnToggle", () => ({ VBtnToggle: {} }));
vi.mock("vuetify/components/VCard", () => ({ VCard: {}, VCardText: {}, VCardActions: {} }));
vi.mock("vuetify/components/VDialog", () => ({ VDialog: {} }));
vi.mock("vuetify/components/VExpansionPanel", () => ({ VExpansionPanel: {}, VExpansionPanelText: {}, VExpansionPanels: {} }));
vi.mock("vuetify/components/VList", () => ({ VList: {}, VListItem: {} }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: {} }));
vi.mock("vuetify/components/VTextField", () => ({ VTextField: {} }));
vi.mock("vuetify/components/VTextarea", () => ({ VTextarea: {} }));
vi.mock("vue", async (load) => ({ ...await load(), onMounted() {}, onUnmounted() {}, useSSRContext: () => ({ modules: new Set() }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: { integrationSession: "session-1", integration: "calendar" } }) }));
vi.mock("@jskit-ai/connectors-web/client", () => ({ IntegrationConfigurationFields: {} }));
vi.mock("@/components/common/Vibe64AsyncModuleState.vue", () => ({ default: {} }));
vi.mock("@/lib/browserLocalStorage.js", () => ({ readLocalStorageJson: (_key, fallback) => fallback, writeLocalStorageJson() {} }));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => ref("dogandgroom") }));
vi.mock("@/composables/useVibe64Integrations.js", () => ({ useVibe64Integrations: () => ({
  releaseId: ref(""), connection: ref(null), verificationInput: ref({}), dirty: ref(false),
  configuration: ref({ registrations: { google: { callbackUrlRef: "env:GOOGLE_CALLBACK" } }, integrations: {
    calendar: { provider: "google-calendar", authentication: { method: "oauth2", registrationRef: "google" } }
  } })
}) }));
import IntegrationsPanel from "@/components/studio/IntegrationsPanel.vue";

it("updates the application callback suggestion without changing an explicit override or saved Env reference", async () => {
  const scope = effectScope();
  const props = reactive({ dashboardContext: { sessionId: "session-1", applicationPublicUrl: "https://sas-dogandgroom.hosting.vibe64.dev" } });
  const form = scope.run(() => IntegrationsPanel.setup(props, { expose() {} }));
  try {
    expect(form.callbackUrl.value).toBe("https://sas-dogandgroom.hosting.vibe64.dev/integrations/google/callback");
    props.dashboardContext.applicationPublicUrl = "https://dogandgroom.example";
    await nextTick();
    expect(form.callbackUrl.value).toBe("https://dogandgroom.example/integrations/google/callback");
    form.callbackUrl.value = "https://explicit.example/custom-callback";
    props.dashboardContext.applicationPublicUrl = "https://another.example";
    await nextTick();
    expect(form.callbackUrl.value).toBe("https://explicit.example/custom-callback");
    expect(form.registration.value.callbackUrlRef).toBe("env:GOOGLE_CALLBACK");
    form.callbackOverride.value = null;
    props.dashboardContext.applicationPublicUrl = "";
    await nextTick();
    expect(form.callbackUrl.value).toBe("");
    expect(form.registration.value.callbackUrlRef).toBe("env:GOOGLE_CALLBACK");
  } finally { scope.stop(); }
});

it("prepares MCP registration from the current project callback, region and permissions before credentials exist", async () => {
  const scope = effectScope();
  const props = reactive({ dashboardContext: { sessionId: "session-1", applicationPublicUrl: "https://sas-dogandgroom.hosting.vibe64.dev" } });
  const form = scope.run(() => IntegrationsPanel.setup(props, { expose() {} }));
  try {
    expect(form.clientRegistrationBody.value).toBe("");
    form.add(form.providers.find((provider) => provider.id === "amplitude"));
    await nextTick();
    expect(form.registration.value.clientId).toBe("");
    expect(form.clientRegistrationEndpoint.value).toBe("https://mcp.amplitude.com/register");
    const request = JSON.parse(form.clientRegistrationBody.value);
    expect(request).toEqual({
      client_name: "dogandgroom — Amplitude",
      redirect_uris: ["https://sas-dogandgroom.hosting.vibe64.dev/integrations/amplitude/callback"],
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      scope: "mcp:read offline_access"
    });
    form.selected.value.settings = { region: "eu" };
    form.selected.value.scopes = ["mcp:read", "mcp:write"];
    form.callbackUrl.value = "https://custom.example/assistant/callback";
    expect(form.clientRegistrationEndpoint.value).toBe("https://mcp.eu.amplitude.com/register");
    expect(JSON.parse(form.clientRegistrationBody.value)).toMatchObject({
      redirect_uris: ["https://custom.example/assistant/callback"], scope: "mcp:read mcp:write"
    });
    form.callbackUrl.value = "";
    expect(form.clientRegistrationBody.value).toBe("");
    form.add(form.providers.find((provider) => provider.id === "atlassian"));
    await nextTick();
    expect(form.clientRegistrationEndpoint.value).toBe("https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register");
    const atlassian = JSON.parse(form.clientRegistrationBody.value);
    expect(atlassian.redirect_uris).toEqual(["https://sas-dogandgroom.hosting.vibe64.dev/integrations/atlassian/callback"]);
    expect(atlassian.scope.split(" ")).toEqual(form.selected.value.scopes);
    expect(atlassian).not.toHaveProperty("client_secret");
    expect(form.registration.value.clientId).toBe("");
  } finally { scope.stop(); }
});

it("prepares Canva metadata from current fields without publishing it or including secrets", async () => {
  const scope = effectScope();
  const props = reactive({ dashboardContext: { sessionId: "session-1", applicationPublicUrl: "https://dogandgroom.example" } });
  const form = scope.run(() => IntegrationsPanel.setup(props, { expose() {} }));
  try {
    expect(form.clientMetadata.value).toBeNull();
    form.add(form.providers.find((provider) => provider.id === "canva"));
    await nextTick();
    expect(form.clientMetadata.value.json).toBe("");
    form.registration.value.clientId = "https://dogandgroom.example/oauth/canva.json";
    expect(JSON.parse(form.clientMetadata.value.json)).toEqual({
      client_id: "https://dogandgroom.example/oauth/canva.json", client_name: "Canva",
      redirect_uris: ["https://dogandgroom.example/integrations/canva/callback"],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none"
    });
    form.selected.value.displayName = "Design helper";
    form.callbackUrl.value = "https://custom.example/assistant/callback";
    expect(JSON.parse(form.clientMetadata.value.json)).toMatchObject({
      client_name: "Design helper", redirect_uris: ["https://custom.example/assistant/callback"]
    });
    form.registration.value.clientId = "http://insecure.example/client.json";
    expect(form.clientMetadata.value.json).toBe("");
    expect(form.clientMetadata.value.error).toContain("valid Client metadata URL");
  } finally { scope.stop(); }
});
