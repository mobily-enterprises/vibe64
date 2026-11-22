// A placeholder adapter for a type whose treatment is being ported: its steps exist, and running
// them says so.
import { vibe64Error } from "@local/vibe64-core/server/core";

function notPorted(type, runtimeRequirements) {
  const refuse = async () => {
    throw vibe64Error(`Vibe64's ${type} treatment is not ready yet.`, "vibe64_connected_adapter_missing");
  };
  return Object.freeze({
    type,
    runtimeRequirements: Object.freeze(runtimeRequirements),
    apply: refuse,
    proof: refuse
  });
}

export { notPorted };
