import { backtickedArguments, invalidStackOperation } from "./stackOperation.js";

// The error code and entry helpers every Outputs block parser shares.
const ERROR_CODE = "VIBE64_OUTPUTS_INVALID";

function invalid(outputsPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, outputsPath, message, line, details);
}

function tokenValues(source, prefix, outputsPath, label, line, options) {
  return backtickedArguments(
    source.slice(prefix.length),
    ERROR_CODE,
    outputsPath,
    label,
    line,
    options
  );
}

function oneToken(source, prefix, outputsPath, label, line) {
  return tokenValues(source, prefix, outputsPath, label, line, { count: 1 })[0];
}

function setOnce(draft, field, value, outputsPath, line, label) {
  if (draft.seen.has(field)) invalid(outputsPath, `Duplicate ${label}.`, line);
  draft.seen.add(field);
  draft[field] = value;
}

export { ERROR_CODE, invalid, oneToken, setOnce, tokenValues };
