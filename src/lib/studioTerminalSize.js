const INVALID_TERMINAL_SIZE_ERROR = "Terminal size must include valid cols and rows.";
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
  reportableTerminalSize,
  terminalResizeErrorMessage
};
