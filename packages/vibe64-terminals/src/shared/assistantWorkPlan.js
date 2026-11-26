const PASSES_HEADING = /^## Passes\s*$/iu;

/**
 * Keep checklist recognition identical in stored progress and the plan viewer.
 * A checklist item carries one of three marks: `[ ]` not done yet, `[~]` built
 * (implemented, and its own focused checks pass) and `[x]` proven by
 * Senior's review. `built` is true for a built or proven item, `checked`
 * only for a proven one. Every line of the plan's `## Passes` section, its
 * heading too, has `passes: true`: that section's items are the passes the plan
 * runs after Senior's review, one turn each.
 */
function parseWorkPlanLines(text, options = {}) {
  const { markTechnicalDetails = false } = options;
  let fence = "";
  let passes = false;
  return text.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
      return { text: line, ...(passes ? { passes } : {}) };
    }
    if (!fence && /^## /u.test(line)) passes = PASSES_HEADING.test(line);
    const section = passes ? { passes } : {};
    const item = !fence && /^\s*(?:[-*+]|\d+[.)]) \[([ xX~])\] (.+)$/u.exec(line);
    return item ? { text: item[2], checked: item[1] === "x" || item[1] === "X", built: item[1] !== " ", ...section } : {
      text: line,
      ...section,
      ...(markTechnicalDetails && !fence && /^## Technical details\s*$/iu.test(line) ? { technicalDetails: true } : {})
    };
  });
}

/**
 * Compare the agreed content while allowing checklist progress and completion.
 * Without passes, the plan's Passes section is left out: the passes it runs
 * after its review can change without changing what the plan agreed to build.
 * @param {string} text
 * @param {{ passes?: boolean }} [options]
 */
function workPlanScope(text, options = {}) {
  const { passes = true } = options;
  const lines = text.replace(/^Status: completed\r?$/mu, "Status: active").split("\n");
  return parseWorkPlanLines(lines.join("\n")).flatMap((item, index) => {
    if (!passes && item.passes) return [];
    return [item.checked === undefined ? lines[index] : lines[index].replace(/^(\s*(?:[-*+]|\d+[.)]) \[)[ xX~]/u, "$1 ")];
  }).join("\n");
}

/**
 * The plan's Passes items, in order: each item's line index, its text, the pass
 * it names (the text before the first ": ") and its scope (the rest).
 * @param {string} text
 * @returns {{ line: number, text: string, title: string, scope: string, checked: boolean, built: boolean }[]}
 */
function workPlanPassItems(text) {
  return parseWorkPlanLines(text).flatMap((entry, line) => {
    if (!entry.passes || entry.checked === undefined) return [];
    const separator = entry.text.indexOf(": ");
    return [{
      line,
      text: entry.text,
      title: (separator < 0 ? entry.text : entry.text.slice(0, separator)).trim(),
      scope: separator < 0 ? "" : entry.text.slice(separator + 2).trim(),
      checked: entry.checked,
      built: entry.built
    }];
  });
}

/**
 * Whether an active plan has reached its Passes step: it has pass items and
 * every item outside Passes is proven (- [x]).
 * @param {{ status?: string, text?: string } | null} plan
 */
function workPlanAtPasses(plan) {
  if (plan?.status !== "active" || typeof plan.text !== "string") return false;
  const items = parseWorkPlanLines(plan.text).filter((entry) => entry.checked !== undefined);
  return items.some((entry) => entry.passes) && items.every((entry) => entry.passes || entry.checked);
}

/**
 * The plan text with pass item lines added at the end of its Passes section,
 * which is added as the plan's last section when it has none.
 * @param {string} text
 * @param {string[]} lines checklist lines, such as `- [ ] Review: whole app`
 */
function withWorkPlanPasses(text, lines) {
  if (!lines.length) return text;
  const parsed = parseWorkPlanLines(text);
  const section = parsed.flatMap((entry, index) => entry.passes ? [index] : []);
  if (!section.length) return `${text.trimEnd()}\n\n## Passes\n\n${lines.join("\n")}\n`;
  const items = section.filter((index) => parsed[index].checked !== undefined);
  const after = items.length ? items.at(-1) : section[0];
  const all = text.split("\n");
  // A heading with no items yet is followed by a blank line, as Markdown lists are.
  return [...all.slice(0, after + 1), ...(items.length ? [] : [""]), ...lines, ...all.slice(after + 1)].join("\n");
}

/**
 * The plan text with the given Passes items not done yet (- [ ]) again.
 * @param {string} text
 * @param {(item: ReturnType<typeof workPlanPassItems>[number]) => boolean} chosen
 */
function withWorkPlanPassesUnticked(text, chosen) {
  const lines = text.split("\n");
  for (const item of workPlanPassItems(text).filter(chosen)) {
    lines[item.line] = lines[item.line].replace(/^(\s*(?:[-*+]|\d+[.)]) \[)[xX~]/u, "$1 ");
  }
  return lines.join("\n");
}

/**
 * Where a plan is, read from the plan itself: implementing its first item not
 * built yet (- [ ]), Senior's review once every item outside Passes is built,
 * the first Passes item not ticked once every other item is proven, or
 * completed. Null for a plan with no checklist items.
 * @param {{ status?: string, text?: string } | null} plan
 * @returns {{ step: "implementation", item: number, items: number, title: string } | { step: "review" } |
 *   { step: "pass", item: number, items: number, title: string, scope: string } | { step: "completed" } | null}
 *   a pass's scope is its Passes item's text after the title, such as "whole app"
 */
function workPlanStep(plan) {
  if (!plan || typeof plan.text !== "string") return null;
  if (plan.status === "completed") return { step: "completed" };
  const items = parseWorkPlanLines(plan.text).filter((entry) => entry.checked !== undefined);
  if (!items.length) return null;
  const work = items.filter((entry) => !entry.passes);
  const open = work.findIndex((entry) => !entry.built);
  if (open >= 0) return { step: "implementation", item: open + 1, items: work.length, title: work[open].text };
  const passes = workPlanPassItems(plan.text);
  const pass = passes.findIndex((item) => !item.checked);
  if (!work.every((entry) => entry.checked) || pass < 0) return { step: "review" };
  return { step: "pass", item: pass + 1, items: passes.length, title: passes[pass].title, scope: passes[pass].scope };
}

/** "just now", "47 min ago", "3 h ago", "2 days ago". */
function timeAgo(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/**
 * How current an active plan is, from its summary's facts: when the AI last updated its marks or Progress, or checked
 * it (otherwise when it was last saved), and how many of the session's files changed since. `behind` is true when
 * files changed since. Null for a plan that is not active or has no update time.
 * @param {{ status?: string, updatedAt?: string, updatedHow?: string,
 *   changedSince?: { files: number, more?: boolean } | null } | null | undefined} current
 * @param {number} [now]
 * @returns {{ text: string, updated: string, changed: string, behind: boolean } | null}
 */
function workPlanFreshness(current, now = Date.now()) {
  const at = Date.parse(current?.updatedAt || "");
  if (current?.status !== "active" || !Number.isFinite(at)) return null;
  const updated = `${current.updatedHow === "checked" ? "Checked" : "Updated"} ${timeAgo(now - at)}`;
  const since = current.changedSince;
  const files = since ? Math.max(Number(since.files) || 0, since.more ? 1 : 0) : 0;
  let changed = "";
  if (since && files) changed = `${files}${since.more ? "+" : ""} ${files === 1 && !since.more ? "file" : "files"} changed since`;
  else if (since) changed = "no files changed since";
  return { text: [updated, changed].filter(Boolean).join(" · "), updated, changed, behind: files > 0 };
}

/**
 * The chat's one line saying where an open plan is: its step, unless the chat's
 * request is waiting: for the person's answer (or questions the chat shows), for
 * another turn to end before its next step starts by itself, for Implement plan
 * before a planned plan starts, or paused. A paused plan says what is paused
 * (the item, Senior review, or the pass with its scope, such as "Paused: UI pass
 * (whole app)"), that the person's request is running while a turn holds the
 * chat, and names the workflow action the chat offers (`action`, the notice's
 * own) by its exact label: what to press when it can be pressed, when it
 * becomes available while other work holds it, or that it is starting; with no
 * action, a message moves it on. A plan behind its work says so: how many files
 * changed since its last update.
 * @param {ReturnType<typeof workPlanStep>} step
 * @param {{ questions?: number, request?: { status?: string, stage?: string | null, awaitingAnswer?: boolean,
 *   resumeImplementation?: boolean, stopped?: boolean, followup?: { owed?: boolean } } | null,
 *   freshness?: ReturnType<typeof workPlanFreshness>, busy?: "" | "turn" | "message" | "voice",
 *   action?: { kind: string, label: string, enabled: boolean, waits: string, progress: string } | null }} [state]
 *   questions: the questions the chat offers answers for; freshness: the plan's; busy: what holds the chat (the
 *   assistant's turn, the person's message being sent, or their spoken message), as the notice takes it; action: the
 *   workflow action the chat's notice offers for the request (assistantRoutingNotice's), null when it offers none
 */
function workPlanStatusLine(step, { questions = 0, request = null, freshness = null, busy = "", action = null } = {}) {
  const line = workPlanStepLine(step, { questions, request, busy, action });
  if (!line || step.step === "completed" || !freshness?.behind) return line;
  // No minutes here: the line is a live status, read out again whenever it changes.
  return `${line} · ${freshness.changed.replace(/ since$/u, " since the plan's last update")}`;
}

/** What a paused plan has paused: the plan's change, the item, Senior's review, or the pass with its scope. */
function pausedWork(step, request) {
  if (request.stage === "planning") return "changing the plan";
  if (step.step === "review") return "Senior review";
  if (step.step === "pass") return step.scope ? `${step.title} (${step.scope})` : step.title;
  return `item ${step.item} of ${step.items}, ${step.title}`;
}

function workPlanStepLine(step, { questions, request, busy, action }) {
  if (!step) return "";
  if (step.step === "completed") return "Plan: completed";
  const waiting = request?.status === "waiting";
  if (waiting && request.awaitingAnswer || questions > 0) {
    return `Plan: needs you${questions > 0 ? ` (${questions} ${questions === 1 ? "question" : "questions"})` : ""}`;
  }
  // A step another turn came before is owed: it starts by itself once that turn ends (assistantRoutingOwedSteps.js).
  if (waiting && request.followup?.owed && !request.stopped) {
    if (step.step === "review") return "Plan: Senior review starts when this answer ends";
    if (step.step === "pass") return `Plan: pass ${step.title.replace(/ pass$/u, "")} (${step.item} of ${step.items}) starts when this answer ends`;
    return `Plan: item ${step.item} of ${step.items}, ${step.title}, starts when this answer ends`;
  }
  if (waiting) {
    const ready = request.stage === "planning" && !request.resumeImplementation && step.step === "implementation" &&
      action?.kind === "implement";
    if (ready) {
      if (action.enabled) return `Plan: ready, ${action.label} to start`;
      return `Plan: ready · ${action.progress || `${action.label} is ${action.waits}`}`;
    }
    let next = "Send a message to go on";
    if (action?.enabled) next = `${action.label} to resume`;
    else if (action?.progress) next = action.progress;
    else if (action) next = `${action.label} is ${action.waits}`;
    // The person's own request runs while the plan waits: the turn holding the chat is theirs.
    return [`Paused: ${pausedWork(step, request)}`, busy === "turn" ? "Your request is running now" : "", next]
      .filter(Boolean).join(". ");
  }
  // Senior's review runs in Auto and a Senior chat; anywhere else nothing runs it until the person asks Senior.
  if (step.step === "review") return request?.status === "working" ? "Plan: Senior review" : "Plan: ready for Senior review, ask Senior to start it";
  if (step.step === "pass") return `Plan: pass ${step.title.replace(/ pass$/u, "")} (${step.item} of ${step.items})`;
  return `Plan: implementing item ${step.item} of ${step.items}, ${step.title}`;
}

export {
  parseWorkPlanLines,
  workPlanAtPasses,
  workPlanFreshness,
  workPlanStatusLine,
  workPlanStep,
  workPlanPassItems,
  workPlanScope,
  withWorkPlanPasses,
  withWorkPlanPassesUnticked
};
