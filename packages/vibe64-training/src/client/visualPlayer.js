const MAX_FILE_BYTES = 1024 * 1024;
const MAX_COMMAND_IDS = 64;
const MAX_PENDING_REQUESTS = 64;
const PROTOCOL_VERSION = 1;
const identityPattern = /^[a-zA-Z0-9-]{1,64}$/u;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, names) {
  return object(value) && Object.keys(value).length === names.length
    && names.every(name => Object.hasOwn(value, name));
}

function text(value, maximum, multiline = false) {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= maximum
    // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
    && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value);
}

function identity(value) {
  return typeof value === "string" && identityPattern.test(value);
}

function semanticSnapshot(value, states) {
  if (!exactKeys(value, ["state", "paused", "labels"]) || !states.has(value.state)
    || typeof value.paused !== "boolean" || !object(value.labels)
    || Object.keys(value.labels).length > 32
    || Object.entries(value.labels).some(([name, label]) => !identity(name) || !text(label, 256))
    || JSON.stringify(value).length > 4096) {
    throw new Error("The diagram's saved semantic state is invalid. Reload its declared initial state.");
  }
  return structuredClone(value);
}

function validateResource(resource, view) {
  const visual = resource?.visual;
  if (!object(visual) || visual.schemaVersion !== 1 || !identity(visual.id) || resource.id !== visual.id
    || !text(visual.title, 256) || !text(visual.description, 2000, true)
    || !Array.isArray(visual.states) || !visual.states.length || visual.states.length > 32
    || visual.states.some(state => !identity(state)) || new Set(visual.states).size !== visual.states.length
    || !visual.states.includes(visual.initialState)
    || !Array.isArray(visual.commands) || !visual.commands.length || visual.commands.length > 32) {
    throw new Error("The verified diagram descriptor is missing or invalid.");
  }
  const states = new Set(visual.states);
  const commands = new Map();
  for (const command of visual.commands) {
    if (!object(command) || !identity(command.name) || commands.has(command.name)
      || (command.completionState !== "unchanged" && !states.has(command.completionState))
      || !Array.isArray(command.parameters) || command.parameters.length > 8) {
      throw new Error("The diagram declares an invalid command.");
    }
    const parameters = new Map();
    for (const parameter of command.parameters) {
      if (!object(parameter) || !identity(parameter.name) || parameters.has(parameter.name)
        || typeof parameter.required !== "boolean" || !Number.isInteger(parameter.maxLength)
        || parameter.maxLength < 1 || parameter.maxLength > 256) {
        throw new Error("The diagram declares an invalid command parameter.");
      }
      parameters.set(parameter.name, { required: parameter.required, maxLength: parameter.maxLength });
    }
    commands.set(command.name, { completionState: command.completionState, parameters });
  }
  function encodedFile(file) {
    if (!object(file) || !text(file.path, 1024) || file.encoding !== "base64" || typeof file.bytes !== "string"
      || file.bytes.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
      throw new Error("Diagram files require bounded base64 bytes from the verified lesson reader.");
    }
    let bytes;
    try { bytes = view.atob(file.bytes); } catch { throw new Error("Diagram file bytes are not valid base64."); }
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || view.btoa(bytes) !== file.bytes) {
      throw new Error("Diagram file bytes are empty, oversized or noncanonical.");
    }
    return file.bytes;
  }
  return {
    visual: structuredClone(visual), states, commands,
    svg: encodedFile(resource.svg), controller: encodedFile(resource.controller)
  };
}

// This bootstrap only mounts verified authored bytes and transfers the original
// controller's port. Transition, interruption and receipt semantics stay there.
async function bootstrap(payload, loadController) {
  let dispose;
  let claimed = false;
  window.addEventListener("pagehide", () => dispose?.(), { once: true });
  window.addEventListener("message", async event => {
    if (claimed || event.source !== parent || !event.data
      || Object.keys(event.data).sort().join(",") !== "init,playerInstanceId,protocolVersion,token,type"
      || event.data.type !== "vibe64-visual-init" || event.data.protocolVersion !== 1
      || event.data.playerInstanceId !== payload.playerInstanceId || event.data.token !== payload.token
      || event.ports.length !== 1) return;
    claimed = true;
    const port = event.ports[0];
    let moduleUrl;
    try {
      const decode = value => new TextDecoder("utf-8", { fatal: true })
        .decode(Uint8Array.from(atob(value), character => character.charCodeAt(0)));
      const documentSvg = new DOMParser().parseFromString(decode(payload.svg), "image/svg+xml");
      const svg = documentSvg.documentElement;
      if (svg.localName !== "svg" || svg.namespaceURI !== "http://www.w3.org/2000/svg"
        || documentSvg.querySelector("parsererror")) throw new Error("The diagram SVG cannot be read.");
      document.body.append(document.importNode(svg, true));
      moduleUrl = URL.createObjectURL(new Blob([decode(payload.controller)], { type: "text/javascript" }));
      const controller = await loadController(moduleUrl);
      if (typeof controller.mountVisual !== "function") throw new Error("The diagram controller has no mountVisual operation.");
      dispose = controller.mountVisual(document.body.querySelector("svg"), port, event.data.init);
    } catch (cause) {
      port.postMessage({
        protocolVersion: 1, playerInstanceId: payload.playerInstanceId, type: "bootstrap-failed",
        description: String(cause.message || "Diagram initialization failed.").slice(0, 2000)
      });
    } finally {
      if (moduleUrl) URL.revokeObjectURL(moduleUrl);
    }
  });
  parent.postMessage({ type: "vibe64-visual-handshake", protocolVersion: 1,
    playerInstanceId: payload.playerInstanceId, token: payload.token }, "*");
}

function frameDocument(payload) {
  const nonce = payload.token;
  const policy = [
    "default-src 'none'", `script-src 'nonce-${nonce}' blob:`, "style-src 'unsafe-inline'",
    "connect-src 'none'", "img-src 'none'", "media-src 'none'", "frame-src 'none'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'"
  ].join("; ");
  // Keep the import inside the isolated document's source. A bundler may add
  // parent-module helpers to an import serialized through Function.toString().
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<style>html,body{margin:0}svg{display:block;width:100%;height:auto}</style></head><body>',
    `<script nonce="${nonce}">(${bootstrap.toString()})(${JSON.stringify(payload)}, url => import(url));</script>`,
    "</body></html>"
  ].join("");
}

function createTrainingVisualPlayer({
  iframe, resource, attemptId, reducedMotion = false, snapshot: initialSnapshot, onState, timeoutMs = 5000
} = {}) {
  const view = iframe?.ownerDocument?.defaultView;
  if (!view || !identity(attemptId) || typeof reducedMotion !== "boolean"
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error("Mount a diagram in its iframe for an admitted attempt with a bounded timeout.");
  }
  const { visual, states, commands, svg, controller } = validateResource(resource, view);
  const pending = new Map();
  // Inputs/instance identities fence retries; completed receipts live only in
  // the authored controller, including its original 64-receipt bound.
  const commandInputs = new Map();
  let current;
  let closed = false;
  let savedSnapshot = initialSnapshot === undefined ? undefined : semanticSnapshot(initialSnapshot, states);
  let display = { state: savedSnapshot?.state ?? visual.initialState, description: visual.description };
  let status = { attemptId, playerInstanceId: "", phase: "loading", ...display, error: "" };

  function publish(patch) {
    status = { ...status, ...patch };
    try {
      const observed = onState?.(structuredClone(status));
      observed?.catch?.(() => {});
    } catch { /* A presentation observer cannot retain the iframe or its port. */ }
  }

  function settle(id, error, result) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(result);
  }

  function retire(cause) {
    const previous = current;
    current = undefined;
    if (!previous) return;
    clearTimeout(previous.timer);
    view.removeEventListener("message", previous.handshake);
    if (previous.port) {
      previous.port.onmessage = null;
      previous.port.close();
    }
    previous.rejectReady(cause);
    for (const id of [...pending.keys()]) settle(id, cause);
    iframe.srcdoc = "";
  }

  function fail(message) {
    retire(new Error(message));
    publish({ phase: "failed", error: message });
  }

  function request(kind, id, body, command) {
    if (!current?.ready || closed) return Promise.reject(new Error("The diagram is not ready. Reload it before sending a command."));
    if (pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new Error("The diagram has too many pending requests."));
    const instance = current;
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => {
      if (current === instance && pending.has(id)) fail("The diagram did not confirm its result in time. Reload its saved state; the command will not be replayed.");
    }, timeoutMs);
    pending.set(id, { kind, promise, resolve, reject, timer, command, accepted: false });
    try { instance.port.postMessage({ protocolVersion: PROTOCOL_VERSION, playerInstanceId: instance.id, ...body }); }
    catch { fail("The diagram channel is unavailable. Reload its saved state."); }
    return promise;
  }

  function snapshot() {
    const requestId = view.crypto.randomUUID();
    return request("snapshot", requestId, { type: "snapshot", requestId });
  }

  function receive(instance, value) {
    if (closed || current !== instance || !object(value) || value.protocolVersion !== PROTOCOL_VERSION
      || value.playerInstanceId !== instance.id) return;
    if (value.type === "bootstrap-failed") {
      if (!instance.ready && exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "description"])
        && text(value.description, 2000, true)) fail(value.description);
      return;
    }
    if (value.type === "ready") {
      if (instance.ready || !exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "commands", "state", "description"])
        || value.state !== instance.initialState || !text(value.description, 2000, true)
        || !Array.isArray(value.commands) || value.commands.length !== commands.size
        || new Set(value.commands).size !== commands.size || value.commands.some(name => !commands.has(name))) return;
      instance.ready = true;
      clearTimeout(instance.timer);
      display = { state: value.state, description: value.description };
      publish({ phase: "ready", ...display, error: "" });
      instance.resolveReady(structuredClone(status));
      return;
    }
    if (!instance.ready || !states.has(value.state) || !identity(value.commandId ?? value.requestId)) return;
    const id = value.commandId ?? value.requestId;
    const operation = pending.get(id);
    if (!operation) return;
    if (operation.kind === "snapshot") {
      if (value.type !== "snapshot" || !exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "requestId", "state", "description", "paused", "labels"])
        || !text(value.description, 2000, true)) return;
      let semantic;
      try { semantic = semanticSnapshot({ state: value.state, paused: value.paused, labels: value.labels }, states); }
      catch { return; }
      savedSnapshot = semantic;
      display = { state: value.state, description: value.description };
      publish(display);
      settle(id, null, structuredClone(semantic));
      return;
    }
    if (value.type === "accepted") {
      if (!exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "commandId", "state"])) return;
      operation.accepted = true;
      operation.acceptedState = value.state;
      publish({ phase: "accepted", error: "" });
      return;
    }
    if (value.type === "completed") {
      if (!exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "commandId", "state", "description"])
        || !text(value.description, 2000, true) || (!operation.accepted && !operation.command.retry)
        || (operation.command.completionState !== "unchanged" && value.state !== operation.command.completionState)
        || (operation.command.completionState === "unchanged" && operation.accepted && value.state !== operation.acceptedState)) return;
      publish({ phase: "ready", error: "" });
      settle(id, null, structuredClone(value));
    } else if (value.type === "failed") {
      if (!exactKeys(value, ["protocolVersion", "playerInstanceId", "type", "commandId", "state", "code", "description"])
        || !identity(value.code) || !text(value.description, 2000, true)) return;
      publish({ phase: "ready", error: value.description });
      settle(id, Object.assign(new Error(value.description), { code: value.code }));
    } else return;
    // A cached completion describes its original command, not today's display.
    // Ask the original controller for the actual current semantic state.
    snapshot().catch(() => {});
  }

  function command({ commandId, name, parameters = {} } = {}) {
    const declared = commands.get(name);
    if (!identity(commandId) || !declared || !object(parameters)
      || Object.keys(parameters).some(key => !declared.parameters.has(key))) {
      return Promise.reject(new Error("Choose a declared diagram command and bounded parameters."));
    }
    for (const [key, parameter] of declared.parameters) {
      if (parameters[key] === undefined && !parameter.required) continue;
      if (!text(parameters[key], parameter.maxLength)) return Promise.reject(new Error(`Diagram parameter ${key} is missing or invalid.`));
    }
    const input = JSON.stringify([name, Object.keys(parameters).sort().map(key => [key, parameters[key]])]);
    const previous = commandInputs.get(commandId);
    if (previous && previous.input !== input) return Promise.reject(new Error("This diagram command ID already names different input."));
    if (pending.has(commandId)) return pending.get(commandId).promise;
    if (!current?.ready || closed) return Promise.reject(new Error("The diagram is not ready. Reload it before sending a command."));
    if (previous && previous.instanceId !== current.id) return Promise.reject(new Error("The original diagram instance and retry receipt are gone. Use a new ID only for an intentional new command."));
    if (!previous && commandInputs.size >= MAX_COMMAND_IDS) return Promise.reject(new Error("This diagram reached its 64 command-ID limit. Reopen it explicitly; no retry identity was discarded."));
    if (!previous) commandInputs.set(commandId, { input, instanceId: current.id });
    return request("command", commandId, { type: "command", commandId, name, parameters: structuredClone(parameters) },
      { retry: Boolean(previous), completionState: declared.completionState });
  }

  function restore(value = savedSnapshot, motion = reducedMotion) {
    if (closed) return Promise.reject(new Error("The diagram player is closed."));
    if (typeof motion !== "boolean") throw new Error("Choose a boolean reduced-motion preference for the diagram.");
    const semantic = value === undefined ? undefined : semanticSnapshot(value, states);
    reducedMotion = motion;
    retire(new Error("The diagram instance changed; unfinished commands were not replayed."));
    const instance = { id: view.crypto.randomUUID(), token: view.crypto.randomUUID(), ready: false,
      initialState: semantic?.state ?? visual.initialState };
    const ready = new Promise((resolve, reject) => { instance.resolveReady = resolve; instance.rejectReady = reject; });
    // Presentation-only consumers can observe failed state without awaiting ready.
    ready.catch(() => {});
    instance.handshake = event => {
      const value = event.data;
      if (current !== instance || event.source !== iframe.contentWindow || instance.port
        || !exactKeys(value, ["type", "protocolVersion", "playerInstanceId", "token"])
        || value.type !== "vibe64-visual-handshake" || value.protocolVersion !== PROTOCOL_VERSION
        || value.playerInstanceId !== instance.id || value.token !== instance.token) return;
      const channel = new view.MessageChannel();
      instance.port = channel.port1;
      instance.port.onmessage = event => receive(instance, event.data);
      instance.port.start();
      try {
        iframe.contentWindow.postMessage({ type: "vibe64-visual-init", protocolVersion: PROTOCOL_VERSION,
          playerInstanceId: instance.id, token: instance.token,
          init: { protocolVersion: PROTOCOL_VERSION, playerInstanceId: instance.id,
            initialState: instance.initialState, reducedMotion, ...(semantic ? { snapshot: semantic } : {}) }
        }, "*", [channel.port2]);
      } catch {
        channel.port2.close();
        fail("The diagram channel could not be transferred. Reload its saved state.");
      }
      view.removeEventListener("message", instance.handshake);
    };
    current = instance;
    savedSnapshot = semantic;
    display = { state: instance.initialState, description: visual.description };
    publish({ playerInstanceId: instance.id, phase: "loading", ...display, error: "" });
    instance.timer = setTimeout(() => {
      if (current === instance) fail("The diagram did not become ready. Reload it or ask the owner to check its verified controller.");
    }, timeoutMs);
    view.addEventListener("message", instance.handshake);
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.removeAttribute("allow");
    iframe.removeAttribute("src");
    iframe.srcdoc = frameDocument({ playerInstanceId: instance.id, token: instance.token, svg, controller });
    return ready;
  }

  function dispose() {
    if (closed) return;
    closed = true;
    retire(new Error("The diagram player closed; unfinished commands were not replayed."));
    publish({ phase: "disposed" });
  }

  const ready = restore(savedSnapshot);
  return { ready, command, snapshot, restore, dispose, get state() { return structuredClone(status); } };
}

export { createTrainingVisualPlayer };
