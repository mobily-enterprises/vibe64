const PASSES_HEADING = /^## Passes\s*$/iu;

/**
 * Keep checklist recognition identical in stored progress and the plan viewer.
 * A checklist item carries one of three marks: `[ ]` not done yet, `[~]` built
 * (implemented, and its own focused checks pass) and `[x]` proven by the
 * plan's final checks. `built` is true for a built or proven item, `checked`
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
 *   { step: "pass", item: number, items: number, title: string } | { step: "completed" } | null}
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
  return { step: "pass", item: pass + 1, items: passes.length, title: passes[pass].title };
}

/**
 * The chat's one line saying where an open plan is: its step, unless the chat's
 * request is waiting: for the person's answer (or questions the chat shows), for
 * Implement plan before a planned plan starts, or paused for Continue.
 * @param {ReturnType<typeof workPlanStep>} step
 * @param {{ questions?: number, request?: { status?: string, stage?: string | null, awaitingAnswer?: boolean,
 *   resumeImplementation?: boolean } | null }} [state] questions: the questions the chat offers answers for
 */
function workPlanStatusLine(step, { questions = 0, request = null } = {}) {
  if (!step) return "";
  if (step.step === "completed") return "Plan: completed";
  const waiting = request?.status === "waiting";
  if (waiting && request.awaitingAnswer || questions > 0) {
    return `Plan: needs you${questions > 0 ? ` (${questions} ${questions === 1 ? "question" : "questions"})` : ""}`;
  }
  if (waiting && request.stage === "planning" && !request.resumeImplementation && step.step === "implementation") {
    return "Plan: ready, Implement plan to start";
  }
  if (waiting) return "Plan: paused, Continue to resume";
  if (step.step === "review") return "Plan: Senior review";
  if (step.step === "pass") return `Plan: pass ${step.title.replace(/ pass$/u, "")} (${step.item} of ${step.items})`;
  return `Plan: implementing item ${step.item} of ${step.items}, ${step.title}`;
}

export {
  parseWorkPlanLines,
  workPlanAtPasses,
  workPlanStatusLine,
  workPlanStep,
  workPlanPassItems,
  workPlanScope,
  withWorkPlanPasses,
  withWorkPlanPassesUnticked
};
