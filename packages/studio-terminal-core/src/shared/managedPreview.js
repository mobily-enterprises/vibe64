function managedPreviewTarget(launchTargets = []) {
  const availableTargets = (Array.isArray(launchTargets) ? launchTargets : [])
    .filter((target) => target?.available !== false);
  return availableTargets.find((target) => target?.defaultPreview === true) ||
    availableTargets[0] ||
    null;
}

export {
  managedPreviewTarget
};
