import { test, expect, type Locator } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { DASHBOARD_PATH, directChatSessionId, viewports } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

async function addIntegration(panel: Locator, name: string) {
  const search = panel.getByRole("textbox", { name: "Search integrations", exact: true });
  await search.fill(name);
  await panel.getByRole("button", { name: `Add ${name}`, exact: true }).click();
  await search.fill("");
}

const credentialLabels: Record<string, string> = {
  clay: "Public API key reference",
  contentful: "Content Delivery API token reference",
  telegram: "Bot token reference",
  sevdesk: "API token reference",
  mapbox: "Backend access token reference",
  "google-maps-platform": "Server API key reference",
  "logo-dev": "Publishable key reference"
};
const optionalKeyFields: Record<string, { label: string; setting: string; reference: string }> = {
  mapbox: { label: "Public browser token reference", setting: "publicTokenRef", reference: "env:MAPBOX_PUBLIC_TOKEN" },
  "google-maps-platform": { label: "Browser API key reference (optional)", setting: "browserKeyRef", reference: "env:GOOGLE_MAPS_BROWSER_KEY" }
};

for (const { viewport, providerBatch } of [
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-ads-search" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "airtable" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "apify" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "apollo" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "asana" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "ashby" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "attention" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "brevo" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "calendly" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "clay" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "contentful" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "elevenlabs" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "firecrawl" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "fireflies" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "gatewayapi" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "github-api" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "gitlab-api" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "gmail" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "analytics" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-slides" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-sheets" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-search-console" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-maps" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-drive" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "google-docs" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "calendar" },
  ...viewports.map((viewport) => ({ viewport, providerBatch: viewport.name === "expanded" ? "existing" : "responsive" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-excel" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-teams" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-sharepoint" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-outlook" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-onenote" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "microsoft-onedrive" },
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
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "mapbox" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "mailgun" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "logo-dev" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "public-resources" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "wordpress" },
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "wordpress-com" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "mcp" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "n8n" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "notion" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "perplexity" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "pipedrive" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "replicate" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "resend" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "inngest" },
  ...viewports.map((viewport) => ({ viewport, providerBatch: "amplitude" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "atlassian" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "design-mcp" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "miro" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "figma" },
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "prestashop" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "clickhouse" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "twitch" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "slack" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "aws" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "redshift" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "bigquery" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "xero" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "semrush" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "granola" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "hex" })),
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "heygen" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "linear" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "hubspot" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "incident-io" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "klipy" },
  { viewport: viewports.find((viewport) => viewport.name === "expanded")!, providerBatch: "lexware" },
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "confidence" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "lightspeed" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "databricks" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "fabric" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "dbt" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "firebase" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "salesforce" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "google-ads" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "linkedin" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "tiktok" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "wordpress-self-hosted" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "woocommerce" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "wix" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "snowflake" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "storyblok" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "workday" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "shopify" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "wiz" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "ai" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "gemini-enterprise" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "x-twitter" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "tally" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "telegram" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "sanity" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "sentry" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "wave" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "zoho-books" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "zoho-crm" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "canva" })),
  ...viewports.map((viewport) => ({ viewport, providerBatch: "twilio" })),
  ...viewports.filter((viewport) => viewport.name !== "medium").map((viewport) => ({ viewport, providerBatch: "posthog" }))
]) {
  const name = providerBatch === "google-ads-search" ? "Google Ads Search saves portable plans and requires separate launch approval" : providerBatch === "google-slides" ? "Slides form supports create-first decks and explains editing ownership" : providerBatch === "google-sheets" ? "Sheets form supports create-first access and explains formula writes" : providerBatch === "google-search-console" ? "Search Console form explains property verification and sitemap writes" : providerBatch === "google-maps" ? "Maps form preserves separate keys and composes the native map boundary" : providerBatch === "google-drive" ? "Drive form explains file grants and bounded transfers" : providerBatch === "google-docs" ? "Docs form supports create-first access and explains native edits" : providerBatch === "calendar" ? "Calendar form explains event writes and attendee effects" : providerBatch === "sentry"
    ? `Sentry registration and scoped OAuth lifecycle (${viewport.name})`
    : providerBatch === "sanity"
    ? `Sanity registration and OAuth lifecycle (${viewport.name})`
    : providerBatch === "airtable"
    ? "Airtable form saves PAT references and explains scopes, verification and revocation"
    : providerBatch === "calendly"
    ? "Calendly form explains personal tokens OAuth scopes and booking requirements"
    : providerBatch === "brevo"
    ? "Brevo form explains sender DNS SMS and delivery readiness with private keys"
    : providerBatch === "attention"
    ? "Attention form saves organization keys and explains access and seat ownership"
    : providerBatch === "ashby"
    ? "Ashby form saves organization keys and explains recruiting permissions and disabling"
    : providerBatch === "asana"
    ? "Asana form saves personal tokens and explains project permissions and revocation"
    : providerBatch === "apollo"
    ? "Apollo form saves workspace keys and explains endpoint permissions and credit usage"
    : providerBatch === "apify"
    ? "Apify form saves token references and explains verification, run access and revocation"
    : providerBatch === "analytics"
    ? "Analytics dashboard saves public settings and removes them without connecting"
    : providerBatch === "microsoft-teams"
      ? "Microsoft Teams form explains channel and chat permissions"
    : providerBatch === "microsoft-sharepoint"
      ? "Microsoft SharePoint form explains library transfers and concurrent list edits"
    : providerBatch === "microsoft-outlook"
      ? "Microsoft Outlook form explains mail actions and personal appointments"
    : providerBatch === "microsoft-onenote"
      ? "Microsoft OneNote form explains note creation and content ownership"
    : providerBatch === "microsoft-onedrive"
      ? "Microsoft OneDrive form explains downloads and bounded uploads"
    : providerBatch === "microsoft-excel"
      ? "Microsoft Excel form explains cell writes and workbook sessions"
    : providerBatch === "microsoft"
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
    : providerBatch === "gmail"
      ? "Gmail form explains body read and explicit send permissions"
    : providerBatch === "gitlab-api"
      ? "GitLab API form explains instance ownership and write permissions"
    : providerBatch === "github-api"
      ? "GitHub API form explains OAuth and repository token permissions"
    : providerBatch === "gatewayapi"
      ? "GatewayAPI form explains messaging webhook and regional ownership"
    : providerBatch === "fireflies"
      ? "Fireflies form explains transcript content and account access"
    : providerBatch === "firecrawl"
      ? "Firecrawl form explains own credits and bounded crawl completion"
    : providerBatch === "elevenlabs"
      ? "ElevenLabs form explains synthesis permissions and instant voice cloning"
    : providerBatch === "contentful"
      ? "Contentful form saves delivery space and explains published linked content"
    : providerBatch === "clay"
      ? "Clay form explains Public API keys routine setup and Enterprise tables"
    : providerBatch === "chargebee"
      ? "Chargebee form validates site names and saves its own key reference"
    : providerBatch === "account-readers"
      ? "account reader forms save Ashby, Lexware and Sevdesk credential references"
    : providerBatch === "sales-readers"
      ? "sales reader forms save Apollo.io, Attention and Clay credential references"
    : providerBatch === "path-readers"
      ? "path credential forms save Telegram and KLIPY references and setup instructions"
    : providerBatch === "mapbox"
      ? "Mapbox form separates browser-only maps from backend geocoding"
    : providerBatch === "mailgun"
      ? "Mailgun form explains sending DNS and delivery ownership"
    : providerBatch === "logo-dev"
      ? "Logo.dev form explains public lookups and image delivery"
    : providerBatch === "public-resources"
      ? "public resource forms save Mapbox, Google Maps and Logo.dev references and load image fixtures"
    : providerBatch === "woocommerce"
      ? `WooCommerce configuration and account lifecycle (${viewport.name})`
    : providerBatch === "wordpress-self-hosted"
      ? `WordPress self-hosted configuration and account lifecycle (${viewport.name})`
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
    : providerBatch === "bigquery"
      ? `BigQuery form saves project ownership and explains OAuth permissions (${viewport.name})`
    : providerBatch === "redshift"
      ? `Redshift form persists serverless and provisioned targets without mixed fields (${viewport.name})`
    : providerBatch === "xero"
      ? `Xero form persists Basic registration, ownership and accounting permissions (${viewport.name})`
    : providerBatch === "zoho-books"
      ? `Zoho Books form persists region, optional organisation, ownership and references (${viewport.name})`
    : providerBatch === "zoho-crm"
      ? `Zoho CRM form persists data center, environment, ownership and references (${viewport.name})`
    : providerBatch === "wave"
      ? `Wave form persists ownership, read scopes and registration references (${viewport.name})`
    : providerBatch === "semrush"
      ? `Semrush form persists V4 key references and shared or assistant ownership (${viewport.name})`
    : providerBatch === "granola"
      ? `Granola form persists key references and shared or assistant ownership (${viewport.name})`
    : providerBatch === "lexware"
      ? `Lexware form explains accounting permissions and draft limits (${viewport.name})`
    : providerBatch === "klipy"
      ? `KLIPY form explains media setup and embedding limits (${viewport.name})`
    : providerBatch === "incident-io"
      ? `incident.io form explains roles and safe management (${viewport.name})`
    : providerBatch === "linear"
      ? `Linear form explains approved MCP workflows and credential modes (${viewport.name})`
    : providerBatch === "hubspot"
      ? `HubSpot form explains CRM permissions and both credential modes (${viewport.name})`
    : providerBatch === "heygen"
      ? `HeyGen form separates keys and registers MCP OAuth (${viewport.name})`
    : providerBatch === "hex"
      ? `Hex form persists endpoint, permissions and assistant registration (${viewport.name})`
    : providerBatch === "lightspeed"
      ? `Lightspeed form persists store prefix, permissions and ownership (${viewport.name})`
    : providerBatch === "salesforce"
      ? `Salesforce form preserves environment, My Domain and credential references (${viewport.name})`
    : providerBatch === "telegram"
      ? `Telegram form and account lifecycle (${viewport.name})`
    : providerBatch === "tally"
      ? `Tally form and account lifecycle (${viewport.name})`
    : providerBatch === "x-twitter"
      ? `X Twitter form persists app token references and shared or assistant ownership (${viewport.name})`
    : providerBatch === "storyblok"
      ? `Storyblok content configuration and lifecycle (${viewport.name})`
    : providerBatch === "snowflake"
      ? `Snowflake form persists account, role scopes and credential references (${viewport.name})`
    : providerBatch === "workday"
      ? `Workday form validates tenant endpoints and preserves personal OAuth references (${viewport.name})`
    : providerBatch === "shopify"
      ? `Shopify form preserves store credentials and assistant action permissions (${viewport.name})`
    : providerBatch === "wiz"
      ? `Wiz form preserves scanner credentials, endpoints and policy filters (${viewport.name})`
    : providerBatch === "ai"
      ? `AI form defaults to free access and preserves model and credential ownership (${viewport.name})`
    : providerBatch === "gemini-enterprise"
      ? `Gemini Enterprise form preserves project, region, engine and OAuth references (${viewport.name})`
    : providerBatch === "wix"
      ? `Wix form saves account ID, key reference and ownership (${viewport.name})`
    : providerBatch === "tiktok"
      ? `TikTok form saves Client key, required and optional permissions across ownership modes (${viewport.name})`
    : providerBatch === "linkedin"
      ? `LinkedIn form preserves required and optional permissions, ownership and references (${viewport.name})`
    : providerBatch === "google-ads"
      ? `Google Ads form preserves API access mode, manager and credential references (${viewport.name})`
    : providerBatch === "firebase"
      ? `Firebase Cloud Messaging form preserves service credentials and conditional web settings (${viewport.name})`
    : providerBatch === "dbt"
      ? `dbt Semantic Layer form preserves host, exact Environment ID and service token reference (${viewport.name})`
    : providerBatch === "fabric"
      ? `Microsoft Fabric form persists tenant, endpoint and grant-specific permissions (${viewport.name})`
    : providerBatch === "databricks"
      ? `Databricks form persists user and service credentials without mixed fields (${viewport.name})`
    : providerBatch === "confidence"
      ? `Confidence forms persist separate assistant registrations and permissions (${viewport.name})`
    : providerBatch === "clickhouse"
      ? `ClickHouse form saves credential modes and optional passwords (${viewport.name})`
    : providerBatch === "resend"
      ? "Resend form explains verified senders and reviewed broadcasts"
    : providerBatch === "replicate"
      ? "Replicate form explains predictions and result retention"
    : providerBatch === "pipedrive"
      ? "Pipedrive form explains company routing and CRM permissions"
    : providerBatch === "perplexity"
      ? "Perplexity form explains native answers and app-owned billing"
    : providerBatch === "notion"
      ? "Notion form explains content capabilities and page ownership"
    : providerBatch === "n8n"
      ? "n8n form explains token setup and deferred workflow attachment"
    : providerBatch === "mcp"
      ? "MCP assistant forms validate endpoint and token references and persist ownership"
    : providerBatch === "inngest"
      ? "Inngest form separates Signing and Event Key references and persists branch settings"
    : providerBatch === "amplitude"
      ? `Amplitude form saves assistant OAuth registration, region and permissions (${viewport.name})`
    : providerBatch === "atlassian"
      ? "Atlassian form saves assistant registration and independent product permissions"
    : providerBatch === "canva"
      ? `Canva form saves metadata clients without secrets and preserves design permissions (${viewport.name})`
    : providerBatch === "figma"
      ? "Figma form explains remote client approval and desktop topology"
    : providerBatch === "miro"
      ? "Miro form explains registration and deferred chat attachment"
    : providerBatch === "design-mcp"
      ? "Figma and Miro forms save assistant registrations and independent design permissions"
    : providerBatch === "wordpress-com"
      ? `WordPress.com form saves OAuth registration and selected permissions (${viewport.name})`
    : `integration form saves the CLI configuration and protects drafts (${viewport.name})`;
  test(name, async ({ page }) => {
    test.setTimeout(providerBatch === "responsive" && viewport.name === "compact" ? 180_000 : 120_000);
    await page.setViewportSize(viewport);
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-integration-browser-"));
    const source = path.join(root, "sessions", "active", directChatSessionId, "source");
    await mkdir(source, { recursive: true });
    const registrationPosts: string[] = [];
    const registrationEnv: unknown[] = [];
    const service = createService({
      integrationDiscoveryFetch: async (url, options) => {
        registrationPosts.push(String(url));
        return Response.json({ ...JSON.parse(options.body), client_id: providerBatch === "confidence" ? `assigned-confidence-${JSON.parse(options.body).client_name.includes("Flags") ? "flags" : "exp"}` : `assigned-${providerBatch}-client`, client_secret: `private-${providerBatch}-browser-fixture` });
      },
      temporaryRoot: path.join(root, "temporary"),
      projectService: {
        readEnv: async () => ({ ok: true, env: { records: [] } }),
        saveEnvUserValues: async (request) => { registrationEnv.push(request); return { ok: true }; },
        createRuntime: async () => ({
        ...(["amplitude", "atlassian", "confidence", "sanity", "sentry", "granola", "hex", "heygen"].includes(providerBatch) ? { store: { runSessionExclusive: async (_id, _lock, work) => ({ acquired: true, value: await work() }) } } : {}),
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
        [`/vibe64/sessions/${directChatSessionId}/agent-session`, { ok: true }],
        [`/vibe64/sessions/${directChatSessionId}/presence`, { ok: true }],
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
      if (["amplitude", "atlassian", "confidence", "sanity", "sentry", "granola", "hex", "heygen"].includes(providerBatch)) await page.route(/\/integrations\/(?:amplitude|atlassian|confidence-exp|confidence-flags|sanity|sentry|granola|hex|heygen)\/oauth-client$/, async route => {
        const result = await service.registerOAuthIntegration({ sessionId: directChatSessionId, integrationId: new URL(route.request().url()).pathname.split("/").at(-2),
          ...route.request().postDataJSON(), vibe64User: { role: "owner" } });
        await route.fulfill({ status: result.statusCode || 200, contentType: "application/json", body: JSON.stringify(result) });
      });
      const connectionStatuses: Record<string, string> = {};
      const previousConnectionStatuses: Record<string, string> = {};
      const setupIssues: Record<string, string> = {};
      const setupRequests: unknown[] = [];
      let rejectApiKey = true;
      await page.route(/\/integrations\/[^/]+\/setup$/, async (route) => {
        setupRequests.push(route.request().postDataJSON());
        const { operation } = route.request().postDataJSON();
        const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
        if (providerBatch === "google-ads-search" && operation.startsWith("ads-")) {
          const input = route.request().postDataJSON();
          const config = JSON.parse(await readFile(path.join(source, "integrations.json"), "utf8"));
          const account = { id: "1234567890", descriptiveName: "Dog And Groom", currencyCode: "AUD", timeZone: "Australia/Perth", status: "ENABLED" };
          const conversion = { id: "22", name: "Booking", status: "ENABLED", type: "WEBPAGE", tagSnippets: [{ eventSnippet: "<script>window.__adsMustNotExecute = true</script>" }] };
          const replies = {
            "ads-discover": input.ads.customerId ? { account, clients: [], conversions: [{ conversionAction: conversion }], campaigns: [] } : { accounts: ["customers/1234567890"] },
            "ads-targets": { locations: [{ geoTargetConstant: { id: "2036", canonicalName: "Australia" } }], languages: [{ languageConstant: { id: "1000", name: "English" } }] },
            "ads-preview": { plan: config.extensions?.googleAdsSearch?.[id], account, conversion, reviewId: "a".repeat(64) },
            "ads-create": { campaignId: "33", status: "PAUSED" },
            "ads-campaign": { customerId: account.id, account, campaign: { id: "33", status: "PAUSED", name: "Dog leads" }, campaignBudget: { amountMicros: "12000000" }, reviewId: "b".repeat(64) },
            "ads-launch": { results: [{ resourceName: "customers/1234567890/campaigns/33" }] },
            "ads-pause": { results: [{ resourceName: "customers/1234567890/campaigns/33" }] },
            "ads-report": { campaigns: [{ campaign: { id: "33", name: "Dog leads" }, metrics: { clicks: "10", costMicros: "1000000" } }] }
          };
          await fulfillJson(route, { ok: true, status: "ads", operation, data: replies[operation] });
          return;
        }
        if (setupIssues[id]) {
          await fulfillJson(route, { ok: true, status: "unconfigured", setupIssue: setupIssues[id] });
          return;
        }
        if (operation === "connect" && id === "resend" && rejectApiKey) {
          rejectApiKey = false;
          await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, error: "The application could not verify this API key." }) });
          return;
        }
        if (operation === "connect") {
          previousConnectionStatuses[id] = connectionStatuses[id] || "disconnected";
          connectionStatuses[id] = ["resend", "posthog", "google-maps-platform", "x-twitter", "tally", "telegram", "aws-s3", "aws-athena", "amazon-redshift", "wordpress-self-hosted", "woocommerce", "semrush", "storyblok", "twilio", "incident-io", "inngest", "klipy", "lexware", "mailgun", "wix"].includes(id) ? "connected" : "pending";
        }
        if (operation === "cancel") connectionStatuses[id] = previousConnectionStatuses[id] || "disconnected";
        if (operation === "disconnect") connectionStatuses[id] = "disconnected";
        const connectionStatus = connectionStatuses[id] || "disconnected";
        await fulfillJson(route, { ok: true, status: connectionStatus,
          ...(id === "gmail" && connectionStatus === "connected" ? { accountLabel: "business@example.test" } : {}),
          ...(id === "gmail-2" && connectionStatus === "connected" ? { accountLabel: "support@example.test" } : {}),
          ...(id === "google-calendar" ? { callbackUrl: "https://previous.example/callback" } : {}),
          ...(connectionStatus === "connected" && id === "google-calendar" ? {
            grantedScopes: ["https://www.googleapis.com/auth/calendar.calendarlist.readonly", "provider:future-permission"],
            verifiedAt: "2026-09-11T03:00:00.000Z"
          } : {}),
          ...(connectionStatus === "pending" ? {
            authorizationUrl: "https://accounts.example/consent", attemptId: "fixture-attempt",
            expiresAt: "2030-01-01T00:00:00Z"
          } : {})
        });
      });
      await page.goto(`${DASHBOARD_PATH}/integrations`);
      const showProject = page.getByRole("button", { name: "Show project", exact: true });
      if (viewport.name !== "expanded") await showProject.click();
      const panel = page.locator(".integrations-panel");
      await expect(panel.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
      if (providerBatch === "google-ads-search") {
        page.setDefaultTimeout(15000);
        await addIntegration(panel, "Google Ads");
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-ads-client");
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await save.click(); await expect(save).toBeDisabled();
        const ads = panel.getByRole("region", { name: "Google Ads Search campaigns" });
        await expect(ads).toBeVisible();
        await ads.getByRole("button", { name: "1. Choose an existing account and conversion goal" }).click();
        await ads.getByRole("button", { name: "List accessible accounts", exact: true }).click();
        await expect(ads.getByText(/customers\/1234567890/)).toBeVisible();
        await ads.getByRole("textbox", { name: "Ads customer ID", exact: true }).fill("1234567890");
        await ads.getByRole("button", { name: "Load account and goals", exact: true }).click();
        await ads.getByRole("combobox", { name: "Website conversion goal" }).press("ArrowDown");
        await page.getByRole("option", { name: "Booking (22)", exact: true }).click();
        await expect(ads.getByRole("textbox", { name: "Google tag snippet 1 (display only)" })).toHaveValue(/__adsMustNotExecute/);
        expect(await page.evaluate(() => (window as any).__adsMustNotExecute)).toBeUndefined();
        await ads.getByRole("button", { name: "2. Prepare the Search campaign" }).click();
        await ads.getByRole("textbox", { name: "Campaign name", exact: true }).fill("Dog leads");
        await ads.getByRole("textbox", { name: "Public HTTPS landing page" }).fill("https://dog.example.test/book");
        await ads.getByRole("textbox", { name: "Average daily budget" }).fill("12");
        await ads.getByRole("textbox", { name: "Maximum cost per click" }).fill("1.50");
        await ads.getByRole("textbox", { name: "Find a target location" }).fill("Australia");
        await ads.getByRole("button", { name: "Find locations and languages" }).click();
        await ads.getByRole("combobox", { name: "Target location IDs" }).click();
        await page.getByRole("option", { name: "Australia", exact: true }).click();
        await ads.getByRole("combobox", { name: "Target location IDs" }).press("Escape");
        await ads.getByRole("combobox", { name: "Target language ID", exact: true }).click();
        await page.getByRole("option", { name: "English", exact: true }).click();
        await ads.getByRole("textbox", { name: "Phrase keywords — one per line" }).fill("dog grooming");
        await ads.getByRole("textbox", { name: "Ad headlines — one per line" }).fill("Book Dog Grooming\nLocal Groomers\nMake A Booking");
        await ads.getByRole("textbox", { name: "Ad descriptions — one per line" }).fill("Book an appointment for your dog.\nMeet our experienced team.");
        await ads.getByRole("checkbox", { name: "This campaign does not contain EU political advertising" }).check();
        await ads.getByRole("button", { name: "Apply Search plan to configuration" }).click();
        await expect(ads.getByRole("button", { name: "Validate and review saved plan" })).toBeDisabled();
        await save.click(); await expect(save).toBeDisabled();
        const config = JSON.parse(await readFile(path.join(source, "integrations.json"), "utf8"));
        expect(config.extensions.googleAdsSearch["google-ads"].dailyBudgetMicros).toBe("12000000");
        expect(config.extensions.googleAdsSearch["google-ads"].maxCpcMicros).toBe("1500000");
        expect(config.integrations["google-ads"].settings?.searchCampaign).toBeUndefined();
        await ads.getByRole("button", { name: "Validate and review saved plan" }).click();
        await ads.getByRole("button", { name: "Review paused campaign creation" }).click();
        expect(setupRequests.some((input: any) => input.operation === "ads-create")).toBe(false);
        await page.getByRole("button", { name: "Confirm create", exact: true }).click();
        await expect(ads.getByText(/Campaign 33 created PAUSED/)).toBeVisible();
        expect(setupRequests.some((input: any) => input.operation === "ads-launch")).toBe(false);
        await ads.getByRole("button", { name: "Inspect current campaign" }).click();
        const launch = ads.getByRole("button", { name: "Review campaign launch" });
        await expect(launch).toBeDisabled();
        await ads.getByRole("checkbox", { name: "I verified the conversion tag and successful lead event on the landing site" }).check();
        await ads.getByRole("checkbox", { name: "I verified account billing, advertiser requirements and the website, and approve spending this budget" }).check();
        await launch.click();
        await page.getByRole("button", { name: "Confirm launch", exact: true }).click();
        await expect.poll(() => setupRequests.filter((input: any) => input.operation === "ads-launch").length).toBe(1);
        await ads.getByRole("button", { name: "Review pause", exact: true }).click();
        await page.getByRole("button", { name: "Confirm pause", exact: true }).click();
        await ads.getByRole("button", { name: "Read last 30 days report" }).click();
        await expect(ads.getByRole("textbox", { name: /Search campaign report/ })).toHaveValue(/costMicros/);
        await page.setViewportSize(viewports.find(v => v.name === "compact")!);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(errors).toEqual([]);
        return;
      }
      if (providerBatch === "analytics") {
        await addIntegration(panel, "Google Analytics");
        await panel.getByRole("textbox", { name: "Measurement ID", exact: true }).fill("G-APP12345");
        await expect(panel.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Check connection", exact: true })).toHaveCount(0);
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        await expect(panel.getByRole("button", { name: "Save configuration", exact: true })).toBeDisabled();
        await expect(panel.getByText("Configured", { exact: true })).toBeVisible();
        const filePath = path.join(source, "integrations.json");
        const saved = JSON.parse(await readFile(filePath, "utf8"));
        expect(saved.integrations["google-analytics"].settings).toEqual({ measurementId: "G-APP12345" });
        expect(saved.registrations).toEqual({});
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Analytics", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Measurement ID", exact: true })).toHaveValue("G-APP12345");
        const analyticsSetup = panel.getByRole("button", { name: "Set up Google Analytics", exact: true });
        if (await analyticsSetup.getAttribute("aria-expanded") !== "true") await analyticsSetup.click();
        await expect(panel.getByText(/Choose one tracking owner/)).toBeVisible();
        await expect(panel.getByText(/For conversions, emit an event such as generate_lead/)).toBeVisible();
        await panel.getByRole("button", { name: "Remove", exact: true }).click();
        await page.getByRole("button", { name: "Remove integration", exact: true }).click();
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        await expect(panel.getByRole("button", { name: "Save configuration", exact: true })).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations).toEqual({});
        expect(setupRequests).toEqual([]);
        expect(errors).toEqual([]);
        const analyticsModuleUrl = "data:text/javascript;base64," + Buffer.from(await readFile(new URL(import.meta.resolve("@jskit-ai/connectors-catalog/client/google-analytics")), "utf8")).toString("base64");
        const tracking = await page.context().newPage();
        try {
          const address = new URL("/analytics-fixture", page.url()).href;
          await tracking.route(address, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Tracking fixture</title><p>Controlled tag boundary</p>" }));
          const tagRequests: string[] = [];
          await tracking.route("https://www.googletagmanager.com/**", route => { tagRequests.push(route.request().url()); return route.fulfill({ contentType: "application/javascript", body: "/* controlled tag; no telemetry */" }); });
          await tracking.goto(address);
          const result = await tracking.evaluate(async (moduleUrl) => {
            const { createGoogleAnalytics } = await import(moduleUrl);
            const browser = window as typeof window & { dataLayer?: IArguments[]; [key: string]: any };
            const tracker = createGoogleAnalytics({ measurementId: "G-FIXTURE1", window });
            const same = createGoogleAnalytics({ measurementId: "G-FIXTURE1", window }) === tracker;
            const before = { scripts: document.querySelectorAll('script[src*="googletagmanager.com"]').length, event: tracker.event("generate_lead"), disabled: browser["ga-disable-G-FIXTURE1"] };
            tracker.setConsent(true); tracker.setConsent(true);
            const first = tracker.pageView({ location: "https://example.test/bookings", title: "Bookings" });
            const duplicate = tracker.pageView({ location: "https://example.test/bookings" });
            const second = tracker.pageView({ location: "https://example.test/thanks", title: "Thanks" });
            tracker.event("generate_lead", { value: 10, currency: "USD", send_to: "G-WRONG" });
            const after = { scripts: document.querySelectorAll('script[src*="googletagmanager.com"]').length, commands: browser.dataLayer!.map(args => Array.from(args)) };
            tracker.setConsent(false);
            const denied = tracker.event("generate_lead");
            tracker.dispose();
            let disposedError = false;
            try { tracker.pageView(); } catch { disposedError = true; }
            return { same, before, first, duplicate, second, after, denied, disposedError,
              removed: document.querySelectorAll('script[src*="googletagmanager.com"]').length, disabled: browser["ga-disable-G-FIXTURE1"] };
          }, analyticsModuleUrl);
          expect(result.same).toBe(true);
          expect(result.before).toEqual({ scripts: 0, event: false, disabled: true });
          expect([result.first, result.duplicate, result.second]).toEqual([true, false, true]);
          expect(result.after.scripts).toBe(1);
          expect(result.after.commands.filter(command => command[0] === "config")).toEqual([["config", "G-FIXTURE1", { send_page_view: false }]]);
          const events = result.after.commands.filter(command => command[0] === "event");
          expect(events).toHaveLength(3);
          expect(events[1][2]).toMatchObject({ page_referrer: "https://example.test/bookings", page_location: "https://example.test/thanks" });
          expect(events[2]).toEqual(["event", "generate_lead", { value: 10, currency: "USD", send_to: "G-FIXTURE1" }]);
          expect(result.denied).toBe(false); expect(result.disposedError).toBe(true);
          expect(result.removed).toBe(0); expect(result.disabled).toBe(true);
          expect(tagRequests.length).toBeLessThanOrEqual(1);
          await tracking.reload();
          expect(await tracking.evaluate(async (moduleUrl) => {
            const { createGoogleAnalytics } = await import(moduleUrl);
            (window as any).gtag = () => {};
            try { createGoogleAnalytics({ measurementId: "G-FIXTURE1", window }); return false; } catch { return true; }
          }, analyticsModuleUrl)).toBe(true);
        } finally { await tracking.close(); }
        return;
      }
      if (providerBatch === "bigquery") {
        const filePath = path.join(source, "integrations.json");
        await addIntegration(panel, "BigQuery");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const project = panel.getByRole("textbox", { name: "Google Cloud project ID", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await client.fill("bigquery.apps.googleusercontent.com");
        await project.fill("Invalid_Project");
        await save.click();
        await expect(panel.getByText("Enter the Google Cloud project ID, not its number or URL.", { exact: true })).toBeVisible();
        await project.fill("query-project");
        const setup = panel.getByRole("button", { name: "Set up BigQuery", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/OAuth consent alone does not grant project or dataset access/)).toBeVisible();
        await expect(panel.getByText(/Sharing > Permissions > Add principal/)).toBeVisible();
        await expect(panel.getByText(/Connect only lists accessible projects/)).toBeVisible();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", /^https:/);
        await save.click();
        await expect(save).toBeDisabled();
        const saved = JSON.parse(await readFile(filePath, "utf8"));
        expect(saved.integrations.bigquery).toMatchObject({
          provider: "bigquery", settings: { projectId: "query-project" },
          scopes: ["https://www.googleapis.com/auth/bigquery"],
          authentication: { method: "oauth2", registrationRef: "bigquery" }
        });
        expect(saved.registrations.bigquery.clientId).toBe("bigquery.apps.googleusercontent.com");
        expect(saved.registrations.bigquery.clientSecretRef).toMatch(/^env:/);
        expect(JSON.stringify(saved)).not.toContain('"clientSecret":');
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("BigQuery", { exact: true }).click();
        await expect(client).toHaveValue("bigquery.apps.googleusercontent.com");
        await expect(project).toHaveValue("query-project");
        const connection = panel.getByRole("region", { name: "Application connection" });
        setupIssues.bigquery = "credentials-missing";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Complete the required provider settings and credentials.", { exact: false })).toBeVisible();
        await expect(connection.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        delete setupIssues.bigquery;
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.bigquery = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await expect(page.getByText(/Provider permissions are not revoked\./)).toBeVisible();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(saved);
        expect(errors).toEqual([]);
        return;
      }
      if (providerBatch === "aws") {
        page.setDefaultTimeout(10_000);
        const filePath = path.join(source, "integrations.json");
        const saved = { extensions: undefined };
        for (const provider of [{ id: "aws-s3", name: "AWS S3" }, { id: "aws-athena", name: "AWS Athena" }]) {
          await addIntegration(panel, provider.name);
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
          const afterRejectedSave = await readFile(filePath, "utf8").catch((error) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
          expect(afterRejectedSave).not.toContain("AKIARAWKEY123456789");
          await key.fill("env:AWS_ACCESS_KEY_ID");
          await resource.fill(provider.id === "aws-s3" ? "my-app-files" : "reports");
          await session.fill("env:AWS_SESSION_TOKEN");
          await panel.getByText("N. Virginia (us-east-1)", { exact: true }).click();
          await expect(page.getByRole("option", { name: "N. Virginia (us-east-1)", exact: true })).toBeVisible();
          await region.press("c");
          await page.getByRole("option", { name: "Cape Town (af-south-1)", exact: true }).click();
          await panel.getByRole("textbox", { name: "Display name", exact: true }).fill(`${provider.name} account`);
          if (provider.id === "aws-s3") {
            const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
            if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
            await expect(panel.getByText("These choices limit the application's operations. AWS IAM and bucket policies decide actual access; selecting a permission does not grant it in AWS.", { exact: true })).toBeVisible();
            await expect(panel.getByRole("checkbox", { name: "List and download objects from bucket", exact: true })).toBeChecked();
            await expect(panel.getByRole("checkbox", { name: "List and download objects from bucket", exact: true })).toBeDisabled();
            await panel.getByRole("checkbox", { name: "Also upload objects via pre-signed URLs", exact: true }).uncheck();
          } else {
            await panel.getByRole("textbox", { name: "Query result location (optional)", exact: true }).fill("s3://query-results/reports/");
          }
          await save.click();
          await expect(save).toBeDisabled();
          for (const [label, keyName] of [["AWS access key ID", "AWS_ACCESS_KEY_ID"], ["AWS session token", "AWS_SESSION_TOKEN"], ["Application credential", "AWS_SECRET_ACCESS_KEY"]]) {
            await expect(panel.getByRole("region", { name: label, exact: true }).getByRole("link", { name: "Set credential in Env", exact: true }))
              .toHaveAttribute("href", new RegExp(`prefillKey=${keyName}`));
          }
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
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(`${provider.name} account`, { exact: true }).click({ timeout: 30_000 });
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
          if (provider.id === "aws-s3") {
            await expect(panel.getByText(/Return here and choose Connect\. No OAuth app or callback URL is needed\./)).toBeVisible();
            await expect(panel.getByText(/Cross-origin resource sharing \(CORS\) > Edit\./)).toBeVisible();
            await expect(panel.getByText(/renew all three temporary credential values together/)).toBeVisible();
          } else {
            await expect(panel.getByText(/choose Athena SQL and AWS Identity and Access Management/)).toBeVisible();
            await expect(panel.getByText(/Return here and choose Connect account\. No OAuth app or callback URL is needed/)).toBeVisible();
            await expect(panel.getByText(/Connecting reads workgroup metadata without running SQL/)).toBeVisible();
          }
          {
            const connection = panel.getByRole("region", { name: "Application connection" });
            setupIssues[provider.id] = "credentials-missing";
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await expect(connection.getByText("Complete the required provider settings and credentials.", { exact: false })).toBeVisible();
            delete setupIssues[provider.id];
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
            await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveCount(0);
            connectionStatuses[provider.id] = "reconnect-required";
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
            await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
            await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
          }
        }
        expect(errors).toEqual([]);
        return;
      }
      await addIntegration(panel, "Google Calendar");
      if (providerBatch === "calendar") {
        await panel.getByRole("button", { name: "Set up Google Calendar", exact: true }).click();
        await expect(panel.getByText(/To create, edit or cancel events, select Manage events/)).toBeVisible();
        await expect(panel.getByText(/All-day end dates are exclusive/)).toBeVisible();
        const eventScope = panel.getByRole("checkbox", { name: "Manage events", exact: true });
        if (!await eventScope.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
        await eventScope.check();
      }
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
      if (["existing", "responsive"].includes(providerBatch)) {
        const connectionPanel = panel.getByRole("region", { name: "Application connection" });
        for (const [issue, instruction] of [
          ["credentials-missing", "Complete the required provider settings and credentials."],
          ["callback-invalid", "Set a valid application callback URL in Env"]
        ]) {
          setupIssues["google-calendar"] = issue;
          await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();
          await expect(connectionPanel.getByText(instruction, { exact: false })).toBeVisible();
          await expect(connectionPanel.getByText(/Ask the project assistant to implement/)).toHaveCount(0);
          await expect(connectionPanel.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        }
        delete setupIssues["google-calendar"];
        if (viewport.name === "compact") {
          connectionStatuses["google-calendar"] = "unconfigured";
          await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();
          await expect(connectionPanel.getByRole("button", { name: "Prepare setup request", exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Show chat", exact: true }).click();
          const composer = page.getByLabel("Message AI assistant");
          await composer.fill("Keep my existing request.");
          await showProject.click();
          await connectionPanel.getByRole("button", { name: "Prepare setup request", exact: true }).click();
          await expect(composer).toBeVisible();
          await expect(composer).toHaveValue(/^Keep my existing request\.\n\nImplement the saved integration "google-calendar"/);
          await expect(composer).toHaveValue(/Use this project's selected framework/);
          expect(await readFile(filePath, "utf8")).not.toContain("Keep my existing request");
          await composer.fill("");
          await showProject.click();
          connectionStatuses["google-calendar"] = "disconnected";
        }
        await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connectionPanel.getByText("Not connected", { exact: true })).toBeVisible();
        await connectionPanel.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connectionPanel.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill("calendar");
        await expect(panel.getByRole("list", { name: "Configured integrations" }).getByText("Team calendar", { exact: true })).toBeVisible();
        await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill("no-matching-integration");
        await expect(panel.getByText("No configured integrations match your search.", { exact: true })).toBeVisible();
        await expect(panel.getByText("No services match your search.", { exact: true })).toBeVisible();
        await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Team calendar");
        await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill("calendar");
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Team calendar");
        await expect(panel.getByRole("textbox", { name: "Search integrations", exact: true })).toHaveValue("calendar");
        await panel.getByRole("textbox", { name: "Search integrations", exact: true }).fill("");
        await expect(connectionPanel.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        await connectionPanel.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connectionPanel.getByText("Not connected", { exact: true })).toBeVisible();
        await connectionPanel.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connectionPanel.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        connectionStatuses["google-calendar"] = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connectionPanel.getByText("Connected", { exact: true })).toBeVisible();
        await expect(connectionPanel.getByText("List calendars", { exact: true })).toBeVisible();
        await expect(connectionPanel.getByText("provider:future-permission", { exact: true })).toBeVisible();
        await expect(connectionPanel.locator("time")).toHaveAttribute("datetime", "2026-09-11T03:00:00.000Z");
        await expect(connectionPanel.locator("time")).not.toHaveText("Invalid Date");
        await connectionPanel.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connectionPanel.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connectionPanel.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connectionPanel.getByText("Connected", { exact: true })).toBeVisible();
        await connectionPanel.getByRole("button", { name: "Disconnect", exact: true }).click();
        await expect(page.getByText(/Provider permissions are not revoked\./)).toBeVisible();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connectionPanel.getByText("Not connected", { exact: true })).toBeVisible();
        await expect(connectionPanel.getByText(/disconnecting here does not revoke them\./)).toBeVisible();
      }
      await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Unsaved form draft");
      if (providerBatch === "responsive" && viewport.name === "compact") {
        await routeApiEndpoint(page, "/vibe64/env", (route) => fulfillJson(route, {
          ok: true, env: { environment: "dev", records: [], unavailable: null }
        }));
        const setupGuide = panel.getByRole("button", { name: "Set up Google Calendar", exact: true });
        if (await setupGuide.getAttribute("aria-expanded") !== "true") await setupGuide.click();
        await panel.getByRole("link", { name: "Open Env", exact: true }).click();
        await expect(page.locator(".env-panel")).toBeVisible();
        await page.goBack();
        await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Unsaved form draft");
        await expect(panel.getByRole("button", { name: "Save configuration", exact: true })).toBeEnabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["google-calendar"].displayName).toBe("Team calendar");
      }
      saved.integrations["google-calendar"].displayName = "CLI update";
      saved.extensions = { application: { keep: true } };
      await writeFile(filePath, JSON.stringify(saved));
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("Unsaved form draft");
      expect(JSON.parse(await readFile(filePath, "utf8")).integrations["google-calendar"].displayName).toBe("CLI update");
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await panel.getByRole("button", { name: "Discard", exact: true }).click();
      await page.getByRole("button", { name: "Discard and reload" }).click();
      await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("CLI update");
      await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("After CLI update");
      await panel.getByRole("button", { name: "Save configuration" }).click();
      await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
      expect(JSON.parse(await readFile(filePath, "utf8")).extensions).toEqual(saved.extensions);
      if (providerBatch === "calendar") {
        expect(saved.integrations["google-calendar"].scopes).toContain("https://www.googleapis.com/auth/calendar.events");
        expect(errors).toEqual([]);
        return;
      }
      const tokenProviders = providerBatch === "resend" ? [["Resend", "resend"]] : providerBatch === "replicate" ? [["Replicate", "replicate"]] : providerBatch === "pipedrive" ? [["Pipedrive", "pipedrive"]] : providerBatch === "perplexity" ? [["Perplexity", "perplexity"]] : providerBatch === "notion" ? [["Notion", "notion"]] : providerBatch === "mapbox" ? [["Mapbox", "mapbox"]] : providerBatch === "mailgun" ? [["Mailgun", "mailgun"]] : providerBatch === "logo-dev" ? [["Logo.dev", "logo-dev"]] : providerBatch === "lexware" ? [["Lexware", "lexware"]] : providerBatch === "klipy" ? [["KLIPY", "klipy"]] : providerBatch === "incident-io" ? [["incident.io", "incident-io"]] : providerBatch === "google-maps" ? [["Google Maps Platform", "google-maps-platform"]] : ["gmail", "google-docs", "google-drive", "google-search-console", "google-sheets", "google-slides", "heygen", "hubspot", "lightspeed", "linear", "linkedin", "microsoft-excel", "microsoft-onedrive", "microsoft-onenote", "microsoft-outlook", "microsoft-sharepoint", "microsoft-teams", "fabric", "miro", "n8n", "oura"].includes(providerBatch) ? [] : providerBatch === "gitlab-api" ? [["GitLab API", "gitlab-api"]] : providerBatch === "github-api" ? [["GitHub API", "github-api"]] : providerBatch === "gatewayapi" ? [["GatewayAPI", "gatewayapi"]] : providerBatch === "fireflies" ? [["Fireflies", "fireflies"]] : providerBatch === "firecrawl" ? [["Firecrawl", "firecrawl"]] : providerBatch === "elevenlabs" ? [["ElevenLabs", "elevenlabs"]] : providerBatch === "contentful" ? [["Contentful", "contentful"]] : providerBatch === "clay" ? [["Clay", "clay"]] : providerBatch === "calendly" ? [["Calendly", "calendly"]] : providerBatch === "airtable" ? [["Airtable", "airtable"]] : providerBatch === "apify" ? [["Apify", "apify"]] : providerBatch === "apollo" ? [["Apollo.io", "apollo-io"]] : providerBatch === "asana" ? [["Asana", "asana"]] : providerBatch === "brevo" ? [["Brevo", "brevo"]] : providerBatch === "attention" ? [["Attention", "attention"]] : providerBatch === "ashby" ? [["Ashby", "ashby"]] : [["Resend", "resend"], ["Firecrawl", "firecrawl"]];
      if (providerBatch === "existing") tokenProviders.push(
        ["Airtable", "airtable"], ["Notion", "notion"], ["Brevo", "brevo"],
        ["ElevenLabs", "elevenlabs"], ["GitHub API", "github-api"], ["Apify", "apify"],
        ["Calendly", "calendly"], ["HubSpot", "hubspot"], ["Linear", "linear"], ["Pipedrive", "pipedrive"],
        ["GitLab API", "gitlab-api"], ["Tally", "tally"], ["Contentful", "contentful"], ["Asana", "asana"]
      );
      if (providerBatch === "additional-tokens") tokenProviders.push(
        ["Stripe", "stripe"], ["Replicate", "replicate"],
        ["incident.io", "incident-io"], ["Fireflies", "fireflies"]
      );
      if (providerBatch === "service-readers") tokenProviders.push(
        ["HeyGen", "heygen"], ["Perplexity", "perplexity"], ["Supabase", "supabase"]
      );
      if (providerBatch === "storyblok") tokenProviders.push(["Storyblok", "storyblok"]);
      if (providerBatch === "regional") tokenProviders.push(["Paddle", "paddle"], ["Mailgun", "mailgun"], ["Storyblok", "storyblok"]);
      if (providerBatch === "platform-readers") tokenProviders.push(["Fireworks AI", "fireworks-ai"], ["GatewayAPI", "gatewayapi"], ["Polar", "polar"]);
      if (providerBatch === "account-readers") tokenProviders.push(["Ashby", "ashby"], ["Lexware", "lexware"], ["Sevdesk", "sevdesk"]);
      if (providerBatch === "sales-readers") tokenProviders.push(["Apollo.io", "apollo-io"], ["Attention", "attention"], ["Clay", "clay"]);
      if (providerBatch === "path-readers") tokenProviders.push(["Telegram", "telegram"], ["KLIPY", "klipy"]);
      if (providerBatch === "public-resources") tokenProviders.push(["Mapbox", "mapbox"], ["Google Maps Platform", "google-maps-platform"], ["Logo.dev", "logo-dev"]);
      for (const [name, id] of tokenProviders) {
        await addIntegration(panel, name);
        if (id === "contentful") {
          await panel.getByRole("textbox", { name: "Space ID", exact: true }).fill("space-one");
          await panel.getByRole("textbox", { name: "Environment ID", exact: true }).fill("published-web");
          await panel.getByRole("combobox", { name: "Region", exact: true }).press("Enter");
          await page.getByRole("option", { name: "Europe", exact: true }).click();
        }
        if (id === "gitlab-api") {
          await panel.getByRole("textbox", { name: "Instance URL", exact: true }).fill("https://code.example.test");
          await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
          await page.getByRole("option", { name: "OAuth", exact: true }).click();
        }
        if (["calendly", "github-api", "gitlab-api"].includes(id)) {
          await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toBeVisible();
          await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
          await page.getByRole("option", { name: "API key", exact: true }).click();
        }
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(["calendly", "github-api", "gitlab-api"].includes(id) ? 1 : 0);
        const keyField = panel.getByRole("textbox", { name: credentialLabels[id] || "API key reference", exact: true });
        if (id === "resend") {
          const setup = panel.getByRole("button", { name: "Set up Resend", exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByText(/copy the displayed SPF\/DKIM DNS records/)).toBeVisible();
          await expect(panel.getByText(/broadcasts.create always creates a draft/)).toBeVisible();
          await expect(panel.getByText(/older guides call these Audiences/)).toBeVisible();
        }
        if (id === "replicate") {
          const setup = panel.getByRole("button", { name: "Set up Replicate", exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByText(/copy the owner\/name or version and model-specific input schema/)).toBeVisible();
          await expect(panel.getByText(/normally after one hour/)).toBeVisible();
        }
        if (id === "pipedrive") {
          const company = panel.getByRole("textbox", { name: "Company domain (API token)", exact: true });
          await company.fill("acme");
          const setup = panel.getByRole("button", { name: "Set up Pipedrive", exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByText(/The adapter lists\/reads deals/)).toBeVisible();
          await expect(panel.getByText(/copy the company subdomain from your browser/)).toBeVisible();
        }
        if (id === "perplexity") {
          const setup = panel.getByRole("button", { name: "Set up Perplexity", exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByText(/there is no Vibe64 inference gateway/)).toBeVisible();
          await expect(panel.getByText(/API console, then Projects/)).toBeVisible();
        }
        if (id === "notion") {
          const setup = panel.getByRole("button", { name: "Set up Notion", exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByText(/enable Insert content for creation/)).toBeVisible();
          await expect(panel.getByText(/LIMITATIONS: no embedded editor/)).toBeVisible();
        }
        if (id === "google-maps-platform") {
          if (providerBatch === "google-maps") await panel.getByRole("textbox", { name: "Map ID (optional)", exact: true }).fill("DEMO_MAP_ID");
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
        if (id === "resend" && ["existing", "responsive"].includes(providerBatch)) {
          const connectionPanel = panel.getByRole("region", { name: "Application connection" });
          setupIssues.resend = "credentials-missing";
          await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();
          await expect(connectionPanel.getByText(/Blank values and MISSING placeholders cannot connect/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Set credential in Env", exact: true })).toBeVisible();
          delete setupIssues.resend;
          await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();

          await expect(connectionPanel.getByText("Not connected", { exact: true })).toBeVisible();
          await connectionPanel.getByRole("button", { name: "Connect account", exact: true }).click();
          await expect(connectionPanel.getByRole("alert")).toBeVisible();
          await expect(connectionPanel.getByText("Not connected", { exact: true })).toBeVisible();
          await connectionPanel.getByRole("button", { name: "Connect account", exact: true }).click();
          await expect(connectionPanel.getByText("Connected", { exact: true })).toBeVisible();
          rejectApiKey = true;
          await connectionPanel.getByRole("button", { name: "Verify again", exact: true }).click();
          await expect(connectionPanel.getByRole("alert")).toBeVisible();
          await expect(connectionPanel.getByText("Connected", { exact: true })).toBeVisible();
          await connectionPanel.getByRole("button", { name: "Verify again", exact: true }).click();
          await expect(connectionPanel.getByRole("alert")).toHaveCount(0);
          connectionStatuses.resend = "reconnect-required";
          await connectionPanel.getByRole("button", { name: "Check connection", exact: true }).click();
          await connectionPanel.getByRole("button", { name: "Reconnect", exact: true }).click();
          await expect(connectionPanel.getByText("Connected", { exact: true })).toBeVisible();
          await connectionPanel.screenshot({ path: `/tmp/integration-connection-${viewport.name}.png` });
        }
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations[id].authentication).toEqual({ method: "api-key", secretRef: reference });
        expect(file.registrations[id]).toBeUndefined();
        expect(file.extensions).toEqual(saved.extensions);
        if (id === "pipedrive") expect(file.integrations[id].settings).toEqual({ companyDomain: "acme" });
        if (optionalKey) expect(file.integrations[id].settings).toEqual({ ...(id === "mapbox" ? { usage: "backend" } : {}), [optionalKey.setting]: optionalKey.reference, ...(providerBatch === "google-maps" ? { mapId: "DEMO_MAP_ID" } : {}) });
        const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", /^https:/);
        if (id === "lexware" && providerBatch === "lexware") {
          await expect(panel.getByText(/Erweiterungen > Weitere Apps > Public API/)).toBeVisible();
          await expect(panel.getByText(/allow invoice creation only if the app will create drafts/)).toBeVisible();
          await expect(panel.getByText(/Review and finalize drafts in Lexware/)).toBeVisible();
          await expect(panel.getByText(/An interrupted invoice creation may already have succeeded/)).toBeVisible();
          await expect(panel.getByText(/does not create contacts\/articles\/vouchers/)).toBeVisible();
          const connection = panel.getByRole("region", { name: "Application connection" });
          await connection.getByRole("button", { name: "Connect account", exact: true }).click();
          await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
          await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
          await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
          await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        }
        if (id === "klipy" && providerBatch === "klipy") {
          await expect(panel.getByText(/choose Add Platform/)).toBeVisible();
          await expect(panel.getByText(/Use Search KLIPY as the search placeholder/)).toBeVisible();
          await expect(panel.getByText(/requires prior approval for custom server-side requests/)).toBeVisible();
          await expect(panel.getByText(/new AI emoji generation, callbacks, share\/report analytics/)).toBeVisible();
          const connection = panel.getByRole("region", { name: "Application connection" });
          await connection.getByRole("button", { name: "Connect account", exact: true }).click();
          await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
          await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
          await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
          await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        }
        if (id === "incident-io" && providerBatch === "incident-io") {
          await expect(panel.getByText(/Settings > API keys and choose Add API key/)).toBeVisible();
          await expect(panel.getByText(/follow_ups.create and follow_ups.update/)).toBeVisible();
          await expect(panel.getByText(/explicit notify_incident_channel choice/)).toBeVisible();
          await expect(panel.getByText(/Schedule reads use pages of at most 25/)).toBeVisible();
          await expect(panel.getByText(/This key remains valid if its creator is deactivated/)).toBeVisible();
          const connection = panel.getByRole("region", { name: "Application connection" });
          await connection.getByRole("button", { name: "Connect account", exact: true }).click();
          await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
          await connection.getByRole("button", { name: "Verify again", exact: true }).click();
          await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
          await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
          await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
          await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        }
        if (id === "google-maps-platform" && providerBatch === "google-maps") {
          await expect(panel.getByText(/also enable Places API \(New\) and Routes API/)).toBeVisible();
          await expect(panel.getByText(/Map management > Create map ID/)).toBeVisible();
          expect(file.integrations[id].settings.mapId).toBe("DEMO_MAP_ID");
          const moduleUrl = "data:text/javascript;base64," + Buffer.from(await readFile(new URL(import.meta.resolve("@jskit-ai/connectors-catalog/client/google-maps-platform")), "utf8")).toString("base64");
          const result = await page.evaluate(async url => {
            const { mountGoogleMap } = await import(url);
            const element = document.createElement("div"); document.body.append(element);
            const created: any[] = []; const cleared: any[] = []; const imports: string[] = [];
            class Map { constructor(host: HTMLElement, options: any) { host.textContent = "Controlled map surface"; created.push({ kind: "map", options }); } }
            class AdvancedMarkerElement { map: any; constructor(options: any) { this.map = options.map; created.push({ kind: "marker", options, instance: this }); } }
            class Polyline { map: any; constructor(options: any) { this.map = options.map; created.push({ kind: "line", options, instance: this }); } setMap(map: any) { this.map = map; } }
            const maps = { importLibrary: async (name: string) => { imports.push(name); return { Map, AdvancedMarkerElement, Polyline }; }, event: { clearInstanceListeners: (value: any) => cleared.push(value) } };
            try {
              const controller = new AbortController();
              const mounted = await mountGoogleMap({ element, maps, center: { lat: -31.95, lng: 115.86 }, mapId: "DEMO_MAP_ID",
                markers: [{ position: { lat: -31.95, lng: 115.86 }, title: "DogAndGroom" }], path: [{ lat: -31.95, lng: 115.86 }, { lat: -31.96, lng: 115.87 }], signal: controller.signal });
              const rendered = element.textContent;
              controller.abort(); mounted.dispose();
              const disposed = element.childNodes.length === 0 && created.filter(item => item.instance).every(item => item.instance.map === null);
              const count = created.length; let invalid = false; let aborted = false;
              try { await mountGoogleMap({ element, maps, center: { lat: 100, lng: 0 } }); } catch { invalid = true; }
              try { await mountGoogleMap({ element, maps, center: { lat: 0, lng: 0 }, signal: controller.signal }); } catch { aborted = true; }
              return { rendered, disposed, invalid, aborted, unchanged: created.length === count, imports, cleared: cleared.length,
                mapId: created[0].options.mapId, markerTitle: created[1].options.title, path: created[2].options.path };
            } finally { element.remove(); }
          }, moduleUrl);
          expect(result).toMatchObject({ rendered: "Controlled map surface", disposed: true, invalid: true, aborted: true, unchanged: true, imports: ["maps", "marker"], cleared: 3, mapId: "DEMO_MAP_ID", markerTitle: "DogAndGroom" });
          expect(result.path).toEqual([{ lat: -31.95, lng: 115.86 }, { lat: -31.96, lng: 115.87 }]);
          await page.reload();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Maps Platform", { exact: true }).click();
          await expect(panel.getByRole("textbox", { name: "Map ID (optional)", exact: true })).toHaveValue("DEMO_MAP_ID");
          await panel.getByRole("textbox", { name: "Map ID (optional)", exact: true }).fill("");
          await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
          await expect(panel.getByRole("button", { name: "Save configuration", exact: true })).toBeDisabled();
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations[id].settings).toEqual({ browserKeyRef: optionalKey.reference });
        }
        if (id === "calendly") {
          await expect(panel.getByText(/Personal tokens need no OAuth registration or callback/)).toBeVisible();
          await expect(panel.getByText(/Direct API booking needs Calendly Standard or higher/)).toBeVisible();
          await expect(panel.getByText(/scheduled_events:read for meetings and invitees/)).toBeVisible();
          await expect(panel.getByText(/Local disconnect removes app connection state/)).toBeVisible();
        }
        if (id === "gitlab-api") {
          expect(file.integrations[id].settings.instanceUrl).toBe("https://code.example.test");
          await expect(panel.getByText(/Personal access tokens. Generate a token/)).toBeVisible();
          await expect(panel.getByText(/Issue and merge-request writes require api permission/)).toBeVisible();
          await expect(panel.getByText(/Changing the instance requires reconnection/)).toBeVisible();
        }
        if (id === "github-api") {
          await expect(panel.getByText(/OAuth Apps > New OAuth App/)).toBeVisible();
          await expect(panel.getByText(/Fine-grained tokens, generate a token/)).toBeVisible();
          await expect(panel.getByText(/does not synchronize project code/)).toBeVisible();
          await expect(panel.getByText(/repository access still depends on token permissions/)).toBeVisible();
        }
        if (id === "gatewayapi") {
          await expect(panel.getByText(/RCS requires an approved agent/)).toBeVisible();
          await expect(panel.getByText(/Current Messaging API callbacks use Signature/)).toBeVisible();
          await expect(panel.getByText(/API Keys in the left menu/)).toBeVisible();
          await panel.getByRole("combobox", { name: "API domain", exact: true }).press("Enter");
          await page.getByRole("option", { name: "EU (gatewayapi.eu)", exact: true }).click();
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations.gatewayapi.settings.region).toBe("eu");
        }
        if (id === "fireflies") {
          await expect(panel.getByText(/Sign into Fireflies and open Integrations/)).toBeVisible();
          await expect(panel.getByText(/Transcript details include sentences, speakers/)).toBeVisible();
          await expect(panel.getByText(/does not create recordings or receive webhooks/)).toBeVisible();
        }
        if (id === "firecrawl") {
          await expect(panel.getByText(/Select the team that will pay/)).toBeVisible();
          await expect(panel.getByText(/Crawls require an explicit page limit/)).toBeVisible();
          await expect(panel.getByText(/Vibe64 does not supply a managed subscription/)).toBeVisible();
        }
        if (id === "elevenlabs") {
          await expect(panel.getByText(/Enable Voices write only if/)).toBeVisible();
          await expect(panel.getByText(/Instant Voice Cloning requires an eligible plan/)).toBeVisible();
          await expect(panel.getByText(/returns bounded audio files/)).toBeVisible();
        }
        if (id === "contentful") {
          expect(file.integrations[id].settings).toEqual({ spaceId: "space-one", environmentId: "published-web", region: "eu" });
          await expect(panel.getByText(/Publish entries and assets in Contentful before reading them/)).toBeVisible();
          await expect(panel.getByText(/Content Delivery API access token; the Preview token/)).toBeVisible();
          await expect(panel.getByText(/Disconnect only removes local state, not the Contentful API key/)).toBeVisible();
        }
        if (id === "clay") {
          await expect(panel.getByText(/Settings > Account > API keys/)).toBeVisible();
          await expect(panel.getByText(/Functions > select your function > Details > enable API/)).toBeVisible();
          await expect(panel.getByText(/Table queries require Clay Enterprise/)).toBeVisible();
          await expect(panel.getByText(/returned in_progress run ID is not a finished enrichment/)).toBeVisible();
          await expect(panel.getByText(/Disconnect removes local state, not the key in Clay/)).toBeVisible();
        }
        if (id === "brevo") {
          await expect(panel.getByText(/Return here and choose Connect account or Verify again/)).toBeVisible();
          await expect(panel.getByText(/copy the exact Brevo code, DKIM and DMARC records/)).toBeVisible();
          await expect(panel.getByText(/SMS credits and sender approval are separate/)).toBeVisible();
          await expect(panel.getByText(/A returned message ID is acceptance, not delivery/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://help.brevo.com/hc/en-us/articles/209467485-Create-and-manage-your-API-keys");
        }
        if (id === "attention") {
          await expect(panel.getByText(/Choose Connect account|choose Connect account/)).toBeVisible();
          await expect(panel.getByText(/New users require an explicit listener or recording seat choice/)).toBeVisible();
          await expect(panel.getByText(/Disconnect here removes the local grant only/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://docs.attention.com/api-authentication");
        }
        if (id === "ashby") {
          await expect(panel.getByText(/Candidates write \(candidatesWrite\) for profile edits/)).toBeVisible();
          await expect(panel.getByText(/hiringProcessMetadataRead/)).toBeVisible();
          await expect(panel.getByText(/not an applicant login or public careers form/)).toBeVisible();
          await expect(panel.getByText(/open the old key by name and click Disable/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://docs.ashbyhq.com/how-do-i-generate-an-api-key");
        }
        if (id === "asana") {
          await expect(panel.getByText(/Verification lists workspaces without changing tasks or projects/)).toBeVisible();
          await expect(panel.getByText(/listing a workspace does not prove permission to edit every project/)).toBeVisible();
          await expect(panel.getByText(/Disconnect alone does not revoke it/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://developers.asana.com/docs/personal-access-token");
        }
        if (id === "apollo-io") {
          await expect(panel.getByText(/Keep api\/v1\/accounts\/search enabled for verification/)).toBeVisible();
          await expect(panel.getByText(/Verification reads saved accounts; it does not enrich/)).toBeVisible();
          await expect(panel.getByText(/Company prospect searches and enrichment can consume credits/)).toBeVisible();
          await expect(panel.getByText(/delete the key on Apollo's API keys page/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://docs.apollo.io/docs/create-api-key");
        }
        if (id === "apify") {
          await expect(panel.getByText(/Check connection only reads the current connection status/)).toBeVisible();
          await expect(panel.getByText(/access to its default run storages/)).toBeVisible();
          await expect(panel.getByText(/revoke the token in Apify Console/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://docs.apify.com/integrations/api");
        }
        if (id === "airtable") {
          await expect(panel.getByText(/schema.bases:write only for table\/field changes/)).toBeVisible();
          await expect(panel.getByText(/Check connection only reads the application’s saved status/)).toBeVisible();
          await expect(panel.getByText(/it does not revoke the PAT or erase Env/)).toBeVisible();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute(
            "href", "https://support.airtable.com/docs/creating-personal-access-tokens");
        }
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
      if (providerBatch === "mapbox") {
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        const usage = panel.getByRole("combobox", { name: "Mapbox usage", exact: true });
        const publicKey = panel.getByRole("textbox", { name: "Public browser token reference", exact: true });
        await usage.press("Enter"); await page.getByRole("option", { name: "Browser maps only", exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Backend access token reference", exact: true })).toHaveCount(0);
        await publicKey.fill(""); await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await publicKey.fill("env:MAPBOX_BROWSER_ONLY"); await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.mapbox.authentication).toEqual({ method: "none" });
        expect(file.integrations.mapbox.settings).toEqual({ usage: "browser", publicTokenRef: "env:MAPBOX_BROWSER_ONLY" });
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Mapbox", { exact: true }).click();
        await expect(usage).toHaveValue("Browser maps only"); await expect(publicKey).toHaveValue("env:MAPBOX_BROWSER_ONLY");
        await expect(panel.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        const setup = panel.getByRole("button", { name: "Set up Mapbox", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/No backend token, account verification or OAuth callback is needed/)).toBeVisible();
        await expect(panel.getByText(/Mapbox GL JS integration, import its CSS/)).toBeVisible();
        await usage.press("Enter"); await page.getByRole("option", { name: "Backend geocoding and optional browser maps", exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Backend access token reference", exact: true })).toBeVisible();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
      }
      if (providerBatch === "mailgun") {
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await panel.getByRole("combobox", { name: "API region", exact: true }).press("Enter");
        await page.getByRole("option", { name: "European Union (api.eu.mailgun.net)", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Mailgun", { exact: true }).click();
        await expect(panel.getByRole("combobox", { name: "API region", exact: true })).toHaveValue("European Union (api.eu.mailgun.net)");
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.mailgun.settings.region).toBe("eu");
        const setup = panel.getByRole("button", { name: "Set up Mailgun", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/choose Developer for sending and domain management/)).toBeVisible();
        await expect(panel.getByText(/Add the exact sending DNS records/)).toBeVisible();
        await expect(panel.getByText(/queued does not mean delivered/)).toBeVisible();
        await expect(panel.getByText(/no attachments, stored templates/)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "logo-dev") {
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Logo.dev", { exact: true }).click();
        const setup = panel.getByRole("button", { name: "Set up Logo.dev", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/strips the part before @ locally/)).toBeVisible();
        await expect(panel.getByText(/no brand search, private enrichment API/)).toBeVisible();
        await expect(panel.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
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
          for (const lookup of [{ ticker: "AAPL", fallback: "monogram" }, { email: "private@example.com", fallback: "404" }]) {
            const image = new Image();
            image.referrerPolicy = "origin";
            results.push(await new Promise((resolve) => {
              image.onload = () => resolve({ loaded: true, width: image.naturalWidth });
              image.onerror = () => resolve({ loaded: false });
              image.src = createLogoDevImageUrl({ publishableKey: "pk_browser_fixture", ...lookup });
            }));
          }
          return results;
        });
        expect(images).toEqual([{ loaded: true, width: 1 }, { loaded: false }]);
        expect(imageRequests).toHaveLength(2);
        expect(new URL(imageRequests[0].url).pathname).toBe("/ticker/AAPL");
        expect(new URL(imageRequests[1].url).pathname).toBe("/example.com");
        expect(imageRequests[1].url).not.toContain("private");
        for (const request of imageRequests) {
          expect(new URL(request.url).searchParams.get("token")).toBe("pk_browser_fixture");
          expect(request.referrer).toBe(`${new URL(page.url()).origin}/`);
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
          expect(integration.settings).toEqual(id === "mapbox" ? { usage: "backend" } : {});
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
      if (providerBatch === "storyblok") {
        const region = panel.getByRole("combobox", { name: "Space region", exact: true });
        await region.press("Enter");
        for (const title of ["European Union (EU)", "United States (US)", "Canada (CA)", "Australia / APAC (AP)", "China (CN)"]) {
          await expect(page.getByRole("option", { name: title, exact: true })).toBeVisible();
        }
        await page.getByRole("option", { name: "Canada (CA)", exact: true }).click();
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Storyblok", { exact: true }).click();
        await expect(region).toHaveValue("Canada (CA)");
        await expect(panel.getByRole("textbox", { name: "API key reference", exact: true })).toHaveValue("env:STORYBLOK_KEY");
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.storyblok.settings).toEqual({ region: "ca" });
        const setup = panel.getByRole("button", { name: "Set up Storyblok", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Select the intended Storyblok space and open Settings/)).toBeVisible();
        await expect(panel.getByText(/For a public site, use a Public token/)).toBeVisible();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.storyblok.com/docs/concepts/access-tokens");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
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
        await addIntegration(panel, "Algolia");
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
        const frontendCredential = panel.getByRole("region", { name: "Public frontend API key", exact: true });
        await expect(frontendCredential.getByText("Your application may publish this key in its frontend. Use a key restricted to data those users may read.", { exact: true })).toBeVisible();
        await expect(frontendCredential.getByRole("link", { name: "Set credential in Env" })).toHaveAttribute("href", /prefillKey=ALGOLIA_PUBLIC_KEY/);
        await expect(panel.getByRole("region", { name: "Application credential", exact: true }).getByRole("link", { name: "Set credential in Env" })).toHaveAttribute("href", /prefillKey=ALGOLIA_BACKEND_KEY/);
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Algolia", { exact: true }).click();
        await expect(applicationId).toHaveValue("APP123ABC");
        await expect(publicKey).toHaveValue("env:ALGOLIA_PUBLIC_KEY");
        await publicKey.fill("");
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.algolia.settings).toEqual({ applicationId: "APP123ABC" });
        await expect(panel.getByRole("region", { name: "Public frontend API key", exact: true })).toHaveCount(0);
        const setup = panel.getByRole("button", { name: "Set up Algolia", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.algolia.com/doc/guides/security/api-keys");
      }
      if (providerBatch === "twilio") {
        await addIntegration(panel, "Twilio");
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
        const callbackSecret = panel.getByRole("textbox", { name: "Callback Auth Token reference (optional)", exact: true });
        await callbackSecret.fill("env:TWILIO_AUTH_TOKEN");
        await secret.fill("env:TWILIO_API_SECRET");
        await save.click();
        await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.twilio.settings).toEqual({ authTokenRef: "env:TWILIO_AUTH_TOKEN", region: "us1", accountSid: `AC${"a".repeat(32)}`, apiKeySid: `SK${"b".repeat(32)}` });
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
        await expect(callbackSecret).toHaveValue("env:TWILIO_AUTH_TOKEN");
        await expect(panel.getByText("Australia (AU1)", { exact: true })).toBeVisible();
        const setup = panel.getByRole("button", { name: "Set up Twilio", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.twilio.com/docs/iam/api-keys/keys-in-console");
        await expect(panel.getByText(/For callbacks, reveal the account Auth Token/)).toBeVisible();
        await expect(panel.getByText(/For incoming messages or calls/)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "posthog") {
        await addIntegration(panel, "PostHog");
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
        await addIntegration(panel, "Chargebee");
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
        await expect(panel.getByText(/choose Full-Access Key with Write access/)).toBeVisible();
        await expect(panel.getByText(/Connect account or Verify again/)).toBeVisible();
        await expect(panel.getByText(/This adapter uses Product Catalog 2.0 item prices/)).toBeVisible();
        await expect(panel.getByText(/Creating a hosted checkout URL does not prove payment/)).toBeVisible();
      }
      if (providerBatch === "canva") {
        await addIntegration(panel, "Canva");
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
      if (["design-mcp", "figma", "miro"].includes(providerBatch)) {
        for (const spec of [
          { id: "figma", name: "Figma", scope: "Use Figma MCP tools", scopes: ["mcp:connect"], count: 1,
            guide: "https://developers.figma.com/docs/figma-mcp-server/" },
          { id: "miro", name: "Miro", scope: "Read boards", scopes: ["boards:read", "boards:write"], count: 4,
            guide: "https://developers.miro.com/docs/connecting-to-miro-mcp" }
        ].filter(spec => providerBatch === "design-mcp" || spec.id === providerBatch)) {
          await addIntegration(panel, spec.name);
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
          if (spec.id === "miro") await expect(panel.getByText(/LIMITATIONS: connecting does not attach Miro tools/)).toBeVisible();
          if (spec.id === "figma") {
            await expect(panel.getByText(/Figma currently requires approval/)).toBeVisible();
            await expect(panel.getByText(/a VPS localhost address points to the VPS/)).toBeVisible();
            await expect(panel.getByText(/Vibe64 coding-assistant attachment is deferred/)).toBeVisible();
          }
          if (spec.id === "miro") {
            await expect(panel.getByRole("textbox", { name: "Registration endpoint", exact: true })).toHaveValue("https://mcp.miro.com/register");
          }
        }
      }
      if (providerBatch === "atlassian") {
        await addIntegration(panel, "Atlassian");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill("https://app.example/integrations/atlassian/callback");
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        await expect(client).toHaveValue("assigned-atlassian-client");
        expect(registrationPosts).toEqual(["https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect(await readFile(filePath, "utf8")).not.toContain("private-atlassian-browser-fixture");
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
        expect(file.registrations.atlassian).toEqual({ source: "own", clientId: "assigned-atlassian-client", clientSecretRef: "env:ATLASSIAN_CLIENT_SECRET", callbackUrlRef: "env:ATLASSIAN_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Atlassian", { exact: true }).click();
        await expect(client).toHaveValue("assigned-atlassian-client");
        await expect(secret).toHaveValue("env:ATLASSIAN_CLIENT_SECRET");
        await expect(callback).toHaveValue("env:ATLASSIAN_CALLBACK_URL");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const checkbox of [read, write, confluence, loom]) await expect(checkbox).toBeChecked();
        for (const checkbox of [remove, manage, refresh]) await expect(checkbox).not.toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Atlassian", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://support.atlassian.com/atlassian-ai-gateway/docs/configure-oauth-2-1/");
      }
      if (providerBatch === "wix") {
        await addIntegration(panel, "Wix");
        const account = panel.getByRole("textbox", { name: "Account ID", exact: true });
        const selectable = panel.getByRole("textbox", { name: "Selectable Site IDs", exact: true });
        const site = panel.getByRole("textbox", { name: "Site ID", exact: true });
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.wix).toBeUndefined();
        await account.fill("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"); await save.click();
        await expect(panel.getByText("Enter the Account ID from Wix's API Keys Manager.", { exact: true })).toBeVisible();
        await account.fill("01234567-89ab-cdef-0123-456789abcdef");
        await key.fill("raw-wix-key"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await key.fill("env:WIX_KEY");
        await site.fill("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"); await save.click();
        await expect(panel.getByText("Copy the Site ID from the Wix site dashboard URL.", { exact: true })).toBeVisible();
        await site.fill("12345678-9abc-def0-1234-56789abcdef0");
        await selectable.fill("not-a-site"); await save.click();
        await expect(panel.getByText("Enter up to 100 distinct Site IDs separated by commas.", { exact: true })).toBeVisible();
        await selectable.fill("01234567-89ab-cdef-0123-456789abcdef");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.wix).toEqual({ provider: "wix", displayName: "Wix", accountMode: "shared", scopes: [],
          authentication: { method: "api-key", secretRef: "env:WIX_KEY" }, settings: { accountId: "01234567-89ab-cdef-0123-456789abcdef", siteId: "12345678-9abc-def0-1234-56789abcdef0", selectableSiteIds: "01234567-89ab-cdef-0123-456789abcdef" } });
        expect(file.registrations.wix).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Website inventory");
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Website inventory", { exact: true }).click();
        await expect(account).toHaveValue("01234567-89ab-cdef-0123-456789abcdef"); await expect(key).toHaveValue("env:WIX_KEY");
        await expect(site).toHaveValue("12345678-9abc-def0-1234-56789abcdef0");
        await expect(selectable).toHaveValue("01234567-89ab-cdef-0123-456789abcdef");
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.wix.accountMode).toBe("assistant"); expect(file.extensions).toEqual(saved.extensions);
        expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        const setup = panel.getByRole("button", { name: "Set up Wix", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://dev.wix.com/docs/go-headless/authentication/admin/generate-an-api-key");
        await expect(panel.getByText("This account credential is for backend administrative operations. It does not connect each app user's Wix account or implement application login.", { exact: true })).toBeVisible();
        await expect(panel.getByText(/For CRM access, enter the intended Site ID/)).toBeVisible();
        await expect(panel.getByText(/For CMS collection browsing, grant Manage Data Collections/)).toBeVisible();
        await expect(panel.getByText(/For CMS collection browsing,.*WIX_DATA\.PATCH/)).toBeVisible();
        await expect(panel.getByText(/For a multi-site app, list the account sites/)).toBeVisible();
        await expect(panel.getByText(/To rotate a key, create a replacement in Wix/)).toBeVisible();
        await expect(panel.getByText(/Account verification queries sites; an empty list is valid/)).toBeVisible();
        await expect(panel.getByText(/For business-location selection, grant Read Locations/)).toBeVisible();
        await expect(panel.getByText(/For business-location selection,.*Updates replace the full writable location/)).toBeVisible();
        await expect(panel.getByText(/For products, install Wix Stores/)).toBeVisible();
        await expect(panel.getByText(/For commerce order reads, grant Read Orders/)).toBeVisible();
        await expect(panel.getByText(/For Wix-hosted checkout,.*Write Carts V2 \(PII\).*Read Carts V2 \(PII\)/)).toBeVisible();
        await expect(panel.getByText(/For booking services,.*Retrieve add-on groups too/)).toBeVisible();
        await expect(panel.getByText(/Read bookings with.*direct confirmation skips availability checks/)).toBeVisible();
        await expect(panel.getByText(/To create shipments or update tracking, grant Manage Orders.*Wix may send shipping emails/)).toBeVisible();
        await panel.getByText("Assistant access", { exact: true }).click();
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        const beforeConnection = JSON.parse(await readFile(filePath, "utf8"));
        const connection = panel.getByRole("region", { name: "Application connection" });
        setupIssues.wix = "credentials-missing";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Complete the required provider settings and credentials.", { exact: false })).toBeVisible();
        delete setupIssues.wix;
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveCount(0);
        connectionStatuses.wix = "reconnect-required";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.screenshot({ path: `/tmp/wix-package-proof/connection-${viewport.name}.png` });
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(beforeConnection);
      }
      if (providerBatch === "ai") {
        await addIntegration(panel, "AI");
        const model = panel.getByRole("combobox", { name: "AI model", exact: true });
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await expect(model).toHaveValue(/Big Pickle/);
        await expect(key).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await save.click(); await expect(save).toBeDisabled();
        const read = async () => JSON.parse(await readFile(filePath, "utf8"));
        expect((await read()).integrations.ai).toMatchObject({ settings: { model: "opencode/big-pickle" }, authentication: { method: "none" } });
        expect((await read()).registrations.ai).toBeUndefined();
        const chooseModel = async (search: string, name: RegExp) => {
          await model.fill(search);
          await page.getByRole("option", { name }).click();
        };
        await chooseModel("GLM-4.7-Flash (zai)", /^GLM-4.7-Flash \(zai\)/);
        await expect(key).toBeVisible();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await key.fill("raw-ai-secret"); await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-ai-secret");
        await key.fill("env:APP_AI_API_KEY"); await save.click(); await expect(save).toBeDisabled();
        expect((await read()).integrations.ai.authentication).toEqual({ method: "api-key", secretRef: "env:APP_AI_API_KEY" });
        await chooseModel("GPT-5.4 (openai)", /^GPT-5.4 \(openai\)/);
        await expect(key).toHaveValue(""); // A different provider cannot inherit this key.
        await chooseModel("GLM-4.7-Flash (zai)", /^GLM-4.7-Flash \(zai\)/);
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await key.fill("account:personal-ai"); await save.click(); await expect(save).toBeDisabled();
        expect((await read()).integrations.ai.accountMode).toBe("per-user");
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("AI", { exact: true }).click();
        await expect(model).toHaveValue(/GLM-4.7-Flash \(zai\)/); await expect(key).toHaveValue("account:personal-ai");
        await chooseModel("MiMo V2.5 Free (opencode)", /^MiMo V2.5 Free \(opencode\)/);
        await expect(key).toHaveCount(0); await save.click(); await expect(save).toBeDisabled();
        expect((await read()).integrations.ai.authentication).toEqual({ method: "none" });
        expect((await read()).integrations.ai.settings.model).toBe("opencode/mimo-v2.5-free");
        await model.fill("grok-code"); await expect(page.getByRole("option")).toHaveCount(0);
        await model.press("Escape"); await model.blur();
        expect((await read()).integrations.ai.settings.model).toBe("opencode/mimo-v2.5-free");
        await panel.getByRole("button", { name: "Set up AI", exact: true }).click();
        await expect(panel.getByRole("link", { name: "Open Env", exact: true })).toBeVisible();
        expect(await model.locator("xpath=ancestor::*[contains(@class,'v-field')][1]").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
        await page.screenshot({ path: `/tmp/vibe64-integrations-dev/ai-${viewport.name}.png`, fullPage: true });
      }
      if (providerBatch === "wiz") {
        await addIntegration(panel, "Wiz");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const policies = panel.getByRole("textbox", { name: "CI/CD scan policies", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        const endpoint = panel.getByRole("combobox", { name: "Token URL", exact: true });
        const filter = panel.getByRole("combobox", { name: "Filter findings by policy hits", exact: true });
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(endpoint).toHaveValue("Cognito (auth.app.wiz.io)");
        await expect(filter).toHaveValue("Blocking policy hits (BLOCK)");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await client.fill("fixture-wiz-client"); await secret.fill("raw-wiz-secret"); await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-wiz-secret");
        await secret.fill("env:WIZ_SECRET"); await policies.fill("first,,second"); await save.click();
        await expect(panel.getByText("Use up to 50 comma-separated policy names, without empty names or control characters.", { exact: true })).toBeVisible();
        await policies.fill("Default vulnerabilities policy, Default IaC policy");
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Workspace security");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.registrations.wiz).toEqual({ source: "own", grantType: "client_credentials", clientId: "fixture-wiz-client", clientSecretRef: "env:WIZ_SECRET" });
        expect(file.integrations.wiz.settings).toEqual({ tokenUrl: "https://auth.app.wiz.io/oauth/token", byPolicyHits: "BLOCK", policies: "Default vulnerabilities policy, Default IaC policy" });
        expect(file.integrations.wiz.accountMode).toBe("shared"); expect(file.integrations.wiz.scopes).toEqual([]);
        const choose = async (label: string, current: string, next: string) => {
          const field = panel.locator(".v-input").filter({ has: page.getByRole("combobox", { name: label, exact: true }) });
          await field.getByText(current, { exact: true }).click({ timeout: 10000 });
          await page.getByRole("option", { name: next, exact: true }).click();
        };
        await choose("Filter findings by policy hits", "Blocking policy hits (BLOCK)", "Blocking or audit policy hits (AUDIT)");
        await save.click(); await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.wiz.settings.byPolicyHits).toBe("AUDIT");
        await choose("Filter findings by policy hits", "Blocking or audit policy hits (AUDIT)", "All findings (DISABLED)");
        await choose("Token URL", "Cognito (auth.app.wiz.io)", "Auth0 (auth.wiz.io)");
        await expect(panel.getByText("The current Wiz v1 runner supports Cognito. Auth0 configuration can be saved, but requires a verified compatible runner before scanning.", { exact: true })).toBeVisible();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Workspace security", { exact: true }).click();
        await expect(endpoint).toHaveValue("Auth0 (auth.wiz.io)"); await expect(filter).toHaveValue("All findings (DISABLED)");
        await expect(policies).toHaveValue("Default vulnerabilities policy, Default IaC policy");
        await expect(client).toHaveValue("fixture-wiz-client"); await expect(secret).toHaveValue("env:WIZ_SECRET");
        await choose("Token URL", "Auth0 (auth.wiz.io)", "Cognito (auth.app.wiz.io)");
        await policies.fill(""); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.wiz.settings).toEqual({ tokenUrl: "https://auth.app.wiz.io/oauth/token", byPolicyHits: "DISABLED" });
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        const setup = panel.getByRole("button", { name: "Set up Wiz", exact: true }); if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://marketplace.visualstudio.com/items?itemName=WizCloud.wiz-task");
      }
      if (providerBatch === "shopify") {
        await addIntegration(panel, "Shopify");
        const shop = panel.getByRole("textbox", { name: "Shopify store domain", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await client.fill("fixture-shopify-client"); await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await shop.fill("https://whatever.com"); await save.click();
        await expect(panel.getByText("Enter the store's permanent name.myshopify.com domain without a protocol, path or port.", { exact: true })).toBeVisible();
        await shop.fill("fixture-store.myshopify.com");
        await panel.getByRole("textbox", { name: "Client secret reference", exact: true }).fill("env:SHOPIFY_SECRET");
        await panel.getByRole("button", { name: "Assistant permissions", exact: true }).click();
        const labels = ["Enable Shopify", "Connect your Shopify store", "Claim your store", "Read products", "Create product", "Update product", "Delete product",
          "Add product variant", "Update product variant", "Delete product variant", "Create discount code", "Update discount code", "Delete discount code",
          "Create price rule", "Update price rule", "Delete price rule"];
        for (const label of labels) await expect(panel.getByRole("combobox", { name: label, exact: true })).toHaveValue("Ask each time");
        const choose = async (label: string, current: string, next: string) => {
          const field = panel.locator(".v-input").filter({ has: page.getByRole("combobox", { name: label, exact: true }) });
          await field.getByText(current, { exact: true }).click({ timeout: 10000 });
          for (const option of ["Ask each time", "Always allow", "Never allow"]) await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
          await page.getByRole("option", { name: next, exact: true }).click();
        };
        await choose("Delete product", "Ask each time", "Never allow");
        await choose("Manage all permissions", "Ask each time", "Always allow");
        for (const label of labels) await expect(panel.getByRole("combobox", { name: label, exact: true })).toHaveValue("Always allow");
        await choose("Claim your store", "Always allow", "Never allow");
        await choose("Create product", "Always allow", "Ask each time");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.registrations.shopify).toEqual({ source: "own", clientId: "fixture-shopify-client", clientSecretRef: "env:SHOPIFY_SECRET", grantType: "client_credentials" });
        expect(file.integrations.shopify.assistantPolicy).toEqual({ enabled: true, defaultPermission: "always", actions: { claim: "never", "products.create": "ask" } });
        const enabled = panel.getByRole("checkbox", { name: "Allow assistant access", exact: true });
        await enabled.uncheck({ timeout: 10000 });
        await expect(panel.getByRole("combobox", { name: "Manage all permissions", exact: true })).toBeDisabled();
        for (const label of labels) await expect(panel.getByRole("combobox", { name: label, exact: true })).toBeDisabled();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Shopify", { exact: true }).click();
        await expect(shop).toHaveValue("fixture-store.myshopify.com"); await expect(client).toHaveValue("fixture-shopify-client");
        await panel.getByRole("button", { name: "Assistant permissions", exact: true }).click();
        await expect(enabled).not.toBeChecked(); await enabled.check();
        await expect(panel.getByRole("combobox", { name: "Claim your store", exact: true })).toHaveValue("Never allow");
        await expect(panel.getByRole("combobox", { name: "Create product", exact: true })).toHaveValue("Ask each time");
        if (viewport.name === "compact") {
          const field = panel.locator(".v-input").filter({ has: page.getByRole("combobox", { name: "Create product", exact: true }) });
          expect(await field.locator(".v-field").evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
        }
        await panel.getByText("App in your Shopify organization", { exact: true }).click();
        await page.getByRole("option", { name: "Existing Admin API access token", exact: true }).click();
        const token = panel.getByRole("textbox", { name: "Admin API access token reference", exact: true });
        await token.fill("raw-secret"); await save.click(); await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-secret"); await token.fill("env:SHOPIFY_TOKEN");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.shopify.authentication).toEqual({ method: "api-key", secretRef: "env:SHOPIFY_TOKEN" });
        expect(file.integrations.shopify.assistantPolicy.actions).toEqual({ claim: "never", "products.create": "ask" });
        expect(file.integrations["google-calendar"].displayName).toBe("After CLI update"); expect(file.extensions).toEqual(saved.extensions);
        const setup = panel.getByRole("button", { name: "Set up Shopify", exact: true }); if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant");
      }
      if (providerBatch === "workday") {
        await addIntegration(panel, "Workday");
        const rest = panel.getByRole("textbox", { name: "Workday REST API Endpoint", exact: true });
        const token = panel.getByRole("textbox", { name: "Token Endpoint", exact: true });
        const authorization = panel.getByRole("textbox", { name: "Authorization Endpoint", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Each app user's own account");
        await panel.getByText("Each app user's own account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "One shared account", exact: true })).toHaveCount(0);
        await expect(page.getByRole("option", { name: "Assistant access", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.workday).toBeUndefined();
        await client.fill("fixture-workday-client"); await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(3);
        await rest.fill("https://wd5-services1.myworkday.com/ccx/api/v1/acme_corp");
        await token.fill("https://wd5-services1.myworkday.com/ccx/oauth2/another_tenant/token");
        await authorization.fill("https://acme.wd5.myworkday.com/another_tenant/authorize");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(2);
        await token.fill("https://wd5-services1.myworkday.com/ccx/oauth2/acme_corp/token");
        await authorization.fill("https://acme.wd5.myworkday.com/acme_corp/authorize");
        await secret.fill("raw-workday-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-workday-secret");
        await secret.fill("env:WORKDAY_SECRET"); await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:WORKDAY_CALLBACK"); await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.workday.settings).toEqual({ restApiEndpoint: "https://wd5-services1.myworkday.com/ccx/api/v1/acme_corp",
          tokenEndpoint: "https://wd5-services1.myworkday.com/ccx/oauth2/acme_corp/token", authorizationEndpoint: "https://acme.wd5.myworkday.com/acme_corp/authorize" });
        expect(file.integrations.workday.accountMode).toBe("per-user"); expect(file.integrations.workday.scopes).toEqual([]);
        expect(file.registrations.workday).toEqual({ source: "own", clientId: "fixture-workday-client", clientSecretRef: "env:WORKDAY_SECRET", callbackUrlRef: "env:WORKDAY_CALLBACK" });
        const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
        if (await dismiss.isVisible()) await dismiss.click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Staff directory");
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Staff directory", { exact: true }).click();
        await expect(rest).toHaveValue(file.integrations.workday.settings.restApiEndpoint);
        await expect(token).toHaveValue(file.integrations.workday.settings.tokenEndpoint);
        await expect(authorization).toHaveValue(file.integrations.workday.settings.authorizationEndpoint);
        await expect(client).toHaveValue("fixture-workday-client"); await expect(secret).toHaveValue("env:WORKDAY_SECRET"); await expect(callback).toHaveValue("env:WORKDAY_CALLBACK");
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.workday.accountMode).toBe("per-user");
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        const setup = panel.getByRole("button", { name: "Set up Workday", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.lovable.dev/integrations/workday");
        await expect(panel.getByText("Register this confidential client without PKCE so Workday issues a Client Secret. Enter your application's exact backend callback URL.", { exact: true })).toBeVisible();
        await expect(panel.getByText(/For organization browsing, also select Organizations and Roles/)).toBeVisible();
        await expect(panel.getByText(/For time-off balances and entries, select Time Off and Leave/)).toBeVisible();
        await expect(panel.getByText(/For custom reports, select Tenant Non-Configurable and Include Workday Owned Scope/)).toBeVisible();
      }
      if (providerBatch === "gemini-enterprise") {
        await addIntegration(panel, "Gemini Enterprise");
        const project = panel.getByRole("textbox", { name: "GCP project ID", exact: true });
        const engine = panel.getByRole("textbox", { name: "Engine ID", exact: true });
        const location = panel.getByRole("combobox", { name: "Location", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Cloud Platform (full access)", exact: true })).toBeChecked();
        await expect(location).toHaveValue("Global");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["gemini-enterprise"]).toBeUndefined();
        await client.fill("fixture-google-client"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(2);
        await project.fill("123456789012"); await engine.fill("Bad/engine"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(2);
        await project.fill("my-gcp-project"); await engine.fill("company_search-1");
        await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-secret");
        await secret.fill("env:GEMINI_ENTERPRISE_SECRET"); await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:GEMINI_ENTERPRISE_CALLBACK");
        await panel.getByText("Global", { exact: true }).click(); await page.getByRole("option", { name: "European Union", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["gemini-enterprise"].settings).toEqual({ projectId: "my-gcp-project", location: "eu", engineId: "company_search-1" });
        expect(file.integrations["gemini-enterprise"].scopes).toEqual(["https://www.googleapis.com/auth/cloud-platform"]);
        expect(file.registrations["gemini-enterprise"]).toEqual({ source: "own", clientId: "fixture-google-client", clientSecretRef: "env:GEMINI_ENTERPRISE_SECRET", callbackUrlRef: "env:GEMINI_ENTERPRISE_CALLBACK" });
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Company search");
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByText("European Union", { exact: true }).click(); await page.getByRole("option", { name: "United States", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Company search", { exact: true }).click();
        await expect(project).toHaveValue("my-gcp-project"); await expect(engine).toHaveValue("company_search-1"); await expect(location).toHaveValue("United States");
        await expect(client).toHaveValue("fixture-google-client"); await expect(secret).toHaveValue("env:GEMINI_ENTERPRISE_SECRET"); await expect(callback).toHaveValue("env:GEMINI_ENTERPRISE_CALLBACK");
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations["gemini-enterprise"].accountMode).toBe("assistant");
        expect(file.integrations["gemini-enterprise"].settings.location).toBe("us");
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        const setup = panel.getByRole("button", { name: "Set up Gemini Enterprise", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.cloud.google.com/gemini/enterprise/docs/authentication");
        await expect(panel.getByText(/Google-generated summary with citations/)).toBeVisible();
        await expect(panel.getByText(/Grant the connecting Google account discoveryengine.engines.get/)).toBeVisible();
      }
      if (providerBatch === "snowflake") {
        await addIntegration(panel, "Snowflake");
        const account = panel.getByRole("textbox", { name: "Account URL", exact: true });
        const role = panel.getByRole("textbox", { name: "Role", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Keep access between visits (required)", exact: true })).toBeChecked();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.snowflake).toBeUndefined();
        await client.fill("fixture-snowflake-client"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await account.fill("https://app.snowflake.com/org/account"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await account.fill("https://myorg-myaccount.snowflakecomputing.com"); await role.fill("ACCOUNTADMIN"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await role.fill("VIBE64_READER"); await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-secret");
        await secret.fill("env:SNOWFLAKE_SECRET"); await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:SNOWFLAKE_CALLBACK");
        const warehouse = panel.getByRole("textbox", { name: "Warehouse (optional)", exact: true });
        const database = panel.getByRole("textbox", { name: "Database (optional)", exact: true });
        const schema = panel.getByRole("textbox", { name: "Schema (optional)", exact: true });
        await warehouse.fill("AppCompute"); await database.fill("AppData"); await schema.fill("Reporting");
        const requiredRole = panel.getByRole("checkbox", { name: "Use role VIBE64_READER (required)", exact: true });
        await expect(requiredRole).toBeChecked(); await expect(requiredRole).toBeDisabled();
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.snowflake.settings).toEqual({ accountUrl: "https://myorg-myaccount.snowflakecomputing.com", role: "VIBE64_READER", warehouse: "AppCompute", database: "AppData", schema: "Reporting" });
        expect(file.integrations.snowflake.scopes).toEqual(["refresh_token", "session:role:VIBE64_READER"]);
        expect(file.registrations.snowflake).toEqual({ source: "own", clientId: "fixture-snowflake-client", clientSecretRef: "env:SNOWFLAKE_SECRET", callbackUrlRef: "env:SNOWFLAKE_CALLBACK" });
        await role.fill("Inventory & stock");
        await expect(panel.getByRole("checkbox", { name: "Use role Inventory & stock (required)", exact: true })).toBeChecked();
        await panel.getByRole("checkbox", { name: "Keep access between visits", exact: true }).uncheck();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Inventory databases");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Inventory databases", { exact: true }).click();
        await expect(account).toHaveValue("https://myorg-myaccount.snowflakecomputing.com"); await expect(role).toHaveValue("Inventory & stock");
        await expect(warehouse).toHaveValue("AppCompute"); await expect(database).toHaveValue("AppData"); await expect(schema).toHaveValue("Reporting");
        await expect(client).toHaveValue("fixture-snowflake-client"); await expect(secret).toHaveValue("env:SNOWFLAKE_SECRET"); await expect(callback).toHaveValue("env:SNOWFLAKE_CALLBACK");
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.snowflake.accountMode).toBe("per-user");
        expect(file.integrations.snowflake.scopes).toEqual(["session:role-encoded:Inventory%20%26%20stock"]);
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await expect(panel.getByText("Each user connects in your application's own account screen.", { exact: true })).toBeVisible();
        await expect(panel.getByRole("region", { name: "Application connection" }).getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        await role.fill("");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        const offline = panel.getByRole("checkbox", { name: "Keep access between visits (required)", exact: true });
        await expect(offline).toBeChecked(); await expect(offline).toBeDisabled();
        await panel.getByText("Each app user's own account", { exact: true }).click(); await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.snowflake.accountMode).toBe("assistant");
        expect(file.integrations.snowflake.settings.role).toBeUndefined(); expect(file.integrations.snowflake.scopes).toEqual(["refresh_token"]);
        const setup = panel.getByRole("button", { name: "Set up Snowflake", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Run: CREATE SECURITY INTEGRATION APP_CONNECTOR/)).toBeVisible();
        await expect(panel.getByText(/Run SELECT SYSTEM\$SHOW_OAUTH_CLIENT_SECRETS/)).toBeVisible();
        await expect(panel.getByText(/Warehouse management needs separate grants/)).toBeVisible();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.snowflake.com/en/user-guide/oauth-custom");
        const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
        if (await dismiss.isVisible()) await dismiss.click();
        await panel.getByRole("combobox", { name: "Account used by the application", exact: true }).press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        if (await dismiss.isVisible()) await dismiss.click();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.snowflake = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "tiktok") {
        await addIntegration(panel, "TikTok");
        const client = panel.getByRole("textbox", { name: "Client key", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        const required = panel.getByRole("checkbox", { name: "Read basic profile information (required)", exact: true });
        await expect(required).toBeChecked(); await expect(required).toBeDisabled();
        const optional = ["Read user statistics", "Read extended profile information", "Read published video metadata"];
        for (const label of optional) await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.tiktok).toBeUndefined();
        await client.fill("fixture-tiktok-key"); await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:TIKTOK_SECRET"); await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:TIKTOK_CALLBACK"); await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.tiktok).toEqual({ provider: "tiktok", displayName: "TikTok", accountMode: "shared",
          scopes: ["user.info.basic", "user.info.stats", "user.info.profile", "video.list"], authentication: { method: "oauth2", registrationRef: "tiktok" } });
        expect(file.registrations.tiktok).toEqual({ source: "own", clientId: "fixture-tiktok-key", clientSecretRef: "env:TIKTOK_SECRET", callbackUrlRef: "env:TIKTOK_CALLBACK" });
        const connection = panel.getByRole("region", { name: "Application connection" });
        setupIssues.tiktok = "callback-invalid";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Set a valid application callback URL in Env", { exact: false })).toBeVisible();
        delete setupIssues.tiktok;
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        connectionStatuses.tiktok = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        for (const label of optional) await panel.getByRole("checkbox", { name: label, exact: true }).uncheck();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("My creator account");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("My creator account", { exact: true }).click();
        await expect(client).toHaveValue("fixture-tiktok-key"); await expect(secret).toHaveValue("env:TIKTOK_SECRET"); await expect(callback).toHaveValue("env:TIKTOK_CALLBACK");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(required).toBeChecked(); await expect(required).toBeDisabled();
        for (const label of optional) await expect(panel.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.tiktok.accountMode).toBe("per-user");
        expect(file.integrations.tiktok.scopes).toEqual(["user.info.basic"]);
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await panel.getByRole("checkbox", { name: "Read published video metadata", exact: true }).check();
        await panel.getByText("Each app user's own account", { exact: true }).click(); await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.tiktok.accountMode).toBe("assistant");
        expect(file.integrations.tiktok.scopes).toEqual(["user.info.basic", "video.list"]);
        const setup = panel.getByRole("button", { name: "Set up TikTok", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developers.tiktok.com/docs/en/getting-started-create-an-app");
        await expect(panel.getByText("Use the Client key from TikTok's app credentials, not its App ID.", { exact: true })).toBeVisible();
        await expect(panel.getByText(/Open your profile menu, choose Manage apps/)).toBeVisible();
        await expect(panel.getByText(/register the backend's exact HTTPS redirect URI/)).toBeVisible();
        await expect(panel.getByText(/Use Sandbox with designated test users/)).toBeVisible();
      }
      if (providerBatch === "linkedin") {
        await addIntegration(panel, "LinkedIn");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const label of ["OpenID (required)", "Read basic profile (required)"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeDisabled();
        }
        await expect(panel.getByRole("checkbox", { name: "Read primary email address", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Publish posts", exact: true })).not.toBeChecked();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.linkedin).toBeUndefined();
        await client.fill("fixture-linkedin-client");
        await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:LINKEDIN_SECRET");
        await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:LINKEDIN_CALLBACK");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.linkedin).toEqual({ provider: "linkedin", displayName: "LinkedIn", accountMode: "shared",
          scopes: ["openid", "profile"], authentication: { method: "oauth2", registrationRef: "linkedin" } });
        expect(file.registrations.linkedin).toEqual({ source: "own", clientId: "fixture-linkedin-client", clientSecretRef: "env:LINKEDIN_SECRET", callbackUrlRef: "env:LINKEDIN_CALLBACK" });
        await panel.getByRole("checkbox", { name: "Read primary email address", exact: true }).check();
        await panel.getByRole("checkbox", { name: "Publish posts", exact: true }).check();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("My LinkedIn profile");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("My LinkedIn profile", { exact: true }).click();
        await expect(client).toHaveValue("fixture-linkedin-client"); await expect(secret).toHaveValue("env:LINKEDIN_SECRET"); await expect(callback).toHaveValue("env:LINKEDIN_CALLBACK");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const label of ["OpenID (required)", "Read basic profile (required)", "Read primary email address", "Publish posts"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.linkedin.accountMode).toBe("per-user");
        expect(file.integrations.linkedin.scopes).toEqual(["openid", "profile", "email", "w_member_social"]);
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await panel.getByRole("checkbox", { name: "Read primary email address", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Publish posts", exact: true }).uncheck();
        await panel.getByText("Each app user's own account", { exact: true }).click(); await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations.linkedin.accountMode).toBe("assistant");
        expect(file.integrations.linkedin.scopes).toEqual(["openid", "profile"]);
        const setup = panel.getByRole("button", { name: "Set up LinkedIn", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2");
        await expect(panel.getByText(/request Share on LinkedIn, wait until Auth lists w_member_social/)).toBeVisible();
        await expect(panel.getByText(/approve the exact post text and visibility/)).toBeVisible();
        await expect(panel.getByText(/text posts only, with no image\/video upload/)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "google-ads") {
        await addIntegration(panel, "Google Ads");
        const mode = panel.getByRole("combobox", { name: "API access", exact: true });
        const developer = panel.getByRole("textbox", { name: "Developer token reference", exact: true });
        const manager = panel.getByRole("textbox", { name: "Manager customer ID (optional)", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(mode).toHaveCount(0); await expect(developer).toHaveCount(0);
        await client.fill("fixture-ads.apps.googleusercontent.com");
        await manager.fill("123-456-7890"); await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await manager.fill("123456789x"); await save.click();
        await expect(panel.getByText("Enter the manager's 10-digit customer ID without hyphens.", { exact: true })).toBeVisible();
        await manager.fill("1234567890");
        await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:ADS_SECRET");
        await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:ADS_CALLBACK");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["google-ads"]).toEqual({ provider: "google-ads", displayName: "Google Ads", accountMode: "shared",
          scopes: ["https://www.googleapis.com/auth/adwords"], settings: { loginCustomerId: "1234567890" },
          authentication: { method: "oauth2", registrationRef: "google-ads" } });
        expect(file.registrations["google-ads"]).toEqual({ source: "own", clientId: "fixture-ads.apps.googleusercontent.com", clientSecretRef: "env:ADS_SECRET", callbackUrlRef: "env:ADS_CALLBACK" });
        await manager.fill("");
        await panel.getByText("One shared account", { exact: true }).click(); await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Ads reports");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["google-ads"].settings).toEqual({});
        expect(file.integrations["google-ads"].accountMode).toBe("per-user");
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Ads reports", { exact: true }).click();
        await expect(mode).toHaveCount(0); await expect(developer).toHaveCount(0); await expect(manager).toHaveValue("");
        await expect(client).toHaveValue("fixture-ads.apps.googleusercontent.com"); await expect(secret).toHaveValue("env:ADS_SECRET"); await expect(callback).toHaveValue("env:ADS_CALLBACK");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Access Google Ads accounts", exact: true })).toBeChecked();
        await manager.fill("0987654321");
        await panel.getByText("Each app user's own account", { exact: true }).click(); await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Ads reports", { exact: true }).click();
        await expect(developer).toHaveCount(0); await expect(manager).toHaveValue("0987654321");
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations["google-ads"].accountMode).toBe("assistant");
        expect(file.integrations["google-ads"].settings).toEqual({ loginCustomerId: "0987654321" });
        const setup = panel.getByRole("button", { name: "Set up Google Ads", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developers.google.com/google-ads/api/docs/get-started/make-first-call");
      }
      if (providerBatch === "salesforce") {
        await addIntegration(panel, "Salesforce");
        const environment = panel.getByRole("combobox", { name: "Environment", exact: true });
        const account = panel.getByRole("textbox", { name: "Account URL", exact: true });
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(environment.locator("..")).toContainText("Production");
        await client.fill("fixture-salesforce-client");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.salesforce).toBeUndefined();
        for (const url of ["https://login.salesforce.com", "https://fixture.my.salesforce.com.evil.test", "https://fixture.my.salesforce.com/path"]) {
          await account.fill(url); await save.click();
          await expect(panel.getByText("Enter a lowercase HTTPS My Domain URL matching the selected environment, without a path, query or port.", { exact: true })).toBeVisible();
        }
        await account.fill("https://fixture.develop.my.salesforce.com/");
        await secret.fill("raw-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:SALESFORCE_SECRET");
        await callback.fill("https://app.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:SALESFORCE_CALLBACK");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.salesforce).toEqual({ provider: "salesforce", displayName: "Salesforce", accountMode: "shared", scopes: ["api", "refresh_token"],
          settings: { environment: "production", accountUrl: "https://fixture.develop.my.salesforce.com/" }, authentication: { method: "oauth2", registrationRef: "salesforce" } });
        expect(file.registrations.salesforce).toEqual({ source: "own", clientId: "fixture-salesforce-client", clientSecretRef: "env:SALESFORCE_SECRET", callbackUrlRef: "env:SALESFORCE_CALLBACK" });
        await panel.getByText("Production", { exact: true }).click(); await page.getByRole("option", { name: "Sandbox", exact: true }).click();
        await save.click();
        await expect(panel.getByText("Enter a lowercase HTTPS My Domain URL matching the selected environment, without a path, query or port.", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.salesforce.settings.environment).toBe("production");
        await account.fill("https://fixture--uat.sandbox.my.salesforce.com");
        await panel.getByText("One shared account", { exact: true }).click(); await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Sandbox CRM");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        const api = panel.getByRole("checkbox", { name: "Access Salesforce APIs with this user's permissions", exact: true });
        const refresh = panel.getByRole("checkbox", { name: "Keep access when the user is away", exact: true });
        await expect(api).toBeChecked(); await expect(refresh).toBeChecked(); await refresh.uncheck();
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.salesforce.accountMode).toBe("per-user");
        expect(file.integrations.salesforce.scopes).toEqual(["api"]);
        expect(file.integrations.salesforce.settings).toEqual({ environment: "sandbox", accountUrl: "https://fixture--uat.sandbox.my.salesforce.com" });
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await page.reload();
        if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Sandbox CRM", { exact: true }).click();
        await expect(account).toHaveValue("https://fixture--uat.sandbox.my.salesforce.com");
        await expect(client).toHaveValue("fixture-salesforce-client"); await expect(secret).toHaveValue("env:SALESFORCE_SECRET"); await expect(callback).toHaveValue("env:SALESFORCE_CALLBACK");
        await expect(environment.locator("..")).toContainText("Sandbox");
        await expect(owner.locator("..")).toContainText("Each app user's own account");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(api).toBeChecked(); await expect(refresh).not.toBeChecked();
        await panel.getByText("Sandbox", { exact: true }).click(); await page.getByRole("option", { name: "Production", exact: true }).click();
        await account.fill("https://fixture.my.salesforce.com"); await refresh.check();
        await panel.getByText("Each app user's own account", { exact: true }).click(); await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.salesforce.accountMode).toBe("assistant");
        expect(file.integrations.salesforce.settings).toEqual({ environment: "production", accountUrl: "https://fixture.my.salesforce.com" });
        expect(file.integrations.salesforce.scopes).toEqual(["api", "refresh_token"]);
        const setup = panel.getByRole("button", { name: "Set up Salesforce", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://help.salesforce.com/s/articleView?id=sf.external_client_apps.htm&type=5");
      }
      if (providerBatch === "firebase") {
        await addIntegration(panel, "Firebase Cloud Messaging");
        const project = panel.getByRole("textbox", { name: "Firebase project ID", exact: true });
        const key = panel.getByRole("textbox", { name: "Service-account JSON reference", exact: true });
        const apiKey = panel.getByRole("textbox", { name: "Firebase API key", exact: true });
        const appId = panel.getByRole("textbox", { name: "Firebase App ID", exact: true });
        const vapid = panel.getByRole("textbox", { name: "Web Push VAPID key", exact: true });
        const mode = panel.getByRole("combobox", { name: "Client setup", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(mode).toHaveValue("Server or native only");
        await expect(apiKey).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(key).toHaveValue("env:FIREBASE_CLOUD_MESSAGING_SERVICE_ACCOUNT");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await project.fill("https://wrong-project"); await save.click();
        await expect(panel.getByText("Enter the Firebase project ID, without a URL or project number.", { exact: true })).toBeVisible();
        await project.fill("target-project");
        for (const raw of ['{"type":"service_account"}', "https://secret.test/key"]) {
          await key.fill(raw); await save.click();
          await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain(raw);
        }
        await key.fill("env:FIREBASE_SERVICE_ACCOUNT"); await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["firebase-cloud-messaging"]).toEqual({ provider: "firebase-cloud-messaging", displayName: "Firebase Cloud Messaging", accountMode: "shared",
          scopes: ["https://www.googleapis.com/auth/firebase.messaging"], settings: { projectId: "target-project", clientMode: "server" },
          authentication: { method: "service-account", secretRef: "env:FIREBASE_SERVICE_ACCOUNT" } });
        expect(file.registrations["firebase-cloud-messaging"]).toBeUndefined();
        await panel.getByText("Server or native only", { exact: true }).click();
        await page.getByRole("option", { name: "Include web push", exact: true }).click();
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(3);
        await apiKey.fill("raw-invalid-key"); await appId.fill("1:123:ios:not-web"); await vapid.fill("private-vapid-value");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(3);
        const publicKey = `AIza${"a".repeat(35)}`; const webId = "1:9007199254740993:web:abcdef1234567890"; const publicVapid = `B${"a".repeat(85)}A`;
        await apiKey.fill(publicKey); await appId.fill(webId); await vapid.fill(publicVapid); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["firebase-cloud-messaging"].settings).toEqual({ projectId: "target-project", clientMode: "web", apiKey: publicKey, appId: webId, vapidKey: publicVapid });
        await panel.getByText("Include web push", { exact: true }).click();
        await page.getByRole("option", { name: "Server or native only", exact: true }).click();
        await expect(apiKey).toHaveCount(0); await expect(appId).toHaveCount(0); await expect(vapid).toHaveCount(0);
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["firebase-cloud-messaging"].settings).toEqual({ projectId: "target-project", clientMode: "server" });
        await panel.getByText("Server or native only", { exact: true }).click();
        await page.getByRole("option", { name: "Include web push", exact: true }).click();
        await expect(apiKey).toHaveValue(""); await expect(appId).toHaveValue(""); await expect(vapid).toHaveValue("");
        await apiKey.fill(publicKey); await appId.fill(webId); await vapid.fill(publicVapid);
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("App notifications");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["firebase-cloud-messaging"].accountMode).toBe("assistant");
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("App notifications", { exact: true }).click();
        await expect(project).toHaveValue("target-project"); await expect(key).toHaveValue("env:FIREBASE_SERVICE_ACCOUNT");
        await expect(mode).toHaveValue("Include web push"); await expect(apiKey).toHaveValue(publicKey); await expect(appId).toHaveValue(webId); await expect(vapid).toHaveValue(publicVapid);
        const setup = panel.getByRole("button", { name: "Set up Firebase Cloud Messaging", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://firebase.google.com/docs/cloud-messaging/send/v1-api");
        await expect(panel.getByText(/On connector_recipient_unregistered/)).toBeVisible();
        await expect(panel.getByText(/Check connection only reads saved status/)).toBeVisible();
      }
      if (providerBatch === "dbt") {
        await addIntegration(panel, "dbt Semantic Layer");
        const host = panel.getByRole("textbox", { name: "Semantic Layer host", exact: true });
        const environment = panel.getByRole("textbox", { name: "Environment ID", exact: true });
        const key = panel.getByRole("textbox", { name: "Service token reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(2);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["dbt-semantic-layer"]).toBeUndefined();
        await host.fill("https://semantic-layer.cloud.getdbt.com/api/graphql");
        await environment.fill("1e16"); await save.click();
        await expect(panel.getByText("Enter the lowercase dbt Semantic Layer hostname without a URL, path or port.", { exact: true })).toBeVisible();
        await expect(panel.getByText("Enter a positive decimal Environment ID as text, without spaces or leading zeros.", { exact: true })).toBeVisible();
        await host.fill("semantic-layer.au.dbt.com"); await environment.fill("9007199254740993");
        for (const invalid of ["raw-dbtc-token", "https://secret.test/token"]) {
          await key.fill(invalid); await save.click();
          await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain(invalid);
        }
        await key.fill("env:DBT_SERVICE_TOKEN"); await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["dbt-semantic-layer"]).toEqual({ provider: "dbt-semantic-layer", displayName: "dbt Semantic Layer", accountMode: "shared", scopes: [],
          settings: { host: "semantic-layer.au.dbt.com", environmentId: "9007199254740993" }, authentication: { method: "api-key", secretRef: "env:DBT_SERVICE_TOKEN" } });
        expect(file.registrations["dbt-semantic-layer"]).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Warehouse metadata");
        await host.fill("team.semantic-layer.us1.dbt.com"); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["dbt-semantic-layer"].accountMode).toBe("assistant");
        expect(file.integrations["dbt-semantic-layer"].settings).toEqual({ host: "team.semantic-layer.us1.dbt.com", environmentId: "9007199254740993" });
        expect(file.extensions).toEqual(saved.extensions); expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Warehouse metadata", { exact: true }).click();
        await expect(host).toHaveValue("team.semantic-layer.us1.dbt.com"); await expect(environment).toHaveValue("9007199254740993");
        await expect(key).toHaveValue("env:DBT_SERVICE_TOKEN"); await expect(owner).toHaveValue("Assistant access");
        const setup = panel.getByRole("button", { name: "Set up dbt Semantic Layer", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.getdbt.com/docs/use-dbt-semantic-layer/setup-sl");
        await expect(panel.getByText(/Check connection only reads saved status/)).toBeVisible();
        await expect(panel.getByText(/JSON results suit small tables/)).toBeVisible();
      }
      if (providerBatch === "fabric") {
        await addIntegration(panel, "Microsoft Fabric");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const tenant = panel.getByRole("textbox", { name: "Microsoft Entra Tenant ID", exact: true });
        const endpoint = panel.getByRole("textbox", { name: "Fabric GraphQL Endpoint", exact: true });
        const flow = panel.getByRole("combobox", { name: "OAuth flow", exact: true });
        const account = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const tenantId = "11111111-2222-3333-4444-555555555555";
        const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        const graphqlEndpoint = `https://api.fabric.microsoft.com/v1/workspaces/${tenantId}/graphqlapis/${clientId}/graphql`;
        await expect(flow).toHaveValue("User consent");
        await client.fill(clientId); await secret.fill("env:FABRIC_SECRET"); await callback.fill("env:FABRIC_CALLBACK");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(2);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["microsoft-fabric"]).toBeUndefined();
        await tenant.fill("common"); await endpoint.fill(graphqlEndpoint + "?token=private"); await save.click();
        await expect(panel.getByText("Enter the Directory (tenant) ID as a GUID, not common or a client ID.", { exact: true })).toBeVisible();
        await expect(panel.getByText("Copy the Fabric GraphQL API endpoint with workspace and API IDs, without a query string or fragment.", { exact: true })).toBeVisible();
        await tenant.fill(tenantId); await endpoint.fill(graphqlEndpoint); await client.fill("not-a-client-guid"); await save.click();
        await expect(panel.getByText("Enter the Application (client) ID as a GUID.", { exact: true })).toBeVisible();
        await client.fill(clientId); await secret.fill("raw-fabric-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-fabric-secret");
        await secret.fill("env:FABRIC_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:FABRIC_CALLBACK"); await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(2); await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(2);
        await save.click(); await expect(save).toBeDisabled();
        const user = JSON.parse(await readFile(filePath, "utf8"));
        expect(user.integrations["microsoft-fabric"].settings).toEqual({ tenantId, graphqlEndpoint });
        expect(user.integrations["microsoft-fabric"].scopes).toEqual(["https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All", "offline_access"]);
        expect(user.integrations["microsoft-fabric"].accountMode).toBe("per-user");
        expect(user.registrations["microsoft-fabric"].callbackUrlRef).toBe("env:FABRIC_CALLBACK");
        await panel.getByText("User consent", { exact: true }).click(); await page.getByRole("option", { name: "Service account", exact: true }).click();
        await expect(callback).toHaveCount(0); await expect(account).toHaveValue("One shared account");
        await expect(panel.getByRole("checkbox")).toHaveCount(1);
        const servicePermission = panel.getByRole("checkbox", { name: "Use the service account's Fabric permissions", exact: true });
        await expect(servicePermission).not.toBeChecked(); await save.click();
        await expect(panel.getByText("Select at least one permission.", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["microsoft-fabric"].accountMode).toBe("per-user");
        await servicePermission.check(); await client.fill(tenantId); await tenant.fill(clientId);
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Fabric inventory");
        await save.click(); await expect(save).toBeDisabled();
        const machine = JSON.parse(await readFile(filePath, "utf8"));
        expect(machine.registrations["microsoft-fabric"]).toEqual({ source: "own", grantType: "client_credentials", clientId: tenantId, clientSecretRef: "env:FABRIC_SECRET" });
        expect(machine.integrations["microsoft-fabric"].scopes).toEqual(["https://api.fabric.microsoft.com/.default"]);
        expect(machine.integrations["microsoft-fabric"].settings).toEqual({ tenantId: clientId, graphqlEndpoint });
        expect(machine.extensions).toEqual(saved.extensions); expect(machine.integrations["google-calendar"]).toEqual(user.integrations["google-calendar"]);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Fabric inventory", { exact: true }).click();
        await expect(flow).toHaveValue("Service account"); await expect(callback).toHaveCount(0);
        await expect(tenant).toHaveValue(clientId); await expect(client).toHaveValue(tenantId); await expect(endpoint).toHaveValue(graphqlEndpoint);
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click(); await expect(servicePermission).toBeChecked();
        await panel.getByText("Service account", { exact: true }).click(); await page.getByRole("option", { name: "User consent", exact: true }).click();
        await expect(callback).toHaveValue(""); await expect(servicePermission).toHaveCount(0);
        await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(0);
        await callback.fill("env:FABRIC_NEW_CALLBACK");
        await panel.getByRole("checkbox", { name: "Execute GraphQL queries and mutations as the user", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const restored = JSON.parse(await readFile(filePath, "utf8"));
        expect(restored.registrations["microsoft-fabric"].grantType).toBe("authorization_code");
        expect(restored.registrations["microsoft-fabric"].callbackUrlRef).toBe("env:FABRIC_NEW_CALLBACK");
        expect(restored.integrations["microsoft-fabric"].scopes).toEqual(["https://analysis.windows.net/powerbi/api/GraphQLApi.Execute.All"]);
        const setup = panel.getByRole("button", { name: "Set up Microsoft Fabric", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://learn.microsoft.com/en-us/fabric/data-engineering/connect-apps-api-graphql");
        await expect(panel.getByText(/Use graphql.execute with an app-approved query/)).toBeVisible();
        await expect(panel.getByText(/LIMITATIONS: no automatic table browser/)).toBeVisible();
      }
      if (providerBatch === "databricks") {
        await addIntegration(panel, "Databricks");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const workspace = panel.getByRole("textbox", { name: "Workspace URL", exact: true });
        const flow = panel.getByRole("combobox", { name: "OAuth flow", exact: true });
        const account = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(flow).toHaveValue("User consent");
        await client.fill("assigned-user-client"); await secret.fill("env:DATABRICKS_SECRET"); await callback.fill("env:DATABRICKS_CALLBACK");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.databricks).toBeUndefined();
        await workspace.fill("https://accounts.cloud.databricks.com"); await save.click();
        await expect(panel.getByText("Enter the HTTPS per-workspace URL for Databricks on AWS, Azure or Google Cloud, without a path or query.", { exact: true })).toBeVisible();
        await workspace.fill("https://dbc-abc123.cloud.databricks.com"); await secret.fill("raw-databricks-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-databricks-secret");
        await secret.fill("env:DATABRICKS_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:DATABRICKS_CALLBACK");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(2); await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(2);
        await save.click(); await expect(save).toBeDisabled();
        const user = JSON.parse(await readFile(filePath, "utf8"));
        expect(user.integrations.databricks.scopes).toEqual(["all-apis", "offline_access"]);
        expect(user.integrations.databricks.accountMode).toBe("per-user");
        expect(user.registrations.databricks).toEqual({ source: "own", clientId: "assigned-user-client", clientSecretRef: "env:DATABRICKS_SECRET", callbackUrlRef: "env:DATABRICKS_CALLBACK" });
        await panel.getByText("User consent", { exact: true }).click();
        await page.getByRole("option", { name: "Service account", exact: true }).click();
        await expect(callback).toHaveCount(0); await expect(account).toHaveValue("One shared account");
        await client.fill("assigned-service-principal"); await workspace.fill("https://adb-123456789.7.azuredatabricks.net");
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Warehouse jobs");
        const jobs = panel.getByRole("checkbox", { name: "Jobs API access for the service account", exact: true });
        await jobs.check(); await panel.getByRole("checkbox", { name: "APIs allowed by the connected account", exact: true }).uncheck();
        await expect(panel.getByRole("checkbox", { name: "Keep user access between visits", exact: true })).toHaveCount(0);
        await save.click(); await expect(save).toBeDisabled();
        const machine = JSON.parse(await readFile(filePath, "utf8"));
        expect(machine.integrations.databricks.accountMode).toBe("shared"); expect(machine.integrations.databricks.scopes).toEqual(["jobs"]);
        expect(machine.integrations.databricks.settings).toEqual({ workspaceUrl: "https://adb-123456789.7.azuredatabricks.net" });
        expect(machine.registrations.databricks).toEqual({ source: "own", grantType: "client_credentials", tokenEndpointAuthMethod: "client_secret_basic",
          clientId: "assigned-service-principal", clientSecretRef: "env:DATABRICKS_SECRET" });
        expect(machine.extensions).toEqual(saved.extensions); expect(machine.integrations["google-calendar"]).toEqual(user.integrations["google-calendar"]);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Warehouse jobs", { exact: true }).click();
        await expect(flow).toHaveValue("Service account"); await expect(callback).toHaveCount(0); await expect(client).toHaveValue("assigned-service-principal");
        await expect(workspace).toHaveValue("https://adb-123456789.7.azuredatabricks.net");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click(); await expect(jobs).toBeChecked();
        await panel.getByText("Service account", { exact: true }).click();
        await page.getByRole("option", { name: "User consent", exact: true }).click();
        await expect(callback).toHaveValue(""); await expect(jobs).toHaveCount(0);
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        await expect(panel.getByText("Select at least one permission.", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).registrations.databricks.grantType).toBe("client_credentials");
        await callback.fill("env:DATABRICKS_USER_CALLBACK"); await client.fill("assigned-user-client");
        await panel.getByRole("checkbox", { name: "APIs allowed by the connected account", exact: true }).check();
        await panel.getByRole("checkbox", { name: "Keep user access between visits", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const restored = JSON.parse(await readFile(filePath, "utf8"));
        expect(restored.registrations.databricks.grantType).toBe("authorization_code");
        expect(restored.registrations.databricks.tokenEndpointAuthMethod).toBe("client_secret_post");
        expect(restored.registrations.databricks.callbackUrlRef).toBe("env:DATABRICKS_USER_CALLBACK");
        const setup = panel.getByRole("button", { name: "Set up Databricks", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.databricks.com/aws/en/integrations/enable-disable-oauth");
      }
      if (providerBatch === "lightspeed") {
        await addIntegration(panel, "Lightspeed");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const prefix = panel.getByRole("textbox", { name: "Domain prefix", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await client.fill("assigned-lightspeed-client"); await secret.fill("env:LIGHTSPEED_SECRET"); await callback.fill("env:LIGHTSPEED_CALLBACK");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.lightspeed).toBeUndefined();
        await prefix.fill("https://my-store.retail.lightspeed.app"); await save.click();
        await expect(panel.getByText("Enter the lowercase store prefix without a URL, dots or spaces.", { exact: true })).toBeVisible();
        await prefix.fill("my-store"); await secret.fill("raw-lightspeed-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-lightspeed-secret");
        await secret.fill("env:LIGHTSPEED_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:LIGHTSPEED_CALLBACK");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(49);
        await expect(panel.getByRole("checkbox", { checked: true })).toHaveCount(16);
        for (const label of ["Read products", "Read customers", "Read outlets"]) await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Edit customers", exact: true })).not.toBeChecked();
        await save.click(); await expect(save).toBeDisabled();
        const initial = JSON.parse(await readFile(filePath, "utf8"));
        expect(initial.integrations.lightspeed.settings).toEqual({ domainPrefix: "my-store" });
        expect(initial.integrations.lightspeed.scopes).toEqual(["retailer:read", "outlets:read", "registers:read", "payment_types:read", "products:read", "products:read:price_books", "inventory:read", "customers:read", "sales:read", "fulfillments:read", "promotions:read", "gift_cards:read", "store_credits:read", "suppliers:read", "taxes:read", "users:read"]);
        expect(initial.registrations.lightspeed).toEqual({ source: "own", clientId: "assigned-lightspeed-client", clientSecretRef: "env:LIGHTSPEED_SECRET", callbackUrlRef: "env:LIGHTSPEED_CALLBACK" });
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Retail connection");
        await prefix.fill("next-store");
        await panel.getByRole("checkbox", { name: "Read customers", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Edit customers", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.lightspeed.accountMode).toBe("per-user");
        expect(file.integrations.lightspeed.settings).toEqual({ domainPrefix: "next-store" });
        expect(file.integrations.lightspeed.scopes).toEqual([...initial.integrations.lightspeed.scopes.filter((scope) => scope !== "customers:read"), "customers:write"]);
        expect(file.registrations.lightspeed).toEqual(initial.registrations.lightspeed); expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Retail connection", { exact: true }).click();
        await expect(client).toHaveValue("assigned-lightspeed-client"); await expect(secret).toHaveValue("env:LIGHTSPEED_SECRET");
        await expect(callback).toHaveValue("env:LIGHTSPEED_CALLBACK"); await expect(owner).toHaveValue("Each app user's own account"); await expect(prefix).toHaveValue("next-store");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read customers", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Edit customers", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Lightspeed", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://x-series-api.lightspeedhq.com/docs/authorization");
        await expect(panel.getByText(/This connector is Retail X-Series only/)).toBeVisible();
        await expect(panel.getByText(/Select inventory:read to read stock and sales:read/)).toBeVisible();
        await expect(panel.getByText(/Customer\/product edits, stock adjustments, sale\/payment writes/)).toBeVisible();
        await owner.press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("button", { name: "Cancel connection", exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();

      }
      if (providerBatch === "confidence") {
        for (const provider of [{ id: "confidence-flags", name: "Confidence Flags", binding: "FLAGS" }, { id: "confidence-exp", name: "Confidence Exp", binding: "EXP" }]) {
          await addIntegration(panel, provider.name);
          const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
          const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
          const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
          const save = panel.getByRole("button", { name: "Save configuration" });
          await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
          const assignedClient = `assigned-${provider.id}`;
          await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill(`https://app.example/integrations/${provider.id}/callback`);
          await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
          await expect(client).toHaveValue(assignedClient);
          expect(registrationPosts.at(-1)).toBe("https://mcp.confidence.dev/register");
          expect(registrationPosts).toHaveLength(provider.id === "confidence-flags" ? 1 : 2);
          expect(await readFile(filePath, "utf8")).not.toContain("private-confidence-browser-fixture");
          await secret.fill("raw-secret-do-not-save"); await save.click();
          await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
          expect(await readFile(filePath, "utf8")).not.toContain("raw-secret-do-not-save");
          const secretRef = `env:CONFIDENCE_${provider.binding}_CLIENT_SECRET`;
          const callbackRef = `env:CONFIDENCE_${provider.binding}_CALLBACK_URL`;
          await secret.fill(secretRef); await callback.fill(callbackRef);
          const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          const identity = panel.getByRole("checkbox", { name: "Identify the connected Confidence account", exact: true });
          const profile = panel.getByRole("checkbox", { name: "Read account profile", exact: true });
          const email = panel.getByRole("checkbox", { name: "Read account email", exact: true });
          const refresh = panel.getByRole("checkbox", { name: "Refresh access without repeating sign-in", exact: true });
          for (const checkbox of [identity, profile, email, refresh]) await expect(checkbox).toBeChecked();
          await email.uncheck(); await refresh.uncheck();
          const displayName = `${provider.name} research`;
          await panel.getByRole("textbox", { name: "Display name", exact: true }).fill(displayName);
          await save.click(); await expect(save).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[provider.id].accountMode).toBe("assistant");
          expect(file.integrations[provider.id].scopes).toEqual(["openid", "profile"]);
          expect(file.registrations[provider.id]).toEqual({ source: "own", clientId: assignedClient, clientSecretRef: secretRef, callbackUrlRef: callbackRef });
          expect(file.extensions).toEqual(saved.extensions);
          if (provider.id === "confidence-exp") expect(file.registrations["confidence-flags"].clientSecretRef).toBe("env:CONFIDENCE_FLAGS_CLIENT_SECRET");
          await page.reload(); if (viewport.name !== "expanded") await showProject.click();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(displayName, { exact: true }).click();
          await expect(client).toHaveValue(assignedClient); await expect(secret).toHaveValue(secretRef); await expect(callback).toHaveValue(callbackRef);
          if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
          await expect(identity).toBeChecked(); await expect(profile).toBeChecked(); await expect(email).not.toBeChecked(); await expect(refresh).not.toBeChecked();
          const setup = panel.getByRole("button", { name: `Set up ${provider.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://confidence.spotify.com/docs/sdks/mcp-servers");
          await expect(panel.getByText(provider.id === "confidence-flags" ? /Flag creation, variants, schema changes and targeting rules/ : /positive effect estimate alone is not a winning experiment/)).toBeVisible();
          await expect(panel.getByText("Verification only lists tools. The host must authorize each tool and its arguments; identity scopes do not limit calls to reads.", { exact: true })).toBeVisible();
        }
      }
      if (providerBatch === "hex") {
        await addIntegration(panel, "Hex");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const endpoint = panel.getByRole("combobox", { name: "Hex workspace endpoint", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await expect(endpoint).toHaveValue("Standard (app.hex.tech)");
        await client.fill("assigned-hex-client");
        await secret.fill("raw-secret-do-not-save"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-secret-do-not-save");
        await secret.fill("env:HEX_CLIENT_SECRET");
        await callback.fill("https://callback.example/hex"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.hex).toBeUndefined();
        await callback.fill("env:HEX_CALLBACK_URL");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        const labels = ["Identify the connected Hex account", "Read account profile", "Read account email", "Refresh access without repeating sign-in"];
        for (const label of labels) await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        await panel.getByRole("checkbox", { name: "Read account email", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Refresh access without repeating sign-in", exact: true }).uncheck();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Data assistant");
        for (const [value, title] of [["eu", "Europe (eu.hex.tech)"], ["hipaa", "HIPAA (hc.hex.tech)"], ["standard", "Standard (app.hex.tech)"]]) {
          await endpoint.focus(); await endpoint.press("ArrowDown");
          await page.getByRole("option", { name: title, exact: true }).click();
          await save.click(); await expect(save).toBeDisabled();
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations.hex.settings).toEqual({ endpoint: value });
        }
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.hex.accountMode).toBe("assistant");
        expect(file.integrations.hex.scopes).toEqual(["openid", "profile"]);
        expect(file.registrations.hex).toEqual({ source: "own", clientId: "assigned-hex-client", clientSecretRef: "env:HEX_CLIENT_SECRET", callbackUrlRef: "env:HEX_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Data assistant", { exact: true }).click();
        await expect(endpoint).toHaveValue("Standard (app.hex.tech)");
        await expect(client).toHaveValue("assigned-hex-client");
        await expect(secret).toHaveValue("env:HEX_CLIENT_SECRET");
        await expect(callback).toHaveValue("env:HEX_CALLBACK_URL");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        for (const label of labels.slice(0, 2)) await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        for (const label of labels.slice(2)) await expect(panel.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Hex", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://learn.hex.tech/docs/api-integrations/mcp-server");
        await expect(panel.getByText(/Choose Register client and connect to create the client for this endpoint/)).toBeVisible();
        await expect(panel.getByText(/Thread tools can run analysis and consume credits/)).toBeVisible();
        await client.fill("");
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill("https://app.example/integrations/hex/callback");
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        await expect(client).toHaveValue("assigned-hex-client");
        expect(registrationPosts).toEqual(["https://auth.app.hex.tech/oauth2/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect(await readFile(filePath, "utf8")).not.toContain("private-hex-browser-fixture");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();

      }
      if (providerBatch === "amplitude") {
        await addIntegration(panel, "Amplitude");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const region = panel.getByRole("combobox", { name: "Region", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(panel.getByRole("combobox", { name: "Account used by the application", exact: true })).toHaveValue("Assistant access");
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill("https://app.example/integrations/amplitude/callback");
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        await expect(client).toHaveValue("assigned-amplitude-client");
        expect(registrationPosts).toEqual(["https://mcp.amplitude.com/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect(await readFile(filePath, "utf8")).not.toContain("private-amplitude-browser-fixture");
        await expect(panel.getByRole("region", { name: "Amplitude client registration", exact: true })).toHaveCount(0);
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
        if (viewport.name !== "expanded") await showProject.click();
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
        await addIntegration(panel, "Inngest");
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
        const eventCredential = panel.getByRole("region", { name: "Inngest Event Key", exact: true });
        await expect(eventCredential.getByRole("link", { name: "Set credential in Env", exact: true })).toHaveAttribute("href", /prefillKey=INNGEST_EVENT_KEY&prefillSecret=true/);
        await expect(panel.getByText(/Under Inngest Event Key, choose Set credential in Env/)).toBeVisible();
        await expect(panel.getByText(/Apps > Sync App or Sync New App/)).toBeVisible();
        await expect(panel.getByText(/Override for a changed URL and retain the same app ID/)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await branch.fill("");
        await save.click();
        await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.inngest.settings).toEqual({ eventKeyRef: "env:INNGEST_EVENT_KEY" });
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Inngest", { exact: true }).click();
        await expect(branch).toHaveValue("");
      }
      if (providerBatch === "sanity") {
        await addIntegration(panel, "Sanity");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const callback = "https://app.example/integrations/sanity/callback";
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill(callback);
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        await expect(client).toHaveValue("assigned-sanity-client");
        expect(registrationPosts).toEqual(["https://mcp.sanity.io/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect((registrationEnv[0] as { values: unknown }).values).toEqual({
          SANITY_CLIENT_SECRET: { value: "private-sanity-browser-fixture", secret: true },
          SANITY_CALLBACK_URL: { value: callback, secret: false },
          SANITY_CLIENT_ID: { value: "assigned-sanity-client", secret: false }
        });
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.sanity.accountMode).toBe("assistant");
        expect(file.integrations.sanity.scopes).toEqual(["global"]);
        expect(file.registrations.sanity).toEqual({ source: "own", clientId: "assigned-sanity-client",
          clientSecretRef: "env:SANITY_CLIENT_SECRET", callbackUrlRef: "env:SANITY_CALLBACK_URL" });
        expect(JSON.stringify(file)).not.toContain("private-sanity-browser-fixture");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.sanity = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Sanity", { exact: true }).click();
        await expect(client).toHaveValue("assigned-sanity-client");
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        const setup = panel.getByRole("button", { name: "Set up Sanity", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.sanity.io/docs/ai/mcp-server");
        await expect(panel.getByText(/For API key authentication instead/)).toBeVisible();
        await expect(panel.getByText(/The editor coding-assistant attachment is deferred/)).toBeVisible();
      }
      if (providerBatch === "sentry") {
        await addIntegration(panel, "Sentry");
        await panel.getByRole("textbox", { name: "Sentry organization slug", exact: true }).fill("example");
        await panel.getByRole("textbox", { name: "Sentry project slug (optional)", exact: true }).fill("web-app");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const callback = "https://app.example/integrations/sentry/callback";
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill(callback);
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        await expect(client).toHaveValue("assigned-sentry-client");
        expect(registrationPosts).toEqual(["https://mcp.sentry.dev/oauth/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect((registrationEnv[0] as { values: unknown }).values).toEqual({
          SENTRY_CLIENT_SECRET: { value: "private-sentry-browser-fixture", secret: true },
          SENTRY_CALLBACK_URL: { value: callback, secret: false },
          SENTRY_CLIENT_ID: { value: "assigned-sentry-client", secret: false }
        });
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.sentry.settings).toEqual({ organizationSlug: "example", projectSlug: "web-app" });
        expect(file.integrations.sentry.accountMode).toBe("assistant");
        expect(file.integrations.sentry.scopes).toEqual(["org:read"]);
        expect(file.registrations.sentry).toEqual({ source: "own", clientId: "assigned-sentry-client",
          clientSecretRef: "env:SENTRY_CLIENT_SECRET", callbackUrlRef: "env:SENTRY_CALLBACK_URL" });
        expect(JSON.stringify(file)).not.toContain("private-sentry-browser-fixture");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.sentry = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Sentry", { exact: true }).click();
        await expect(client).toHaveValue("assigned-sentry-client");
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        const setup = panel.getByRole("button", { name: "Set up Sentry", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://mcp.sentry.dev/");
        await expect(panel.getByText(/This is assistant context, not application login/)).toBeVisible();
        await expect(panel.getByText(/Editor coding-assistant attachment is deferred/)).toBeVisible();
      }
      if (["mcp", "n8n"].includes(providerBatch)) {
        for (const provider of [
          { id: "n8n", name: "n8n", label: "MCP access token reference", setupUrl: "https://docs.n8n.io/connect/connect-to-n8n-mcp-server" },
          { id: "sanity", name: "Sanity", label: "MCP API token reference", setupUrl: "https://www.sanity.io/docs/ai/mcp-server" }
        ].filter((provider) => providerBatch === "mcp" || provider.id === "n8n")) {
          await addIntegration(panel, provider.name);
          if (provider.id === "sanity") {
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toBeVisible();
            await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
            await page.getByRole("option", { name: "API key", exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
            await expect(panel.getByRole("button", { name: "Register client and connect", exact: true })).toHaveCount(0);
          }
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
          if (provider.id === "n8n") await expect(panel.getByText(/LIMITATIONS: Automatic Vibe64 coding-chat attachment is deferred/)).toBeVisible();
        }
      }
      if (providerBatch === "wordpress-com") {
        await addIntegration(panel, "WordPress.com");
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
        const connection = panel.getByRole("region", { name: "Application connection" });
        setupIssues["wordpress-com"] = "callback-invalid";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Set a valid application callback URL in Env", { exact: false })).toBeVisible();
        delete setupIssues["wordpress-com"];
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveAttribute("href", "https://accounts.example/consent");
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses["wordpress-com"] = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["wordpress-com"].scopes).toEqual(["users", "sites", "stats"]);
        expect(file.registrations["wordpress-com"]).toEqual({ source: "own", clientId: "12345", clientSecretRef: "env:WORDPRESS_COM_CLIENT_SECRET", callbackUrlRef: "env:WORDPRESS_COM_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
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
        await expect(panel.getByText(/open My Apps and choose Create New Application/)).toBeVisible();
        await expect(panel.getByText(/exact backend Redirect URL/)).toBeVisible();
        await expect(panel.getByText(/Reconnect after adding permissions/)).toBeVisible();
        await expect(panel.getByText(/Media deletion is permanent/)).toBeVisible();
        await expect(panel.getByText(/It does not create an application login/)).toBeVisible();
      }
      if (providerBatch === "zoho-books") {
        await addIntegration(panel, "Zoho Books");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const region = panel.getByRole("combobox", { name: "Data center", exact: true });
        const organization = panel.getByRole("textbox", { name: "Organization ID (optional)", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(region).toHaveValue("Europe (.eu)"); await expect(organization).toHaveValue("");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["zoho-books"]).toBeUndefined();
        await client.fill("1000.assigned-books-client"); await secret.fill("raw-zoho-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:BOOKS_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:BOOKS_CALLBACK");
        await organization.fill("invalid-org"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use an organisation ID containing digits only.", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["zoho-books"]).toBeUndefined();
        await organization.fill("");
        await panel.getByText("Europe (.eu)", { exact: true }).click();
        for (const label of ["United States (.com)", "Europe (.eu)", "India (.in)", "Australia (.com.au)", "Japan (.jp)", "Canada (.ca)", "China (.com.cn)", "Saudi Arabia (.sa)"]) {
          await expect(page.getByRole("option", { name: label, exact: true })).toHaveCount(1);
        }
        await page.getByRole("option", { name: "Saudi Arabia (.sa)", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(13);
        for (const label of ["Read organisations and settings", "Read contacts", "Read invoices"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        await expect(panel.getByRole("checkbox", { name: "Full access to invoices", exact: true })).not.toBeChecked();
        await save.click(); await expect(save).toBeDisabled();
        const initial = JSON.parse(await readFile(filePath, "utf8"));
        expect(initial.integrations["zoho-books"].settings).toEqual({ region: "sa" });
        expect(initial.registrations["zoho-books"]).toEqual({ source: "own", clientId: "1000.assigned-books-client", clientSecretRef: "env:BOOKS_SECRET", callbackUrlRef: "env:BOOKS_CALLBACK" });
        await organization.fill("10234695");
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Personal accounting");
        await panel.getByRole("checkbox", { name: "Read invoices", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Full access to invoices", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["zoho-books"].settings).toEqual({ region: "sa", organizationId: "10234695" });
        expect(file.integrations["zoho-books"].scopes).toEqual(["ZohoBooks.settings.READ", "ZohoBooks.contacts.READ", "ZohoBooks.invoices.ALL"]);
        expect(file.integrations["zoho-books"].accountMode).toBe("per-user"); expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Personal accounting", { exact: true }).click();
        await expect(client).toHaveValue("1000.assigned-books-client"); await expect(secret).toHaveValue("env:BOOKS_SECRET"); await expect(callback).toHaveValue("env:BOOKS_CALLBACK");
        await expect(region).toHaveValue("Saudi Arabia (.sa)"); await expect(organization).toHaveValue("10234695"); await expect(owner).toHaveValue("Each app user's own account");
        await organization.fill(""); await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8")); expect(file.integrations["zoho-books"].settings).toEqual({ region: "sa" });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read invoices", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Full access to invoices", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Zoho Books", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.zoho.com/books/api/v3/oauth/");
      }
      if (providerBatch === "zoho-crm") {
        await addIntegration(panel, "Zoho CRM");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const region = panel.getByRole("combobox", { name: "Data center", exact: true });
        const environment = panel.getByRole("combobox", { name: "CRM environment", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await expect(region).toHaveValue("United States (.com)"); await expect(environment).toHaveValue("Production");
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["zoho-crm"]).toBeUndefined();
        await client.fill("1000.assigned-client"); await secret.fill("raw-zoho-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await secret.fill("env:ZOHO_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:ZOHO_CALLBACK");
        await panel.getByText("United States (.com)", { exact: true }).click();
        for (const label of ["United States (.com)", "Europe (.eu)", "India (.in)", "Australia (.com.au)", "Japan (.jp)", "Canada (.ca)", "China (.com.cn)"]) {
          await expect(page.getByRole("option", { name: label, exact: true })).toHaveCount(1);
        }
        await page.getByRole("option", { name: "Canada (.ca)", exact: true }).click();
        await panel.getByText("Production", { exact: true }).click();
        await page.getByRole("option", { name: "Sandbox", exact: true }).click();
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(12);
        for (const label of ["Read the connected CRM user", "Read leads", "Read contacts", "Read accounts", "Read deals"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        await expect(panel.getByRole("checkbox", { name: "Full access to all CRM modules", exact: true })).not.toBeChecked();
        await save.click(); await expect(save).toBeDisabled();
        const initial = JSON.parse(await readFile(filePath, "utf8"));
        expect(initial.integrations["zoho-crm"].settings).toEqual({ region: "ca", environment: "sandbox" });
        expect(initial.registrations["zoho-crm"]).toEqual({ source: "own", clientId: "1000.assigned-client", clientSecretRef: "env:ZOHO_SECRET", callbackUrlRef: "env:ZOHO_CALLBACK" });
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Personal CRM");
        await panel.getByRole("checkbox", { name: "Read leads", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Full lead access", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["zoho-crm"].scopes).toEqual(["ZohoCRM.users.READ", "ZohoCRM.modules.contacts.READ", "ZohoCRM.modules.accounts.READ", "ZohoCRM.modules.deals.READ", "ZohoCRM.modules.leads.ALL"]);
        expect(file.integrations["zoho-crm"].accountMode).toBe("per-user"); expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Personal CRM", { exact: true }).click();
        await expect(client).toHaveValue("1000.assigned-client"); await expect(secret).toHaveValue("env:ZOHO_SECRET"); await expect(callback).toHaveValue("env:ZOHO_CALLBACK");
        await expect(region).toHaveValue("Canada (.ca)"); await expect(environment).toHaveValue("Sandbox"); await expect(owner).toHaveValue("Each app user's own account");
        await panel.getByText("Sandbox", { exact: true }).click(); await page.getByRole("option", { name: "Developer", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled(); file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["zoho-crm"].settings).toEqual({ region: "ca", environment: "developer" });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read leads", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Full lead access", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Zoho CRM", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://www.zoho.com/crm/developer/docs/api/v8/register-client.html");
      }
      if (providerBatch === "wave") {
        await addIntegration(panel, "Wave");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await save.click(); await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.wave).toBeUndefined();
        await client.fill("assigned-wave-client"); await secret.fill("raw-wave-secret"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-wave-secret");
        await secret.fill("env:WAVE_SECRET"); await callback.fill("https://literal.example.test/callback"); await save.click();
        await expect(panel.locator(".v-input--error").getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        await callback.fill("env:WAVE_CALLBACK");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox")).toHaveCount(32);
        for (const label of ["Read the connected user's profile", "Read businesses", "Read customers", "Read invoices"]) {
          await expect(panel.getByRole("checkbox", { name: label, exact: true })).toBeChecked();
        }
        await expect(panel.getByRole("checkbox", { name: "Full customer access", exact: true })).not.toBeChecked();
        await save.click(); await expect(save).toBeDisabled();
        const initial = JSON.parse(await readFile(filePath, "utf8"));
        expect(initial.integrations.wave.scopes).toEqual(["user:read", "business:read", "customer:read", "invoice:read"]);
        expect(initial.registrations.wave).toEqual({ source: "own", clientId: "assigned-wave-client", clientSecretRef: "env:WAVE_SECRET", callbackUrlRef: "env:WAVE_CALLBACK" });
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Personal accounting");
        await panel.getByRole("checkbox", { name: "Read customers", exact: true }).uncheck();
        await panel.getByRole("checkbox", { name: "Full customer access", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.wave).toEqual({ provider: "wave", displayName: "Personal accounting", accountMode: "per-user", authentication: { method: "oauth2", registrationRef: "wave" }, scopes: ["user:read", "business:read", "invoice:read", "customer:*"] });
        expect(file.registrations.wave).toEqual(initial.registrations.wave); expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Personal accounting", { exact: true }).click();
        await expect(client).toHaveValue("assigned-wave-client"); await expect(secret).toHaveValue("env:WAVE_SECRET");
        await expect(callback).toHaveValue("env:WAVE_CALLBACK"); await expect(owner).toHaveValue("Each app user's own account");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read customers", exact: true })).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Full customer access", exact: true })).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Wave", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developer.waveapps.com/hc/en-us/articles/50682251860884-2-Create-an-application");
        await expect(panel.getByText("Wave OAuth access requires an active Pro or Wave Advisor business subscription. Integrations for other Wave users require Wave approval.", { exact: true })).toBeVisible();
        for (const phrase of [
          /Sign in to Wave, open Manage applications/, /Use this project's deployed application URL/,
          /Copy the issued Client ID into Client ID/, /Put the same registered callback URL/,
          /Keep profile and business read access/, /Product writes that reference accounts or taxes/,
          /Save the configuration, then use the project's Connect action/, /Reconnect after changing permissions/,
          /Disconnect currently deletes the local connection/
        ]) await expect(panel.getByText(phrase)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        await expect(panel.getByText("Each user connects in your application's own account screen.", { exact: true })).toBeVisible();
        const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
        if (await dismiss.isVisible()) await dismiss.click();
        await owner.press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        if (await dismiss.isVisible()) await dismiss.click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.wave = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "granola") {
        await addIntegration(panel, "Granola");
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        for (const invalid of ["", "grn_raw-key", "https://example.test/key"]) {
          await key.fill(invalid); await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(1);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations.granola).toBeUndefined();
        }
        await key.fill("env:GRANOLA_KEY");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.granola).toEqual({ provider: "granola", displayName: "Granola", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:GRANOLA_KEY" } });
        expect(file.registrations.granola).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Meeting research");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.granola.accountMode).toBe("assistant");
        expect(file.integrations.granola.displayName).toBe("Meeting research");
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Meeting research", { exact: true }).click();
        await expect(key).toHaveValue("env:GRANOLA_KEY"); await expect(owner).toHaveValue("Assistant access");
        const setup = panel.getByRole("button", { name: "Set up Granola", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.granola.ai/help-center/sharing/integrations/granola-api");
        await expect(panel.getByText(/Enter env:GRANOLA_API_KEY in API key reference/)).toBeVisible();
        await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
        await page.getByRole("option", { name: "OAuth", exact: true }).click();
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill("https://app.example/integrations/granola/callback");
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        await expect(client).toHaveValue("assigned-granola-client");
        expect(registrationPosts).toEqual(["https://mcp-auth.granola.ai/oauth2/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect(JSON.stringify(registrationEnv)).toContain("private-granola-browser-fixture");
        expect(await readFile(filePath, "utf8")).not.toContain("private-granola-browser-fixture");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Meeting research", { exact: true }).click();
        await expect(client).toHaveValue("assigned-granola-client");
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.granola.ai/help-center/sharing/integrations/mcp");
        await expect(panel.getByText(/Choose Register client and connect to create the client/)).toBeVisible();
      }
      if (providerBatch === "linear") {
        await addIntegration(panel, "Linear");
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        await key.fill("raw-linear-token"); await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-linear-token");
        await key.fill("env:HUBSPOT_API_KEY");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read your account", exact: true })).toBeChecked();
        await panel.getByRole("checkbox", { name: "Write on your behalf", exact: true }).check();
        await save.click(); await expect(save).toBeDisabled();
        const setup = panel.getByRole("button", { name: "Set up Linear", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Personal API keys/)).toBeVisible();
        await expect(panel.getByText(/saved connection alone does not let the coding chat edit an issue/)).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.linear.scopes).toContain("write");
        await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
        await page.getByRole("option", { name: "OAuth", exact: true }).click();
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("linear-project-client");
        await panel.getByRole("textbox", { name: "Client secret reference", exact: true }).fill("env:HUBSPOT_SECRET");
        await panel.getByRole("textbox", { name: "Callback URL reference", exact: true }).fill("env:HUBSPOT_CALLBACK");
        await panel.getByRole("combobox", { name: "Account used by the application", exact: true }).press("Enter");
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.linear.accountMode).toBe("per-user");
        expect(file.registrations.linear.clientId).toBe("linear-project-client");
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Linear", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("linear-project-client");
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Settings > Administration > API and create an OAuth application/)).toBeVisible();
        await expect(panel.getByText(/Your app owns tool approval and must check isError/)).toBeVisible();
        await expect(panel.getByText("Configuration matches integrations.json. Account access is verified by your application when a user connects.", { exact: true })).toBeVisible();
        await panel.getByRole("combobox", { name: "Account used by the application", exact: true }).press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "hubspot") {
        await addIntegration(panel, "HubSpot");
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        await key.fill("raw-hubspot-token"); await save.click();
        await expect(panel.getByText("Use a reference such as env:VARIABLE_NAME.", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("raw-hubspot-token");
        await key.fill("env:HUBSPOT_API_KEY");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read CRM contacts", exact: true })).toBeChecked();
        for (const name of ["Create and update CRM contacts", "Read deals and pipelines", "Create and update CRM deals"]) {
          await expect(panel.getByRole("checkbox", { name, exact: true })).not.toBeChecked();
          await panel.getByRole("checkbox", { name, exact: true }).check();
        }
        await save.click(); await expect(save).toBeDisabled();
        const setup = panel.getByRole("button", { name: "Set up HubSpot", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Development > Legacy apps > Create legacy app > Private/)).toBeVisible();
        await expect(panel.getByText(/Use internal property, pipeline and stage IDs/)).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.hubspot.scopes).toContain("crm.objects.deals.write");
        await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
        await page.getByRole("option", { name: "OAuth", exact: true }).click();
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("hubspot-project-client");
        await panel.getByRole("textbox", { name: "Client secret reference", exact: true }).fill("env:HUBSPOT_SECRET");
        await panel.getByRole("textbox", { name: "Callback URL reference", exact: true }).fill("env:HUBSPOT_CALLBACK");
        await panel.getByRole("combobox", { name: "Account used by the application", exact: true }).press("Enter");
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.hubspot.accountMode).toBe("per-user");
        expect(file.registrations.hubspot.clientId).toBe("hubspot-project-client");
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("HubSpot", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("hubspot-project-client");
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/Under Project Components, select the app, then Auth > Client credentials/)).toBeVisible();
        await expect(panel.getByText(/HubSpot installation normally grants account-level CRM access/)).toBeVisible();
        await expect(panel.getByText("Configuration matches integrations.json. Account access is verified by your application when a user connects.", { exact: true })).toBeVisible();
        await panel.getByRole("combobox", { name: "Account used by the application", exact: true }).press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click(); await expect(save).toBeDisabled();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "heygen") {
        await addIntegration(panel, "HeyGen");
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        for (const invalid of ["", "grn_raw-key", "https://example.test/key"]) {
          await key.fill(invalid); await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(1);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations.heygen).toBeUndefined();
        }
        await key.fill("env:HEYGEN_KEY");
        await save.click(); await expect(save).toBeDisabled();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.heygen).toEqual({ provider: "heygen", displayName: "HeyGen", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:HEYGEN_KEY" } });
        expect(file.registrations.heygen).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Video creation");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.heygen.accountMode).toBe("assistant");
        expect(file.integrations.heygen.displayName).toBe("Video creation");
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Video creation", { exact: true }).click();
        await expect(key).toHaveValue("env:HEYGEN_KEY"); await expect(owner).toHaveValue("Assistant access");
        const setup = panel.getByRole("button", { name: "Set up HeyGen", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developers.heygen.com/docs/api-key");
        await expect(panel.getByText(/Enter env:HEYGEN_API_KEY in API key reference/)).toBeVisible();
        await panel.getByRole("combobox", { name: "Authentication", exact: true }).press("Enter");
        await page.getByRole("option", { name: "OAuth", exact: true }).click();
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill("https://app.example/integrations/heygen/callback");
        await panel.getByRole("button", { name: "Register client and connect", exact: true }).click();
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        await expect(client).toHaveValue("assigned-heygen-client");
        expect(registrationPosts).toEqual(["https://api2.heygen.com/v1/oauth/register"]);
        expect(registrationEnv).toHaveLength(1);
        expect(JSON.stringify(registrationEnv)).toContain("private-heygen-browser-fixture");
        expect(await readFile(filePath, "utf8")).not.toContain("private-heygen-browser-fixture");
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Video creation", { exact: true }).click();
        await expect(client).toHaveValue("assigned-heygen-client");
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developers.heygen.com/mcp/overview");
        await expect(panel.getByText(/Choose Register client and connect to create the client/)).toBeVisible();
      }
      if (providerBatch === "telegram") {
        await addIntegration(panel, "Telegram");
        const key = panel.getByRole("textbox", { name: "Bot token reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await key.fill("raw-telegram-key"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(await readFile(filePath, "utf8")).not.toContain("raw-telegram-key");
        await key.fill("env:TELEGRAM_BOT_TOKEN"); await save.click(); await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.telegram.authentication).toEqual({ method: "api-key", secretRef: "env:TELEGRAM_BOT_TOKEN" });
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Verify again", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        connectionStatuses.telegram = "reconnect-required";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Telegram", { exact: true }).click();
        await expect(key).toHaveValue("env:TELEGRAM_BOT_TOKEN");
        const setup = panel.getByRole("button", { name: "Set up Telegram", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://core.telegram.org/bots/tutorial");
        await expect(panel.getByText(/open the verified BotFather account and send/)).toBeVisible();
        await expect(panel.getByText(/Use one app worker and save update offsets/)).toBeVisible();
        await expect(panel.getByText(/Bot permissions and privacy settings control available messages/)).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).extensions).toEqual(saved.extensions);
      }
      if (providerBatch === "tally") {
        await addIntegration(panel, "Tally");
        const key = panel.getByRole("textbox", { name: "API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration", exact: true });
        await key.fill("raw-tally-key"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(await readFile(filePath, "utf8")).not.toContain("raw-tally-key");
        await key.fill("env:TALLY_API_KEY"); await save.click(); await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.tally.authentication).toEqual({ method: "api-key", secretRef: "env:TALLY_API_KEY" });
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Verify again", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        connectionStatuses.tally = "reconnect-required";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Tally", { exact: true }).click();
        await expect(key).toHaveValue("env:TALLY_API_KEY");
        const setup = panel.getByRole("button", { name: "Set up Tally", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developers.tally.so/api-reference/api-keys");
        await expect(panel.getByText(/Open Tally Settings, then API keys and Create API key/)).toBeVisible();
        await expect(panel.getByText(/Creating forms defaults to draft/)).toBeVisible();
        await expect(panel.getByText(/Submission reads default to completed responses/)).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).extensions).toEqual(saved.extensions);
      }
      if (providerBatch === "x-twitter") {
        await addIntegration(panel, "X (Twitter)");
        const key = panel.getByRole("textbox", { name: "App-only bearer token reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(key).toBeVisible();
        await expect(panel.getByText("Reference the app-only Bearer Token from X Developer Console. This token does not sign in an app user.", { exact: true })).toBeVisible();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("textbox", { name: "Callback URL reference", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Permissions", exact: true })).toHaveCount(0);
        for (const invalid of ["", "raw-app-token", "https://example.test/key"]) {
          await key.fill(invalid); await save.click();
          await expect(panel.locator(".v-input--error")).toHaveCount(1);
          expect(JSON.parse(await readFile(filePath, "utf8")).integrations["x-twitter"]).toBeUndefined();
        }
        await key.fill("env:X_APP_BEARER_TOKEN");
        await save.click(); await expect(save).toBeDisabled();
        const connection = panel.getByRole("region", { name: "Application connection" });
        const username = connection.getByRole("textbox", { name: "Verification username", exact: true });
        const connect = connection.getByRole("button", { name: "Connect account", exact: true });
        await expect(connect).toBeDisabled();
        await username.fill("fixture_user");
        await connect.click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        expect(setupRequests.at(-1)).toMatchObject({ operation: "connect", verificationInput: { username: "fixture_user" } });
        expect(await readFile(filePath, "utf8")).not.toContain("fixture_user");
        await connection.getByRole("button", { name: "Verify again", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        connectionStatuses["x-twitter"] = "reconnect-required";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        let file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["x-twitter"]).toEqual({ provider: "x-twitter", displayName: "X (Twitter)", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:X_APP_BEARER_TOKEN" } });
        expect(file.registrations["x-twitter"]).toBeUndefined();
        await panel.getByText("One shared account", { exact: true }).click();
        await expect(page.getByRole("option", { name: "Each app user's own account", exact: true })).toHaveCount(0);
        await page.getByRole("option", { name: "Assistant access", exact: true }).click();
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Public social research");
        await save.click(); await expect(save).toBeDisabled();
        file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations["x-twitter"].accountMode).toBe("assistant");
        expect(file.integrations["x-twitter"].displayName).toBe("Public social research");
        expect(file.extensions).toEqual(saved.extensions);
        expect(file.integrations["google-calendar"].displayName).toBe("After CLI update");
        await page.reload(); if (viewport.name !== "expanded") await showProject.click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Public social research", { exact: true }).click();
        await expect(key).toHaveValue("env:X_APP_BEARER_TOKEN"); await expect(owner).toHaveValue("Assistant access");
        const setup = panel.getByRole("button", { name: "Set up X (Twitter)", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.x.com/x-api/getting-started/getting-access");
        await expect(panel.getByText("This flow has no OAuth callback or per-user consent. It cannot post, read direct messages or provide application login.", { exact: true })).toBeVisible();
        await expect(panel.getByText(/Recent search covers the last seven days/)).toBeVisible();
        await expect(panel.getByText(/Disconnect removes the local connection only/)).toBeVisible();
      }
      if (providerBatch === "semrush") {
        await addIntegration(panel, "Semrush");
        const key = panel.getByRole("textbox", { name: "V4 API key reference", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        await expect(key).toBeVisible();
        await expect(panel.getByText("Use a new Semrush V4 key: Read-only for reports and project reads, Read and write for creating, renaming or deleting projects. V3 keys and OAuth tokens are different credentials.", { exact: true })).toBeVisible();
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
        expect(file.integrations.semrush).toEqual({ provider: "semrush", displayName: "Semrush", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:SEMRUSH_V4_KEY" }, settings: {} });
        expect(file.registrations.semrush).toBeUndefined();
        await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        const v3 = panel.getByRole("textbox", { name: "V3 API key reference (optional)", exact: true });
        await v3.fill("raw-v3-secret"); await save.click();
        await expect(panel.locator(".v-input--error")).toHaveCount(1);
        expect(await readFile(filePath, "utf8")).not.toContain("raw-v3-secret");
        await v3.fill("env:SEMRUSH_V3_KEY"); await save.click(); await expect(save).toBeDisabled();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.semrush.settings).toEqual({ v3ApiKeyRef: "env:SEMRUSH_V3_KEY" });
        await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Verify again", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations.semrush.settings).toEqual({ v3ApiKeyRef: "env:SEMRUSH_V3_KEY" });
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
        await expect(v3).toHaveValue("env:SEMRUSH_V3_KEY");
        const setup = panel.getByRole("button", { name: "Set up Semrush", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://developer.semrush.com/api/v4/get-started/quick-start/");
        await expect(panel.getByText(/Keyword metrics and backlink overview/)).toBeVisible();
        await expect(panel.getByText(/Project deletion permanently removes/)).toBeVisible();
        await expect(panel.getByText(/Position tracking uses this V3 key too/)).toBeVisible();
        await expect(panel.getByText("Separate keys on one account share account capacity. This initial runtime does not implement the captured OAuth connection or individual app-user login.", { exact: true })).toBeVisible();
      }
      if (providerBatch === "xero") {
        await addIntegration(panel, "Xero");
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
        for (const guidance of [
          /create an app using the Auth Code grant type/,
          /http:\/\/127\.0\.0\.1 is not accepted/,
          /This provider uses HTTP Basic client authentication/,
          /A connection is not application login/,
          /Read and manage manual journals and reconnect/,
          /Currency comes from the bank account/,
          /Files are limited to 3 MiB by this adapter/,
          /For the budget summary report, separately select/,
          /This records a payment in Xero; it does not charge a customer/,
          /Saving this form writes no accounting records/
        ]) await expect(panel.getByText(guidance)).toBeVisible();

      }
      if (providerBatch === "redshift") {
        await addIntegration(panel, "Amazon Redshift");
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
        await expect(page.getByRole("option", { name: "N. Virginia (us-east-1)", exact: true })).toBeVisible();
        await region.press("o");
        await region.press("s");
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
        await expect(panel.getByText(/ListDatabases, ListSchemas, ListTables, DescribeTable/)).toBeVisible();
        await expect(panel.getByText(/Save the configuration, then use Set credential in Env/)).toBeVisible();
        await expect(panel.getByText(/No OAuth app or callback is needed for this shared mode/)).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        setupIssues["amazon-redshift"] = "credentials-missing";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await expect(connection.getByText("Complete the required provider settings and credentials.", { exact: false })).toBeVisible();
        delete setupIssues["amazon-redshift"];
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveCount(0);
        connectionStatuses["amazon-redshift"] = "reconnect-required";
        await connection.getByRole("button", { name: "Check connection", exact: true }).click();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "slack") {
        await addIntegration(panel, "Slack");
        const client = panel.getByRole("textbox", { name: "Client ID", exact: true });
        const secret = panel.getByRole("textbox", { name: "Client secret reference", exact: true });
        const callback = panel.getByRole("textbox", { name: "Callback URL reference", exact: true });
        const actor = panel.getByRole("combobox", { name: "Act in Slack as", exact: true });
        const owner = panel.getByRole("combobox", { name: "Account used by the application", exact: true });
        const save = panel.getByRole("button", { name: "Save configuration" });
        await client.fill("assigned-slack-client");
        await secret.fill("env:SLACK_SECRET");
        await callback.fill("env:SLACK_CALLBACK");
        const signing = panel.getByRole("textbox", { name: "Signing secret reference (optional)", exact: true });
        await signing.fill("env:SLACK_SIGNING_SECRET");
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
        if (await page.getByRole("button", { name: "Dismiss", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        const bot = JSON.parse(await readFile(filePath, "utf8"));
        expect(bot.integrations.slack).toEqual({ provider: "slack", displayName: "Team Slack", accountMode: "per-user", scopes: ["channels:read", "channels:join"], settings: { actor: "bot", signingSecretRef: "env:SLACK_SIGNING_SECRET" }, authentication: { method: "oauth2", registrationRef: "slack" } });
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
        await expect(signing).toHaveValue("env:SLACK_SIGNING_SECRET");
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(join).toBeChecked();
        await expect(history).not.toBeChecked();
        await panel.getByText("Installed bot", { exact: true }).click();
        await page.getByRole("option", { name: "Connected user", exact: true }).click();
        await expect(panel.getByRole("checkbox")).toHaveCount(52);
        await expect(profile).not.toBeChecked();
        await save.click();
        await expect(save).toBeDisabled();
        if (await page.getByRole("button", { name: "Dismiss", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        const user = JSON.parse(await readFile(filePath, "utf8"));
        expect(user.integrations.slack.settings).toEqual({ actor: "user", signingSecretRef: "env:SLACK_SIGNING_SECRET" });
        expect(user.integrations.slack.scopes).toEqual(["channels:read"]);
        expect(user.registrations.slack).toEqual(bot.registrations.slack);
        const setup = panel.getByRole("button", { name: "Set up Slack", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://docs.slack.dev/authentication/installing-with-oauth/");
              await expect(panel.getByText(/For incoming events, copy Signing Secret/)).toBeVisible();
        await expect(panel.getByText(/The application must verify signed raw request bytes/)).toBeVisible();
        await expect(panel.getByText("Each user connects in your application's own account screen.", { exact: true })).toBeVisible();
        await expect(panel.getByRole("region", { name: "Application connection" }).getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
        if (await dismiss.isVisible()) await dismiss.click();
        await owner.press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        if (await page.getByRole("button", { name: "Dismiss", exact: true }).isVisible()) await page.getByRole("button", { name: "Dismiss", exact: true }).click();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.slack = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "twitch") {
        await addIntegration(panel, "Twitch");
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
        await expect(panel.getByText(/Sign in to dev.twitch.tv\/console/)).toBeVisible();
        await expect(panel.getByText(/A new secret invalidates the previous one/)).toBeVisible();
        await expect(panel.getByText(/Replacing the Client ID does not transfer/)).toBeVisible();
        await expect(panel.getByText(/generated app must maintain a Twitch EventSub WebSocket/)).toBeVisible();
        await expect(panel.getByText(/To revoke provider access, open Twitch Settings/)).toBeVisible();
        await expect(panel.getByRole("checkbox", { name: "Read current hype train status", exact: true })).toBeVisible();
        const connection = panel.getByRole("region", { name: "Application connection" });
        await expect(connection.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        await expect(panel.getByText("Each user connects in your application's own account screen.", { exact: true })).toBeVisible();
        const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
        if (await dismiss.isVisible()) await dismiss.click();
        await owner.press("Enter");
        await page.getByRole("option", { name: "One shared account", exact: true }).click();
        await save.click();
        await expect(save).toBeDisabled();
        if (await dismiss.isVisible()) await dismiss.click();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(connection.getByRole("link", { name: "Continue with provider" })).toBeVisible();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Connect account", exact: true }).click();
        connectionStatuses.twitch = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
        await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
        await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
        await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
      }
      if (providerBatch === "clickhouse") {
        await addIntegration(panel, "ClickHouse");
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
        await expect(panel.getByText(/accepting SQL text is not a sandbox/)).toBeVisible();
        await expect(panel.getByText(/Connect account or Verify again/)).toBeVisible();
      }
      if (providerBatch === "prestashop") {
        await addIntegration(panel, "PrestaShop");
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
      if (["wordpress", "wordpress-self-hosted", "woocommerce"].includes(providerBatch)) {
        page.setDefaultTimeout(10_000);
        for (const provider of [
          { id: "woocommerce", name: "WooCommerce", siteLabel: "Store URL", identityLabel: "Consumer key", identitySetting: "consumerKey",
            identity: "ck_fixture123", invalidIdentity: "not-a-consumer-key", identityError: "Enter the WooCommerce consumer key beginning ck_.",
            secretLabel: "Consumer secret reference", setupUrl: "https://developer.woocommerce.com/docs/apis/rest-api/authentication/" },
          { id: "wordpress-self-hosted", name: "WordPress (self-hosted)", siteLabel: "Site URL", identityLabel: "Username", identitySetting: "username",
            identity: "editor", invalidIdentity: "user:password", identityError: "Enter a username without colons or control characters.",
            secretLabel: "Application password reference", setupUrl: "https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/" }
        ].filter(provider => providerBatch === "wordpress" || provider.id === providerBatch)) {
          await addIntegration(panel, provider.name);
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
          if (viewport.name !== "expanded") await showProject.click();
          await panel.getByRole("list", { name: "Configured integrations" }).getByText(provider.name, { exact: true }).click();
          await expect(site).toHaveValue("https://merchant.example:8443/store/");
          await expect(identity).toHaveValue(provider.identity);
          await expect(secret).toHaveValue(reference);
          const setup = panel.getByRole("button", { name: `Set up ${provider.name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", provider.setupUrl);
          if (provider.id === "wordpress-self-hosted") {
            await expect(panel.getByText(/choose Add New Application Password/)).toBeVisible();
            await expect(panel.getByText(/User creation, role changes and deletion require administrative capabilities/)).toBeVisible();
            await expect(panel.getByText(/Revoke the old password in the user's profile/)).toBeVisible();
            await expect(panel.getByText(/Media and user deletion are permanent/)).toBeVisible();
          }
          if (provider.id === "woocommerce") {
            await expect(panel.getByText(/Read\/Write for product, inventory, customer, coupon or order changes/)).toBeVisible();
            await expect(panel.getByText(/Stock quantities replace the current value/)).toBeVisible();
            await expect(panel.getByText(/Creating an order creates a store record/)).toBeVisible();
            await expect(panel.getByText(/Refund creation requires an explicit choice/)).toBeVisible();
            await expect(panel.getByText(/Reports require reporting permission/)).toBeVisible();
            await expect(panel.getByText(/Customers and variations support only permanent deletion/)).toBeVisible();
            await expect(panel.getByText(/For event notifications, open WooCommerce/)).toBeVisible();
          }
          {
            const connection = panel.getByRole("region", { name: "Application connection" });
            setupIssues[provider.id] = "credentials-missing";
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await expect(connection.getByText("Complete the required provider settings and credentials.", { exact: false })).toBeVisible();
            delete setupIssues[provider.id];
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Verify again", exact: true }).click();
            connectionStatuses[provider.id] = "reconnect-required";
            await connection.getByRole("button", { name: "Check connection", exact: true }).click();
            await expect(connection.getByText("Reconnect required", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Reconnect", exact: true }).click();
            await expect(connection.getByText("Connected", { exact: true })).toBeVisible();
            await expect(connection.getByRole("link", { name: "Continue with provider" })).toHaveCount(0);
            await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
            await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
            expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(file);
          }
        }
      }
      if (providerBatch === "gong") {
        await addIntegration(panel, "Gong");
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
        await expect(panel.getByText(/technical administrator. Open Admin center/)).toBeVisible();
        await expect(panel.getByText(/Call reads require existing recordings/)).toBeVisible();
        await expect(panel.getByText(/Linked deal context comes from the CRM data already connected to Gong/)).toBeVisible();
      }
      if (providerBatch === "oura") {
        await addIntegration(panel, "Oura");
        await expect(panel.getByText("Each app user's own account", { exact: true })).toBeVisible();
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-oura-client");
        const permissions = panel.getByRole("button", { name: "Permissions", exact: true });
        if (await permissions.getAttribute("aria-expanded") !== "true") await permissions.click();
        await expect(panel.getByRole("checkbox", { name: "Read daily sleep, activity and readiness summaries", exact: true })).toBeChecked();
        const personal = panel.getByRole("checkbox", { name: "Read personal profile information", exact: true });
        await expect(personal).not.toBeChecked();
        await expect(panel.getByRole("checkbox", { name: "Read the account email address", exact: true })).not.toBeChecked();
        await personal.check();
        const heartRate = panel.getByRole("checkbox", { name: "Read heart-rate samples", exact: true });
        await expect(heartRate).not.toBeChecked();
        await heartRate.check();
        await panel.getByRole("button", { name: "Save configuration" }).click();
        await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
        const file = JSON.parse(await readFile(filePath, "utf8"));
        expect(file.integrations.oura.accountMode).toBe("per-user");
        expect(file.integrations.oura.scopes).toEqual(["daily", "personal", "heartrate"]);
        expect(file.registrations.oura).toEqual({ source: "own", clientId: "fixture-oura-client", clientSecretRef: "env:OURA_CLIENT_SECRET", callbackUrlRef: "env:OURA_CALLBACK_URL" });
        expect(file.extensions).toEqual(saved.extensions);
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Oura", { exact: true }).click();
        await expect(panel.getByText("Each app user's own account", { exact: true })).toBeVisible();
        await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("fixture-oura-client");
        await permissions.click();
        await expect(personal).toBeChecked();
        await expect(heartRate).toBeChecked();
        const setup = panel.getByRole("button", { name: "Set up Oura", exact: true });
        if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
        await expect(panel.getByText(/LIMITATIONS: no live synchronization/)).toBeVisible();
        await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", "https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API");
        await expect(panel.getByRole("checkbox", { name: "Read the account email address", exact: true })).not.toBeChecked();
      }
      if (providerBatch === "additional-tokens") {
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Fireflies", { exact: true }).click();
        await expect(panel.getByRole("textbox", { name: "API key reference", exact: true })).toHaveValue("env:FIREFLIES_KEY");
      }
      if (["existing", "service-readers", "gmail", "google-docs", "google-drive", "google-search-console", "google-sheets", "google-slides"].includes(providerBatch)) {
        const googleProviders = providerBatch === "google-slides" ? [["Google Slides", "google-slides", "Access files selected for this application", "drive.file"]] : providerBatch === "google-sheets" ? [["Google Sheets", "google-sheets", "Access files selected for this application", "drive.file"]] : providerBatch === "google-search-console" ? [["Google Search Console", "google-search-console", "Read Search Console properties", "webmasters.readonly"]] : providerBatch === "google-drive" ? [["Google Drive", "google-drive", "Manage files selected for this application", "drive.file"]] : providerBatch === "google-docs" ? [["Google Docs", "google-docs", "Access files selected for this application", "drive.file"]] : providerBatch === "gmail" ? [["Gmail", "gmail", "Read messages", "gmail.readonly"]] : providerBatch === "service-readers" ? [
          ["BigQuery", "bigquery", "Manage BigQuery data", "bigquery"]
        ] : [
          ["Gmail", "gmail", "Read messages", "gmail.readonly"],
          ["Google Drive", "google-drive", "Manage files selected for this application", "drive.file"],
          ["Google Sheets", "google-sheets", "Access files selected for this application", "drive.file"],
          ["Google Docs", "google-docs", "Access files selected for this application", "drive.file"],
          ["Google Slides", "google-slides", "Access files selected for this application", "drive.file"],
          ["Google Search Console", "google-search-console", "Read Search Console properties", "webmasters.readonly"]
        ];
        for (const [name, id, permission, scope] of googleProviders) {
          await addIntegration(panel, name);
          await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill(`${id}.apps.googleusercontent.com`);
          if (id === "bigquery") await panel.getByRole("textbox", { name: "Google Cloud project ID", exact: true }).fill("query-project");
          const checkbox = panel.getByRole("checkbox", { name: permission, exact: true });
          if (!await checkbox.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
          await expect(checkbox).toBeChecked();
          await panel.getByRole("button", { name: "Save configuration" }).click();
          await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
          const file = JSON.parse(await readFile(filePath, "utf8"));
          expect(file.integrations[id]).toMatchObject({
            provider: id, scopes: (id === "google-drive" ? ["drive.file", "drive.readonly", "drive.appdata", "drive.appfolder"] : id === "gmail" ? ["gmail.readonly", "gmail.send", "gmail.compose", "gmail.modify"] : [scope]).map((value) => `https://www.googleapis.com/auth/${value}`),
            authentication: { method: "oauth2", registrationRef: id }
          });
          expect(file.registrations[id].clientId).toBe(`${id}.apps.googleusercontent.com`);
          expect(file.extensions).toEqual(saved.extensions);
          const setup = panel.getByRole("button", { name: `Set up ${name}`, exact: true });
          if (await setup.getAttribute("aria-expanded") !== "true") await setup.click();
          await expect(panel.getByRole("link", { name: "Provider setup guide", exact: true })).toHaveAttribute("href", /^https:/);
          if (id === "google-search-console" && providerBatch === "google-search-console") {
            await expect(panel.getByText(/To add a property, open Search Console/)).toBeVisible();
            await expect(panel.getByText(/Search performance uses finalized Pacific-time dates/)).toBeVisible();
            await expect(panel.getByText(/Submission does not create the file, guarantee indexing or change DNS/)).toBeVisible();
            const write = panel.getByRole("checkbox", { name: "Manage Search Console properties", exact: true });
            if (!await write.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
            await write.check();
            await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
            await expect(panel.getByRole("button", { name: "Save configuration", exact: true })).toBeDisabled();
            expect(JSON.parse(await readFile(filePath, "utf8")).integrations[id].scopes).toContain("https://www.googleapis.com/auth/webmasters");
            await page.reload();
            await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Search Console", { exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("google-search-console.apps.googleusercontent.com");
          }
          if (id === "google-drive" && providerBatch === "google-drive") {
            await expect(panel.getByText(/The app can upload files up to 5 MB/)).toBeVisible();
            await expect(panel.getByText(/Use file capabilities and sharing access before offering writes/)).toBeVisible();
            await expect(panel.getByText(/Pasting an existing file ID alone does not grant access/)).toBeVisible();
            await page.reload();
            await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Drive", { exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("google-drive.apps.googleusercontent.com");
          }
          if (id === "google-sheets" && providerBatch === "google-sheets") {
            await expect(panel.getByText(/For create-first access, retain Access files/)).toBeVisible();
            await expect(panel.getByText(/Value writes default to RAW/)).toBeVisible();
            const connection = panel.getByRole("region", { name: "Application connection" });
            await expect(panel.getByRole("textbox", { name: "Spreadsheet ID (optional)", exact: true })).toHaveValue("");
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
            await page.reload();
            await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Sheets", { exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("google-sheets.apps.googleusercontent.com");
          }
          if (id === "google-slides" && providerBatch === "google-slides") {
            await expect(panel.getByText(/For create-first access, retain Access files/)).toBeVisible();
            await expect(panel.getByText(/Create a blank presentation, then use native batch requests/)).toBeVisible();
            const connection = panel.getByRole("region", { name: "Application connection" });
            await expect(panel.getByRole("textbox", { name: "Presentation ID (optional)", exact: true })).toHaveValue("");
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
            await page.reload();
            await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Slides", { exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("google-slides.apps.googleusercontent.com");
          }
          if (id === "google-docs" && providerBatch === "google-docs") {
            await expect(panel.getByText(/For create-first access, retain Access files/)).toBeVisible();
            await expect(panel.getByText(/Create a blank document, then insert content/)).toBeVisible();
            const connection = panel.getByRole("region", { name: "Application connection" });
            await expect(panel.getByRole("textbox", { name: "Document ID (optional)", exact: true })).toHaveValue("");
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
            await page.reload();
            await panel.getByRole("list", { name: "Configured integrations" }).getByText("Google Docs", { exact: true }).click();
            await expect(panel.getByRole("textbox", { name: "Client ID", exact: true })).toHaveValue("google-docs.apps.googleusercontent.com");
          }
          if (id === "gmail" && providerBatch === "gmail") {
            await expect(panel.getByText(/Read messages gives full bodies, search and attachments/)).toBeVisible();
            await expect(panel.getByText(/A send receipt is not proof of delivery/)).toBeVisible();
            await expect(panel.getByText(/Gmail read access is restricted/)).toBeVisible();
            for (const name of ["Send messages", "Manage drafts and send messages", "Read and modify messages"]) await panel.getByRole("checkbox", { name, exact: true }).uncheck();
            await panel.getByRole("button", { name: "Save configuration" }).click();
            await expect(panel.getByRole("button", { name: "Save configuration" })).toBeDisabled();
            expect(JSON.parse(await readFile(filePath, "utf8")).integrations.gmail.scopes).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
            const connection = panel.getByRole("region", { name: "Application connection" });
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            await expect(connection.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Cancel connection", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Connect account", exact: true }).click();
            connectionStatuses.gmail = "connected";
            await page.evaluate(() => window.dispatchEvent(new Event("focus")));
            await expect(connection.getByText("Connected account: business@example.test", { exact: true })).toBeVisible();
            await connection.getByRole("button", { name: "Disconnect", exact: true }).click();
            await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
            await expect(connection.getByText("Not connected", { exact: true })).toBeVisible();
          }
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
      if (["microsoft", "microsoft-excel", "microsoft-onedrive", "microsoft-onenote", "microsoft-outlook", "microsoft-sharepoint", "microsoft-teams"].includes(providerBatch)) {
        for (const [name, id, permission, scope] of [
          ["Microsoft Outlook", "microsoft-outlook", "Read your mail", "Mail.Read"],
          ["Microsoft OneDrive", "microsoft-onedrive", "Read your files", "Files.Read"],
          ["Microsoft Excel", "microsoft-excel", "Read and write your files (required by Excel worksheets)", "Files.ReadWrite"],
          ["Microsoft Teams", "microsoft-teams", "List joined teams", "Team.ReadBasic.All"],
          ["Microsoft OneNote", "microsoft-onenote", "Read your notebooks", "Notes.Read"],
          ["Microsoft SharePoint", "microsoft-sharepoint", "Read items in all site collections", "Sites.Read.All"]
        ].filter(([, id]) => providerBatch === "microsoft" || id === providerBatch)) {
          await addIntegration(panel, name);
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
            provider: id, scopes: id === "microsoft-outlook" ? ["Mail.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "offline_access"] : id === "microsoft-excel" ? ["Files.Read", scope, "offline_access"] : id === "microsoft-onedrive" ? ["Files.Read", "Files.Read.All", "Files.ReadWrite", "offline_access"] : id === "microsoft-onenote" ? ["Notes.Read", "Notes.Read.All", "Notes.ReadWrite.All", "Notes.Create", "Notes.ReadWrite", "offline_access"] : id === "microsoft-sharepoint" ? ["Sites.Read.All", "User.Read", "Sites.ReadWrite.All", "Files.Read.All", "offline_access"] : id === "microsoft-teams" ? ["Team.ReadBasic.All", "Channel.ReadBasic.All", "User.Read", "ChannelMessage.Send", "User.Read.All", "offline_access"] : [scope, "offline_access"], settings: { tenantId }, authentication: { method: "oauth2", registrationRef: id }
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
          if (id === "microsoft-sharepoint") {
            await expect(panel.getByText(/listItems.list returns fields and ETags/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: no site-collection creation/)).toBeVisible();
          }
          if (id === "microsoft-outlook") {
            await expect(panel.getByText(/messages.send needs Mail.Send/)).toBeVisible();
            await expect(panel.getByText(/events.create requires Calendars.ReadWrite/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: no email-client UI/)).toBeVisible();
          }
          if (id === "microsoft-onenote") {
            await expect(panel.getByText(/To create a note, add Notes.Create/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: no rich-text editor/)).toBeVisible();
          }
          if (id === "microsoft-onedrive") {
            await expect(panel.getByText(/files.upload needs Files.ReadWrite/)).toBeVisible();
            await expect(panel.getByText(/short-lived download URL/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: larger\/resumable transfers/)).toBeVisible();
          }
          if (id === "microsoft-excel") {
            await expect(panel.getByText(/ranges.update writes an exactly matching matrix/)).toBeVisible();
            await expect(panel.getByText(/sessions.create requires an explicit persistChanges/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: no workbook creation/)).toBeVisible();
          }
          if (id === "microsoft-teams") {
            await expect(panel.getByText(/requires a work or school account with Teams access/)).toBeVisible();
            await expect(panel.getByText(/Existing chats use chats.list/)).toBeVisible();
            await expect(panel.getByText(/LIMITATIONS: no team\/chat creation/)).toBeVisible();
          }
        }
        await page.reload();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText(providerBatch === "microsoft-teams" ? "Microsoft Teams" : providerBatch === "microsoft-sharepoint" ? "Microsoft SharePoint" : providerBatch === "microsoft-outlook" ? "Microsoft Outlook" : providerBatch === "microsoft-onenote" ? "Microsoft OneNote" : providerBatch === "microsoft-onedrive" ? "Microsoft OneDrive" : "Microsoft Excel", { exact: true }).click();
        const permission = panel.getByRole("checkbox", { name: providerBatch === "microsoft-teams" ? "List joined teams" : providerBatch === "microsoft-sharepoint" ? "Read items in all site collections" : providerBatch === "microsoft-outlook" ? "Read your mail" : providerBatch === "microsoft-onenote" ? "Read your notebooks" : providerBatch === "microsoft-onedrive" ? "Read and write your files" : "Read and write your files (required by Excel worksheets)", exact: true });
        if (!await permission.isVisible()) await panel.getByRole("button", { name: "Permissions", exact: true }).click();
        await expect(permission).toBeChecked();
      }
      if (providerBatch === "microsoft-documents") {
        const tenants = ["11111111-2222-3333-4444-555555555555", "consumers"];
        for (const [index, [name, id]] of [["Microsoft Word", "microsoft-word"], ["Microsoft PowerPoint", "microsoft-powerpoint"]].entries()) {
          await addIntegration(panel, name);
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
      if (providerBatch === "responsive" && viewport.name === "compact") {
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("After CLI update", { exact: true }).click();
        const url = "https://sas-dogandgroom.hosting.vibe64.dev/integrations/google/callback";
        await panel.getByRole("textbox", { name: "Suggested callback URL", exact: true }).fill(url);
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        await expect(panel.getByRole("textbox", { name: "Configured callback URL", exact: true })).toHaveValue("https://previous.example/callback");
        await expect(panel.getByText(/The proposed URL differs from the application's configured callback/)).toBeVisible();
        await panel.getByRole("button", { name: "Copy configured callback URL", exact: true }).click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://previous.example/callback");
        await panel.getByRole("button", { name: "Copy callback URL", exact: true }).click();
        await expect(panel.getByText("Callback URL copied.", { exact: true })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
        const writes: unknown[] = [];
        await routeApiEndpoint(page, "/vibe64/env", (route) => fulfillJson(route, { ok: true, env: { environment: "dev", records: [{
          key: "GOOGLE_CALENDAR_CALLBACK_URL", value: "https://previous.example/callback", valuePresent: true,
          editable: true, secret: false, source: "user"
        }], unavailable: null } }));
        await routeApiEndpoint(page, "/vibe64/env/user-values", async (route) => {
          writes.push(route.request().postDataJSON());
          await fulfillJson(route, { ok: true, env: { environment: "dev", records: [], unavailable: null } });
        });
        await panel.getByRole("link", { name: "Set callback in Env", exact: true }).click();
        const env = page.locator(".env-panel");
        await expect(env.getByRole("textbox", { name: "Key", exact: true })).toHaveValue("GOOGLE_CALENDAR_CALLBACK_URL");
        await expect(env.getByRole("textbox", { name: "Value", exact: true })).toHaveValue(url);
        expect(writes).toEqual([]);
        await expect(env.getByText(/already has a value/)).toBeVisible();
        await env.getByRole("button", { name: "Replace value", exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toMatchObject({ environment: "dev", sessionId: directChatSessionId,
          values: { GOOGLE_CALENDAR_CALLBACK_URL: { value: url, secret: false } } });
        await page.goBack();
        await expect(panel.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("After CLI update");
        const credentialLink = panel.getByRole("link", { name: "Set credential in Env", exact: true });
        await expect(credentialLink).toHaveAttribute("href", /prefillKey=GOOGLE_CALENDAR_CLIENT_SECRET.*prefillSecret=true/);
        await credentialLink.click();
        await expect(env.getByRole("textbox", { name: "Key", exact: true })).toHaveValue("GOOGLE_CALENDAR_CLIENT_SECRET");
        const secretValue = env.getByLabel("Value", { exact: true });
        await expect(secretValue).toHaveValue("");
        await expect(secretValue).toHaveAttribute("type", "password");
        await expect(env.getByRole("checkbox", { name: "Secret", exact: true })).toBeChecked();
        expect(writes).toHaveLength(1);
        await secretValue.fill("fixture-provider-secret");
        await env.getByRole("button", { name: "Add", exact: true }).click();
        await expect.poll(() => writes.length).toBe(2);
        expect(writes[1]).toMatchObject({ environment: "dev", sessionId: directChatSessionId,
          values: { GOOGLE_CALENDAR_CLIENT_SECRET: { value: "fixture-provider-secret", secret: true } } });
        expect(page.url()).not.toContain("fixture-provider-secret");
        expect(await readFile(filePath, "utf8")).not.toContain("fixture-provider-secret");
        await page.goBack();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("Resend", { exact: true }).click();
        await expect(credentialLink).toHaveAttribute("href", /prefillKey=RESEND_KEY.*prefillSecret=true/);
        await credentialLink.click();
        await expect(env.getByRole("textbox", { name: "Key", exact: true })).toHaveValue("RESEND_KEY");
        await expect(secretValue).toHaveValue("");
        await expect(secretValue).toHaveAttribute("type", "password");
        await secretValue.fill("fixture-resend-secret");
        await env.getByRole("button", { name: "Add", exact: true }).click();
        await expect.poll(() => writes.length).toBe(3);
        expect(writes[2]).toMatchObject({ environment: "dev", sessionId: directChatSessionId,
          values: { RESEND_KEY: { value: "fixture-resend-secret", secret: true } } });
        expect(page.url()).not.toContain("fixture-resend-secret");
        expect(await readFile(filePath, "utf8")).not.toContain("fixture-resend-secret");
        await page.getByRole("button", { name: "Integrations", exact: true }).click();
        await panel.getByRole("list", { name: "Configured integrations" }).getByText("After CLI update", { exact: true }).click();
        await panel.getByText("One shared account", { exact: true }).click();
        await page.getByRole("option", { name: "Each app user's own account", exact: true }).click();
        const personalRequest = panel.getByRole("button", { name: "Prepare app user connection request", exact: true });
        await expect(personalRequest).toBeDisabled();
        const requestsBeforePersonalSave = setupRequests.length;
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        await expect(personalRequest).toBeEnabled();
        await expect(panel.getByRole("button", { name: "Connect account", exact: true })).toHaveCount(0);
        await expect(panel.getByRole("button", { name: "Check connection", exact: true })).toHaveCount(0);
        await personalRequest.click();
        const personalDraft = page.getByLabel("Message AI assistant");
        await expect(personalDraft).toBeVisible();
        await expect(personalDraft).toHaveValue(/authenticated app user, isolate their grants/);
        await expect(personalDraft).toHaveValue(/not a shared administrator connection or a new application login method/);
        expect(setupRequests).toHaveLength(requestsBeforePersonalSave);
        expect(JSON.parse(await readFile(filePath, "utf8")).integrations["google-calendar"].accountMode).toBe("per-user");
        await showProject.click();
        await addIntegration(panel, "Google Sheets");
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-sheets-client");
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        const spreadsheet = panel.getByRole("textbox", { name: "Spreadsheet ID (optional)", exact: true });
        await expect(spreadsheet).toBeVisible();
        await expect(panel.getByRole("button", { name: "Connect account", exact: true })).toBeEnabled();
        await spreadsheet.fill("sheet-check-only-123");
        await page.getByRole("button", { name: "Env", exact: true }).click();
        await expect(env).toBeVisible();
        await page.getByRole("button", { name: "Integrations", exact: true }).click();
        await expect(spreadsheet).toHaveValue("sheet-check-only-123");
        await panel.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(panel.getByText("Waiting for provider approval", { exact: true })).toBeVisible();
        expect(setupRequests.at(-1)).toMatchObject({ operation: "connect", verificationInput: { spreadsheetId: "sheet-check-only-123" } });
        expect(await readFile(filePath, "utf8")).not.toContain("sheet-check-only-123");
        expect(writes).toHaveLength(3);
        for (const [name, field, key, value, oauth] of [
          ["Microsoft SharePoint", "Site search", "search", "Verification team", true],
          ["PostHog", "Verification user ID", "distinct_id", "verification-subject", false],
          ["Google Maps Platform", "Verification address", "address", "Verification address fixture", false],
          ["X (Twitter)", "Verification username", "username", "fixture_user", false]
        ] as const) {
          await addIntegration(panel, name);
          if (oauth) await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-client-id");
          if (name === "PostHog") await panel.getByRole("textbox", { name: "Project ID", exact: true }).fill("12345");
          await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
          const input = panel.getByRole("textbox", { name: field, exact: true });
          await expect(input).toBeVisible();
          const connect = panel.getByRole("button", { name: "Connect account", exact: true });
          await expect(connect).toBeDisabled();
          await input.fill(value);
          await connect.click();
          await expect(panel.getByRole("status")).toHaveText(oauth ? "Waiting for provider approval" : "Connected");
          expect(setupRequests.at(-1)).toMatchObject({ operation: "connect", verificationInput: { [key]: value } });
          expect(await readFile(filePath, "utf8")).not.toContain(value);
        }
        await addIntegration(panel, "Gmail");
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-gmail-client");
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        await panel.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(panel.getByRole("status")).toHaveText("Waiting for provider approval");
        connectionStatuses.gmail = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        const accountLabel = panel.getByText("Connected account: business@example.test", { exact: true });
        await expect(accountLabel).toBeVisible();
        await page.getByRole("button", { name: "Env", exact: true }).click();
        await expect(env).toBeVisible();
        await page.getByRole("button", { name: "Integrations", exact: true }).click();
        await expect(accountLabel).toBeVisible();
        await addIntegration(panel, "Gmail");
        await panel.getByRole("textbox", { name: "Display name", exact: true }).fill("Support mailbox");
        await panel.getByRole("textbox", { name: "Client ID", exact: true }).fill("fixture-second-gmail-client");
        await panel.getByRole("button", { name: "Save configuration", exact: true }).click();
        await panel.getByRole("button", { name: "Connect account", exact: true }).click();
        await expect(panel.getByRole("status")).toHaveText("Waiting for provider approval");
        const accounts = panel.getByRole("list", { name: "Configured integrations" });
        await accounts.getByText("Gmail", { exact: true }).click();
        await expect(accountLabel).toBeVisible();
        await accounts.getByText("Support mailbox", { exact: true }).click();
        await expect(panel.getByRole("status")).toHaveText("Waiting for provider approval");
        await expect(accountLabel).toHaveCount(0);
        connectionStatuses["gmail-2"] = "connected";
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(panel.getByText("Connected account: support@example.test", { exact: true })).toBeVisible();
        await accounts.getByText("Gmail", { exact: true }).click();
        await expect(accountLabel).toBeVisible();
        await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
        await page.getByRole("button", { name: "Disconnect account", exact: true }).click();
        await expect(accountLabel).toHaveCount(0);
        await accounts.getByText("Support mailbox", { exact: true }).click();
        await expect(panel.getByText("Connected account: support@example.test", { exact: true })).toBeVisible();
        expect(await readFile(filePath, "utf8")).not.toContain("business@example.test");
        expect(writes).toHaveLength(3);
      }
      expect(errors).toEqual([]);
    } finally {
      service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
