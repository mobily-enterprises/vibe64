function preferredPreviewTarget(launchTargets = []) {
  const targets = Array.isArray(launchTargets) ? launchTargets : [];
  return targets.find((target) => target?.defaultPreview === true) ||
    targets[0] ||
    null;
}

function managedPreviewTarget(launchTargets = []) {
  const availableTargets = (Array.isArray(launchTargets) ? launchTargets : [])
    .filter((target) => target?.available !== false);
  return preferredPreviewTarget(availableTargets);
}

export {
  managedPreviewTarget,
  preferredPreviewTarget
};
