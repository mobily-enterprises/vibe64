import { attachDirectRequestActionExecutor } from "@jskit-ai/kernel/server/http";
import { COLLEAGUE_FOCUS_RELEASE, COLLEAGUE_FOCUS_UPDATE } from "../shared/focusRealtime.js";

// Focus belongs to one existing authenticated browser connection. The action
// retains access/input checks; the socket supplies only its cleanup lifetime.
function registerColleagueFocus({ realtime, actions }) {
  return realtime.onConnection(({ socket, readRequest }) => {
    const bindings = new Map();
    let closed = false;
    function release(clientId) {
      const binding = bindings.get(clientId);
      bindings.delete(clientId);
      if (binding) binding.owner.connected = false;
      if (binding?.release) void binding.release().catch(error => {
        console.error("Colleague browser focus cleanup failed.", error);
      });
    }
    async function update(input, acknowledge) {
      if (typeof acknowledge !== "function" || closed) return;
      try {
        if (typeof input?.clientId !== "string" || !input.clientId || input.clientId.length > 200) {
          throw Object.assign(new Error("A browser client identity is required."), { statusCode: 400 });
        }
        const binding = bindings.get(input.clientId) || { owner: { connected: true }, revision: 0 };
        bindings.set(input.clientId, binding);
        const revision = ++binding.revision;
        const current = () => !closed && socket.connected && bindings.get(input.clientId) === binding && binding.revision === revision;
        const request = await readRequest();
        if (!current()) return;
        attachDirectRequestActionExecutor({ actions, request });
        const result = await request.executeAction({
          actionId: "vibe64.colleague.focus.update", channel: "api", surface: "app", input,
          deps: { browserBinding: { owner: binding.owner, current, onRelease(detach) {
            if (binding.release && binding.release !== detach) void binding.release().catch(error => {
              console.error("Colleague previous actor focus cleanup failed.", error);
            });
            binding.release = detach;
            if (!current()) release(input.clientId);
          } } }
        });
        if (current()) acknowledge(result);
      } catch (error) {
        if (!closed && socket.connected) acknowledge({ ok: false,
          error: Number(error.statusCode || error.status || 500) < 500 ? error.message : "Colleague could not update this browser's focus." });
      }
    }
    function leave(input) { release(input?.clientId); }
    socket.on(COLLEAGUE_FOCUS_UPDATE, update);
    socket.on(COLLEAGUE_FOCUS_RELEASE, leave);
    return () => {
      closed = true;
      socket.off(COLLEAGUE_FOCUS_UPDATE, update);
      socket.off(COLLEAGUE_FOCUS_RELEASE, leave);
      for (const clientId of bindings.keys()) release(clientId);
    };
  });
}

export { registerColleagueFocus };
