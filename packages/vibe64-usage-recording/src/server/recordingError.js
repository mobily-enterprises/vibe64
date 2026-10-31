import { AppError } from "@jskit-ai/kernel/server/runtime";

// A recording request that cannot be served, with its HTTP status and code.
const recordingError = (status, message, code, details) => new AppError(status, message, { code, details });

export { recordingError };
