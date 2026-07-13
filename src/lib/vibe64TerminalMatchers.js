import { stripTerminalControlSequences } from "@/lib/codexOutput.js";

function normalizedMatcherId(matcher = {}, index = 0) {
  return String(matcher.id || matcher.event || `matcher-${index + 1}`).trim();
}

function normalizeMatchers(matchers = []) {
  return (Array.isArray(matchers) ? matchers : [])
    .map((matcher, index) => ({
      ...matcher,
      id: normalizedMatcherId(matcher, index)
    }))
    .filter((matcher) => matcher.id);
}

function matcherPattern(matcher = {}) {
  if (matcher.pattern instanceof RegExp) {
    const flags = matcher.pattern.flags.includes("g")
      ? matcher.pattern.flags
      : `${matcher.pattern.flags}g`;
    return new RegExp(matcher.pattern.source, flags);
  }
  if (typeof matcher.pattern === "string" && matcher.pattern) {
    return matcher.pattern;
  }
  return null;
}

function literalMatches(text, pattern) {
  const matches = [];
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(pattern, offset);
    if (index < 0) {
      break;
    }
    matches.push({
      captures: [],
      end: index + pattern.length,
      start: index,
      text: pattern
    });
    offset = index + Math.max(1, pattern.length);
  }
  return matches;
}

function regularExpressionMatches(text, pattern) {
  const matches = [];
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const start = Number(match.index || 0);
    matches.push({
      captures: match.slice(1),
      end: start + String(match[0] || "").length,
      start,
      text: String(match[0] || "")
    });
  }
  return matches;
}

function textMatches(text, matcher = {}) {
  const pattern = matcherPattern(matcher);
  if (typeof pattern === "string") {
    return literalMatches(text, pattern);
  }
  if (pattern instanceof RegExp) {
    return regularExpressionMatches(text, pattern);
  }
  return [];
}

function normalizePredicateMatch(result) {
  if (!result) {
    return null;
  }
  if (result === true) {
    return {
      captures: [],
      end: -1,
      start: -1,
      text: ""
    };
  }
  if (typeof result === "string") {
    return {
      captures: [],
      end: -1,
      start: -1,
      text: result
    };
  }
  if (typeof result === "object" && !Array.isArray(result)) {
    return {
      captures: Array.isArray(result.captures) ? result.captures : [],
      end: Number.isInteger(result.end) ? result.end : -1,
      start: Number.isInteger(result.start) ? result.start : -1,
      text: String(result.text || ""),
      value: result.value
    };
  }
  return null;
}

function createTerminalMatcherEngine({
  matchers = [],
  onMatch = null
} = {}) {
  const notify = typeof onMatch === "function" ? onMatch : () => null;
  let activeSessionId = "";
  let matcherStates = new Map();

  function reset(sessionId = "") {
    activeSessionId = String(sessionId || "");
    matcherStates = new Map();
  }

  function matcherState(matcherId) {
    if (!matcherStates.has(matcherId)) {
      matcherStates.set(matcherId, {
        complete: false,
        seen: new Set()
      });
    }
    return matcherStates.get(matcherId);
  }

  function inspect(context = {}) {
    const sessionId = String(context.sessionId || "");
    if (sessionId !== activeSessionId) {
      reset(sessionId);
    }

    const rawOutput = String(context.output || "");
    const plainOutput = Object.hasOwn(context, "plainOutput")
      ? String(context.plainOutput || "")
      : stripTerminalControlSequences(rawOutput);
    const emitted = [];

    for (const matcher of normalizeMatchers(
      typeof matchers === "function" ? matchers() : matchers
    )) {
      const state = matcherState(matcher.id);
      if (state.complete) {
        continue;
      }
      if (context.source === "replacement" && matcher.once === false) {
        state.seen.clear();
      }

      const matcherContext = {
        ...context,
        output: rawOutput,
        plainOutput,
        sessionId
      };
      const sourceText = matcher.source === "raw" ? rawOutput : plainOutput;
      const matches = typeof matcher.predicate === "function"
        ? [normalizePredicateMatch(matcher.predicate(matcherContext))].filter(Boolean)
        : textMatches(sourceText, matcher);

      for (const match of matches) {
        const matchKey = `${match.start}:${match.end}:${match.text}`;
        if (state.seen.has(matchKey)) {
          continue;
        }
        state.seen.add(matchKey);
        const payload = {
          captures: match.captures,
          error: String(context.error || ""),
          exitCode: context.exitCode ?? null,
          matcher: matcher.id,
          metadata: context.metadata || {},
          outputVersion: Number(context.outputVersion || 0),
          sessionId,
          source: String(context.source || "snapshot"),
          status: String(context.status || ""),
          text: match.text,
          transcriptOffset: match.start,
          value: match.value
        };
        emitted.push(payload);
        notify(payload);
        if (matcher.once !== false) {
          state.complete = true;
          break;
        }
      }
    }

    return emitted;
  }

  return {
    inspect,
    reset
  };
}

export {
  createTerminalMatcherEngine,
  normalizeMatchers
};
