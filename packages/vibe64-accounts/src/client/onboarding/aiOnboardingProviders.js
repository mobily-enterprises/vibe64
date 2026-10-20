// AI onboarding copy: the only place for provider ranking, plan names, prices
// and sign-up links. plan.budget is the product's spending advice, not a
// provider price; plan.detail names the plan with its official price. Check
// those against each provider's official pricing page before changing them.
// bullets: [aspect, rating 1-3, label]; 3 is reserved for Claude-level.
// mark: the one-letter glyph on the provider's tile.
// connect: the existing AI Accounts route. access: "personal" serves only the
// owner in a hosted workspace. matches: which connections show it as Connected.
const AI_ONBOARDING_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "claude", rank: 1, crown: true, mark: "C", tone: "primary", name: "Claude",
    tagline: "The best experience in Vibe64",
    bullets: [["intelligence", 3, "Very high intelligence"], ["quota", 3, "Very generous quota"], ["speed", 3, "Very high speed"]],
    why: "It plans whole features, writes clean code and fixes its own mistakes.",
    plan: { budget: "$30/month", detail: "Claude Pro ($20/month) · basic coding",
      more: "$100/month on Claude Max for a lot of good coding" },
    note: "",
    signUp: { label: "Open claude.ai", url: "https://claude.ai/login?plan=pro",
      step: "Choose Claude Pro (recommended) or Max. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already subscribed? Connect",
    steps: ["Sign in with your Claude account, then paste the code it shows you."],
    connect: { engineId: "claude", modelProviderId: "anthropic", access: "personal" },
    matches: { native: ["claude"], curated: [], opencode: ["anthropic"] }
  }),
  Object.freeze({
    id: "codex", rank: 2, mark: "O", tone: "secondary", name: "Codex",
    tagline: "OpenAI · capable, with limits",
    bullets: [["intelligence", 3, "Very good intelligence"], ["quota", 1, "Quota issues"], ["speed", 1, "Speed issues"]],
    plan: { budget: "$100/month", detail: "ChatGPT Pro ($100/month) · basic coding",
      more: "$200/month on the larger Pro plan for a lot of coding" },
    note: "Hits limits on long sessions.",
    signUp: { label: "Open chatgpt.com", url: "https://chatgpt.com/explore/pro",
      step: "Choose ChatGPT Pro. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already subscribed? Connect",
    steps: [
      "In ChatGPT's Security settings, turn on \"Enable device code authorization for Codex\".",
      "Log in with ChatGPT and enter the short code on OpenAI's site."
    ],
    connect: { engineId: "codex", modelProviderId: "openai", access: "personal" },
    matches: { native: ["codex"], curated: [], opencode: ["openai"] }
  }),
  Object.freeze({
    id: "deepseek", rank: 3, mark: "D", tone: "tertiary", name: "DeepSeek",
    tagline: "Cheap, pay as you go",
    bullets: [["intelligence", 2, "Good intelligence, weaker on long coding tasks"],
      ["quota", 2, "Pay per use: cost grows with work"], ["speed", 2, "Speed varies by time of day"]],
    plan: { budget: "Top up $20", detail: "Prepaid API credit · light use", more: "" },
    note: "Spending $20 a month? Claude gives a far better experience for about the same.",
    signUp: { label: "Open platform.deepseek.com", url: "https://platform.deepseek.com/api_keys",
      step: "Top up your DeepSeek balance. Come back here when it shows credit." },
    haveTitle: "Already have credit", have: "Already have a key? Connect",
    steps: ["Create an API key on DeepSeek, then paste it here."],
    connect: { engineId: "codex", modelProviderId: "deepseek", access: "workspace" },
    matches: { native: [], curated: ["deepseek"], opencode: ["deepseek"] }
  }),
  Object.freeze({
    id: "glm", rank: 4, mark: "G", tone: "neutral", name: "GLM",
    tagline: "Z.ai · budget subscription",
    bullets: [["intelligence", 2, "Decent intelligence"], ["quota", 2, "Good quota"], ["speed", 1, "Slower at busy times"]],
    plan: { budget: "$30/month", detail: "GLM Coding Plan (from $18/month)", more: "" },
    note: "There's no point in getting it if you can get Claude for the same price.",
    signUp: { label: "Open z.ai", url: "https://z.ai/subscribe",
      step: "Subscribe to the GLM Coding Plan. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already have a key? Connect",
    steps: ["Create a Coding Plan API key on Z.AI (Personal Coding Plan > Plan Overview), then paste it here."],
    connect: { engineId: "codex", modelProviderId: "zai-coding-plan", access: "personal" },
    matches: { native: [], curated: ["zai-coding-plan"], opencode: ["zai-coding-plan"] }
  })
]);

export { AI_ONBOARDING_PROVIDERS };
