// What a problem report includes, in a line each, for the person reviewing it before it goes anywhere.

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const count = (list) => (Array.isArray(list) ? list.length : 0);

/** @param {any} session */
function sessionLine(session) {
  if (!session) return "";
  if (session.unreadable) return `${session.sessionId}, which could not be read (${session.unreadable})`;
  const facts = [
    plural(count(session.turns), "turn"),
    plural(count(session.events), "timeline event"),
    session.plan?.title ? `plan "${session.plan.title}" (${session.plan.status || "unknown"})` : "no plan",
    session.routing ? `the AI request's state (${[session.routing.role, session.routing.status, session.routing.delivery].filter(Boolean).join(", ")})` : ""
  ].filter(Boolean);
  return `${session.sessionId}: ${facts.join(", ")}; turns are described, never quoted`;
}

/**
 * @param {Record<string, any>} bundle a collected report
 * @returns {{ label: string, value: string }[]}
 */
function describeProblemReport(bundle) {
  const versions = bundle.versions || {};
  const preview = bundle.session?.preview;
  const lines = [
    { label: "Page", value: [bundle.place?.page, bundle.place?.route].filter(Boolean).join(" · ") || "unknown" },
    { label: "You", value: [bundle.reporter?.username, bundle.reporter?.role].filter(Boolean).join(", ") },
    { label: "Time", value: `the 6 hours to ${bundle.window?.to || bundle.createdAt || ""}` },
    bundle.session ? { label: "Session", value: sessionLine(bundle.session) } : null,
    preview && !preview.unreadable ? { label: "Preview", value: [preview.state, preview.message].filter(Boolean).join(": ") } : null,
    ...(Array.isArray(bundle.host) ? bundle.host : []).map((section) => ({
      label: section.title || section.id,
      value: [section.state, section.lastError?.message || section.lastError?.code].filter(Boolean).join(": ") || "included"
    })),
    { label: "Errors this page saw", value: String(count(bundle.client?.errors)) },
    { label: "Editor crashes", value: String(count(bundle.server?.crashes)) },
    { label: "Versions", value: [versions.app && `app ${versions.app}`, versions.jskit && `JSKIT ${versions.jskit}`,
      versions.genesis && `Genesis ${versions.genesis}`, versions.engine?.engineId && `AI ${[versions.engine.engineId, versions.engine.modelId].filter(Boolean).join(" ")}`,
      ...Object.entries(versions.host || {}).map(([name, value]) => `${name} ${value}`)].filter(Boolean).join(", ") || "unknown" },
    {
      label: "Chat messages",
      value: bundle.chat ? (Array.isArray(bundle.chat.messages) ? plural(bundle.chat.messages.length, "message") : "could not be read") : "not included"
    }
  ];
  return lines.filter(Boolean);
}

export { describeProblemReport };
