const GITHUB_COMMAND_FAILED_CODE = "vibe64_github_command_failed";
const GITHUB_RECONNECT_REQUIRED_CODE = "vibe64_github_reconnect_required";
const GITHUB_RECONNECT_REQUIRED_MESSAGE = "GitHub rejected the saved login. Reconnect GitHub to continue.";

function githubCliCommandOutput(result = {}) {
  return String(result?.output || result?.stderr || result?.stdout || "").trim();
}

function githubCliOutputRequiresReconnect(output = "") {
  const text = String(output || "");
  return /token\b[\s\S]{0,240}\binvalid\b|\bbad credentials\b|\bHTTP 401\b|["']status["']\s*:\s*["']401["']/iu.test(text);
}

function githubCliAccountFailureMessage(output = "") {
  return githubCliOutputRequiresReconnect(output)
    ? GITHUB_RECONNECT_REQUIRED_MESSAGE
    : "GitHub CLI is not authenticated for this Vibe64 user. Reconnect GitHub to continue.";
}

function githubCliFailureDetails(result = {}, {
  fallbackMessage = "GitHub command failed.",
  fallbackStatusCode = 502
} = {}) {
  const output = githubCliCommandOutput(result);
  if (githubCliOutputRequiresReconnect(output)) {
    return {
      code: GITHUB_RECONNECT_REQUIRED_CODE,
      message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
      output,
      reconnectRequired: true,
      statusCode: 409
    };
  }
  return {
    code: GITHUB_COMMAND_FAILED_CODE,
    message: output || fallbackMessage,
    output,
    reconnectRequired: false,
    statusCode: fallbackStatusCode
  };
}

export {
  GITHUB_COMMAND_FAILED_CODE,
  GITHUB_RECONNECT_REQUIRED_CODE,
  GITHUB_RECONNECT_REQUIRED_MESSAGE,
  githubCliAccountFailureMessage,
  githubCliCommandOutput,
  githubCliFailureDetails,
  githubCliOutputRequiresReconnect
};
