export function createLogger(scope) {
  return {
    info(message) {
      writeLine(scope, message);
    }
  };
}

function writeLine(scope, message) {
  process.stdout.write(`[${scope}] ${message}\n`);
}
