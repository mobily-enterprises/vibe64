class ProgSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProgSyncError";
    this.code = code;
    this.details = details;
  }
}

function asDiagnostic(error) {
  if (error instanceof ProgSyncError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  return {
    code: "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
    details: {}
  };
}

export {
  ProgSyncError,
  asDiagnostic
};
