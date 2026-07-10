import { watch } from "vue";
import {
  vibe64SessionDebugEnabled,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";

function debugText(value = "") {
  return String(value ?? "");
}

function debugValue(value = "", privateField = false) {
  const text = debugText(value);
  return {
    length: text.length,
    value: privateField ? "[private]" : text
  };
}

function composerInputDebugFieldValue({
  field = {},
  fieldIsPrivate = () => false,
  values = {}
} = {}) {
  const name = String(field?.name || "");
  const privateField = fieldIsPrivate(field) === true;
  const value = debugValue(
    values && typeof values === "object" && !Array.isArray(values)
      ? values[name] ?? field?.value ?? ""
      : field?.value ?? "",
    privateField
  );
  return {
    kind: String(field?.kind || ""),
    label: String(field?.label || ""),
    name,
    privateField,
    required: field?.required === true,
    value: value.value,
    valueLength: value.length
  };
}

function sourceValue(source, fallback = {}) {
  if (typeof source === "function") {
    return source() ?? fallback;
  }
  if (source && typeof source === "object" && "value" in source) {
    return source.value ?? fallback;
  }
  return source ?? fallback;
}

function useVibe64ComposerInputDebug({
  debugEnabled = vibe64SessionDebugEnabled,
  fieldIsPrivate = () => false,
  session = () => ({}),
  state = () => ({})
} = {}) {
  if (!debugEnabled()) {
    return {
      logInputChanged: () => null
    };
  }

  let inputSequence = 0;
  let stateSequence = 0;

  function logInputChanged({
    accepted = true,
    name = "",
    source = "",
    valueAfter = "",
    valueBefore = "",
    valueRequested = ""
  } = {}) {
    inputSequence += 1;
    const privateField = fieldIsPrivate(name) === true;
    const before = debugValue(valueBefore, privateField);
    const requested = debugValue(valueRequested, privateField);
    const after = debugValue(valueAfter, privateField);
    vibe64SessionDebugLog("client.autopilot.composerInput.changed", {
      ...vibe64SessionDebugSummary(sourceValue(session)),
      ...sourceValue(state),
      accepted: accepted === true,
      changed: debugText(valueBefore) !== debugText(valueAfter),
      fieldName: String(name || ""),
      privateField,
      sequence: inputSequence,
      source: String(source || ""),
      valueAfter: after.value,
      valueAfterLength: after.length,
      valueBefore: before.value,
      valueBeforeLength: before.length,
      valueRequested: requested.value,
      valueRequestedLength: requested.length
    });
  }

  watch(() => sourceValue(state), (nextState, previousState) => {
    stateSequence += 1;
    vibe64SessionDebugLog("client.autopilot.composerInput.stateChanged", {
      ...vibe64SessionDebugSummary(sourceValue(session)),
      nextState,
      previousState: previousState || null,
      sequence: stateSequence
    });
  }, {
    immediate: true
  });

  return {
    logInputChanged
  };
}

export {
  composerInputDebugFieldValue,
  useVibe64ComposerInputDebug
};
