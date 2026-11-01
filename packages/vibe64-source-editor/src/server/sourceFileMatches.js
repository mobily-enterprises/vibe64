import path from "node:path";


import { sourceEditorLanguageForPath } from "./sourceEditorLanguage.js";
import { toText } from "@local/vibe64-core/shared/toText";

// How a session's file names match a query: tokens, fuzzy scores, ordering
// and the ranked page of matches.
const SOURCE_EDITOR_FILE_MATCH_LIMIT = 80;

const SOURCE_EDITOR_QUERY_MAX_LENGTH = 240;

function normalizeSourceEditorQuery(value = "") {
  return toText(value).slice(0, SOURCE_EDITOR_QUERY_MAX_LENGTH);
}

function sourceEditorFileQueryTokens(value = "") {
  return normalizeSourceEditorQuery(value)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function sourceEditorResultLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return Math.min(number, fallback);
}

function sourceEditorResultOffset(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function orderedTokenIndexes(text = "", tokens = []) {
  const normalizedText = String(text || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const token of tokens) {
    const index = normalizedText.indexOf(token, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + token.length;
  }
  return indexes;
}

function fuzzyCharacterIndexes(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  const indexes = [];
  let cursor = 0;
  for (const character of normalizedToken) {
    const index = normalizedText.indexOf(character, cursor);
    if (index < 0) {
      return null;
    }
    indexes.push(index);
    cursor = index + 1;
  }
  return indexes;
}

function textTokenMatchScore(text = "", token = "") {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedToken = String(token || "").toLowerCase();
  if (!normalizedToken) {
    return 0;
  }
  if (normalizedText === normalizedToken) {
    return 0;
  }
  if (normalizedText.startsWith(normalizedToken)) {
    return 1;
  }
  const substringIndex = normalizedText.indexOf(normalizedToken);
  if (substringIndex >= 0) {
    return 2 + substringIndex / 1000;
  }
  const fuzzyIndexes = fuzzyCharacterIndexes(normalizedText, normalizedToken);
  if (!fuzzyIndexes) {
    return null;
  }
  const span = fuzzyIndexes.at(-1) - fuzzyIndexes[0];
  return 6 + fuzzyIndexes[0] / 1000 + span / 1000000;
}

function filePathTokenMatchScore(filePath = "", token = "") {
  const lowerPath = filePath.toLowerCase();
  const lowerName = path.posix.basename(lowerPath);
  const lowerStem = lowerName.replace(/\.[^.]*$/u, "");
  const nameScore = Math.min(
    textTokenMatchScore(lowerName, token) ?? Number.POSITIVE_INFINITY,
    textTokenMatchScore(lowerStem, token) ?? Number.POSITIVE_INFINITY
  );
  if (Number.isFinite(nameScore)) {
    return nameScore;
  }
  const pathScore = textTokenMatchScore(lowerPath, token);
  return pathScore === null ? null : 10 + pathScore;
}

function filePathMatchesQuery(filePath = "", tokens = []) {
  return !tokens.length || tokens.every((token) => filePathTokenMatchScore(filePath, token) !== null);
}

function fileMatchScore(filePath = "", queryTokens = []) {
  const tokens = Array.isArray(queryTokens)
    ? queryTokens
    : sourceEditorFileQueryTokens(queryTokens);
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = tokens.join(" ");
  const lowerName = path.posix.basename(lowerPath);
  if (!tokens.length) {
    return 5;
  }
  if (tokens.length > 1) {
    const tokenScores = tokens.map((token) => filePathTokenMatchScore(lowerPath, token));
    if (tokenScores.some((score) => score === null)) {
      return 99;
    }
    const pathIndexes = orderedTokenIndexes(lowerPath, tokens);
    const nameIndexes = orderedTokenIndexes(lowerName, tokens);
    const allInName = tokens.every((token) => textTokenMatchScore(lowerName, token) !== null);
    const basenameTokenCount = tokens
      .filter((token) => textTokenMatchScore(lowerName, token) !== null)
      .length;
    const firstIndex = pathIndexes?.[0] ?? Math.min(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const lastIndex = pathIndexes?.at(-1) ?? Math.max(...tokens
      .map((token) => lowerPath.indexOf(token))
      .filter((index) => index >= 0));
    const span = Number.isFinite(firstIndex) && Number.isFinite(lastIndex)
      ? lastIndex - firstIndex
      : lowerPath.length;
    if (nameIndexes?.[0] === 0) {
      return 1 + span / 1000;
    }
    if (nameIndexes) {
      return 2 + span / 1000;
    }
    if (allInName) {
      return 2.5 + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
    }
    if (pathIndexes && firstIndex === 0) {
      return 3 + span / 1000;
    }
    if (pathIndexes) {
      return 4 + firstIndex / 1000 + span / 1000000;
    }
    return 6 - basenameTokenCount + tokenScores.reduce((sum, score) => sum + score, 0) / 100;
  }
  if (lowerName === lowerQuery) {
    return 0;
  }
  if (lowerName.startsWith(lowerQuery)) {
    return 1;
  }
  if (lowerName.includes(lowerQuery)) {
    return 2;
  }
  if (lowerPath.startsWith(lowerQuery)) {
    return 3;
  }
  return lowerPath.includes(lowerQuery) ? 4 : 99;
}

function sortFileMatches(matches = [], query = "") {
  const queryTokens = sourceEditorFileQueryTokens(query);
  return matches
    .map((file) => ({ file, score: fileMatchScore(file.path, queryTokens) }))
    .sort((left, right) => (
      left.score - right.score || left.file.path.localeCompare(right.file.path)
    ))
    .map(({ file }) => file);
}

function sourceEditorFileMatches(index, input = {}) {
  const query = normalizeSourceEditorQuery(input.query || input.q);
  const queryTokens = sourceEditorFileQueryTokens(query);
  const limit = sourceEditorResultLimit(input.limit, SOURCE_EDITOR_FILE_MATCH_LIMIT);
  const matches = [];
  for (const relativePath of index.paths) {
    if (filePathMatchesQuery(relativePath, queryTokens)) {
      matches.push({
        language: sourceEditorLanguageForPath(relativePath),
        name: path.posix.basename(relativePath),
        path: relativePath
      });
      if (!queryTokens.length && matches.length >= limit + 1) {
        break;
      }
    }
  }
  return {
    files: sortFileMatches(matches, query).slice(0, limit),
    query,
    truncated: index.truncated || matches.length > limit
  };
}

export {
  fileMatchScore,
  filePathMatchesQuery,
  filePathTokenMatchScore,
  fuzzyCharacterIndexes,
  normalizeSourceEditorQuery,
  orderedTokenIndexes,
  sortFileMatches,
  SOURCE_EDITOR_FILE_MATCH_LIMIT,
  SOURCE_EDITOR_QUERY_MAX_LENGTH,
  sourceEditorFileMatches,
  sourceEditorFileQueryTokens,
  sourceEditorResultLimit,
  sourceEditorResultOffset,
  textTokenMatchScore
};
