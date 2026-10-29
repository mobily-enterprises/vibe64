import { readFileSync } from "node:fs";
import { createRenderer, defineComponent, h, ref, ssrContextKey } from "vue";
import { afterEach, expect, it } from "vitest";
import { parse } from "@vue/compiler-sfc";

import RuntimeConfigRecordsView from "../../src/components/studio/RuntimeConfigRecordsView.vue";
import {
  SAVED_ENV_VALUE_SOURCE,
  VIBE64_SAVED_ENV_VALUES_KEY,
  recordIsSavedEnvValue,
  savedEnvValueEnvironment,
  useVibe64SavedEnvValues
} from "../../src/lib/vibe64SavedEnvValues.js";

const renderer = createRenderer({
  createComment: (text) => ({ text }), createElement: () => ({}), createText: (text) => ({ text }),
  insert() {}, nextSibling() {}, parentNode() {}, patchProp() {}, remove() {}, setElementText() {}, setText() {}
});
let app;
afterEach(() => app?.unmount());

function mountWith(component, props = {}, provided) {
  app = renderer.createApp({ ...component, render: () => null }, props);
  app.provide(ssrContextKey, { modules: new Set() });
  if (provided !== undefined) app.provide(VIBE64_SAVED_ENV_VALUES_KEY, provided);
  app.mount({});
  return app._instance.setupState;
}

function savedValuesFrom(provided) {
  let host;
  mountWith(defineComponent({ setup() { host = useVibe64SavedEnvValues(); return {}; } }), {}, provided);
  return host.value;
}

function source(file) {
  const text = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  if (file.endsWith(".vue")) expect(parse(text, { filename: file }).errors).toEqual([]);
  return text;
}

const Picker = defineComponent({ render: () => h("span") });

it("renders nothing for saved values when the host provides none", () => {
  expect(savedValuesFrom(undefined)).toBe(null);
  expect(savedValuesFrom({ label: "Test vault" })).toBe(null);
  expect(savedValuesFrom({ component: Picker })).toBe(null);
});

it("accepts a host's saved-value component directly or through a ref", () => {
  expect(savedValuesFrom({ label: "Test vault", component: Picker })).toMatchObject({ label: "Test vault" });
  const later = ref(null);
  expect(savedValuesFrom(later)).toBe(null);
  expect(savedValuesFrom(ref({ label: "Test vault", component: Picker }))).toMatchObject({ label: "Test vault" });
});

it("recognises only non-editable host rows as linked saved values", () => {
  expect(recordIsSavedEnvValue({ source: SAVED_ENV_VALUE_SOURCE, editable: false })).toBe(true);
  expect(recordIsSavedEnvValue({ source: SAVED_ENV_VALUE_SOURCE, editable: true })).toBe(false);
  expect(recordIsSavedEnvValue({ source: "vibe64-host:managed-resource", editable: false })).toBe(false);
  expect(savedEnvValueEnvironment("production")).toBe("production");
  expect(savedEnvValueEnvironment("development")).toBe("development");
  expect(savedEnvValueEnvironment("environment")).toBe("development");
});

it("lists linked rows with the person's own values, never under System values", () => {
  const state = mountWith(RuntimeConfigRecordsView, { records: [
    { key: "SHOP_NAME", editable: true, source: "user" },
    { key: "STRIPE_SECRET_KEY", editable: false, secret: true, source: SAVED_ENV_VALUE_SOURCE, label: "From Test vault: Stripe" },
    { key: "DATABASE_URL", editable: false, secret: true, source: "vibe64-host:managed-resource:db" }
  ] });
  expect(state.editableRecords.map((record) => record.key)).toEqual(["SHOP_NAME", "STRIPE_SECRET_KEY"]);
  expect(state.systemRecords.map((record) => record.key)).toEqual(["DATABASE_URL"]);
});

it("a readonly view keeps the person's rows but drops their edit and remove actions", () => {
  const view = source("src/components/studio/RuntimeConfigRecordsView.vue");
  expect(view).toContain(':show-actions="!readonly"');
  expect(view).not.toMatch(/^\s+show-actions$/mu);
  const state = mountWith(RuntimeConfigRecordsView, { readonly: true, records: [{ key: "SHOP_NAME", editable: true, source: "user" }] });
  expect(state.editableRecords.map((record) => record.key)).toEqual(["SHOP_NAME"]);
});

it("mounts the host component only when provided, with the documented props", () => {
  const table = source("src/components/studio/RuntimeConfigRecordsTable.vue");
  const panel = source("src/components/studio/EnvPanel.vue");
  const integrations = source("src/components/studio/IntegrationsPanel.vue");
  for (const [text, placement] of [[table, "env-row"], [panel, "env-add"], [integrations, "integration-credential"]]) {
    expect(text).toContain(`placement="${placement}"`);
    expect(text).toMatch(/:is="savedValues\.component"\s+v-if="savedValues/u);
  }
  expect(table).toContain("@changed=\"$emit('saved-value-changed')\"");
  expect(panel).toContain('@saved-value-changed="refresh"');
  // A linked credential replaces the Env button; the host reports the link.
  expect(integrations).toContain('v-if="!credentialLinked(credential.key)"');
  expect(integrations).toContain('@linked="setCredentialLinked(credential.key, $event)"');
});

it("offers a connected-account row for a refresh token kept in Env", () => {
  const integrations = source("src/components/studio/IntegrationsPanel.vue");
  expect(integrations).toContain("authentication.refreshTokenRef");
  expect(integrations).toContain('label: "Connected account"');
});
