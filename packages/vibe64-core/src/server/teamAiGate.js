// Team AI gate. Team members work on the team setup's models, never on the
// owner's personal plans, so a team member's own request opens no project
// until that setup has a Workspace-use model. The owner, local mode (no
// person) and internal work are never gated.
//
// Accounts owns the setup and registers its one readiness reader:
// ready({ actor }) resolves true when some team role has a usable
// Workspace-use model. Without a reader (no AI accounts here) nothing is gated.

import { readWorkspaceTeam } from "./workspaceTeam.js";

const TEAM_AI_REQUIRED_CODE = "vibe64_team_ai_required";

let readiness = null;

function registerTeamAiReadiness(reader) {
  if (typeof reader !== "function") throw new TypeError("Team AI readiness needs its reader.");
  readiness = reader;
  return () => { if (readiness === reader) readiness = null; };
}

const isTeamMember = (actor) => Boolean(actor) && actor.role !== "owner";

async function readTeamAiReady({ actor = null } = {}) {
  return !readiness || await readiness({ actor }) === true;
}

// For the owner's project lists: whether team members can open projects.
// Nothing for anyone else.
async function readTeamAiStatus({ actor = null } = {}) {
  if (actor?.role !== "owner") return null;
  const team = await readWorkspaceTeam();
  return { ...team, ready: team.available && await readTeamAiReady({ actor }) };
}

// Callers apply it to a person's own work only (a request with headers, or
// their Colleague); internal work is never gated.
async function assertTeamAiAllowsProject({ actor = null } = {}) {
  if (!isTeamMember(actor) || await readTeamAiReady({ actor })) return;
  const { ownerName } = await readWorkspaceTeam();
  throw Object.assign(new Error(`Ask ${ownerName || "the workspace owner"} to set up AI for team members.`), {
    code: TEAM_AI_REQUIRED_CODE, statusCode: 403, ownerName, details: { ownerName }
  });
}

export { TEAM_AI_REQUIRED_CODE, assertTeamAiAllowsProject, readTeamAiReady, readTeamAiStatus, registerTeamAiReadiness };
