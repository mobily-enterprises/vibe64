function plainObjectValue(value = null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sessionRecordHasComposerMenuProjection(session = null) {
  const menu = session?.presentation?.composerMenu;
  return Boolean(
    Array.isArray(menu?.items) ||
    String(menu?.signature || "").trim()
  );
}

function sessionComposerMenuProjection(session = null) {
  const menu = plainObjectValue(session?.presentation?.composerMenu);
  const items = Array.isArray(menu.items) ? menu.items : null;
  const itemCount = Number(menu.itemCount);
  return {
    itemCount: Number.isSafeInteger(itemCount) && itemCount >= 0
      ? itemCount
      : Array.isArray(items)
        ? items.length
        : null,
    items,
    signature: String(menu.signature || "").trim()
  };
}

function rememberSessionComposerMenu(composerMenusById = {}, session = null) {
  const sessionId = String(session?.sessionId || "").trim();
  const projection = sessionComposerMenuProjection(session);
  if (!sessionId || !projection.signature || !Array.isArray(projection.items)) {
    return false;
  }
  composerMenusById[sessionId] = {
    itemCount: projection.itemCount ?? projection.items.length,
    items: projection.items,
    signature: projection.signature
  };
  return true;
}

function composerMenuCacheMatchesProjection(cachedMenu = null, projection = {}) {
  return Boolean(
    cachedMenu &&
    Array.isArray(cachedMenu.items) &&
    cachedMenu.signature &&
    cachedMenu.signature === projection.signature
  );
}

function sessionWithCachedComposerMenu(session = null, cachedMenu = null) {
  if (!session || session?.ok === false) {
    return session;
  }
  const presentation = plainObjectValue(session.presentation);
  const menu = plainObjectValue(presentation.composerMenu);
  if (Array.isArray(menu.items)) {
    return session;
  }
  const projection = sessionComposerMenuProjection(session);
  if (!projection.signature || !composerMenuCacheMatchesProjection(cachedMenu, projection)) {
    return session;
  }
  return {
    ...session,
    presentation: {
      ...presentation,
      composerMenu: {
        ...menu,
        itemCount: cachedMenu.itemCount ?? projection.itemCount,
        items: cachedMenu.items
      }
    }
  };
}

function sessionComposerMenuNeedsRefresh(session = null, cachedMenu = null) {
  const projection = sessionComposerMenuProjection(session);
  return Boolean(
    projection.signature &&
    !Array.isArray(projection.items) &&
    !composerMenuCacheMatchesProjection(cachedMenu, projection)
  );
}

function selectedSessionShouldLoadComposerMenu({
  composerMenusById = {},
  requestedComposerMenusById = {},
  session = null,
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return false;
  }
  if (requestedComposerMenusById[normalizedSessionId] === true) {
    return true;
  }
  const projection = sessionComposerMenuProjection(session);
  if (!projection.signature) {
    return false;
  }
  const cachedMenu = composerMenusById[normalizedSessionId] || null;
  return !composerMenuCacheMatchesProjection(cachedMenu, projection);
}

function composerMenuProjectionFromRealtimePayload(payload = {}, selectedSessionId = "") {
  const changedSessionId = String(payload?.sessionId || payload?.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(selectedSessionId || "").trim()) {
    return null;
  }
  const menu = plainObjectValue(payload.composerMenu);
  const signature = String(menu.signature || "").trim();
  if (!signature) {
    return null;
  }
  const itemCount = Number(menu.itemCount);
  return {
    itemCount: Number.isSafeInteger(itemCount) && itemCount >= 0 ? itemCount : null,
    sessionId: changedSessionId,
    signature
  };
}

export {
  composerMenuProjectionFromRealtimePayload,
  rememberSessionComposerMenu,
  selectedSessionShouldLoadComposerMenu,
  sessionComposerMenuNeedsRefresh,
  sessionComposerMenuProjection,
  sessionRecordHasComposerMenuProjection,
  sessionWithCachedComposerMenu
};
