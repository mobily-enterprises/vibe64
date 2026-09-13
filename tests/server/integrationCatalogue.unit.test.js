import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import test from "node:test";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { integrationCategories, groupIntegrationProviders } from "../../src/lib/integrationCatalogue.js";

const providers = [googleCalendarDefinition, ...connectorDefinitions];

test("every service has exactly one category and a bundled icon", () => {
  const assigned = integrationCategories.flatMap((category) => category.providers);
  assert.equal(new Set(assigned).size, assigned.length);
  assert.deepEqual([...assigned].sort(), providers.map(({ id }) => id).sort());
  const root = new URL("../../src/assets/integrations/", import.meta.url);
  const files = readdirSync(root);
  for (const provider of providers) {
    if (provider.id === "ai") continue; // A choice of models, not one vendor.
    assert.ok(files.some((file) => file.startsWith(`${provider.id}.`)), provider.id);
  }
  assert.ok(existsSync(new URL("SOURCES.md", root)));
});

test("search shrinks the groups, hides empty categories and can match a category name", () => {
  const result = groupIntegrationProviders(providers, "  calendar  ");
  assert.ok(result.length);
  assert.ok(result.every((group) => group.providers.length));
  assert.ok(result.flatMap((group) => group.providers).some(({ id }) => id === "google-calendar"));
  assert.ok(result.flatMap((group) => group.providers).every((provider) => `${provider.name} ${provider.description}`.toLowerCase().includes("calendar")));
  assert.deepEqual(groupIntegrationProviders(providers, "no-such-service-123"), []);
  assert.ok(groupIntegrationProviders(providers, "wellbeing")[0].providers.some(({ id }) => id === "oura"));
  assert.equal(groupIntegrationProviders([{ id: "new", name: "New service", description: "" }])[0].id, "other");
});
