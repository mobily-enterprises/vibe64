function normalizeLaunchRestartPath(relativePath = "") {
  return String(relativePath || "")
    .replace(/\\/gu, "/")
    .replace(/^\.\/+/u, "")
    .replace(/^\/+/u, "")
    .trim();
}

function normalizeLaunchRestartPattern(pattern = "") {
  const normalized = normalizeLaunchRestartPath(pattern);
  return normalized.endsWith("/") ? `${normalized}**` : normalized;
}

function normalizeLaunchRestartRules(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const include = (Array.isArray(source.include) ? source.include : [])
    .map(normalizeLaunchRestartPattern)
    .filter(Boolean);
  if (include.length < 1) {
    return null;
  }
  const exclude = (Array.isArray(source.exclude) ? source.exclude : [])
    .map(normalizeLaunchRestartPattern)
    .filter(Boolean);
  return {
    exclude,
    include,
    label: String(source.label || "server-side files").trim() || "server-side files",
    reason: String(source.reason || "server_source_changed").trim() || "server_source_changed",
    version: 1
  };
}

function escapeLaunchRestartRegExpChar(character = "") {
  return /[\\^$+?.()|[\]{}]/u.test(character) ? `\\${character}` : character;
}

function launchRestartGlobToRegExp(pattern = "") {
  const normalized = normalizeLaunchRestartPattern(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
          continue;
        }
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += escapeLaunchRestartRegExpChar(character);
  }
  return new RegExp(`${source}$`, "u");
}

function launchRestartRulesMatcher(input = {}) {
  const rules = normalizeLaunchRestartRules(input);
  if (!rules) {
    return () => false;
  }
  const include = rules.include.map(launchRestartGlobToRegExp);
  const exclude = rules.exclude.map(launchRestartGlobToRegExp);
  return (relativePath = "") => {
    const normalizedPath = normalizeLaunchRestartPath(relativePath);
    return Boolean(
      normalizedPath &&
      include.some((pattern) => pattern.test(normalizedPath)) &&
      !exclude.some((pattern) => pattern.test(normalizedPath))
    );
  };
}

function launchRestartRulesMatcherSource() {
  const matcherName = String(launchRestartRulesMatcher.name || "").trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(matcherName)) {
    throw new Error("Launch restart matcher cannot be serialized.");
  }
  return [
    normalizeLaunchRestartPath,
    normalizeLaunchRestartPattern,
    normalizeLaunchRestartRules,
    escapeLaunchRestartRegExpChar,
    launchRestartGlobToRegExp,
    launchRestartRulesMatcher
  ].map((helper) => helper.toString()).join("\n\n") +
    `\n\nconst vibe64LaunchRestartRulesMatcher = ${matcherName};`;
}

export {
  launchRestartRulesMatcher,
  launchRestartRulesMatcherSource,
  normalizeLaunchRestartPath,
  normalizeLaunchRestartRules
};
