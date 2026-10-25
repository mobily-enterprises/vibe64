import { expect, it } from "vitest";
import { integrationSetupPrompt } from "@/lib/integrationSetupPrompt.js";

it("builds the setup prompt from the saved integration and its provider", () => {
  const provider = {
    setup: {
      steps: ["Create an app."],
      stepsByAuthentication: { oauth2: ["Register an OAuth client."] },
      url: "https://example.test/setup"
    }
  };
  const prompt = integrationSetupPrompt({
    id: "crm",
    integration: { provider: "example", accountMode: "shared", authentication: { method: "oauth2" }, settings: {} },
    provider,
    configuration: {},
    configurationOnly: false
  });
  const parts = prompt.split("\n\n");
  expect(parts[0]).toBe('Implement the saved integration "crm" ("example") from integrations.json.');
  expect(prompt).toContain("Selected provider setup instructions:\n\nRegister an OAuth client.");
  expect(prompt).toContain("Provider setup guide: https://example.test/setup");
  expect(prompt).toContain("Implement the Integration setup command");
  expect(prompt).not.toContain("extensions.payments");
  expect(parts.at(-1)).toMatch(/^Preserve the existing configuration/u);
});

it("asks for app-owned user connections and configuration-only setups", () => {
  const perUser = integrationSetupPrompt({
    id: "mail",
    integration: { provider: "example", accountMode: "per-user", authentication: { method: "oauth2" } },
    provider: null,
    configuration: {},
    configurationOnly: false
  });
  expect(perUser).toContain("authenticated user account screen");
  const configurationOnly = integrationSetupPrompt({
    id: "analytics",
    integration: { provider: "example", authentication: { method: "none" } },
    provider: null,
    configuration: {},
    configurationOnly: true
  });
  expect(configurationOnly).toContain("Use the saved public settings");
});

it("adds the payment contract only for a payment provider with saved payments", () => {
  const prompt = integrationSetupPrompt({
    id: "billing",
    integration: { provider: "stripe", authentication: { method: "api-key" } },
    provider: { paymentSetup: { steps: ["Create products."], url: "https://example.test/payments" } },
    configuration: { extensions: { payments: { plans: [] } } },
    configurationOnly: false
  });
  expect(prompt).toContain("Selected provider payment setup:\n\nCreate products.\n\nhttps://example.test/payments");
  expect(prompt).toContain("Stripe needs the environment's own webhook destination");
  expect(prompt).toContain("Portable payment semantics");
});
