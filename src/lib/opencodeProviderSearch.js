const DEFAULT_PROVIDER_LIMIT = 12;
const DEFAULT_MODEL_MATCH_LIMIT = 3;

function text(value = "") {
  return String(value || "").trim();
}

function normalized(value = "") {
  return text(value).toLowerCase();
}

export function isOpenCodeTrialProvider(provider = {}) {
  return normalized(provider.id) === "opencode";
}

function modelRows(provider = {}) {
  return Array.isArray(provider.models) ? provider.models : [];
}

function modelKey(model = {}) {
  return normalized(model.id) || normalized(model.label);
}

function matchRank(value = "", query = "") {
  const candidate = normalized(value);
  if (!candidate || !query) {
    return 0;
  }
  if (candidate === query) {
    return 4;
  }
  if (candidate.startsWith(query)) {
    return 3;
  }
  return candidate.includes(query) ? 2 : 0;
}

function providerRank(provider = {}, query = "") {
  return Math.max(
    matchRank(provider.id, query),
    matchRank(provider.label, query),
    matchRank(provider.defaultModelId, query)
  );
}

function modelRank(model = {}, query = "") {
  return Math.max(
    matchRank(model.id, query),
    matchRank(model.label, query)
  );
}

function matchedModels(provider = {}, query = "") {
  const seen = new Set();
  return modelRows(provider)
    .map((model) => ({
      model,
      rank: modelRank(model, query)
    }))
    .filter(({ model, rank }) => {
      const key = modelKey(model);
      if (!rank || !key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.rank - left.rank)
    .map(({ model }) => model);
}

function providerLabel(provider = {}) {
  return normalized(provider.label) || normalized(provider.id);
}

function providerTrialPenalty(provider = {}, query = "") {
  if (!isOpenCodeTrialProvider(provider)) {
    return 0;
  }
  return query ? 10_000 : 100;
}

function normalizedLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function searchOpenCodeProviders(providers = [], query = "", options = {}) {
  const rows = Array.isArray(providers) ? providers : [];
  const normalizedQuery = normalized(query);
  const providerLimit = normalizedLimit(options.limit, DEFAULT_PROVIDER_LIMIT);
  const modelMatchLimit = normalizedLimit(options.modelMatchLimit, DEFAULT_MODEL_MATCH_LIMIT);

  return rows
    .map((provider, index) => {
      const providerMatchRank = normalizedQuery ? providerRank(provider, normalizedQuery) : 1;
      const allMatchedModels = normalizedQuery ? matchedModels(provider, normalizedQuery) : [];
      const bestModelRank = allMatchedModels.reduce((rank, model) => {
        return Math.max(rank, modelRank(model, normalizedQuery));
      }, 0);
      const connectedRank = provider.connected === true ? 1 : 0;
      const score = connectedRank * 1000
        + providerMatchRank * 100
        + bestModelRank * 90
        - providerTrialPenalty(provider, normalizedQuery);

      return {
        allMatchedModels,
        index,
        matched: !normalizedQuery || providerMatchRank > 0 || allMatchedModels.length > 0,
        provider,
        score
      };
    })
    .filter((row) => row.matched)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }
      const leftLabel = providerLabel(left.provider);
      const rightLabel = providerLabel(right.provider);
      if (leftLabel !== rightLabel) {
        return leftLabel.localeCompare(rightLabel);
      }
      return left.index - right.index;
    })
    .slice(0, providerLimit)
    .map((row) => ({
      ...row.provider,
      matchedModels: row.allMatchedModels.slice(0, modelMatchLimit),
      matchingModelCount: row.allMatchedModels.length
    }));
}
