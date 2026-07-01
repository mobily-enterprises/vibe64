const INVALID_TERMINAL_SIZE_ERROR = "Terminal size must include valid cols and rows.";
const STUDIO_TERMINAL_SCROLLBACK_ROWS = 128 * 1024;
const STUDIO_TERMINAL_TEXT_TAIL_LENGTH = 1024 * 1024;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;

function reportableTerminalSize(size = {}) {
  const cols = Math.floor(Number(size.cols));
  const rows = Math.floor(Number(size.rows));
  if (
    !Number.isFinite(cols) ||
    !Number.isFinite(rows) ||
    cols < MIN_TERMINAL_COLS ||
    rows < MIN_TERMINAL_ROWS
  ) {
    return null;
  }
  return {
    cols,
    rows
  };
}

function terminalResizeErrorMessage(error = "") {
  return String(error || "") === INVALID_TERMINAL_SIZE_ERROR;
}

export {
  INVALID_TERMINAL_SIZE_ERROR,
  STUDIO_TERMINAL_SCROLLBACK_ROWS,
  STUDIO_TERMINAL_TEXT_TAIL_LENGTH,
  reportableTerminalSize,
  terminalResizeErrorMessage
};
