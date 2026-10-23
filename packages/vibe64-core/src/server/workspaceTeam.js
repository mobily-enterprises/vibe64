// The host says whether this workspace has team members. Public Vibe64 alone
// has none; a host with people registers its reader once at startup.
let teamReader = null;

function registerWorkspaceTeamReader(reader) {
  if (typeof reader !== "function") throw new TypeError("A workspace team reader must be a function.");
  teamReader = reader;
  return () => { if (teamReader === reader) teamReader = null; };
}

async function readWorkspaceTeam() {
  const team = teamReader ? await teamReader() : null;
  return { available: team?.available === true, ownerName: String(team?.ownerName || ""),
    memberCount: Number.isSafeInteger(team?.memberCount) && team.memberCount > 0 ? team.memberCount : 0 };
}

export { readWorkspaceTeam, registerWorkspaceTeamReader };
