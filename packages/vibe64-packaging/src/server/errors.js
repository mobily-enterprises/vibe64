class Vibe64PublishError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "Vibe64PublishError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function publishError(code, message, details) {
  return new Vibe64PublishError(code, message, details);
}

export { Vibe64PublishError, publishError };
