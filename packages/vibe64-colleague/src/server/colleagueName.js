// The name Colleague gives the model on each turn. A composed host may provide
// its own resolver (a name the person chose) through this token; without one
// Colleague is called "Colleague".
const COLLEAGUE_NAME_RESOLVER_TOKEN = "vibe64.colleague.name-resolver";

/** @type {import("./types.js").ColleagueNameResolver} */
async function nameColleague() {
  return "Colleague";
}

/**
 * Refuses a name resolver a composed host supplies that is not a function.
 * @param {unknown} resolveName
 */
function assertColleagueNameResolver(resolveName) {
  // readable-check: allow method-probe - input validation: a composed host supplies the resolver through its token
  if (resolveName && typeof resolveName !== "function") throw new TypeError("Colleague name resolver must be a function.");
}

export { COLLEAGUE_NAME_RESOLVER_TOKEN, assertColleagueNameResolver, nameColleague };
