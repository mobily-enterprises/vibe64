import stripAnsi from "strip-ansi";

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const STRING_TERMINATOR_CHARACTER = String.fromCharCode(156);
const C1_CSI_CHARACTER = String.fromCharCode(155);
const C1_TERMINAL_STRING_START_CHARACTERS = [
  144,
  152,
  157,
  158,
  159
].map((code) => String.fromCharCode(code)).join("");
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
const C1_TERMINAL_STRING_PATTERN = new RegExp(`[${C1_TERMINAL_STRING_START_CHARACTERS}][\\s\\S]*?(?:${BELL_CHARACTER}|${STRING_TERMINATOR_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const C1_CSI_PATTERN = new RegExp(`${C1_CSI_CHARACTER}[0-?]*[ -/]*[@-~]`, "gu");
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[ -/]*[@-~]`, "gu");
const STANDALONE_TERMINAL_CONTROL_PATTERN = new RegExp(`[${STANDALONE_TERMINAL_CONTROL_CHARACTERS}]`, "gu");
function stripTerminalControlSequences(value) {
  const source = String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(TERMINAL_STRING_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(C1_TERMINAL_STRING_PATTERN, "")
    .replace(C1_CSI_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "");
  return stripAnsi(source)
    .replace(STANDALONE_TERMINAL_CONTROL_PATTERN, "");
}

export {
  stripTerminalControlSequences
};
