import { withRequestContext } from "../../../core/src/server/requestContext.js";
import { sessionActions } from "./actions.js";

export function registerSessionRoutes(router) {
  router.get("/api/sessions", withRequestContext((request) => runAction("demo.sessions.list", { limit: Number(request.headers["x-limit"] || 20) })));
  router.post("/api/sessions", withRequestContext((request) => runAction("demo.sessions.create", request.body)));
}

function runAction(actionId, input) {
  const action = sessionActions.find((candidate) => candidate.id === actionId);
  return action.execute(input);
}
