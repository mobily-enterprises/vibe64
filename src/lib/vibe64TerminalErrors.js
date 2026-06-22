function normalizedText(value = "") {
  return String(value || "").trim();
}

function terminalErrorCode(source = {}) {
  if (!source || typeof source !== "object") {
    return "";
  }
  return normalizedText(source.code || source.errors?.[0]?.code || source.cause?.code);
}

function terminalErrorText(source = {}) {
  if (!source || typeof source !== "object") {
    return normalizedText(source);
  }
  return normalizedText(
    source.error ||
    source.message ||
    source.errors?.[0]?.message ||
    source.cause?.message
  );
}

function terminalOwnerAccessDenied(source = {}) {
  const code = terminalErrorCode(source);
  if (
    code === "vibe64_terminal_owner_mismatch" ||
    code === "vibe64_terminal_owner_required"
  ) {
    return true;
  }
  const message = terminalErrorText(source).toLowerCase();
  return message.includes("belongs to a different vibe64 user") ||
    message.includes("restart it before using it online") ||
    message.includes("recorded terminal ownership");
}

function vibe64TerminalErrorMessage(source = {}, fallback = "Terminal action failed.") {
  const code = terminalErrorCode(source);
  if (code === "vibe64_terminal_owner_mismatch") {
    return "This terminal belongs to a different Vibe64 user. Open a new terminal for your account.";
  }
  if (code === "vibe64_terminal_owner_required") {
    return "This terminal is from an older Vibe64 session. Restart it before using it online.";
  }
  if (
    code === "vibe64_github_required" ||
    code === "vibe64_github_reconnect_required" ||
    code === "vibe64_github_user_required" ||
    code === "vibe64_user_required"
  ) {
    return terminalErrorText(source) || "Connect GitHub before using this terminal.";
  }
  if (code === "vibe64_github_confirmation_required") {
    return "This GitHub operation needs explicit confirmation before Codex can run it.";
  }
  return terminalErrorText(source) || fallback;
}

export {
  terminalErrorCode,
  terminalErrorText,
  terminalOwnerAccessDenied,
  vibe64TerminalErrorMessage
};
