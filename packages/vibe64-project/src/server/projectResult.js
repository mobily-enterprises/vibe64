import { vibe64Result } from "@local/vibe64-core/server/serverResponses";

function projectResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_project_request_failed",
    fallbackMessage: "Vibe64 project request failed."
  });
}

export { projectResult };
