import { requestBody, requestQuery } from "@local/vibe64-core/server/featureRoutes";

// Route inputs. The session and file area come from the route; the acting user
// comes from the action policy, so a body or query naming one is ignored.

/**
 * @param {object} request
 * @param {object} input
 */
function sourceInput(request, input) {
  const { vibe64User: _ignoredUser, ...data } = input;
  return { ...data, sessionId: request.params.sessionId };
}

function sessionInput(request) {
  return sourceInput(request, {});
}

function sessionBodyInput(request) {
  return sourceInput(request, requestBody(request));
}

function sessionQueryInput(request) {
  return sourceInput(request, requestQuery(request));
}

// Source searches accept the short `q` query field as the search text.
function sessionSearchInput(request) {
  const query = requestQuery(request);
  const { q, ...rest } = query;
  return sourceInput(request, { ...rest, ...(Object.hasOwn(query, "q") ? { query: q } : {}) });
}

function integrationBodyInput(request) {
  return { ...sessionBodyInput(request), integrationId: request.params.integrationId };
}

function explanationBodyInput(request) {
  return { ...sessionBodyInput(request), explanationId: request.params.explanationId };
}

/**
 * Files areas: session routes reach every area, so project areas can be
 * destinations; project routes reach only the project's areas.
 * @param {object} request
 * @param {object} data
 */
function areaInput(request, data) {
  const { vibe64User: _ignoredUser, sessionId: _ignoredSession, ...rest } = data;
  return { ...rest, area: request.params.area, ...(request.params.sessionId ? { sessionId: request.params.sessionId } : {}) };
}

function areaBodyInput(request) {
  return areaInput(request, requestBody(request));
}

function areaQueryInput(request) {
  return areaInput(request, requestQuery(request));
}

// Only the operation's own query fields enter the action.
function areaPathQueryInput(request) {
  const query = requestQuery(request);
  return areaInput(request, Object.hasOwn(query, "path") ? { path: query.path } : {});
}

function areaTreeQueryInput(request) {
  const query = requestQuery(request);
  return areaInput(request, {
    ...(Object.hasOwn(query, "path") ? { path: query.path } : {}),
    ...(Object.hasOwn(query, "offset") ? { offset: query.offset } : {}),
    ...(Object.hasOwn(query, "type") ? { type: query.type } : {})
  });
}

export {
  areaBodyInput,
  areaPathQueryInput,
  areaQueryInput,
  areaTreeQueryInput,
  explanationBodyInput,
  integrationBodyInput,
  sessionBodyInput,
  sessionInput,
  sessionQueryInput,
  sessionSearchInput,
  sourceInput
};
