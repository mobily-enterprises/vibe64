// AI onboarding copy: the only place for provider ranking, plan names, prices
// and sign-up links. plan.name and plan.price are the provider's official plan
// and price (check them on its pricing page before changing them); plan.budget
// is the product's spending advice, shown beneath them; plan.more is the
// heavier-use plan. bullets: [aspect, rating 1-5, label]; 5 is reserved for
// Claude-level, 1-2 read as a warning. mark/shape: the provider's monogram tile.
// connect: the existing AI Accounts route. access: "personal" serves only the
// owner in a hosted workspace. matches: which connections show it as Connected.
// free: the one free option (GLM-4.7 Flash costs nothing on Z.AI's regular API,
// docs.z.ai/guides/overview/pricing); it connects as its own card.
const AI_ONBOARDING_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "claude", rank: 1, crown: true, mark: "C", shape: "squircle", tone: "primary", name: "Claude",
    tagline: "The best experience in Vibe64",
    bullets: [["intelligence", 5, "Very high intelligence"], ["quota", 5, "Very generous quota"], ["speed", 5, "Very high speed"]],
    why: "It plans whole features, writes clean code and fixes its own mistakes.",
    plan: { name: "Claude Pro", price: "$20/month", budget: "Budget about $30/month: Pro plus extra usage when you need it.",
      more: "Coding a lot? Max · $100/month" },
    note: "",
    upgrade: "Upgrade your experience: Claude is the biggest step up for Vibe64.",
    signUp: { label: "Open claude.ai", url: "https://claude.ai/login?plan=pro",
      step: "Choose Claude Pro (recommended) or Max. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already subscribed? Connect",
    connectStep: { title: "Sign in with Claude", body: "Use the Claude account that has your plan, then paste the code it shows you." },
    connect: { engineId: "claude", modelProviderId: "anthropic", access: "personal" },
    matches: { native: ["claude"], curated: [], opencode: ["anthropic"] }
  }),
  Object.freeze({
    id: "codex", rank: 2, mark: "O", shape: "circle", tone: "secondary", name: "Codex",
    tagline: "OpenAI · capable, with limits",
    bullets: [["intelligence", 4, "Very good intelligence"], ["quota", 2, "Quota issues"], ["speed", 2, "Speed issues"]],
    plan: { name: "ChatGPT Pro", price: "$100/month", budget: "Budget about $100/month for basic coding.",
      more: "Heavy use: $200/month" },
    note: "Hits limits on long sessions.",
    signUp: { label: "Open chatgpt.com", url: "https://chatgpt.com/explore/pro",
      step: "Choose ChatGPT Pro. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already subscribed? Connect",
    connectStep: { title: "Sign in with ChatGPT",
      body: "In ChatGPT's Security settings, turn on \"Enable device code authorization for Codex\", then sign in and enter the short code." },
    connect: { engineId: "codex", modelProviderId: "openai", access: "personal" },
    matches: { native: ["codex"], curated: [], opencode: ["openai"] }
  }),
  Object.freeze({
    id: "deepseek", rank: 3, mark: "D", shape: "hexagon", tone: "tertiary", name: "DeepSeek",
    tagline: "Cheap, pay as you go",
    bullets: [["intelligence", 3, "Good, weaker on long coding tasks"],
      ["quota", 3, "Pay per use: cost grows with work"], ["speed", 3, "Speed varies by time of day"]],
    plan: { name: "Prepaid API credit", price: "Pay as you go", budget: "Budget about $20 to start.", more: "" },
    note: "Works, but you'll notice the gap. Spending $20 a month? Claude gives a far better experience for about the same.",
    signUp: { label: "Open platform.deepseek.com", url: "https://platform.deepseek.com/api_keys",
      step: "Top up your DeepSeek balance. Come back here when it shows credit." },
    haveTitle: "Already have credit", have: "Already have a key? Connect",
    connectStep: { title: "Paste your DeepSeek API key", body: "Create an API key on DeepSeek, then paste it here." },
    connect: { engineId: "codex", modelProviderId: "deepseek", access: "workspace" },
    matches: { native: [], curated: ["deepseek"], opencode: ["deepseek"] }
  }),
  Object.freeze({
    id: "glm", rank: 4, mark: "G", shape: "diamond", tone: "neutral", name: "GLM",
    tagline: "Z.ai · budget subscription",
    bullets: [["intelligence", 3, "Decent intelligence"], ["quota", 3, "Good quota"], ["speed", 2, "Slower at busy times"]],
    plan: { name: "GLM Coding Plan", price: "from $18/month", budget: "Budget about $30/month for daily coding.", more: "" },
    note: "Works, but you'll notice the gap. There's no point in getting it if you can get Claude for the same price.",
    signUp: { label: "Open z.ai", url: "https://z.ai/subscribe",
      step: "Subscribe to the GLM Coding Plan. Come back here when you're subscribed." },
    haveTitle: "Already subscribed", have: "Already have a key? Connect",
    connectStep: { title: "Paste your Z.ai Coding Plan key",
      body: "Create a Coding Plan API key on Z.ai (Personal Coding Plan > Plan Overview), then paste it here." },
    connect: { engineId: "codex", modelProviderId: "zai-coding-plan", access: "personal" },
    matches: { native: [], curated: ["zai-coding-plan"], opencode: ["zai-coding-plan"] },
    free: Object.freeze({
      id: "glm-free", name: "GLM-4.7 Flash", label: "Free option: GLM-4.7 with a free Z.AI account",
      detail: "GLM-4.7 Flash is free on Z.AI's regular API. Good for trying Vibe64; expect slower, simpler work.",
      plan: { name: "Free Z.AI account", price: "Free", budget: "No plan or credit needed.", more: "" },
      signUp: { label: "Open z.ai API keys", url: "https://z.ai/manage-apikey/apikey-list",
        step: "Create a free Z.AI account, then create an API key." },
      haveTitle: "Already have a Z.AI account", have: "Already have a key? Connect",
      connectStep: { title: "Paste your Z.AI API key",
        body: "Use a key from Z.AI's API Keys page. Vibe64 checks it with one tiny free GLM-4.7 Flash request." },
      connect: { engineId: "opencode", modelProviderId: "zai", access: "workspace" },
      matches: { native: [], curated: [], opencode: ["zai"] }
    })
  })
]);

export { AI_ONBOARDING_PROVIDERS };
