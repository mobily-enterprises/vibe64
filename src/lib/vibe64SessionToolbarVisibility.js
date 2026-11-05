const DEFAULT_VISIBLE_SESSION_LIMIT = 3;

function visibleVibe64ToolbarSessions({
  limit = DEFAULT_VISIBLE_SESSION_LIMIT,
  selectedSessionId = "",
  sessions = []
} = {}) {
  const items = Array.isArray(sessions) ? sessions : [];
  const boundedLimit = Math.max(0, Number(limit || 0));
  if (boundedLimit < 1 || items.length <= boundedLimit) {
    return items;
  }
  const selectedId = String(selectedSessionId || "").trim();
  const selectedIndex = items.findIndex((session) => session?.sessionId === selectedId);
  if (selectedIndex < 0 || selectedIndex < boundedLimit) {
    return items.slice(0, boundedLimit);
  }
  return [
    ...items.slice(0, Math.max(0, boundedLimit - 1)),
    items[selectedIndex]
  ];
}

// Session header actions after Save, highest priority first. Save is never
// listed: it always stays in the header. The last action moves into Session
// actions first when the header runs out of room.
const SESSION_HEADER_ACTION_PRIORITY = Object.freeze([
  "temporary-ai",
  "renew",
  "pin",
  "pull-request",
  "prepare-workspace"
]);

function splitVibe64SessionHeaderActions(available = [], slots = Infinity) {
  const ordered = SESSION_HEADER_ACTION_PRIORITY.filter((id) => available.includes(id));
  const count = Math.max(0, Math.floor(Number.isNaN(Number(slots)) ? 0 : Number(slots)));
  return { inline: ordered.slice(0, count), overflow: ordered.slice(count) };
}

// Room the session name strip needs: each name chip at its full label width up
// to the chip's max-width, plus anything else in the strip, such as New session
// while it stays in the header.
function vibe64SessionNameStripWidth(elements = [], maxChipWidth = Infinity) {
  return [...(elements || [])].reduce((total, element) => {
    if (!element.classList?.contains("studio-ai-sessions__tab")) return total + element.offsetWidth + 6;
    const label = element.querySelector(".studio-ai-sessions__tab-label");
    const natural = element.offsetWidth - (label?.clientWidth || 0) + (label?.scrollWidth || 0);
    return total + Math.min(natural, maxChipWidth) + 6;
  }, 0);
}

export {
  DEFAULT_VISIBLE_SESSION_LIMIT,
  SESSION_HEADER_ACTION_PRIORITY,
  splitVibe64SessionHeaderActions,
  vibe64SessionNameStripWidth,
  visibleVibe64ToolbarSessions
};
