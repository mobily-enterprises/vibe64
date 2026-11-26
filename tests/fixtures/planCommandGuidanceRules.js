// What every engine's session guidance, built when its process starts or resumes a conversation, must tell the agent
// about the plan commands' inputs. A plan's pass turn carries only its pass instructions and an earlier turn's plan
// guidance may be from an older release, so this is how every turn that may use a plan command has the current ones.
const PLAN_COMMAND_GUIDANCE_RULES = Object.freeze([
  ["a JSON object with only the operation's fields", /`vibe64-helper plan` operation takes a JSON object on stdin with only the fields `vibe64-helper plan --help` gives it/u],
  ["the Plan's one name both ways", /a read returns the Plan as text and the Progress as progressText; new and write take the Plan as text/u],
  ["the Progress's one name both ways", /progress-write takes the whole new Progress as progressText, the name a read returns it under; text is always the Plan/u],
  ["the paired revisions", /Writes require expectedRevision and expectedProgressRevision from the latest paired read/u],
  ["whole documents and readThrough", /write and progress-write replace the whole Plan or Progress, so build them from every page and pass readThrough/u],
  ["the refusal", /A field an operation does not read, or a missing required one, is refused and changes nothing: correct the input as the refusal says/u],
  ["current over earlier wording", /These are the plan commands' current inputs; they replace any different ones earlier in this conversation/u]
]);

/**
 * @param {import("node:assert/strict")} assert
 * @param {string} guidance
 * @param {string} engine
 */
function assertPlanCommandGuidance(assert, guidance, engine) {
  for (const [rule, pattern] of PLAN_COMMAND_GUIDANCE_RULES) assert.match(guidance, pattern, `${engine}: ${rule}`);
}

export { assertPlanCommandGuidance, PLAN_COMMAND_GUIDANCE_RULES };
