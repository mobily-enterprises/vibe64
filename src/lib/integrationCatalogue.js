// Presentation belongs to the editor; provider behavior stays in the connector catalog.
const integrationCategories = [
  {
    id: "ai",
    title: "AI & generation",
    providers: [
      "ai",
      "gemini-enterprise",
      "elevenlabs",
      "replicate",
      "perplexity",
      "fireworks-ai",
      "heygen"
    ]
  },
  {
    id: "productivity",
    title: "Productivity & collaboration",
    providers: [
      "google-calendar",
      "google-drive",
      "google-docs",
      "google-sheets",
      "google-slides",
      "notion",
      "calendly",
      "microsoft-onedrive",
      "microsoft-excel",
      "microsoft-onenote",
      "microsoft-sharepoint",
      "microsoft-word",
      "microsoft-powerpoint",
      "asana",
      "linear",
      "atlassian",
      "miro",
      "fireflies",
      "granola"
    ]
  },
  {
    id: "communication",
    title: "Email & messaging",
    providers: [
      "gmail",
      "microsoft-outlook",
      "microsoft-teams",
      "slack",
      "telegram",
      "twilio",
      "gatewayapi",
      "resend",
      "mailgun",
      "firebase-cloud-messaging"
    ]
  },
  {
    id: "sales",
    title: "Sales & customer relationships",
    providers: [
      "salesforce",
      "hubspot",
      "pipedrive",
      "apollo-io",
      "attention",
      "clay",
      "gong",
      "zoho-crm",
      "brevo"
    ]
  },
  {
    id: "commerce",
    title: "Commerce, payments & accounting",
    providers: [
      "stripe",
      "paddle",
      "polar",
      "chargebee",
      "shopify",
      "woocommerce",
      "prestashop",
      "lightspeed",
      "xero",
      "wave",
      "zoho-books",
      "lexware",
      "sevdesk"
    ]
  },
  {
    id: "data",
    title: "Databases & storage",
    providers: [
      "bigquery",
      "snowflake",
      "airtable",
      "supabase",
      "clickhouse",
      "aws-s3",
      "aws-athena",
      "amazon-redshift",
      "databricks",
      "microsoft-fabric",
      "dbt-semantic-layer",
      "hex"
    ]
  },
  {
    id: "marketing",
    title: "Marketing, analytics & social",
    providers: [
      "google-ads",
      "google-search-console",
      "google-analytics",
      "posthog",
      "amplitude",
      "semrush",
      "tiktok",
      "x-twitter",
      "linkedin",
      "twitch",
      "confidence-flags",
      "confidence-exp"
    ]
  },
  {
    id: "content",
    title: "Content, design & forms",
    providers: [
      "wix",
      "contentful",
      "storyblok",
      "sanity",
      "wordpress-com",
      "wordpress-self-hosted",
      "canva",
      "figma",
      "klipy",
      "tally"
    ]
  },
  {
    id: "development",
    title: "Developer tools & automation",
    providers: [
      "github-api",
      "gitlab-api",
      "wiz",
      "sentry",
      "incident-io",
      "n8n",
      "inngest",
      "firecrawl",
      "apify",
      "algolia",
      "mapbox",
      "google-maps-platform",
      "logo-dev"
    ]
  },
  {
    id: "people",
    title: "People & wellbeing",
    providers: [
      "workday",
      "ashby",
      "oura"
    ]
  }
];

function groupIntegrationProviders(providers, search = "") {
  const query = String(search || "").trim().toLowerCase();
  const groups = integrationCategories.map((category) => ({
    id: category.id,
    title: category.title,
    providers: providers.filter((provider) => category.providers.includes(provider.id))
  }));
  const assigned = new Set(integrationCategories.flatMap((category) => category.providers));
  groups.push({ id: "other", title: "Other services", providers: providers.filter((provider) => !assigned.has(provider.id)) });
  return groups.map((group) => ({
    ...group,
    providers: group.providers.filter((provider) =>
      `${provider.name} ${provider.description} ${group.title}`.toLowerCase().includes(query)
    ).sort((left, right) => left.name.localeCompare(right.name))
  })).filter((group) => group.providers.length);
}

export { integrationCategories, groupIntegrationProviders };
