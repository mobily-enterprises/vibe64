// AI onboarding copy: the only place for provider ranking, plan names, prices
// and sign-up links. Prices are the product's recommendation text; check them
// against each provider's official pricing page before changing.
// bullets: [aspect, rating 1-3, label]. connect: the existing AI Accounts route.
// access: "personal" serves only the owner in a hosted workspace.
// matches: which existing connections show this card as Connected.
const AI_ONBOARDING_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "claude", rank: 1, crown: true, mark: "Cl", tone: "primary", name: "Claude",
    tagline: "The best experience in Vibe64",
    bullets: [["intelligence", 3, "Very high intelligence"], ["quota", 3, "Very generous quota"], ["speed", 3, "Very high speed"]],
    plan: { name: "Claude Pro", headline: "Recommended: $30/month", detail: "Basic coding",
      more: "Claude Max: $100/month for a lot of good coding" },
    note: "",
    signUp: { label: "Open claude.com", url: "https://claude.ai/login?plan=pro",
      step: "Choose Claude Pro (recommended) or Max. Come back here when you're subscribed." },
    have: "I already have Claude, connect",
    steps: ["Sign in with your Claude account, then paste the code it shows you."],
    connect: { engineId: "claude", modelProviderId: "anthropic", access: "personal" },
    matches: { native: ["claude"], curated: [], opencode: ["anthropic"] }
  }),
  Object.freeze({
    id: "codex", rank: 2, mark: "Cx", tone: "secondary", name: "Codex",
    tagline: "Very capable, with limits",
    bullets: [["intelligence", 3, "Very good intelligence"], ["quota", 1, "Quota issues"], ["speed", 1, "Speed issues"]],
    plan: { name: "ChatGPT Pro", headline: "Recommended: $100/month", detail: "Basic coding",
      more: "$200/month for a lot of coding" },
    note: "",
    signUp: { label: "Open chatgpt.com", url: "https://chatgpt.com/explore/pro",
      step: "Choose ChatGPT Pro. Come back here when you're subscribed." },
    have: "I already have ChatGPT, connect",
    steps: [
      "In ChatGPT's Security settings, turn on \"Enable device code authorization for Codex\".",
      "Log in with ChatGPT and enter the short code on OpenAI's site."
    ],
    connect: { engineId: "codex", modelProviderId: "openai", access: "personal" },
    matches: { native: ["codex"], curated: [], opencode: ["openai"] }
  }),
  Object.freeze({
    id: "deepseek", rank: 3, mark: "DS", tone: "tertiary", name: "DeepSeek",
    tagline: "Cheap, pay as you go",
    bullets: [["intelligence", 2, "Good intelligence, weaker on long coding tasks"], ["quota", 3, "No quota: pay per use"],
      ["speed", 2, "Speed varies by time of day"]],
    plan: { name: "API credit", headline: "Recommended: top up $20", detail: "Prepaid; lasts for light use", more: "" },
    note: "Spending $20 a month? Claude gives a far better experience for about the same.",
    signUp: { label: "Open platform.deepseek.com", url: "https://platform.deepseek.com/api_keys",
      step: "Top up your DeepSeek balance. Come back here when it shows credit." },
    have: "I already have a DeepSeek key, connect",
    steps: ["Create an API key on DeepSeek, then paste it here."],
    connect: { engineId: "codex", modelProviderId: "deepseek", access: "workspace" },
    matches: { native: [], curated: ["deepseek"], opencode: ["deepseek"] }
  }),
  Object.freeze({
    id: "glm", rank: 4, mark: "GL", tone: "neutral", name: "GLM",
    tagline: "Budget subscription",
    bullets: [["intelligence", 2, "Decent intelligence"], ["quota", 3, "Generous quota"], ["speed", 1, "Slower at busy times"]],
    plan: { name: "GLM Coding Plan", headline: "Recommended: $30/month plan", detail: "Z.AI subscription", more: "" },
    note: "There's no point in getting it if you can get Claude for the same price.",
    signUp: { label: "Open z.ai", url: "https://z.ai/subscribe",
      step: "Subscribe to the GLM Coding Plan. Come back here when you're subscribed." },
    have: "I already have a Coding Plan key, connect",
    steps: ["Create a Coding Plan API key on Z.AI (Personal Coding Plan > Plan Overview), then paste it here."],
    connect: { engineId: "codex", modelProviderId: "zai-coding-plan", access: "personal" },
    matches: { native: [], curated: ["zai-coding-plan", "zai"], opencode: ["zai", "zai-coding-plan"] }
  })
]);

export { AI_ONBOARDING_PROVIDERS };
