import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { DASHBOARD_PATH, directChatSessionId, viewports } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const credentialLabels: Record<string, string> = {
  clay: "Public API key reference",
  telegram: "Bot token reference",
  sevdesk: "API token reference",
  mapbox: "Backend access token reference",
  "google-maps-platform": "Server API key reference",
  "logo-dev": "Publishable key reference"
};
const optionalKeyFields: Record<string, { label: string; setting: string; reference: string }> = {
  mapbox: { label: "Public browser token reference (optional)", setting: "publicTokenRef", reference: "env:MAPBOX_PUBLIC_TOKEN" },
  "google-maps-platform": { label: "Browser API key reference (optional)", setting: "browserKeyRef", reference: "env:GOOGLE_MAPS_BROWSER_KEY" }
};

for (const { viewport, providerBatch } of [
  ...viewports.map((viewport) => ({ viewport, providerBatch: viewport.name === "expanded" ? "existing" : "responsive" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft" },
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "microsoft-documents" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "additional-tokens" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "service-readers" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "regional" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "platform-readers" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "oura" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "algolia" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "gong" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "chargebee" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "account-readers" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "sales-readers" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "path-readers" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "public-resources" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "wordpress" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "wordpress-com" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "mcp" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "inngest" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "amplitude" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "atlassian" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "design-mcp" },
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "prestashop" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "clickhouse" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "twitch" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "slack" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "aws" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "redshift" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "xero" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "semrush" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "canva" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "twilio" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "posthog" }))
]) {
  const name = providerBatch === "microsoft"
    ? "Microsoft integration forms save portable permissions and registration references"
    : providerBatch === "microsoft-documents"
      ? `Microsoft Word and PowerPoint forms persist tenant, ownership and credential references (${viewport.name})`
    : providerBatch === "additional-tokens"
      ? "additional token integration forms save secret references and setup instructions"
    : providerBatch === "service-readers"
      ? "service reader integration forms save credentials and Google permissions"
    : providerBatch === "regional"
      ? "regional integration forms persist validated provider settings"
    : providerBatch === "platform-readers"
      ? "platform reader forms save tokens and select their provider environment"
    : providerBatch === "oura"
      ? "Oura form defaults to individual accounts and persists optional permissions"
    : providerBatch === "algolia"
      ? "Algolia form validates application settings and separate credential references"
    : providerBatch === "twilio"
      ? `Twilio form validates regional key settings and persists them (${viewport.name})`
    : providerBatch === "gong"
      ? "Gong form validates company credentials and an optional API origin"
    : providerBatch === "posthog"
      ? `PostHog form saves public project references and regional settings (${viewport.name})`
    : providerBatch === "chargebee"
      ? "Chargebee form validates site names and saves its own key reference"
    : providerBatch === "account-readers"
      ? "account reader forms save Ashby, Lexware and Sevdesk credential references"
    : providerBatch === "sales-readers"
      ? "sales reader forms save Apollo.io, Attention and Clay credential references"
    : providerBatch === "path-readers"
      ? "path credential forms save Telegram and KLIPY references and setup instructions"
    : providerBatch === "public-resources"
      ? "public resource forms save Mapbox, Google Maps and Logo.dev references and load image fixtures"
    : providerBatch === "wordpress"
      ? "WordPress and WooCommerce forms validate sites and persist credential references"
    : providerBatch === "prestashop"
      ? `PrestaShop form saves store paths and Webservice key references (${viewport.name})`
    : providerBatch === "twitch"
      ? `Twitch form persists registration, ownership and all permission choices (${viewport.name})`
    : providerBatch === "slack"
      ? `Slack form persists actor, compatible permissions and registration references (${viewport.name})`
    : providerBatch === "aws"
      ? `AWS S3 and Athena forms persist region, credential references and resource settings (${viewport.name})`
    : providerBatch === "redshift"
      ? `Redshift form persists serverless and provisioned targets without mixed fields (${viewport.name})`
    : providerBatch === "xero"
      ? `Xero form persists Basic registration, ownership and accounting permissions (${viewport.name})`
    : providerBatch === "semrush"
      ? `Semrush form persists V4 key references and shared or assistant ownership (${viewport.name})`
    : providerBatch === "clickhouse"
      ? `ClickHouse form saves credential modes and optional passwords (${viewport.name})`
    : providerBatch === "mcp"
      ? "MCP assistant forms validate endpoint and token references and persist ownership"
    : providerBatch === "inngest"
      ? "Inngest form separates Signing and Event Key references and persists branch settings"
    : providerBatch === "amplitude"
      ? "Amplitude form saves assistant OAuth registration, region and permissions"
    : providerBatch === "atlassian"
      ? "Atlassian form saves assistant registration and independent product permissions"
    : providerBatch === "canva"
      ? `Canva form saves metadata clients without secrets and preserves design permissions (${viewport.name})`
    : providerBatch === "design-mcp"
      ? "Figma and Miro forms save assistant registrations and independent design permissions"
    : providerBatch === "wordpress-com"
      ? "WordPress.com form saves OAuth registration and selected permissions"
    : `integration form saves the CLI configuration and protects drafts (${viewport.name})`;
  test(name, async ({ page }) => {
    await page.setViewportSize(viewport);
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-integration-browser-"));
    const source = path.join(root, "sessions", "active", directChatSessionId, "source");
    await mkdir(source, { recursive: true });
    const service = createService({
      temporaryRoot: path.join(root, "temporary"),
      projectService: { createRuntime: async () => ({
        stateRoot: path.join(root, "state"),
        getSession: async (sessionId) => ({ sessionId, metadata: {
          source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source"
        } })
      }) }
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("**/api/**", async (route) => {
        errors.push(`Unexpected API request: ${route.request().method()} ${new URL(route.request().url()).pathname}`);
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unmocked integration test request." }) });
      });
      await mockDirectChatSession(page);
      for (const [endpoint, payload] of [
        ["/vibe64/settings", { ok: true, promptHints: { enabled: false } }],
        ["/vibe64/sessions/current", { ok: true, sessionId: directChatSessionId }],
        [`/vibe64/sessions/${directChatSessionId}/assistant-access`, { ok: true, available: true, canUse: true, ownerOnly: false }],
        [`/vibe64/sessions/${directChatSessionId}/message-suggestions`, { ok: true, suggestions: [], canManage: true }],
        [`/vibe64/sessions/${directChatSessionId}/work`, { ok: true, unsaved: false, operation: null, updateOperation: null }],
        [`/vibe64/sessions/${directChatSessionId}/updates/check`, { ok: true, updateAvailable: false, status: "up-to-date" }],
        [`/vibe64/sessions/${directChatSessionId}/renewal`, { ok: true, renewal: null, viewerScope: "integration-test-owner" }],
        [`/vibe64/sessions/${directChatSessionId}/source-editor/stars`, { ok: true, files: [] }]
      ] as const) {
        await routeApiEndpoint(page, endpoint, (route) => fulfillJson(route, payload));
      }
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/integrations`, async (route) => {
        const input = { sessionId: directChatSessionId, ...route.request().postDataJSON() };
        const response = route.request().method() === "PUT"
          ? await service.saveIntegrations(input)
          : await service.readIntegrations(input);
        await route.fulfill({ status: response.statusCode || 200, contentType: "application/json", body: JSON.stringify(response) });
      });
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const showProject = page.getByRole("button", { name: "Show project", exact: true });
      if (viewport.name !== "expanded") await showProject.click();
      const panel = page.locator(".integrations-panel");
      await expect(panel.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "Add Google Calendar" }).click();
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByText("Length must be at least 1 characters.", { exact: true })).toBeVisible();
      await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture.apps.googleusercontent.com");
      await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Team calendar");
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
      const filePath = path.join(source, "integrations.json");
      const saved = JSON.parse(await readFile(filePath, "utf8"));
      expect(saved.integrations["google-calendar"].displayName).toBe("Team calendar");
      expect(saved.registrations["google-calendar"].clientSecretRef).toBe("env:GOOGLE_CALENDAR_CLIENT_SECRET");
      expect(JSON.stringify(saved)).not.toContain('"clientSecret":');
      await page.reload();
      if (viewport.name !== "expanded") await showProject.click();
      await panel.getByRole("list", { name: "Configured integrations" }).getByText("Team calendar", { exact: true }).click();
      await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Team calendar");
      await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Unsaved form draft");
      saved.integrations["google-calendar"].displayName = "CLI update";
      saved.extensions = { application: { keep: true } };
      await writeFile(filePath, JSON.stringify(saved));
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Unsaved form draft");
      expect(JSON.parse(await readFile(filePath, "utf8")).integrations["google-calendar"].displayName).toBe("CLI update");
      await panel.getByRole("button", { name: "Discard", exact: true }).click();
      await page.getByRole("button", { name: "Discard and reload" }).click();
      await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("CLI update");
      await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("After CLI update");
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
      expect(JSON.parse(await readFile(filePath, "utf8")).extensions).toEqual(saved.extensions);
      const tokenProviders = [["Resend", "resend"], ["Firecrawl", "firecrawl"]];
      if (providerBatch === "existing") tokenProviders.push(
        ["Airtable", "airtable"], ["Notion", "notion"], ["Brevo", "brevo"],
        ["ElevenLabs", "elevenlabs"], ["GitHub API", "github-api"], ["Apify", "apify"],
        ["Calendly", "calendly"], ["HubSpot", "hubspot"], ["Linear", "linear"], ["Pipedrive", "pipedrive"],
        ["GitLab API", "gitlab-api"], ["Tally", "tally"], ["Contentful", "contentful"], ["Asana", "asana"]
      );
      if (providerBatch === "additional-tokens") tokenProviders.push(
        ["Stripe", "stripe"], ["Replicate", "replicate"], ["Sentry", "sentry"],
        ["incident.io", "incident-io"], ["Fireflies", "fireflies"]
      );
      if (providerBatch === "service-readers") tokenProviders.push(
        ["HeyGen", "heygen"], ["Perplexity", "perplexity"], ["Supabase", "supabase"]
      );
      if (providerBatch === "regional") tokenProviders.push(["Paddle", "paddle"], ["Mailgun", "mailgun"], ["Storyblok", "storyblok"]);
      if (providerBatch === "platform-readers") tokenProviders.push(["Fireworks AI", "fireworks-ai"], ["GatewayAPI", "gatewayapi"], ["Polar", "polar"]);
      if (providerBatch === "account-readers") tokenProviders.push(["Ashby", "ashby"], ["Lexware", "lexware"], ["Sevdesk", "sevdesk"]);
      if (providerBatch === "sales-readers") tokenProviders.push(["Apollo.io", "apollo-io"], ["Attention", "attention"], ["Clay", "clay"]);
      if (providerBatch === "path-readers") tokenProviders.push(["Telegram", "telegram"], ["KLIPY", "klipy"]);
      if (providerBatch === "public-resources") tokenProviders.push(["Mapbox", "mapbox"], ["Google Maps Platform", "google-maps-platform"], ["Logo.dev", "logo-dev"]);
      for (const [name, id] of tokenProviders) {
        await panel.getByRole("button", { name: `Add ${name}`, exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        const keyField = panel.getByRole("textbox", { name: credentialLabels[id] || "API key reference", exact: true });
        if (id === "google-maps-platform") {
          await expect(panel.getByText("Reference a server key authorized for Geocoding API. Verification performs one geocoding request using an address you supply and can incur provider usage charges.", { exact: true })).toBeVisible();
        }
        await keyField.fill("a-key-value-must-not-go-in-source");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("a-key-value-must-not-go-in-source");
        const reference = `env:${id.toUpperCase().replaceAll("-", "_")}_KEY`;
        await keyField.fill(reference);
        const optionalKey = optionalKeyFields[id];
        if (optionalKey) {
          const publicToken = panel.getByRole("textbox", { name: optionalKey.label, exact: true });
          await publicToken.fill("pk.must-not-be-source");
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.locator(".v-input").filter({ has: page.getByRole("textbox", { name: optionalKey.label, exact: true }) }).getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain("pk.must-not-be-source");
          await publicToken.fill(optionalKey.reference);
        }
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations[id].authentication).toEqual({ method: "api-key", secretRef: reference });
        expect(file.registrations[id]).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        if (optionalKey) expect(file.integrations[id].settings).toEqual({ [optionalKey.setting]: optionalKey.reference });
        const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", /^https:/);
      }
      if (["account-readers", "sales-readers", "path-readers", "public-resources"].includes(providerBatch)) {
        await page.reload();
        const restoredProviders = providerBatch === "public-resources" ? [
          ["Mapbox", "mapbox", "https://docs.mapbox.com/accounts/guides/tokens/"],
          ["Google Maps Platform", "google-maps-platform", "https://developers.google.com/maps/documentation/geocoding/guides-v3/get-api-key"],
          ["Logo.dev", "logo-dev", "https://www.logo.dev/docs/platform/api-keys"]
        ] : providerBatch === "path-readers" ? [
          ["Telegram", "telegram", "https://core.telegram.org/bots/tutorial"],
          ["KLIPY", "klipy", "https://klipy.com/blog/klipy-partner-panel"]
        ] : providerBatch === "sales-readers" ? [
          ["Apollo.io", "apollo-io", "https://docs.apollo.io/docs/create-api-key"],
          ["Attention", "attention", "https://docs.attention.com/api-authentication"],
          ["Clay", "clay", "https://developers.clay.com/public-api/authentication"]
        ] : [
          ["Ashby", "ashby", "https://developers.ashbyhq.com/reference/authentication"],
          ["Lexware", "lexware", "https://help.lexware.de/de-form/articles/548863-alles-rund-um-public-api"],
          ["Sevdesk", "sevdesk", "https://hilfe.sevdesk.de/de/articles/9374740-wo-finde-ich-meinen-api-token-in-sevdesk"]
        ];
        for (const [name, id, setupUrl] of restoredProviders) {
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(name, { exact: true }).click();
          await expect(panel.getByRole("textbox", { name: credentialLabels[id] || "API key reference", exact: true }))
            .toHaveValue(`env:${id.toUpperCase().replaceAll("-", "_")}_KEY`);
          const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", setupUrl);
          const optionalKey = optionalKeyFields[id];
          if (optionalKey) {
            await expect(panel.getByRole("textbox", { name: optionalKey.label, exact: true })).toHaveValue(optionalKey.reference);
          }
        }
      }
      if (providerBatch === "public-resources") {
        for (const [name, id] of tokenProviders.filter(([, id]) => optionalKeyFields[id])) {
          const field = optionalKeyFields[id];
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(name, { exact: true }).click();
          await panel.getByRole("textbox", { name: field.label, exact: true }).fill("");
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          await page.reload();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(name, { exact: true }).click();
          await expect(panel.getByRole("textbox", { name: field.label, exact: true })).toHaveValue("");
          const integration = JSON.parse(await readFile(filePath, "utf8")).integrations[id];
          expect(integration.settings).toEqual({});
          expect(integration.authentication.secretRef).toBe(`env:${id.toUpperCase().replaceAll("-", "_")}_KEY`);
        }

        const imageRequests: { url: string; referrer: string | undefined }[] = [];
        await page.route("https://img.logo.dev/**", async (route) => {
          const request = route.request();
          imageRequests.push({ url: request.url(), referrer: request.headers().referer });
          const missing = new URL(request.url()).searchParams.get("fallback") === "404";
          await route.fulfill(missing ? { status: 404, body: "" } : {
            status: 200, contentType: "image/png",
            body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDAAAAAASUVORK5CYII=", "base64")
          });
        });
        const images = await page.evaluate(async () => {
          // Load the installed browser library through Vite; all CDN responses are local fixtures.
          const modulePath = "/node_modules/@jskit-ai/connectors-catalog/src/client/logo-dev.js";
          const { createLogoDevImageUrl } = await import(modulePath);
          const results = [];
          for (const fallback of ["monogram", "404"]) {
            const image = new Image();
            image.referrerPolicy = "origin";
            results.push(await new Promise((resolve) => {
              image.onload = () => resolve({ loaded: true, width: image.naturalWidth });
              image.onerror = () => resolve({ loaded: false });
              image.src = createLogoDevImageUrl({ publishableKey: "pk_browser_fixture", domain: "example.com", fallback });
            }));
          }
          return results;
        });
        expect(images).toEqual([{ loaded: true, width: 1 }, { loaded: false }]);
        expect(imageRequests).toHaveLength(2);
        for (const request of imageRequests) {
          expect(new URL(request.url).searchParams.get("token")).toBe("pk_browser_fixture");
          expect(request.referrer).toBe(`${new URL(page.url()).origin}/`);
        }
      }
      if (["regional", "platform-readers"].includes(providerBatch)) {
        const configured = panel.getByRole("list", { name: "Configured integrations" });
        const settings = providerBatch === "platform-readers" ? [
          ["GatewayAPI", "gatewayapi", "API domain", "global", "region", "Global (gatewayapi.com)", "EU (gatewayapi.eu)", "eu"],
          ["Polar", "polar", "Environment", "sandbox", "environment", "Sandbox", "Production", "production"]
        ] : [
          ["Paddle", "paddle", "Environment", "sandbox", "environment", "Sandbox", "Live", "live"],
          ["Mailgun", "mailgun", "API region", "us", "region", "United States (api.mailgun.net)", "European Union (api.eu.mailgun.net)", "eu"],
          ["Storyblok", "storyblok", "Space region", "eu", "region", "European Union (EU)", "China (CN)", "cn"]
        ];
        for (const [name, id, field, defaultValue, setting, selected, alternate, nextValue] of settings) {
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations[id].settings[setting]).toBe(defaultValue);
          await configured.getByText(name, { exact: true }).click();
          await expect(panel.getByRole("combobox", { name: field, exact: true })).toBeVisible();
          await panel.getByText(selected, { exact: true }).click();
          if (id === "storyblok") {
            for (const title of ["European Union (EU)", "United States (US)", "Canada (CA)", "Australia / APAC (AP)", "China (CN)"]) {
              await expect(page.getByRole("option", { name: title, exact: true })).toBeVisible();
            }
          }
          await page.getByRole("option", { name: alternate, exact: true }).click();
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[id].settings[setting]).toBe(nextValue);
          expect(file.extensions).toEqual(saved.extensions);
        }
        await page.reload();
        for (const [name, , , , , , alternate] of settings) {
          await configured.getByText(name, { exact: true }).click();
          await expect(panel.getByText(alternate, { exact: true })).toBeVisible();
        }
        if (providerBatch === "platform-readers") {
          await configured.getByText("Fireworks AI", { exact: true }).click();
          await expect(panel.getByRole("textbox", { name: "API key reference", exact: true })).toHaveValue("env:FIREWORKS_AI_KEY");
        }
      }
      if (providerBatch === "algolia") {
        await panel.getByRole("button", { name: "Add Algolia", exact: true }).click();
        const applicationId = panel.getByRole("textbox", { name: "Application ID", exact: true });
        const publicKey = panel.getByRole("textbox", { name: "Public API key reference (optional)", exact: true });
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.algolia).toBeUndefined();
        await applicationId.fill("bad.host");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByText("Enter the application ID using letters and digits.", { exact: true })).toBeVisible();
        await applicationId.fill("APP123ABC");
        await publicKey.fill("raw-key");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await publicKey.fill("env:ALGOLIA_PUBLIC_KEY");
        await panel.getByRole("textbox", { name: "API key reference", exact: true }).fill("env:ALGOLIA_BACKEND_KEY");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.algolia.settings).toEqual({ applicationId: "APP123ABC", publicApiKeyRef: "env:ALGOLIA_PUBLIC_KEY" });
        expect(file.integrations.algolia.authentication).toEqual({ method: "api-key", secretRef: "env:ALGOLIA_BACKEND_KEY" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Algolia", { exact: true }).click();
        await expect(applicationId).toHaveValue("APP123ABC");
        await expect(publicKey).toHaveValue("env:ALGOLIA_PUBLIC_KEY");
        await publicKey.fill("");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.algolia.settings).toEqual({ applicationId: "APP123ABC" });
        const setup = panel.getByRole("button", { name: "Set up Algolia", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.algolia.com/doc/guides/security/api-keys");
      }
      if (providerBatch === "twilio") {
        await panel.getByRole("button", { name: "Add Twilio", exact: true }).click();
        const accountSid = panel.getByRole("textbox", { name: "Account SID", exact: true });
        const apiKeySid = panel.getByRole("textbox", { name: "Standard API Key SID", exact: true });
        const secret = panel.getByRole("textbox", { name: "API key secret reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(2);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.twilio).toBeUndefined();
        await accountSid.fill(`SK${"a".repeat(32)}`);
        await apiKeySid.fill(`AC${"b".repeat(32)}`);
        await save.click();
        await expect(panel.getByText("Enter an Account SID starting with AC followed by 32 hexadecimal characters.", { exact: true })).toBeVisible();
        await expect(panel.getByText("Enter an API Key SID starting with SK followed by 32 hexadecimal characters.", { exact: true })).toBeVisible();
        await accountSid.fill(`AC${"a".repeat(32)}`);
        await apiKeySid.fill(`SK${"b".repeat(32)}`);
        await secret.fill("raw-twilio-secret");
        await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-twilio-secret");
        await secret.fill("env:TWILIO_API_SECRET");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.twilio.settings).toEqual({ region: "us1", accountSid: `AC${"a".repeat(32)}`, apiKeySid: `SK${"b".repeat(32)}` });
        expect(file.integrations.twilio.authentication).toEqual({ method: "api-key", secretRef: "env:TWILIO_API_SECRET" });
        expect(file.registrations.twilio).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await panel.getByText("United States (US1)", { exact: true }).click();
        for (const title of ["United States (US1)", "Ireland (IE1)", "Australia (AU1)"]) {
          await expect(page.getByRole("option", { name: title, exact: true })).toBeVisible();
        }
        await page.getByRole("option", { name: "Ireland (IE1)", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.twilio.settings.region).toBe("ie1");
        await panel.getByText("Ireland (IE1)", { exact: true }).click();
        await page.getByRole("option", { name: "Australia (AU1)", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.twilio.settings.region).toBe("au1");
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Twilio", { exact: true }).click();
        await expect(accountSid).toHaveValue(`AC${"a".repeat(32)}`);
        await expect(apiKeySid).toHaveValue(`SK${"b".repeat(32)}`);
        await expect(secret).toHaveValue("env:TWILIO_API_SECRET");
        await expect(panel.getByText("Australia (AU1)", { exact: true })).toBeVisible();
        const setup = panel.getByRole("button", { name: "Set up Twilio", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.twilio.com/docs/iam/api-keys/keys-in-console");
      }
      if (providerBatch === "posthog") {
        await panel.getByRole("button", { name: "Add PostHog", exact: true }).click();
        const projectId = panel.getByRole("textbox", { name: "Project ID", exact: true });
        const token = panel.getByRole("textbox", { name: "Project token reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByText("Use an environment reference for the project's public token (phc_). Your app may expose that token in its frontend. It cannot read private analytics.", { exact: true })).toBeVisible();
        await expect(panel.getByText("Europe (eu.i.posthog.com)", { exact: true })).toBeVisible();
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.posthog).toBeUndefined();
        await projectId.fill("not-a-project-id");
        await save.click();
        await expect(panel.getByText("Enter the numeric project ID from PostHog project settings.", { exact: true })).toBeVisible();
        await projectId.fill("12345");
        await token.fill("phc_raw_public_token");
        await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("phc_raw_public_token");
        await token.fill("env:POSTHOG_PROJECT_TOKEN");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.posthog.settings).toEqual({ region: "eu", projectId: "12345" });
        expect(file.integrations.posthog.authentication).toEqual({ method: "api-key", secretRef: "env:POSTHOG_PROJECT_TOKEN" });
        expect(file.registrations.posthog).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await panel.getByText("Europe (eu.i.posthog.com)", { exact: true }).click();
        for (const title of ["Europe (eu.i.posthog.com)", "United States (us.i.posthog.com)"]) {
          await expect(page.getByRole("option", { name: title, exact: true })).toBeVisible();
        }
        await page.getByRole("option", { name: "United States (us.i.posthog.com)", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.posthog.settings.region).toBe("us");
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("PostHog", { exact: true }).click();
        await expect(projectId).toHaveValue("12345");
        await expect(token).toHaveValue("env:POSTHOG_PROJECT_TOKEN");
        await expect(panel.getByText("United States (us.i.posthog.com)", { exact: true })).toBeVisible();
        const setup = panel.getByRole("button", { name: "Set up PostHog", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://posthog.com/docs/settings/projects");
      }
      if (providerBatch === "chargebee") {
        await panel.getByRole("button", { name: "Add Chargebee", exact: true }).click();
        const siteName = panel.getByRole("textbox", { name: "Site name", exact: true });
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.chargebee).toBeUndefined();
        await siteName.fill("https://acme-test.chargebee.com");
        await save.click();
        await expect(panel.getByText("Enter the site name without .chargebee.com, a URL or spaces.", { exact: true })).toBeVisible();
        await siteName.fill("acme-test");
        await key.fill("raw-chargebee-key");
        await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-chargebee-key");
        await key.fill("env:CHARGEBEE_API_KEY");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.chargebee.settings).toEqual({ siteName: "acme-test" });
        expect(file.integrations.chargebee.authentication).toEqual({ method: "api-key", secretRef: "env:CHARGEBEE_API_KEY" });
        expect(file.registrations.chargebee).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Chargebee", { exact: true }).click();
        await expect(siteName).toHaveValue("acme-test");
        await expect(key).toHaveValue("env:CHARGEBEE_API_KEY");
        const setup = panel.getByRole("button", { name: "Set up Chargebee", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.chargebee.com/docs/billing/2.0/site-configuration/api_keys");
      }
      if (providerBatch === "canva") {
        await panel.getByRole("button", { name: "Add Canva", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client metadata URL", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("textbox", { name: "Client secret reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await client.fill("ordinary-client-id");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use the exact HTTPS URL of your client metadata JSON, including its path, without credentials, query or fragment.", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.canva).toBeUndefined();
        await client.fill("https://assistant.example/oauth/canva.json");
        await callback.fill("raw-callback-value");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-callback-value");
        await callback.fill("env:CANVA_CALLBACK_URL");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(16);
        const read = panel.getByRole("checkbox", { name: "Read design content", exact: true });
        const write = panel.getByRole("checkbox", { name: "Create and edit designs", exact: true });
        const comment = panel.getByRole("checkbox", { name: "Write comments", exact: true });
        const folder = panel.getByRole("checkbox", { name: "Read folders", exact: true });
        await expect(read).toBeChecked();
        await expect(folder).toBeChecked();
        await expect(write).not.toBeChecked();
        await expect(comment).not.toBeChecked();
        await write.check();
        await comment.check();
        await folder.uncheck();
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.registrations.canva).toEqual({ source: "own", clientId: "https://assistant.example/oauth/canva.json", tokenEndpointAuthMethod: "none", callbackUrlRef: "env:CANVA_CALLBACK_URL" });
        expect(file.integrations.canva.accountMode).toBe("assistant");
        expect([...file.integrations.canva.scopes].sort()).toEqual(["profile:read", "design:meta:read", "design:content:read", "design:content:write", "comment:write"].sort());
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        if (viewport.name === "compact") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Canva", { exact: true }).click();
        await expect(client).toHaveValue("https://assistant.example/oauth/canva.json");
        await expect(callback).toHaveValue("env:CANVA_CALLBACK_URL");
        await expect(panel.getByRole("textbox", { name: "Client secret reference", exact: true })).toHaveCount(0);
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const checkbox of [read, write, comment]) await expect(checkbox).toBeChecked();
        await expect(folder).not.toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Canva", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.canva.dev/docs/mcp/");
        await expect(panel.getByText("Open the Canva MCP guide and follow Register your redirect URI to its Waitlist form. Apply with the exact callback URL and wait for Canva's approval.", { exact: true })).toBeVisible();
      }
      if (providerBatch === "design-mcp") {
        for (const spec of [
          { id: "figma", name: "Figma", scope: "Use Figma MCP tools", scopes: ["mcp:connect"], count: 1,
            guide: "https://developers.figma.com/docs/figma-mcp-server/" },
          { id: "miro", name: "Miro", scope: "Read boards", scopes: ["boards:read", "boards:write"], count: 4,
            guide: "https://developers.miro.com/docs/connecting-to-miro-mcp" }
        ]) {
          await panel.getByRole("button", { name: `Add ${spec.name}`, exact: true }).click();
          const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
          const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
          const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
          await client.fill(`assigned-${spec.id}-client`);
          await secret.fill(`raw-${spec.id}-secret`);
          await save.click();
          await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain(`raw-${spec.id}-secret`);
          const prefix = spec.id.toUpperCase();
          await secret.fill(`env:${prefix}_CLIENT_SECRET`);
          await callback.fill(`env:${prefix}_CALLBACK_URL`);
          const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          await expect(panel.getByRole("checkbox")).toHaveCount(spec.count);
          await expect(panel.getByRole("checkbox", { name: spec.scope, exact: true })).toBeChecked();
          if (spec.id === "miro") {
            for (const name of ["Create and edit boards", "Include account identity", "Read your email address"]) {
              await expect(panel.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
            }
            await panel.getByRole("checkbox", { name: "Create and edit boards", exact: true }).check();
          }
          await save.click();
          await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.registrations[spec.id]).toEqual({ source: "own", clientId: `assigned-${spec.id}-client`,
            clientSecretRef: `env:${prefix}_CLIENT_SECRET`, callbackUrlRef: `env:${prefix}_CALLBACK_URL` });
          expect(file.integrations[spec.id].accountMode).toBe("assistant");
          expect(file.integrations[spec.id].scopes).toEqual(spec.scopes);
          expect(file.extensions).toEqual(saved.extensions);
          await page.reload();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(spec.name, { exact: true }).click();
          await expect(client).toHaveValue(`assigned-${spec.id}-client`);
          await expect(secret).toHaveValue(`env:${prefix}_CLIENT_SECRET`);
          await expect(callback).toHaveValue(`env:${prefix}_CALLBACK_URL`);
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          await expect(panel.getByRole("checkbox", { name: spec.scope, exact: true })).toBeChecked();
          if (spec.id === "miro") {
            await expect(panel.getByRole("checkbox", { name: "Create and edit boards", exact: true })).toBeChecked();
            for (const name of ["Include account identity", "Read your email address"]) {
              await expect(panel.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
            }
          }
          const setup = panel.getByRole("button", { name: `Set up ${spec.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", spec.guide);
        }
      }
      if (providerBatch === "atlassian") {
        await panel.getByRole("button", { name: "Add Atlassian", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await client.fill("assigned-atlassian-v2-client");
        await secret.fill("raw-atlassian-secret");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-atlassian-secret");
        await secret.fill("env:ATLASSIAN_CLIENT_SECRET");
        await callback.fill("env:ATLASSIAN_CALLBACK_URL");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(32);
        const read = panel.getByRole("checkbox", { name: "Read Jira content", exact: true });
        const write = panel.getByRole("checkbox", { name: "Create and edit Jira content", exact: true });
        const remove = panel.getByRole("checkbox", { name: "Delete Jira content", exact: true });
        const manage = panel.getByRole("checkbox", { name: "Manage Jira", exact: true });
        const confluence = panel.getByRole("checkbox", { name: "Read Confluence content", exact: true });
        const refresh = panel.getByRole("checkbox", { name: "Refresh access without repeating sign-in", exact: true });
        const loom = panel.getByRole("checkbox", { name: "Read Loom content", exact: true });
        for (const checkbox of [read, confluence, refresh]) await expect(checkbox).toBeChecked();
        for (const checkbox of [write, remove, manage, loom]) await expect(checkbox).not.toBeChecked();
        await write.check();
        await refresh.uncheck();
        await loom.check();
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.atlassian.accountMode).toBe("assistant");
        expect([...file.integrations.atlassian.scopes].sort()).toEqual([
          "read:me", "read:account", "read:jira:agent-interface", "search:jira:agent-interface",
          "read:confluence:agent-interface", "search:confluence:agent-interface",
          "write:jira:agent-interface", "read:loom:agent-interface"
        ].sort());
        expect(file.registrations.atlassian).toEqual({ source: "own", clientId: "assigned-atlassian-v2-client", clientSecretRef: "env:ATLASSIAN_CLIENT_SECRET", callbackUrlRef: "env:ATLASSIAN_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Atlassian", { exact: true }).click();
        await expect(client).toHaveValue("assigned-atlassian-v2-client");
        await expect(secret).toHaveValue("env:ATLASSIAN_CLIENT_SECRET");
        await expect(callback).toHaveValue("env:ATLASSIAN_CALLBACK_URL");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const checkbox of [read, write, confluence, loom]) await expect(checkbox).toBeChecked();
        for (const checkbox of [remove, manage, refresh]) await expect(checkbox).not.toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Atlassian", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/");
      }
      if (providerBatch === "amplitude") {
        await panel.getByRole("button", { name: "Add Amplitude", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const region = panel.getByRole("combobox", { name: "Region", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await client.fill("assigned-amplitude-client");
        await secret.fill("raw-secret-do-not-save");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-secret-do-not-save");
        await secret.fill("env:AMPLITUDE_CLIENT_SECRET");
        await callback.fill("env:AMPLITUDE_CALLBACK_URL");
        await expect(region).toHaveValue("United States");
        await region.focus();
        await region.press("ArrowDown");
        await page.getByRole("option", { name: "European Union", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        const read = panel.getByRole("checkbox", { name: "Read Amplitude content (required for verification)", exact: true });
        const write = panel.getByRole("checkbox", { name: "Create and edit Amplitude content", exact: true });
        const refresh = panel.getByRole("checkbox", { name: "Refresh access without repeating sign-in", exact: true });
        await expect(read).toBeChecked();
        await expect(write).not.toBeChecked();
        await expect(refresh).toBeChecked();
        await write.check();
        await refresh.uncheck();
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.amplitude.accountMode).toBe("assistant");
        expect(file.integrations.amplitude.settings).toEqual({ region: "eu" });
        expect(file.integrations.amplitude.scopes).toEqual(["mcp:read", "mcp:write"]);
        expect(file.registrations.amplitude).toEqual({ source: "own", clientId: "assigned-amplitude-client", clientSecretRef: "env:AMPLITUDE_CLIENT_SECRET", callbackUrlRef: "env:AMPLITUDE_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Amplitude", { exact: true }).click();
        await expect(region).toHaveValue("European Union");
        await expect(client).toHaveValue("assigned-amplitude-client");
        await expect(secret).toHaveValue("env:AMPLITUDE_CLIENT_SECRET");
        await expect(callback).toHaveValue("env:AMPLITUDE_CALLBACK_URL");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(read).toBeChecked();
        await expect(write).toBeChecked();
        await expect(refresh).not.toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Amplitude", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://amplitude.com/docs/amplitude-ai/amplitude-mcp/other-clients");
      }
      if (providerBatch === "inngest") {
        await panel.getByRole("button", { name: "Add Inngest", exact: true }).click();
        const signingKey = panel.getByRole("textbox", { name: "Signing Key reference", exact: true });
        const eventKey = panel.getByRole("textbox", { name: "Event Key reference", exact: true });
        const branch = panel.getByRole("textbox", { name: "Branch environment (optional)", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await signingKey.fill("raw-signing-key-do-not-save");
        await eventKey.fill("raw-event-key-do-not-save");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await expect(panel.locator(".v-input--error input")).toHaveValue("raw-signing-key-do-not-save");
        expect(await readFile(filePath, "utf8")).not.toContain("do-not-save");
        await signingKey.fill("env:INNGEST_SIGNING_KEY");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await expect(panel.locator(".v-input--error input")).toHaveValue("raw-event-key-do-not-save");
        expect(await readFile(filePath, "utf8")).not.toContain("do-not-save");
        await eventKey.fill("env:INNGEST_EVENT_KEY");
        await branch.fill("branch with spaces");
        await save.click();
        await expect(panel.getByText("Use an ASCII branch environment without spaces or control characters.", { exact: true })).toBeVisible();
        await branch.fill("feature/my-branch");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.inngest.authentication).toEqual({ method: "api-key", secretRef: "env:INNGEST_SIGNING_KEY" });
        expect(file.integrations.inngest.settings).toEqual({ eventKeyRef: "env:INNGEST_EVENT_KEY", branchEnvironment: "feature/my-branch" });
        expect(file.integrations.inngest.accountMode).toBe("shared");
        expect(file.registrations.inngest).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Inngest", { exact: true }).click();
        await expect(signingKey).toHaveValue("env:INNGEST_SIGNING_KEY");
        await expect(eventKey).toHaveValue("env:INNGEST_EVENT_KEY");
        await expect(branch).toHaveValue("feature/my-branch");
        const setup = panel.getByRole("button", { name: "Set up Inngest", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.inngest.com/docs/events/creating-an-event-key");
        await branch.fill("");
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.inngest.settings).toEqual({ eventKeyRef: "env:INNGEST_EVENT_KEY" });
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Inngest", { exact: true }).click();
        await expect(branch).toHaveValue("");
      }
      if (providerBatch === "mcp") {
        for (const provider of [
          { id: "n8n", name: "n8n", label: "MCP access token reference", setupUrl: "https://docs.n8n.io/connect/connect-to-n8n-mcp-server" },
          { id: "sanity", name: "Sanity", label: "MCP API token reference", setupUrl: "https://www.sanity.io/docs/ai/mcp-server" }
        ]) {
          await panel.getByRole("button", { name: `Add ${provider.name}`, exact: true }).click();
          const token = panel.getByRole("textbox", { name: provider.label, exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          const account = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
          await expect(account).toHaveValue("Assistant access");
          await account.focus();
          await account.press("ArrowDown");
          await expect(page.getByRole("option", { name: "Assistant access", exact: true })).toBeVisible();
          await expect(page.getByRole("option", { name: "One shared account", exact: true })).toHaveCount(0);
          await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
          await page.getByRole("option", { name: "Assistant access", exact: true }).click();
          const server = panel.getByRole("textbox", { name: "Server URL", exact: true });
          if (provider.id === "n8n") {
            await save.click();
            await expect(panel.locator(".v-input--error")).toHaveCount(1);
            await server.fill("https://automation.example/mcp-server/http?token=unsafe");
            await save.click();
            await expect(panel.getByText("Use the HTTPS MCP server URL ending /mcp-server/http, without credentials, query or fragment.", { exact: true })).toBeVisible();
            await server.fill("https://automation.example:8443/team/mcp-server/http");
          } else {
            await expect(server).toHaveCount(0);
          }
          await token.fill("raw-token-do-not-save");
          await save.click();
          await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain("raw-token-do-not-save");
          const reference = `env:${provider.id.toUpperCase()}_MCP_TOKEN`;
          await token.fill(reference);
          await save.click();
          await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[provider.id].accountMode).toBe("assistant");
          expect(file.integrations[provider.id].authentication).toEqual({ method: "api-key", secretRef: reference });
          expect(file.registrations[provider.id]).toBeUndefined();
          expect(file.integrations[provider.id].settings).toEqual(provider.id === "n8n" ? { serverUrl: "https://automation.example:8443/team/mcp-server/http" } : undefined);
          expect(file.extensions).toEqual(saved.extensions);
          await page.reload();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(provider.name, { exact: true }).and(page.locator(".v-list-item-title")).click();
          await expect(token).toHaveValue(reference);
          if (provider.id === "n8n") await expect(server).toHaveValue("https://automation.example:8443/team/mcp-server/http");
          const setup = panel.getByRole("button", { name: `Set up ${provider.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", provider.setupUrl);
        }
      }
      if (providerBatch === "wordpress-com") {
        await panel.getByRole("button", { name: "Add WordPress.com", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await client.fill("12345");
        await secret.fill("raw-client-secret-must-not-be-saved");
        await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-client-secret-must-not-be-saved");
        await secret.fill("env:WORDPRESS_COM_CLIENT_SECRET");
        await callback.fill("env:WORDPRESS_COM_CALLBACK_URL");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const label of ["View user information (required for verification)", "View site information and options", "View and manage posts"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        for (const label of ["Manage media assets", "View and manage comments", "View site statistics", "Manage taxonomy terms", "Batch API requests"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
        }
        await panel.getByRole("checkbox", { name: "View and manage posts", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "View site statistics", exact: true }).check();
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["wordpress-com"].scopes).toEqual(["users", "sites", "stats"]);
        expect(file.registrations["wordpress-com"]).toEqual({ source: "own", clientId: "12345", clientSecretRef: "env:WORDPRESS_COM_CLIENT_SECRET", callbackUrlRef: "env:WORDPRESS_COM_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("WordPress.com", { exact: true }).click();
        await expect(client).toHaveValue("12345");
        await expect(secret).toHaveValue("env:WORDPRESS_COM_CLIENT_SECRET");
        await expect(callback).toHaveValue("env:WORDPRESS_COM_CALLBACK_URL");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "View and manage posts", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "View site statistics", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up WordPress.com", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developer.wordpress.com/docs/api/oauth2/");
      }
      if (providerBatch === "semrush") {
        await panel.getByRole("button", { name: "Add Semrush", exact: true }).click();
        const key = panel.getByRole("textbox", { name: "V4 API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(key).toBeVisible();
        await expect(panel.getByText("Use a new Semrush V4 key with Read-only permission. V3 keys and OAuth access tokens are different credentials.", { exact: true })).toBeVisible();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        for (const invalid of ["", "raw-v4-key", "https://example.test/key"]) {
          await key.fill(invalid); await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(1);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations.semrush).toBeUndefined();
        }
        await key.fill("env:SEMRUSH_V4_KEY");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.semrush).toEqual({ provider: "semrush", displayName: "Semrush", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:SEMRUSH_V4_KEY" } });
        expect(file.registrations.semrush).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Marketing research");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.semrush.accountMode).toBe("assistant");
        expect(file.integrations.semrush.displayName).toBe("Marketing research");
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Marketing research", { exact: true }).click();
        await expect(key).toHaveValue("env:SEMRUSH_V4_KEY"); await expect(owner).toHaveValue("Assistant access");
        const setup = panel.getByRole("button", { name: "Set up Semrush", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developer.semrush.com/api/v4/get-started/quick-start/");
        await expect(panel.getByText("Separate keys on one account share account capacity. This initial runtime does not implement the captured OAuth connection or individual app-user login.", { exact: true })).toBeVisible();
      }
      if (providerBatch === "xero") {
        await panel.getByRole("button", { name: "Add Xero", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.xero).toBeUndefined();
        await client.fill("assigned-xero-client"); await secret.fill("raw-xero-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-xero-secret");
        await secret.fill("env:XERO_SECRET"); await callback.fill("env:XERO_CALLBACK");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(24);
        for (const label of ["Keep access when the user is away", "Read organisation settings", "Read contacts", "Read invoices and bills"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        await expect(panel.getByRole("checkbox", { name: "Read and manage contacts", exact: true })).not.toBeChecked();
        await save.click(); await expect(save).toBeDisabled();
        const initial = JSON.parse(await readFile(filePath, "utf8"));
        expect(initial.registrations.xero).toEqual({ source: "own", clientId: "assigned-xero-client", clientSecretRef: "env:XERO_SECRET", callbackUrlRef: "env:XERO_CALLBACK", tokenEndpointAuthMethod: "client_secret_basic" });
        expect(initial.integrations.xero.scopes).toEqual(["offline_access", "accounting.settings.read", "accounting.contacts.read", "accounting.invoices.read"]);
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Personal accounts");
        await panel.getByRole("checkbox", { name: "Read invoices and bills", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Read profit and loss reports", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.xero).toEqual({ provider: "xero", displayName: "Personal accounts", accountMode: "per-user", authentication: { method: "oauth2", registrationRef: "xero" }, scopes: ["offline_access", "accounting.settings.read", "accounting.contacts.read", "accounting.reports.profitandloss.read"] });
        expect(file.registrations.xero).toEqual(initial.registrations.xero); expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Personal accounts", { exact: true }).click();
        await expect(client).toHaveValue("assigned-xero-client"); await expect(secret).toHaveValue("env:XERO_SECRET");
        await expect(callback).toHaveValue("env:XERO_CALLBACK"); await expect(owner).toHaveValue("Each app user's own account");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read invoices and bills", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Read profit and loss reports", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Xero", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developer.xero.com/documentation/guides/oauth2/auth-flow/");
      }
      if (providerBatch === "redshift") {
        await panel.getByRole("button", { name: "Add Amazon Redshift", exact: true }).click();
        const mode = panel.getByRole("combobox", { name: "Deployment type", exact: true });
        const region = panel.getByRole("combobox", { name: "AWS Region", exact: true });
        const workgroup = panel.getByRole("textbox", { name: "Workgroup name", exact: true });
        const cluster = panel.getByRole("textbox", { name: "Cluster identifier", exact: true });
        const user = panel.getByRole("textbox", { name: "Database user (optional)", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(mode).toHaveValue("Serverless"); await expect(cluster).toHaveCount(0); await expect(user).toHaveCount(0);
        await panel.getByRole("textbox", { name: "Access key ID reference", exact: true }).fill("env:AWS_ACCESS_KEY_ID");
        await panel.getByRole("textbox", { name: "Secret access key reference", exact: true }).fill("env:AWS_SECRET_ACCESS_KEY");
        await panel.getByRole("textbox", { name: "Database", exact: true }).fill("dev");
        await workgroup.fill("analytics");
        await panel.getByText("N. Virginia (us-east-1)", { exact: true }).click();
        await page.getByRole("listbox").evaluate((list) => list.scrollTo(0, list.scrollHeight));
        await page.getByRole("option", { name: "Osaka (ap-northeast-3)", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["amazon-redshift"].settings).toEqual({ deploymentType: "serverless", region: "ap-northeast-3", database: "dev", workgroup: "analytics", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID" });
        expect(file.extensions).toEqual(saved.extensions);
        await panel.getByText("Serverless", { exact: true }).click();
        await page.getByRole("option", { name: "Provisioned cluster", exact: true }).click();
        await expect(workgroup).toHaveCount(0); await expect(cluster).toHaveValue("");
        await save.click();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["amazon-redshift"].settings.deploymentType).toBe("serverless");
        await cluster.fill("analytics-cluster"); await user.fill("report_reader"); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["amazon-redshift"].settings).toEqual({ deploymentType: "provisioned", region: "ap-northeast-3", database: "dev", clusterIdentifier: "analytics-cluster", databaseUser: "report_reader", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID" });
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Amazon Redshift", { exact: true }).click();
        await expect(mode).toHaveValue("Provisioned cluster"); await expect(cluster).toHaveValue("analytics-cluster"); await expect(user).toHaveValue("report_reader");
        await expect(region).toHaveValue("Osaka (ap-northeast-3)");
        await user.fill(""); await save.click(); await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["amazon-redshift"].settings.databaseUser).toBeUndefined();
        await panel.getByText("Provisioned cluster", { exact: true }).click();
        await page.getByRole("option", { name: "Serverless", exact: true }).click();
        await expect(workgroup).toHaveValue(""); await expect(cluster).toHaveCount(0); await expect(user).toHaveCount(0);
        await workgroup.fill("restored-group"); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["amazon-redshift"].settings.clusterIdentifier).toBeUndefined();
        expect(file.integrations["amazon-redshift"].settings.workgroup).toBe("restored-group");
        const setup = panel.getByRole("button", { name: "Set up Amazon Redshift", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.aws.amazon.com/redshift/latest/mgmt/data-api.html");
      }
      if (providerBatch === "aws") {
        for (const provider of [{ id: "aws-s3", name: "AWS S3" }, { id: "aws-athena", name: "AWS Athena" }]) {
          await panel.getByRole("button", { name: `Add ${provider.name}`, exact: true }).click();
          const key = panel.getByRole("textbox", { name: "Access key ID reference", exact: true });
          const secret = panel.getByRole("textbox", { name: "Secret access key reference", exact: true });
          const session = panel.getByRole("textbox", { name: "Session token reference (optional)", exact: true });
          const region = panel.getByRole("combobox", { name: "AWS Region", exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          await expect(region).toHaveValue("N. Virginia (us-east-1)");
          await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
          const resource = panel.getByRole("textbox", { name: provider.id === "aws-s3" ? "Bucket name" : "Workgroup (optional)", exact: true });
          if (provider.id === "aws-s3") await resource.fill("Bad_Bucket");
          else await resource.fill("invalid/workgroup");
          await key.fill("AKIARAWKEY123456789");
          await secret.fill("env:AWS_SECRET_ACCESS_KEY");
          await save.click();
          await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain("AKIARAWKEY123456789");
          await key.fill("env:AWS_ACCESS_KEY_ID");
          await resource.fill(provider.id === "aws-s3" ? "my-app-files" : "reports");
          await session.fill("env:AWS_SESSION_TOKEN");
          await panel.getByText("N. Virginia (us-east-1)", { exact: true }).click();
          await page.getByRole("listbox").evaluate((list) => list.scrollTo(0, list.scrollHeight));
          await page.getByRole("option", { name: "Cape Town (af-south-1)", exact: true }).click();
          await panel.getByRole("textbox", { name: "Display name", exact: true }).fill(`${provider.name} account`);
          if (provider.id === "aws-s3") {
            const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
            if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
            await expect(panel.getByText("These choices limit the application's operations. AWS IAM and bucket policies decide actual access; selecting a permission does not grant it in AWS.", { exact: true })).toBeVisible();
            await expect(panel.getByRole("checkbox", { name: "List and download objects from bucket", exact: true })).toBeChecked();
            await panel.getByRole("checkbox", { name: "Also upload objects via pre-signed URLs", exact: true }).uncheck();
          } else {
            await panel.getByRole("textbox", { name: "Query result location (optional)", exact: true }).fill("s3://query-results/reports/");
          }
          await save.click();
          await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[provider.id]).toEqual({
            provider: provider.id, displayName: `${provider.name} account`, accountMode: "shared",
            authentication: { method: "api-key", secretRef: "env:AWS_SECRET_ACCESS_KEY" },
            scopes: provider.id === "aws-s3" ? ["read"] : [],
            settings: { region: "af-south-1", accessKeyIdRef: "env:AWS_ACCESS_KEY_ID", sessionTokenRef: "env:AWS_SESSION_TOKEN",
              ...(provider.id === "aws-s3" ? { bucket: "my-app-files" } : { workgroup: "reports", resultLocation: "s3://query-results/reports/" }) }
          });
          expect(file.extensions).toEqual(saved.extensions);
          await page.reload();
          if (viewport.name !== "expanded") await showProject.click();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(`${provider.name} account`, { exact: true }).click();
          await expect(region).toHaveValue("Cape Town (af-south-1)");
          await expect(key).toHaveValue("env:AWS_ACCESS_KEY_ID");
          await expect(secret).toHaveValue("env:AWS_SECRET_ACCESS_KEY");
          await expect(session).toHaveValue("env:AWS_SESSION_TOKEN");
          await session.fill("");
          if (provider.id === "aws-athena") {
            await resource.fill("");
            await panel.getByRole("textbox", { name: "Query result location (optional)", exact: true }).fill("");
          }
          await save.click();
          await expect(save).toBeDisabled();
          const cleared = JSON.parse(await readFile(filePath, "utf8")).integrations[provider.id].settings;
          expect(cleared.sessionTokenRef).toBeUndefined();
          if (provider.id === "aws-athena") { expect(cleared.workgroup).toBe("primary"); expect(cleared.resultLocation).toBeUndefined(); }
          const setup = panel.getByRole("button", { name: `Set up ${provider.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", provider.id === "aws-s3"
            ? "https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html" : "https://docs.aws.amazon.com/athena/latest/ug/creating-workgroups.html");
        }
      }
      if (providerBatch === "slack") {
        await panel.getByRole("button", { name: "Add Slack", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const actor = panel.getByRole("combobox", { name: "Act in Slack as", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await client.fill("assigned-slack-client");
        await secret.fill("env:SLACK_SECRET");
        await callback.fill("env:SLACK_CALLBACK");
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Team Slack");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(52);
        const read = panel.getByRole("checkbox", { name: "View basic information about public channels in a workspace", exact: true });
        const history = panel.getByRole("checkbox", { name: "View messages and other content in public channels you are in", exact: true });
        const profile = panel.getByRole("checkbox", { name: "Edit a user's profile information and status", exact: true });
        const join = panel.getByRole("checkbox", { name: "Join public channels in a workspace", exact: true });
        await expect(read).toBeChecked();
        await history.uncheck();
        await profile.check();
        await panel.getByText("Connected user", { exact: true }).click();
        await page.getByRole("option", { name: "Installed bot", exact: true }).click();
        await expect(panel.getByRole("checkbox")).toHaveCount(49);
        await expect(profile).toHaveCount(0);
        await expect(read).toBeChecked();
        await join.check();
        await save.click();
        await expect(save).toBeDisabled();
        const bot = JSON.parse(await readFile(filePath, "utf8"));
        expect(bot.integrations.slack).toEqual({ provider: "slack", displayName: "Team Slack", accountMode: "per-user", scopes: ["channels:read", "channels:join"], settings: { actor: "bot" }, authentication: { method: "oauth2", registrationRef: "slack" } });
        expect(bot.registrations.slack).toEqual({ source: "own", clientId: "assigned-slack-client", clientSecretRef: "env:SLACK_SECRET", callbackUrlRef: "env:SLACK_CALLBACK" });
        expect(bot.extensions).toEqual(saved.extensions);
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Team Slack", { exact: true }).click();
        await expect(actor).toHaveValue("Installed bot");
        await expect(owner).toHaveValue("Each app user's own account");
        await expect(client).toHaveValue("assigned-slack-client");
        await expect(secret).toHaveValue("env:SLACK_SECRET");
        await expect(callback).toHaveValue("env:SLACK_CALLBACK");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(join).toBeChecked();
        await expect(history).not.toBeChecked();
        await panel.getByText("Installed bot", { exact: true }).click();
        await page.getByRole("option", { name: "Connected user", exact: true }).click();
        await expect(panel.getByRole("checkbox")).toHaveCount(52);
        await expect(profile).not.toBeChecked();
        await save.click();
        await expect(save).toBeDisabled();
        const user = JSON.parse(await readFile(filePath, "utf8"));
        expect(user.integrations.slack.settings).toEqual({ actor: "user" });
        expect(user.integrations.slack.scopes).toEqual(["channels:read"]);
        expect(user.registrations.slack).toEqual(bot.registrations.slack);
        const setup = panel.getByRole("button", { name: "Set up Slack", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.slack.dev/authentication/installing-with-oauth/");
      }
      if (providerBatch === "twitch") {
        await panel.getByRole("button", { name: "Add Twitch", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const displayName = panel.getByRole("textbox", { name: "Display name", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.twitch).toBeUndefined();
        await client.fill("assigned-twitch-client");
        await secret.fill("raw-twitch-secret");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-twitch-secret");
        await secret.fill("env:TWITCH_SECRET");
        await callback.fill("https://callback.example.test/twitch");
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await callback.fill("env:TWITCH_CALLBACK");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await displayName.fill("Stream account");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(23);
        const email = panel.getByRole("checkbox", { name: "Read your email address", exact: true });
        const follows = panel.getByRole("checkbox", { name: "Read the channels you follow", exact: true });
        const chat = panel.getByRole("checkbox", { name: "Send chat messages", exact: true });
        await expect(email).toBeChecked();
        await expect(follows).toBeChecked();
        await expect(chat).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Read your channel subscriptions", exact: true })).not.toBeChecked();
        await email.uncheck();
        await chat.check();
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.twitch).toEqual({ provider: "twitch", displayName: "Stream account", accountMode: "per-user", scopes: ["user:read:follows", "user:write:chat"], authentication: { method: "oauth2", registrationRef: "twitch" } });
        expect(file.registrations.twitch).toEqual({ source: "own", clientId: "assigned-twitch-client", clientSecretRef: "env:TWITCH_SECRET", callbackUrlRef: "env:TWITCH_CALLBACK" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Stream account", { exact: true }).click();
        await expect(owner).toHaveValue("Each app user's own account");
        await expect(client).toHaveValue("assigned-twitch-client");
        await expect(secret).toHaveValue("env:TWITCH_SECRET");
        await expect(callback).toHaveValue("env:TWITCH_CALLBACK");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(email).not.toBeChecked();
        await expect(follows).toBeChecked();
        await expect(chat).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Twitch", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://dev.twitch.tv/docs/authentication/register-app/");
      }
      if (providerBatch === "clickhouse") {
        await panel.getByRole("button", { name: "Add ClickHouse", exact: true }).click();
        const endpoint = panel.getByRole("textbox", { name: "HTTP Interface URL", exact: true });
        const username = panel.getByRole("textbox", { name: "Username (optional)", exact: true });
        const password = panel.getByRole("textbox", { name: "Password reference (optional)", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(password).toHaveValue("");
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await endpoint.fill("https://warehouse.example:8443/query/?readonly=0");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use an HTTPS site URL without credentials, a query, fragment or parent-path segments.", { exact: true })).toBeVisible();
        await endpoint.fill("https://warehouse.example:8443/query/");
        await username.fill("reader");
        await password.fill("raw-password");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-password");
        await password.fill("env:CLICKHOUSE_PASSWORD");
        await save.click();
        await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.clickhouse).toEqual({
          provider: "clickhouse", displayName: "ClickHouse", accountMode: "shared", scopes: [],
          authentication: { method: "api-key", secretRef: "env:CLICKHOUSE_PASSWORD" },
          settings: { httpUrl: "https://warehouse.example:8443/query/", username: "reader" }
        });
        await panel.getByText("Username and password", { exact: true }).click();
        await page.getByRole("option", { name: "No credentials", exact: true }).click();
        await expect(username).toHaveCount(0);
        await expect(password).toHaveCount(0);
        await save.click();
        await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.clickhouse.authentication).toEqual({ method: "none" });
        expect(file.integrations.clickhouse.settings).toEqual({ httpUrl: "https://warehouse.example:8443/query/" });
        expect(file.registrations.clickhouse).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("ClickHouse", { exact: true }).click();
        await expect(panel.getByText("No credentials", { exact: true })).toBeVisible();
        await expect(endpoint).toHaveValue("https://warehouse.example:8443/query/");
        await expect(password).toHaveCount(0);
        await panel.getByText("No credentials", { exact: true }).click();
        await page.getByRole("option", { name: "Username and password", exact: true }).click();
        await expect(username).toHaveValue("");
        await expect(password).toHaveValue("");
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.clickhouse.authentication).toEqual({ method: "api-key" });
        const setup = panel.getByRole("button", { name: "Set up ClickHouse", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://clickhouse.com/docs/products/cloud/guides/sql-console/connection-details");
      }
      if (providerBatch === "prestashop") {
        await panel.getByRole("button", { name: "Add PrestaShop", exact: true }).click();
        const site = panel.getByRole("textbox", { name: "Store URL", exact: true });
        const key = panel.getByRole("textbox", { name: "Webservice API key reference", exact: true });
        const displayName = panel.getByRole("textbox", { name: "Display name", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.prestashop).toBeUndefined();
        await site.fill("https://merchant.example/store/?ws_key=unsafe");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use an HTTPS site URL without credentials, a query, fragment or parent-path segments.", { exact: true })).toBeVisible();
        await site.fill("https://merchant.example:8443/store/");
        await key.fill("raw-prestashop-key");
        await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-prestashop-key");
        await key.fill("env:PRESTASHOP_WEBSERVICE_KEY");
        await displayName.fill("Merchant catalogue");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.prestashop).toEqual({
          provider: "prestashop", displayName: "Merchant catalogue", accountMode: "shared", scopes: [],
          authentication: { method: "api-key", secretRef: "env:PRESTASHOP_WEBSERVICE_KEY" },
          settings: { siteUrl: "https://merchant.example:8443/store/" }
        });
        expect(file.registrations.prestashop).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Merchant catalogue", { exact: true }).click();
        await expect(site).toHaveValue("https://merchant.example:8443/store/");
        await expect(key).toHaveValue("env:PRESTASHOP_WEBSERVICE_KEY");
        await expect(displayName).toHaveValue("Merchant catalogue");
        const setup = panel.getByRole("button", { name: "Set up PrestaShop", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://devdocs.prestashop-project.org/9/webservice/tutorials/creating-access/");
      }
      if (providerBatch === "wordpress") {
        for (const provider of [
          { id: "woocommerce", name: "WooCommerce", siteLabel: "Store URL", identityLabel: "Consumer key", identitySetting: "consumerKey",
            identity: "ck_fixture123", invalidIdentity: "not-a-consumer-key", identityError: "Enter the WooCommerce consumer key beginning ck_.",
            secretLabel: "Consumer secret reference", setupUrl: "https://developer.woocommerce.com/docs/apis/rest-api/authentication/" },
          { id: "wordpress-self-hosted", name: "WordPress (self-hosted)", siteLabel: "Site URL", identityLabel: "Username", identitySetting: "username",
            identity: "editor", invalidIdentity: "user:password", identityError: "Enter a username without colons or control characters.",
            secretLabel: "Application password reference", setupUrl: "https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/" }
        ]) {
          await panel.getByRole("button", { name: `Add ${provider.name}`, exact: true }).click();
          const site = panel.getByRole("textbox", { name: provider.siteLabel, exact: true });
          const identity = panel.getByRole("textbox", { name: provider.identityLabel, exact: true });
          const secret = panel.getByRole("textbox", { name: provider.secretLabel, exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(2);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations[provider.id]).toBeUndefined();
          await site.fill("https://site.example/?secret=unsafe");
          await identity.fill(provider.invalidIdentity);
          await save.click();
          await expect(panel.locator(".v-input").filter({ has: page.getByRole("textbox", { name: provider.siteLabel, exact: true }) })
            .getByText("Use an HTTPS site URL without credentials, a query, fragment or parent-path segments.", { exact: true })).toBeVisible();
          await expect(panel.locator(".v-input").filter({ has: page.getByRole("textbox", { name: provider.identityLabel, exact: true }) })
            .getByText(provider.identityError, { exact: true })).toBeVisible();
          await site.fill("https://merchant.example:8443/store/");
          await identity.fill(provider.identity);
          await secret.fill("raw-secret-must-stay-out-of-source");
          await save.click();
          await expect(panel.locator(".v-input").filter({ has: page.getByRole("textbox", { name: provider.secretLabel, exact: true }) })
            .getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain("raw-secret-must-stay-out-of-source");
          const reference = `env:${provider.id.toUpperCase().replaceAll("-", "_")}_SECRET`;
          await secret.fill(reference);
          await save.click();
          await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[provider.id].settings).toEqual({ siteUrl: "https://merchant.example:8443/store/", [provider.identitySetting]: provider.identity });
          expect(file.integrations[provider.id].authentication).toEqual({ method: "api-key", secretRef: reference });
          expect(file.registrations[provider.id]).toBeUndefined();
          expect(file.extensions).toEqual(saved.extensions);
          await page.reload();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(provider.name, { exact: true }).click();
          await expect(site).toHaveValue("https://merchant.example:8443/store/");
          await expect(identity).toHaveValue(provider.identity);
          await expect(secret).toHaveValue(reference);
          const setup = panel.getByRole("button", { name: `Set up ${provider.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", provider.setupUrl);
        }
      }
      if (providerBatch === "gong") {
        await panel.getByRole("button", { name: "Add Gong", exact: true }).click();
        const accessKey = panel.getByRole("textbox", { name: "Access key", exact: true });
        const apiBaseUrl = panel.getByRole("textbox", { name: "API base URL (optional)", exact: true });
        const secret = panel.getByRole("textbox", { name: "Access key secret reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.gong).toBeUndefined();
        await accessKey.fill("user:secret");
        await save.click();
        await expect(panel.getByText("Enter the access key without spaces, control characters or colons.", { exact: true })).toBeVisible();
        await accessKey.fill("EXAMPLE_ACCESS_KEY");
        await apiBaseUrl.fill("https://api.gong.io.attacker.invalid");
        await save.click();
        await expect(panel.getByText("Use https://api.gong.io or your company's https://<company>.api.gong.io address, without a path or query.", { exact: true })).toBeVisible();
        await apiBaseUrl.fill("https://company-17.api.gong.io/");
        await secret.fill("raw-gong-secret");
        await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-gong-secret");
        await secret.fill("env:GONG_ACCESS_SECRET");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.gong.settings).toEqual({ accessKey: "EXAMPLE_ACCESS_KEY", apiBaseUrl: "https://company-17.api.gong.io/" });
        expect(file.integrations.gong.authentication).toEqual({ method: "api-key", secretRef: "env:GONG_ACCESS_SECRET" });
        expect(file.registrations.gong).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Gong", { exact: true }).click();
        await expect(accessKey).toHaveValue("EXAMPLE_ACCESS_KEY");
        await expect(apiBaseUrl).toHaveValue("https://company-17.api.gong.io/");
        await expect(secret).toHaveValue("env:GONG_ACCESS_SECRET");
        await apiBaseUrl.fill("");
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.gong.settings.apiBaseUrl).toBe("https://api.gong.io");
        await expect(apiBaseUrl).toHaveValue("https://api.gong.io");
        const setup = panel.getByRole("button", { name: "Set up Gong", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://help.gong.io/docs/receive-access-to-the-api");
      }
      if (providerBatch === "oura") {
        await panel.getByRole("button", { name: "Add Oura", exact: true }).click();
        await expect(panel.getByText("Each app user's own account", { exact: true })).toBeVisible();
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-oura-client");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read daily sleep, activity and readiness summaries", exact: true })).toBeChecked();
        const personal = panel.getByRole("checkbox", { name: "Read personal profile information", exact: true });
        await expect(personal).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Read the account email address", exact: true })).not.toBeChecked();
        await personal.check();
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.oura.accountMode).toBe("per-user");
        expect(file.integrations.oura.scopes).toEqual(["daily", "personal"]);
        expect(file.registrations.oura).toEqual({ source: "own", clientId: "fixture-oura-client", clientSecretRef: "env:OURA_CLIENT_SECRET", callbackUrlRef: "env:OURA_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Oura", { exact: true }).click();
        await expect(panel.getByText("Each app user's own account", { exact: true })).toBeVisible();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("fixture-oura-client");
        await permissions.click();
        await expect(personal).toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Read the account email address", exact: true })).not.toBeChecked();
      }
      if (providerBatch === "additional-tokens") {
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Fireflies", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "API key reference", exact: true })).toHaveValue("env:FIREFLIES_KEY");
      }
      if (["existing", "service-readers"].includes(providerBatch)) {
        const googleProviders = providerBatch === "service-readers" ? [
          ["Google Analytics", "google-analytics", "Read Analytics accounts and properties", "analytics.readonly"],
          ["BigQuery", "bigquery", "Read BigQuery data and metadata", "bigquery.readonly"]
        ] : [
          ["Gmail", "gmail", "Read messages", "gmail.readonly"],
          ["Google Drive", "google-drive", "Read file metadata", "drive.metadata.readonly"],
          ["Google Sheets", "google-sheets", "Read spreadsheets", "spreadsheets.readonly"],
          ["Google Docs", "google-docs", "Read documents", "documents.readonly"],
          ["Google Slides", "google-slides", "Read presentations", "presentations.readonly"],
          ["Google Search Console", "google-search-console", "Read Search Console properties", "webmasters.readonly"]
        ];
        for (const [name, id, permission, scope] of googleProviders) {
          await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill(name);
          await panel.getByRole("button", { name: `Add ${name}`, exact: true }).click();
          await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill(`${id}.apps.googleusercontent.com`);
          const checkbox = panel.getByRole("checkbox", { name: permission, exact: true });
          if (!await checkbox.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
          await expect(checkbox).toBeChecked();
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[id]).toMatchObject({
            provider: id, scopes: [`https://www.googleapis.com/auth/${scope}`],
            authentication: { method: "oauth2", registrationRef: id }
          });
          expect(file.registrations[id].clientId).toBe(`${id}.apps.googleusercontent.com`);
          expect(file.extensions).toEqual(saved.extensions);
          const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", /^https:/);
        }
      }
      if (providerBatch === "service-readers") {
        await page.reload();
        const configured = panel.getByRole("list", { name: "Configured integrations" });
        await configured.getByText("Supabase", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "API key reference", exact: true })).toHaveValue("env:SUPABASE_KEY");
        await configured.getByText("BigQuery", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("bigquery.apps.googleusercontent.com");
      }
      if (providerBatch === "microsoft") {
        for (const [name, id, permission, scope] of [
          ["Microsoft Outlook", "microsoft-outlook", "Read basic mail properties", "Mail.ReadBasic"],
          ["Microsoft OneDrive", "microsoft-onedrive", "Read your files", "Files.Read"],
          ["Microsoft Excel", "microsoft-excel", "Read and write your files (required by Excel)", "Files.ReadWrite"],
          ["Microsoft Teams", "microsoft-teams", "Read team names and descriptions", "Team.ReadBasic.All"],
          ["Microsoft OneNote", "microsoft-onenote", "Read your notebooks", "Notes.Read"],
          ["Microsoft SharePoint", "microsoft-sharepoint", "Read accessible sites", "Sites.Read.All"]
        ]) {
          await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill(name);
          await panel.getByRole("button", { name: `Add ${name}`, exact: true }).click();
          await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("11111111-2222-3333-4444-555555555555");
          const tenantId = ["microsoft-teams", "microsoft-sharepoint"].includes(id) ? "organizations" : "common";
          await expect(panel.getByRole("textbox", { name: "Directory (tenant) ID", exact: true })).toHaveValue(tenantId);
          const checkbox = panel.getByRole("checkbox", { name: permission, exact: true });
          if (!await checkbox.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
          await expect(checkbox).toBeChecked();
          await expect(panel.getByRole("checkbox", { name: "Keep access when you are away", exact: true })).toBeChecked();
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[id]).toMatchObject({
            provider: id, scopes: [scope, "offline_access"], settings: { tenantId }, authentication: { method: "oauth2", registrationRef: id }
          });
          const prefix = id.toUpperCase().replaceAll("-", "_");
          expect(file.registrations[id]).toEqual({
            source: "own", clientId: "11111111-2222-3333-4444-555555555555",
            clientSecretRef: `env:${prefix}_CLIENT_SECRET`, callbackUrlRef: `env:${prefix}_CALLBACK_URL`
          });
          expect(file.extensions).toEqual(saved.extensions);
          const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app");
          if (["microsoft-teams", "microsoft-sharepoint"].includes(id)) {
            await expect(panel.getByText("Choose Multiple Entra ID tenants. This connector requires a work or school account.", { exact: true })).toBeVisible();
          }
        }
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Microsoft Excel", { exact: true }).click();
        const permission = panel.getByRole("checkbox", { name: "Read and write your files (required by Excel)", exact: true });
        if (!await permission.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
        await expect(permission).toBeChecked();
      }
      if (providerBatch === "microsoft-documents") {
        const tenants = ["11111111-2222-3333-4444-555555555555", "consumers"];
        for (const [index, [name, id]] of [["Microsoft Word", "microsoft-word"], ["Microsoft PowerPoint", "microsoft-powerpoint"]].entries()) {
          await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill(name);
          await panel.getByRole("button", { name: `Add ${name}`, exact: true }).click();
          const tenant = panel.getByRole("textbox", { name: "Directory (tenant) ID", exact: true });
          const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
          const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
          const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          await expect(tenant).toHaveValue("common");
          await client.fill(`assigned-${id}-client`);
          await tenant.fill("https://attacker.example/tenant");
          await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(1);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations[id]).toBeUndefined();
          await tenant.fill(tenants[index]);
          await secret.fill(`env:${id.toUpperCase().replaceAll("-", "_")}_SECRET`);
          await callback.fill(`env:${id.toUpperCase().replaceAll("-", "_")}_CALLBACK`);
          await panel.getByText("One shared account", { exact: true }).click();
          await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
          await panel.getByRole("textbox", { name: "Display name", exact: true }).fill(`${name} files`);
          const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          await expect(panel.getByRole("checkbox", { name: "Read your files", exact: true })).toBeChecked();
          const offline = panel.getByRole("checkbox", { name: "Keep access when you are away", exact: true });
          await expect(offline).toBeChecked();
          if (index === 1) await offline.uncheck();
          await save.click();
          await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[id]).toEqual({ provider: id, displayName: `${name} files`, accountMode: "per-user",
            scopes: index === 0 ? ["Files.Read", "offline_access"] : ["Files.Read"], settings: { tenantId: tenants[index] },
            authentication: { method: "oauth2", registrationRef: id } });
          expect(file.registrations[id]).toEqual({ source: "own", clientId: `assigned-${id}-client`,
            clientSecretRef: `env:${id.toUpperCase().replaceAll("-", "_")}_SECRET`, callbackUrlRef: `env:${id.toUpperCase().replaceAll("-", "_")}_CALLBACK` });
          expect(file.extensions).toEqual(saved.extensions);
          await page.reload();
          if (viewport.name !== "expanded") await showProject.click();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(`${name} files`, { exact: true }).click();
          await expect(tenant).toHaveValue(tenants[index]);
          await expect(client).toHaveValue(`assigned-${id}-client`);
          await expect(secret).toHaveValue(file.registrations[id].clientSecretRef);
          await expect(callback).toHaveValue(file.registrations[id].callbackUrlRef);
          await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Each app user's own account");
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          await expect(offline).toBeChecked({ checked: index === 0 });
          const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app");
        }
      }
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
