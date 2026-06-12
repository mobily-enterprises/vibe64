function prerequisiteAccountStatusReadQuery(runtime = null) {
  const localMode = runtime?.local === true || runtime?.mode === "local";
  return localMode
    ? {
        refresh: true
      }
    : null;
}

export {
  prerequisiteAccountStatusReadQuery
};
