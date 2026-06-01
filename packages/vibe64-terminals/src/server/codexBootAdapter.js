import stripAnsi from "strip-ansi";

export const CODEX_BOOT_SCREEN_STATE = Object.freeze({
  BLOCKED: "blocked",
  READY: "ready",
  RUNNING: "running",
  UNKNOWN: "unknown"
});

export const CODEX_BOOT_RESULT_STATE = Object.freeze({
  ATTENTION_REQUIRED: "attention_required",
  EXITED_BEFORE_READY: "exited_before_ready",
  READY: "ready"
});

export const CODEX_BOOT_MAX_RESTARTS = 2;
export const CODEX_BOOT_POLL_MS = 250;
export const CODEX_BOOT_READY_QUIET_MS = 350;
export const CODEX_BOOT_UNKNOWN_QUIET_MS = 5000;
export const CODEX_BOOT_TOTAL_TIMEOUT_MS = 30000;

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const STANDALONE_TERMINAL_CONTROL_CHARACTERS = [
  `${String.fromCharCode(0)}-${String.fromCharCode(8)}`,
  String.fromCharCode(11),
  String.fromCharCode(12),
  `${String.fromCharCode(14)}-${String.fromCharCode(31)}`,
  `${String.fromCharCode(127)}-${String.fromCharCode(159)}`
].join("");
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const TERMINAL_STRING_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[PX^_][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[ -/]*[@-~]`, "gu");
const STANDALONE_TERMINAL_CONTROL_PATTERN = new RegExp(`[${STANDALONE_TERMINAL_CONTROL_CHARACTERS}]`, "gu");
const MAX_CLASSIFIED_OUTPUT_LENGTH = 12000;

const CODEX_READY_PATTERNS = [
  /gpt-[^\s]+\s+[^\s]+\s+[\u00b7\u2022]\s+\/[^\s]+/iu
];

const CODEX_SPECIFIC_BLOCKED_PATTERNS = [
  {
    pattern: /do you trust the contents of this directory/iu,
    reason: "trust_prompt"
  },
  {
    pattern: /working with untrusted contents/iu,
    reason: "trust_prompt"
  },
  {
    pattern: /trusting the directory allows/iu,
    reason: "trust_prompt"
  },
  {
    pattern: /(?:update|upgrade)\s+(?:available|required|codex)/iu,
    reason: "upgrade_prompt"
  },
  {
    pattern: /(?:new|latest)\s+codex\s+version/iu,
    reason: "upgrade_prompt"
  },
  {
    pattern: /new\s+version\s+of\s+codex/iu,
    reason: "upgrade_prompt"
  },
  {
    pattern: /install\s+(?:the\s+)?(?:update|upgrade)/iu,
    reason: "upgrade_prompt"
  },
  {
    pattern: /press enter to insert or esc to close/iu,
    reason: "codex_completion_menu"
  },
  {
    pattern: /(?:log in|login|authenticate)\s+(?:to|with)\s+codex/iu,
    reason: "auth_prompt"
  }
];

const CODEX_GENERIC_BLOCKED_PATTERNS = [
  {
    pattern: /press enter to continue/iu,
    reason: "terminal_prompt"
  }
];

const CODEX_RUNNING_PATTERNS = [
  /openai codex/iu,
  /model:\s+gpt-/iu,
  /directory:\s+/iu
];

export function normalizeCodexBootText(value = "") {
  const source = String(value || "")
    .slice(-MAX_CLASSIFIED_OUTPUT_LENGTH)
    .replace(OSC_PATTERN, "")
    .replace(TERMINAL_STRING_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "");
  return stripAnsi(source)
    .replace(STANDALONE_TERMINAL_CONTROL_PATTERN, "")
    .replace(/\r/g, "\n");
}

function lastPatternMatch(text = "", patterns = []) {
  let best = {
    index: -1,
    reason: ""
  };
  for (const entry of patterns) {
    const pattern = entry.pattern || entry;
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    let match = globalPattern.exec(text);
    while (match) {
      if (match.index >= best.index) {
        best = {
          index: match.index,
          reason: entry.reason || ""
        };
      }
      match = globalPattern.exec(text);
    }
  }
  return best;
}

export function classifyCodexBootScreen(output = "") {
  const text = normalizeCodexBootText(output);
  if (!text.trim()) {
    return {
      confidence: "low",
      reason: "empty",
      state: CODEX_BOOT_SCREEN_STATE.RUNNING
    };
  }

  const readyMatch = lastPatternMatch(text, CODEX_READY_PATTERNS);
  const specificBlockedMatch = lastPatternMatch(text, CODEX_SPECIFIC_BLOCKED_PATTERNS);
  const genericBlockedMatch = lastPatternMatch(text, CODEX_GENERIC_BLOCKED_PATTERNS);
  if (specificBlockedMatch.index >= 0 && specificBlockedMatch.index >= readyMatch.index) {
    return {
      confidence: "high",
      reason: specificBlockedMatch.reason || "blocked_prompt",
      state: CODEX_BOOT_SCREEN_STATE.BLOCKED
    };
  }

  if (genericBlockedMatch.index >= 0 && genericBlockedMatch.index >= readyMatch.index) {
    return {
      confidence: "high",
      reason: genericBlockedMatch.reason || "blocked_prompt",
      state: CODEX_BOOT_SCREEN_STATE.BLOCKED
    };
  }

  if (readyMatch.index >= 0) {
    return {
      confidence: "high",
      reason: "codex_prompt",
      state: CODEX_BOOT_SCREEN_STATE.READY
    };
  }

  if (CODEX_RUNNING_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      confidence: "medium",
      reason: "codex_boot_output",
      state: CODEX_BOOT_SCREEN_STATE.RUNNING
    };
  }

  return {
    confidence: "low",
    reason: "unknown",
    state: CODEX_BOOT_SCREEN_STATE.UNKNOWN
  };
}

export function codexBootAttentionMessage(classification = {}) {
  switch (classification.reason) {
    case "auth_prompt":
      return "Codex needs you to sign in or authenticate before Vibe64 can continue.";
    case "codex_completion_menu":
      return "Codex is waiting in an interactive terminal menu.";
    case "terminal_prompt":
      return "Codex is waiting for terminal input.";
    case "trust_prompt":
      return "Codex is asking whether to trust this directory.";
    case "upgrade_prompt":
      return "Codex is asking about an update or upgrade.";
    case "unknown_quiet":
      return "Codex has been quiet during startup and may need terminal input.";
    default:
      return "Codex needs terminal input before Vibe64 can continue.";
  }
}

export function codexBootShouldRestartAfterExit({
  handoffStarted = false,
  restartCount = 0
} = {}) {
  return handoffStarted !== true && Number(restartCount || 0) < CODEX_BOOT_MAX_RESTARTS;
}
