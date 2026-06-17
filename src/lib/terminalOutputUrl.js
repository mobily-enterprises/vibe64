// eslint-disable-next-line no-control-regex -- Terminal output can include ANSI CSI control sequences.
const ANSI_CSI_PATTERN = new RegExp("\\u001B\\[[0-?]*[ -/]*[@-~]", "gu");
// eslint-disable-next-line no-control-regex -- Terminal output can include ANSI OSC control sequences.
const ANSI_OSC_PATTERN = new RegExp("\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)", "gu");
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/iu;

function plainTerminalText(value = "") {
  return String(value || "")
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "");
}

function normalizeTerminalUrl(value = "") {
  return String(value || "").replace(/[),.;\]}]+$/u, "");
}

function firstTerminalUrl(output = "") {
  const match = plainTerminalText(output).match(URL_PATTERN);
  return normalizeTerminalUrl(match?.[0] || "");
}

export {
  firstTerminalUrl
};
