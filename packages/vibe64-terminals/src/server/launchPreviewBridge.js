import {
  PREVIEW_APP_REQUEST_MESSAGE_TYPE,
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
} from "../shared/launchPreviewProtocol.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import {
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_INTERACTION_HEADER
} from "@local/vibe64-usage-recording/shared/contract";

// The project's Preview locator runs as its own script after the bridge, so a
// locator that throws or fails to parse leaves the bridge working. Its text is
// kept from closing the element early or opening an HTML comment.
function previewLocatorScript(source = "") {
  const text = typeof source === "string" ? source : "";
  if (!text.trim()) {
    return "";
  }
  return `<script data-vibe64-preview-locator="1">(() => {\n${text.replace(/<(?=\/script|!--)/giu, "\\x3C")}\n})();</script>`;
}

// The bridge talks only to the editors that asked for this Preview: it ignores
// messages from any other parent origin and addresses every reply to those
// editor origins, so a foreign page that frames the Preview learns nothing.
// `recording` is the session's Preview recording when the page was served; the
// editor keeps it current and numbers its interactions.
function launchPreviewBridgeScript({
  debug = false,
  locatorSource = "",
  parentOrigins = [],
  recording = null,
  targetOrigin = ""
} = {}) {
  const recordingId = String(recording?.recordingId || "");
  const config = JSON.stringify({
    appRequestMessageType: PREVIEW_APP_REQUEST_MESSAGE_TYPE,
    bridgeReadyMessageType: PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
    debug: debug === true,
    diagnosticsRequestMessageType: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
    diagnosticsResponseMessageType: PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
    identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
    identityRequestMessageType: PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
    identityResponseMessageType: PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
    interactionHeader: USAGE_RECORDING_INTERACTION_HEADER,
    interactionMessageType: PREVIEW_INTERACTION_MESSAGE_TYPE,
    locationMessageType: PREVIEW_LOCATION_MESSAGE_TYPE,
    parentOrigins: [...new Set((Array.isArray(parentOrigins) ? parentOrigins : [])
      .map((origin) => String(origin || "").trim())
      .filter(Boolean))],
    pickResultMessageType: PREVIEW_PICK_RESULT_MESSAGE_TYPE,
    pickStartMessageType: PREVIEW_PICK_START_MESSAGE_TYPE,
    pickStopMessageType: PREVIEW_PICK_STOP_MESSAGE_TYPE,
    queryMessageType: PREVIEW_QUERY_MESSAGE_TYPE,
    recording: recording?.active === true && USAGE_RECORDING_ID_PATTERN.test(recordingId) ? recordingId : "",
    recordingIdPattern: USAGE_RECORDING_ID_PATTERN.source,
    recordingMessageType: PREVIEW_RECORDING_MESSAGE_TYPE,
    resourceFailureMessageType: PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE,
    targetOrigin: String(targetOrigin || ""),
    tokenQueryParam: PREVIEW_PROXY_TOKEN_QUERY_PARAM,
    version: PREVIEW_BRIDGE_VERSION
  });

  return `<script data-vibe64-preview-bridge="1">(() => {
  const config = ${config};
  if (window.__vibe64PreviewBridge && window.__vibe64PreviewBridge.version >= config.version) {
    return;
  }
  let lastHref = "";
  function postToParent(message) {
    for (const origin of config.parentOrigins) {
      window.parent.postMessage(message, origin);
    }
  }
  let consoleCharacterCount = 0;
  let consoleDroppedEntryCount = 0;
  let consoleSequence = 0;
  let networkCharacterCount = 0;
  let networkDroppedEntryCount = 0;
  let networkSequence = 0;
  let networkSuppressedResourceCount = 0;
  let resourceFailurePublished = false;
  let resourceFailureCount = 0;
  const consoleEntries = [];
  const networkEntries = [];
  const networkEntryCharacterCounts = new WeakMap();
  const maxConsoleCharacters = 200000;
  const maxConsoleEntries = 500;
  const maxConsoleEntryCharacters = 12000;
  const maxNetworkCharacters = 350000;
  const maxNetworkEntries = 250;
  const maxNetworkValueCharacters = 24000;
  function clippedConsoleText(value, limit = maxConsoleEntryCharacters) {
    const text = String(value ?? "");
    return text.length > limit
      ? text.slice(0, Math.max(0, limit - 18)) + "… [truncated]"
      : text;
  }
  function consoleErrorValue(value) {
    return {
      message: String(value?.message || ""),
      name: String(value?.name || "Error"),
      stack: String(value?.stack || "")
    };
  }
  function consoleJsonValue(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, candidate) => {
      if (typeof candidate === "bigint") {
        return String(candidate) + "n";
      }
      if (typeof candidate === "function") {
        return "[Function " + String(candidate.name || "anonymous") + "]";
      }
      if (typeof candidate === "symbol") {
        return String(candidate);
      }
      if (candidate instanceof Error) {
        return consoleErrorValue(candidate);
      }
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) {
          return "[Circular]";
        }
        seen.add(candidate);
        if (typeof Element === "function" && candidate instanceof Element) {
          return "<" + String(candidate.tagName || "element").toLowerCase() + ">";
        }
      }
      return candidate;
    });
  }
  function formatConsoleValue(value) {
    if (typeof value === "string") {
      return clippedConsoleText(value);
    }
    if (value instanceof Error) {
      return clippedConsoleText(value.stack || (value.name + ": " + value.message));
    }
    if (value === undefined) {
      return "undefined";
    }
    if (value === null) {
      return "null";
    }
    try {
      const json = consoleJsonValue(value);
      if (json !== undefined) {
        return clippedConsoleText(json);
      }
    } catch {
      // Fall through to the value's string representation.
    }
    try {
      return clippedConsoleText(String(value));
    } catch {
      return "[Unserializable value]";
    }
  }
  function appendConsoleEntry(level, values = [], source = "console") {
    const args = Array.from(values || []).slice(0, 20);
    const extraCount = Math.max(0, Number(values?.length || 0) - args.length);
    const text = clippedConsoleText([
      ...args.map(formatConsoleValue),
      ...(extraCount > 0 ? ["… " + extraCount + " more values"] : [])
    ].join(" "));
    const entry = {
      level: String(level || "log"),
      sequence: ++consoleSequence,
      source: String(source || "console"),
      text,
      timestamp: new Date().toISOString()
    };
    consoleEntries.push(entry);
    consoleCharacterCount += text.length;
    while (
      consoleEntries.length > maxConsoleEntries ||
      consoleCharacterCount > maxConsoleCharacters
    ) {
      const removed = consoleEntries.shift();
      consoleCharacterCount = Math.max(0, consoleCharacterCount - String(removed?.text || "").length);
      consoleDroppedEntryCount += 1;
    }
  }
  function networkEntryCharacters(entry) {
    try {
      return JSON.stringify(entry).length;
    } catch {
      return maxNetworkValueCharacters;
    }
  }
  function pruneNetworkEntries() {
    while (
      networkEntries.length > maxNetworkEntries ||
      networkCharacterCount > maxNetworkCharacters
    ) {
      const removed = networkEntries.shift();
      networkCharacterCount = Math.max(
        0,
        networkCharacterCount - Number(networkEntryCharacterCounts.get(removed) || 0)
      );
      networkEntryCharacterCounts.delete(removed);
      networkDroppedEntryCount += 1;
    }
  }
  function appendNetworkEntry(values = {}) {
    const entry = {
      durationMs: 0,
      error: "",
      phase: String(values.phase || "complete"),
      requestBody: "",
      requestHeaders: {},
      responseBody: "",
      responseHeaders: {},
      sequence: ++networkSequence,
      status: 0,
      statusText: "",
      timestamp: new Date().toISOString(),
      ...values,
      kind: String(values.kind || "resource"),
      method: String(values.method || "GET").toUpperCase(),
      url: targetResourceHref(values.url || window.location.href)
    };
    networkEntries.push(entry);
    const characters = networkEntryCharacters(entry);
    networkEntryCharacterCounts.set(entry, characters);
    networkCharacterCount += characters;
    pruneNetworkEntries();
    return entry;
  }
  function updateNetworkEntry(entry, values = {}) {
    if (!entry || !networkEntries.includes(entry)) {
      return;
    }
    const previousCharacters = Number(networkEntryCharacterCounts.get(entry) || 0);
    Object.assign(entry, values);
    const nextCharacters = networkEntryCharacters(entry);
    networkEntryCharacterCounts.set(entry, nextCharacters);
    networkCharacterCount += nextCharacters - previousCharacters;
    pruneNetworkEntries();
  }
  function networkHeaders(value) {
    const result = {};
    try {
      const headers = new Headers(value || {});
      let count = 0;
      for (const [name, headerValue] of headers.entries()) {
        if (count >= 100) {
          result["…"] = "additional headers omitted";
          break;
        }
        result[String(name)] = clippedConsoleText(headerValue, 4000);
        count += 1;
      }
    } catch {
      return {};
    }
    return result;
  }
  function networkBodyValue(value) {
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return clippedConsoleText(value, maxNetworkValueCharacters);
    }
    if (typeof URLSearchParams === "function" && value instanceof URLSearchParams) {
      return clippedConsoleText(value.toString(), maxNetworkValueCharacters);
    }
    if (typeof FormData === "function" && value instanceof FormData) {
      const fields = [];
      for (const [name, fieldValue] of value.entries()) {
        const text = typeof fieldValue === "string"
          ? fieldValue
          : "[File " + String(fieldValue?.name || "unnamed") + ", " + Number(fieldValue?.size || 0) + " bytes]";
        fields.push(String(name) + "=" + text);
      }
      return clippedConsoleText(fields.join("&"), maxNetworkValueCharacters);
    }
    if (typeof Blob === "function" && value instanceof Blob) {
      return "[Blob " + String(value.type || "application/octet-stream") + ", " + value.size + " bytes]";
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      return "[Binary data, " + Number(value.byteLength || 0) + " bytes]";
    }
    return clippedConsoleText(formatConsoleValue(value), maxNetworkValueCharacters);
  }
  function responseBodyIsText(response) {
    const contentType = String(response?.headers?.get?.("content-type") || "").toLowerCase();
    return !contentType || /(?:json|text|xml|javascript|x-www-form-urlencoded)/u.test(contentType);
  }
  async function streamedTextPreview(body) {
    const reader = body?.getReader?.();
    if (!reader || typeof TextDecoder !== "function") {
      return null;
    }
    const decoder = new TextDecoder();
    let byteCount = 0;
    let text = "";
    let truncated = false;
    try {
      while (byteCount < maxNetworkValueCharacters) {
        const chunk = await reader.read();
        if (chunk.done) {
          text += decoder.decode();
          return clippedConsoleText(text, maxNetworkValueCharacters);
        }
        const value = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value || []);
        const remaining = maxNetworkValueCharacters - byteCount;
        const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
        byteCount += accepted.byteLength;
        text += decoder.decode(accepted, { stream: true });
        if (accepted.byteLength < value.byteLength) {
          truncated = true;
          break;
        }
      }
      truncated = true;
    } finally {
      if (truncated) {
        await reader.cancel?.().catch?.(() => null);
      }
    }
    return clippedConsoleText(text + "… [truncated]", maxNetworkValueCharacters);
  }
  async function responseBodyPreview(response) {
    if (!responseBodyIsText(response)) {
      const contentType = String(response?.headers?.get?.("content-type") || "binary response");
      const length = String(response?.headers?.get?.("content-length") || "unknown size");
      return "[" + contentType + ", " + length + "]";
    }
    try {
      const streamed = await streamedTextPreview(response.body);
      return streamed === null
        ? clippedConsoleText(await response.text(), maxNetworkValueCharacters)
        : streamed;
    } catch (error) {
      return "[Response body unavailable: " + formatConsoleValue(error) + "]";
    }
  }
  async function requestBodyPreview(input, init = {}) {
    if (init?.body !== undefined && init.body !== null) {
      return networkBodyValue(init.body);
    }
    if (typeof Request === "function" && input instanceof Request && !input.bodyUsed) {
      try {
        const clone = input.clone();
        const streamed = await streamedTextPreview(clone.body);
        return streamed === null
          ? clippedConsoleText(await clone.text(), maxNetworkValueCharacters)
          : streamed;
      } catch {
        return "[Request body unavailable]";
      }
    }
    return "";
  }
  function elapsedMilliseconds(startedAt) {
    return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
  }
  // Click in Preview. Pick outlines the element under the pointer and turns the
  // next click into a pick; only in Pick is a click prevented and stopped.
  // While the editor names an active recording, a trusted click, submit or
  // Enter starts an interaction without preventing anything, and same-origin
  // fetch and XHR started within 1 s of it, before the next one, carry its id.
  // Labels name an element by role or tag and a label the page shows, never by
  // what a person typed or chose; a password field is only "password field".
  const fieldTags = ["input", "select", "textarea"];
  const skippedTextTags = ["option", "script", "style", "template", ...fieldTags];
  const inputRoles = {
    button: "button", checkbox: "checkbox", image: "button", radio: "radio",
    range: "slider", reset: "button", search: "searchbox", submit: "button"
  };
  const implicitRoles = {
    a: "link", button: "button", form: "form", h1: "heading", h2: "heading", h3: "heading",
    h4: "heading", h5: "heading", h6: "heading", img: "img", select: "combobox",
    summary: "button", textarea: "textbox"
  };
  const contentNamedRoles = [
    "button", "cell", "checkbox", "columnheader", "heading", "link", "menuitem", "menuitemcheckbox",
    "menuitemradio", "radio", "rowheader", "switch", "tab", "treeitem"
  ];
  const interactiveSelector = "a[href],button,input,select,textarea,summary,label," + [
    "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
    "checkbox", "radio", "switch", "treeitem"
  ].map((role) => "[role=" + role + "]").join(",");
  const recordingIdPattern = new RegExp(config.recordingIdPattern, "u");
  let pick = null;
  let recording = config.recording;
  let nextInteraction = 0;
  let interaction = null;
  let gestureOpen = false;
  function elementTag(element) {
    return String(element?.tagName || "").toLowerCase();
  }
  function editableText(element) {
    return fieldTags.includes(elementTag(element)) || element?.isContentEditable === true;
  }
  function visibleText(node, budget = { left: 200 }) {
    if (!node || editableText(node)) {
      return "";
    }
    let text = "";
    for (const child of Array.from(node.childNodes || [])) {
      if (budget.left <= 0) {
        break;
      }
      if (child.nodeType === 3) {
        const value = String(child.nodeValue || "");
        text += value.slice(0, budget.left);
        budget.left -= value.length;
      } else if (child.nodeType === 1 && !skippedTextTags.includes(elementTag(child)) && child.isContentEditable !== true) {
        text += " " + visibleText(child, budget);
      }
    }
    return text;
  }
  function clippedLabel(value, limit) {
    const text = String(value || "").replace(/\\s+/gu, " ").trim();
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  }
  function accessibleName(element, role, tag) {
    const ariaLabel = String(element.getAttribute("aria-label") || "");
    if (ariaLabel.trim()) {
      return ariaLabel;
    }
    const labelledBy = String(element.getAttribute("aria-labelledby") || "").trim();
    const labelledText = labelledBy
      ? labelledBy.split(/\\s+/u).map((id) => visibleText(document.getElementById(id))).join(" ")
      : "";
    if (labelledText.trim()) {
      return labelledText;
    }
    if (fieldTags.includes(tag)) {
      const labelText = Array.from(element.labels || []).map((label) => visibleText(label)).join(" ");
      return labelText.trim() ? labelText : element.getAttribute("placeholder") || element.getAttribute("title") || "";
    }
    if (contentNamedRoles.includes(role) || tag === "label") {
      return visibleText(element) || element.getAttribute("title") || "";
    }
    return element.getAttribute("title") || element.getAttribute("alt") || "";
  }
  function elementLabel(element) {
    const target = element?.closest?.(interactiveSelector) || element;
    if (!target || typeof target.getAttribute !== "function") {
      return "element";
    }
    const tag = elementTag(target) || "element";
    const type = tag === "input" ? String(target.getAttribute("type") || "text").toLowerCase() : "";
    if (type === "password") {
      return "password field";
    }
    const role = String(target.getAttribute("role") || "").trim().split(/\\s+/u)[0].toLowerCase() ||
      (tag === "input" ? inputRoles[type] || "textbox" : implicitRoles[tag] || "");
    const name = clippedLabel(accessibleName(target, role, tag), 40);
    return name ? (role || tag) + " \\"" + name + "\\"" : role || tag;
  }
  // The project's locator maps an element to the component the dev build names.
  function locateComponent(element) {
    try {
      const located = typeof globalThis.__vibe64LocateElement === "function"
        ? globalThis.__vibe64LocateElement(element)
        : null;
      const file = typeof located?.file === "string" ? located.file.trim().slice(0, 1024) : "";
      const name = typeof located?.name === "string" ? located.name.trim().slice(0, 80) : "";
      return { componentFile: file || null, componentName: name || null };
    } catch {
      return { componentFile: null, componentName: null };
    }
  }
  function startPick() {
    if (pick) {
      return;
    }
    const overlay = document.createElement("div");
    const chip = document.createElement("span");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("data-vibe64-preview-pick", "1");
    overlay.style.cssText = "all:initial;position:fixed;z-index:2147483647;pointer-events:none;" +
      "box-sizing:border-box;border:2px solid #6750a4;border-radius:4px;display:none";
    chip.style.cssText = "all:initial;position:absolute;left:-2px;max-width:min(320px,90vw);padding:2px 8px;" +
      "border-radius:8px;background:#6750a4;color:#fff;font:500 12px/20px system-ui,sans-serif;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    overlay.append(chip);
    document.documentElement.append(overlay);
    pick = { chip, element: null, overlay };
  }
  function stopPick() {
    pick?.overlay.remove();
    pick = null;
  }
  function showPickTarget(element) {
    if (!pick || !element || element === pick.element || typeof element.getBoundingClientRect !== "function") {
      return;
    }
    pick.element = element;
    const rect = element.getBoundingClientRect();
    Object.assign(pick.overlay.style, {
      display: "block",
      height: rect.height + "px",
      left: rect.left + "px",
      top: rect.top + "px",
      width: rect.width + "px"
    });
    pick.chip.textContent = locateComponent(element).componentName || elementLabel(element);
    pick.chip.style.top = rect.top >= 24 ? "-24px" : "0";
  }
  function stopPickEvent(event) {
    if (!pick) {
      return false;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  function beginInteraction(event) {
    if (!recording || nextInteraction < 1 || pick || event?.isTrusted !== true) {
      return;
    }
    if (event.type === "keydown" && (
      event.key !== "Enter" || event.repeat || event.isComposing ||
      elementTag(event.target) === "textarea" || event.target?.isContentEditable === true
    )) {
      return;
    }
    // One gesture is one interaction: the submit that a click or Enter causes
    // in the same task does not start another.
    if (gestureOpen || nextInteraction > 999999) {
      return;
    }
    gestureOpen = true;
    setTimeout(() => {
      gestureOpen = false;
    }, 0);
    const element = event.type === "submit" ? event.submitter || event.target : event.target;
    interaction = {
      id: "i_" + String(nextInteraction).padStart(4, "0"),
      startedAt: performance.now()
    };
    nextInteraction += 1;
    postToParent({
      at: new Date().toISOString(),
      componentFile: locateComponent(element).componentFile,
      elementLabel: elementLabel(element),
      id: interaction.id,
      type: config.interactionMessageType,
      version: config.version
    });
  }
  // Only a request to this page's own origin may carry the interaction id.
  function interactionHeaderValue(url) {
    if (!recording || !interaction || performance.now() - interaction.startedAt > 1000) {
      return "";
    }
    try {
      return new URL(String(url || ""), window.location.href).origin === window.location.origin
        ? interaction.id
        : "";
    } catch {
      return "";
    }
  }
  function withInteractionHeader(input, init, interactionId) {
    const headers = new Headers(init?.headers ||
      (typeof Request === "function" && input instanceof Request ? input.headers : undefined));
    headers.set(config.interactionHeader, interactionId);
    return { ...init, headers };
  }
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"]) {
    window.addEventListener(type, (event) => {
      if (stopPickEvent(event) && type === "pointerdown") {
        showPickTarget(event.target);
      }
    }, true);
  }
  window.addEventListener("pointermove", (event) => {
    showPickTarget(event.target);
  }, true);
  window.addEventListener("click", (event) => {
    if (stopPickEvent(event)) {
      const element = event.target;
      const located = locateComponent(element);
      const label = elementLabel(element);
      stopPick();
      postToParent({
        ...located,
        elementLabel: label,
        type: config.pickResultMessageType,
        version: config.version
      });
      return;
    }
    beginInteraction(event);
  }, true);
  window.addEventListener("submit", beginInteraction, true);
  window.addEventListener("keydown", (event) => {
    if (pick && event.key === "Escape") {
      stopPickEvent(event);
      stopPick();
      postToParent({
        cancelled: true,
        type: config.pickResultMessageType,
        version: config.version
      });
      return;
    }
    beginInteraction(event);
  }, true);
  // Learning sees only a reduced failure of a same-origin, data-changing request
  // started within 3 s of a trusted learner click/submit in this frame: method,
  // path with numeric/UUID segments as :id, status and a failure code. Bodies,
  // headers, queries, fragments and the diagnostics feed above never join it.
  let learnerGestureAt = -Infinity;
  for (const gestureType of ["click", "submit"]) {
    window.addEventListener(gestureType, (event) => {
      if (event?.isTrusted === true) {
        learnerGestureAt = performance.now();
      }
    }, true);
  }
  function appRequestCandidate(method, url) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(normalizedMethod) ||
        performance.now() - learnerGestureAt > 3000) {
      return null;
    }
    try {
      const resource = new URL(String(url || ""), window.location.href);
      if (resource.origin !== window.location.origin) {
        return null;
      }
      const pathTemplate = resource.pathname.split("/").map((segment) =>
        /^(?:\\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.test(segment) ? ":id" : segment
      ).join("/").slice(0, 256);
      return { method: normalizedMethod, pathTemplate };
    } catch {
      return null;
    }
  }
  function publishAppRequest(candidate, status) {
    const code = Math.max(0, Math.min(599, Number(status) || 0));
    const failure = code >= 500 ? "http-5xx" : code >= 400 ? "http-4xx" : code === 0 ? "network" : "";
    if (!candidate || !failure) {
      return;
    }
    postToParent({
      failure,
      method: candidate.method,
      pathTemplate: candidate.pathTemplate,
      status: code,
      type: config.appRequestMessageType,
      version: config.version
    });
  }
  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = async function vibe64PreviewFetch(input, init = {}) {
      const interactionId = interactionHeaderValue(input?.url || input);
      const fetchArguments = interactionId ? [input, withInteractionHeader(input, init, interactionId)] : arguments;
      const startedAt = performance.now();
      const entry = appendNetworkEntry({
        kind: "fetch",
        method: String(init?.method || input?.method || "GET"),
        phase: "pending",
        requestHeaders: networkHeaders(init?.headers || input?.headers),
        url: String(input?.url || input || "")
      });
      const appRequest = appRequestCandidate(init?.method || input?.method, input?.url || input);
      void requestBodyPreview(input, init).then((requestBody) => {
        updateNetworkEntry(entry, { requestBody });
      });
      try {
        const response = await originalFetch.apply(this, fetchArguments);
        publishAppRequest(appRequest, response.status);
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          phase: "complete",
          responseHeaders: networkHeaders(response.headers),
          status: Number(response.status || 0),
          statusText: String(response.statusText || ""),
          url: targetResourceHref(response.url || entry.url)
        });
        void responseBodyPreview(response.clone()).then((responseBody) => {
          updateNetworkEntry(entry, { responseBody });
        });
        return response;
      } catch (error) {
        publishAppRequest(appRequest, 0);
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: formatConsoleValue(error),
          phase: "failed"
        });
        throw error;
      }
    };
  }
  const xhrMetadata = new WeakMap();
  const xhrPrototype = window.XMLHttpRequest?.prototype;
  const originalXhrOpen = xhrPrototype?.open;
  const originalXhrSend = xhrPrototype?.send;
  const originalXhrSetRequestHeader = xhrPrototype?.setRequestHeader;
  if (typeof originalXhrOpen === "function" && typeof originalXhrSend === "function") {
    xhrPrototype.open = function vibe64PreviewXhrOpen(method, url, ...args) {
      xhrMetadata.set(this, {
        headers: {},
        method: String(method || "GET"),
        url: String(url || "")
      });
      return originalXhrOpen.call(this, method, url, ...args);
    };
    if (typeof originalXhrSetRequestHeader === "function") {
      xhrPrototype.setRequestHeader = function vibe64PreviewXhrSetRequestHeader(name, value) {
        const metadata = xhrMetadata.get(this);
        if (metadata) {
          metadata.headers[String(name)] = String(value);
        }
        return originalXhrSetRequestHeader.call(this, name, value);
      };
    }
    xhrPrototype.send = function vibe64PreviewXhrSend(body) {
      const metadata = xhrMetadata.get(this) || { headers: {}, method: "GET", url: "" };
      const startedAt = performance.now();
      const entry = appendNetworkEntry({
        kind: "xhr",
        method: metadata.method,
        phase: "pending",
        requestBody: networkBodyValue(body),
        requestHeaders: networkHeaders(metadata.headers),
        url: metadata.url
      });
      const appRequest = appRequestCandidate(metadata.method, metadata.url);
      const interactionId = interactionHeaderValue(metadata.url);
      if (interactionId && typeof originalXhrSetRequestHeader === "function") {
        originalXhrSetRequestHeader.call(this, config.interactionHeader, interactionId);
      }
      this.addEventListener("loadend", () => {
        publishAppRequest(appRequest, this.status);
        let responseBody = "";
        try {
          if (!this.responseType || this.responseType === "text") {
            responseBody = clippedConsoleText(this.responseText, maxNetworkValueCharacters);
          } else if (this.responseType === "json") {
            responseBody = clippedConsoleText(formatConsoleValue(this.response), maxNetworkValueCharacters);
          } else {
            responseBody = networkBodyValue(this.response);
          }
        } catch (error) {
          responseBody = "[Response body unavailable: " + formatConsoleValue(error) + "]";
        }
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: this.status === 0 ? String(this.statusText || "Request failed") : "",
          phase: this.status === 0 ? "failed" : "complete",
          responseBody,
          responseHeaders: networkHeaders(String(this.getAllResponseHeaders?.() || "")
            .split(/\\r?\\n/u)
            .filter(Boolean)
            .map((line) => {
              const separator = line.indexOf(":");
              return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1).trim()] : [line, ""];
            })),
          status: Number(this.status || 0),
          statusText: String(this.statusText || ""),
          url: targetResourceHref(this.responseURL || entry.url)
        });
      }, { once: true });
      try {
        return originalXhrSend.call(this, body);
      } catch (error) {
        updateNetworkEntry(entry, {
          durationMs: elapsedMilliseconds(startedAt),
          error: formatConsoleValue(error),
          phase: "failed"
        });
        throw error;
      }
    };
  }
  function recordPerformanceResource(resource) {
    const initiatorType = String(resource?.initiatorType || "resource");
    if (["fetch", "xmlhttprequest"].includes(initiatorType)) {
      return;
    }
    if (Number(resource?.responseStatus || 0) >= 400) {
      return;
    }
    networkSuppressedResourceCount += 1;
  }
  if (typeof PerformanceObserver === "function") {
    try {
      const resourceObserver = new PerformanceObserver((list) => {
        for (const resource of list.getEntries()) {
          recordPerformanceResource(resource);
        }
      });
      resourceObserver.observe({ buffered: true, type: "resource" });
    } catch {
      // Resource timing remains optional in older browsers.
    }
  }
  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket === "function") {
    window.WebSocket = class Vibe64PreviewWebSocket extends OriginalWebSocket {
      constructor(url, protocols) {
        if (protocols === undefined) {
          super(url);
        } else {
          super(url, protocols);
        }
        const socketUrl = targetResourceHref(url);
        appendNetworkEntry({ kind: "websocket", method: "CONNECT", phase: "pending", url: socketUrl });
        this.addEventListener("open", () => {
          appendNetworkEntry({ kind: "websocket", method: "OPEN", phase: "complete", url: socketUrl });
        });
        this.addEventListener("message", (event) => {
          appendNetworkEntry({
            kind: "websocket",
            method: "RECEIVE",
            phase: "complete",
            responseBody: networkBodyValue(event.data),
            url: socketUrl
          });
        });
        this.addEventListener("close", (event) => {
          appendNetworkEntry({
            kind: "websocket",
            method: "CLOSE",
            phase: "complete",
            status: Number(event.code || 0),
            statusText: String(event.reason || ""),
            url: socketUrl
          });
        });
        this.addEventListener("error", () => {
          appendNetworkEntry({ kind: "websocket", method: "ERROR", phase: "failed", url: socketUrl });
        });
      }
      send(data) {
        appendNetworkEntry({
          kind: "websocket",
          method: "SEND",
          phase: "complete",
          requestBody: networkBodyValue(data),
          url: targetResourceHref(this.url)
        });
        return super.send(data);
      }
    };
  }
  function internalConsoleMessage(values = []) {
    return typeof values?.[0] === "string" && values[0].startsWith("[VIBE64_SESSION_DEBUG]");
  }
  const originalConsoleError = typeof window.console?.error === "function"
    ? window.console.error.bind(window.console)
    : null;
  for (const level of ["debug", "error", "info", "log", "warn"]) {
    const original = window.console?.[level];
    if (typeof original !== "function") {
      continue;
    }
    window.console[level] = function vibe64PreviewConsoleMethod(...values) {
      if (!internalConsoleMessage(values)) {
        appendConsoleEntry(level, values);
      }
      return original.apply(this, values);
    };
  }
  window.addEventListener("error", (event) => {
    if (event instanceof ErrorEvent) {
      appendConsoleEntry("error", [
        event.error || event.message || "Uncaught error",
        event.filename ? "at " + event.filename + ":" + event.lineno + ":" + event.colno : ""
      ].filter(Boolean), "exception");
      return;
    }
    const target = event.target;
    const resourceUrl = String(target?.currentSrc || target?.src || target?.href || "");
    if (target && target !== window && resourceUrl) {
      const resourceKind = String(target.tagName || "resource").toLowerCase();
      const resourceRole = String(target?.rel || target?.as || "").toLowerCase();
      const applicationResource = resourceKind === "script" || (
        resourceKind === "link" && /(?:^|\\s)(?:modulepreload|preload|stylesheet)(?:\\s|$)/u.test(resourceRole)
      );
      const safeResourceUrl = targetResourceHref(resourceUrl);
      appendConsoleEntry("error", [
        "Failed to load " + resourceKind + ":",
        safeResourceUrl
      ], "resource");
      originalConsoleError?.(
        "[Vibe64 preview] Application resource failed to load.",
        safeResourceUrl
      );
      appendNetworkEntry({
        error: "Resource failed to load",
        kind: resourceKind,
        method: "GET",
        phase: "failed",
        url: safeResourceUrl
      });
      if (applicationResource && resourceFailureCount++ < 50) {
        const recover = !resourceFailurePublished;
        resourceFailurePublished = true;
        postToParent({
          recover,
          href: safeResourceUrl,
          kind: resourceKind,
          timestamp: new Date().toISOString(),
          type: config.resourceFailureMessageType,
          version: config.version
        });
      }
    }
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    appendConsoleEntry("error", ["Unhandled promise rejection:", event.reason], "unhandledrejection");
  });
  function debugLog(event, details = {}) {
    if (config.debug !== true) {
      return;
    }
    const entry = {
      marker: "VIBE64_SESSION_DEBUG",
      timestamp: new Date().toISOString(),
      event: "browser.launchPreviewBridge." + String(event || ""),
      ...details
    };
    try {
      console.info("[VIBE64_SESSION_DEBUG] " + JSON.stringify(entry));
    } catch {
      console.info("[VIBE64_SESSION_DEBUG] " + entry.timestamp + " " + entry.event);
    }
  }
  function targetHref() {
    try {
      const current = new URL(window.location.href);
      if (!config.targetOrigin) {
        return current.toString();
      }
      const target = new URL(config.targetOrigin);
      target.pathname = current.pathname;
      target.search = current.search;
      target.hash = current.hash;
      return target.toString();
    } catch {
      return String(window.location.href || "");
    }
  }
  function targetResourceHref(value) {
    try {
      const resource = new URL(String(value || ""), window.location.href);
      resource.searchParams.delete(config.tokenQueryParam);
      if (!config.targetOrigin || resource.host !== window.location.host) {
        return resource.toString();
      }
      const target = new URL(config.targetOrigin);
      if (["ws:", "wss:"].includes(resource.protocol)) {
        target.protocol = resource.protocol;
      }
      target.pathname = resource.pathname;
      target.search = resource.search;
      target.hash = resource.hash;
      return target.toString();
    } catch {
      return String(value || "");
    }
  }
  function publishLocation(reason, options = {}) {
    const href = targetHref();
    if (!href || (options.force !== true && href === lastHref)) {
      return;
    }
    lastHref = href;
    debugLog("location.publish", {
      href,
      reason: String(reason || "location")
    });
    postToParent({
      href,
      reason: String(reason || "location"),
      title: String(document.title || ""),
      type: config.locationMessageType,
      version: config.version
    });
  }
  function wrapHistoryMethod(methodName) {
    const original = window.history && window.history[methodName];
    if (typeof original !== "function") {
      return;
    }
    window.history[methodName] = function vibe64PreviewHistoryMethod(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => publishLocation(methodName));
      return result;
    };
  }
  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");
  window.addEventListener("hashchange", () => publishLocation("hashchange"));
  window.addEventListener("popstate", () => publishLocation("popstate"));
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !config.parentOrigins.includes(event.origin)) {
      return;
    }
    if (event.data?.type === config.pickStartMessageType) {
      startPick();
      return;
    }
    if (event.data?.type === config.pickStopMessageType) {
      stopPick();
      return;
    }
    if (event.data?.type === config.recordingMessageType) {
      const recordingId = String(event.data?.recordingId || "");
      const active = event.data?.active === true && recordingIdPattern.test(recordingId);
      if (!active || recordingId !== recording) {
        nextInteraction = 0;
        interaction = null;
      }
      recording = active ? recordingId : "";
      const next = Number(event.data?.nextInteraction);
      if (recording && Number.isSafeInteger(next) && next > nextInteraction) {
        nextInteraction = next;
      }
      return;
    }
    if (event.data?.type === config.queryMessageType) {
      debugLog("query.received", {
        href: targetHref()
      });
      publishLocation("query", {
        force: true
      });
      return;
    }
    if (event.data?.type === config.identityRequestMessageType) {
      const requestId = String(event.data?.requestId || "");
      const grant = String(event.data?.grant || "");
      void (async () => {
        let payload = {};
        try {
          const response = await originalFetch.call(window, config.identityControlPath, {
            body: JSON.stringify({ grant }),
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              "content-type": "application/json"
            },
            method: "POST"
          });
          try {
            payload = await response.json();
          } catch {
            payload = {};
          }
          if (!response.ok || payload?.ok === false) {
            throw Object.assign(new Error(String(
              payload?.error || "Preview identity exchange failed."
            )), {
              code: String(payload?.code || "vibe64_preview_identity_exchange_failed"),
              signedOut: payload?.signedOut === true
            });
          }
          postToParent({
            identity: payload?.identity || null,
            ok: true,
            requestId,
            type: config.identityResponseMessageType,
            version: config.version
          });
        } catch (error) {
          postToParent({
            code: String(error?.code || "vibe64_preview_identity_exchange_failed"),
            error: String(error?.message || error || "Preview identity exchange failed."),
            ok: false,
            requestId,
            signedOut: error?.signedOut === true,
            type: config.identityResponseMessageType,
            version: config.version
          });
        }
      })();
      return;
    }
    if (event.data?.type === config.diagnosticsRequestMessageType) {
      postToParent({
        diagnostics: {
          capturedAt: new Date().toISOString(),
          console: {
            droppedEntryCount: consoleDroppedEntryCount,
            entries: consoleEntries.slice()
          },
          href: targetHref(),
          network: {
            droppedEntryCount: networkDroppedEntryCount,
            entries: networkEntries.slice(),
            suppressedResourceCount: networkSuppressedResourceCount
          },
          title: String(document.title || "")
        },
        requestId: String(event.data?.requestId || ""),
        type: config.diagnosticsResponseMessageType,
        version: config.version
      });
      return;
    }
  });
  window.__vibe64PreviewBridge = Object.freeze({
    publishLocation: () => publishLocation("manual"),
    version: config.version
  });
  // This handshake means the bridge listeners are installed, not that the app
  // has rendered. It must remain independent of application modules and
  // DOMContentLoaded so a stalled module graph cannot strand preview controls.
  postToParent({
    type: config.bridgeReadyMessageType,
    version: config.version
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      publishLocation("ready");
    }, { once: true });
  } else {
    publishLocation("ready");
  }
  debugLog("init", {
    href: targetHref(),
    readyState: document.readyState,
    targetOrigin: config.targetOrigin,
    version: config.version
  });
})();</script>${previewLocatorScript(locatorSource)}`;
}

function injectLaunchPreviewBridge(html = "", options = {}) {
  const source = String(html || "");
  if (!source || source.includes("data-vibe64-preview-bridge")) {
    return source;
  }
  const bridge = launchPreviewBridgeScript(options);
  if (/<head(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  if (/<body(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<body(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  return `${bridge}${source}`;
}

export {
  injectLaunchPreviewBridge,
  launchPreviewBridgeScript
};
