function vibe64SessionListRefreshRequested(payload = {}) {
  return payload?.clientRefresh?.includeList === true;
}

export {
  vibe64SessionListRefreshRequested
};
