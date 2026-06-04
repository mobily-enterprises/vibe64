const DECRQM_REQUEST_SEQUENCE_PATTERN = /\u001b\[[0-9;?=><!]*\$p/g;
const DECRQM_REQUEST_PREFIX_PATTERN = /\u001b(?:\[[0-9;?=><!]*\$?)?$/;

function createStudioTerminalRenderOutputFilter() {
  let pendingSequence = "";

  function reset() {
    pendingSequence = "";
  }

  function filter(chunk = "") {
    const input = `${pendingSequence}${String(chunk || "")}`;
    pendingSequence = "";
    const output = input.replace(DECRQM_REQUEST_SEQUENCE_PATTERN, "");
    const pendingMatch = output.match(DECRQM_REQUEST_PREFIX_PATTERN);
    const pending = pendingMatch?.[0] || "";
    if (!pending) {
      return output;
    }
    pendingSequence = pending;
    return output.slice(0, -pending.length);
  }

  return {
    filter,
    reset
  };
}

export {
  createStudioTerminalRenderOutputFilter
};
