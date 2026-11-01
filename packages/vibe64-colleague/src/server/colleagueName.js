// The name Colleague gives the model on each turn. A composed host may provide
// its own resolver (a name the person chose) through this token; without one
// Colleague is called "Colleague".
const COLLEAGUE_NAME_RESOLVER_TOKEN = "vibe64.colleague.name-resolver";

/** @type {import("./types.js").ColleagueNameResolver} */
async function nameColleague() {
  return "Colleague";
}

export { COLLEAGUE_NAME_RESOLVER_TOKEN, nameColleague };
