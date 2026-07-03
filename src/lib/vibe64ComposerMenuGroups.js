import {
  normalizeVibe64ComposerMenuGroupLabel,
  normalizeVibe64ComposerMenuGroupPath
} from "@local/vibe64-core/shared";

function composerMenuItemGroupPath(item = {}) {
  return normalizeVibe64ComposerMenuGroupPath(item?.groupPath, [
    item?.group || "Ask Codex"
  ]);
}

function createComposerMenuGroup(label = "", path = []) {
  return {
    groups: [],
    items: [],
    label,
    path,
    childrenByLabel: new Map()
  };
}

function ensureComposerMenuGroup(parent, label = "") {
  const normalizedLabel = normalizeVibe64ComposerMenuGroupLabel(label);
  if (!normalizedLabel) {
    return parent;
  }
  if (!parent.childrenByLabel.has(normalizedLabel)) {
    const child = createComposerMenuGroup(normalizedLabel, [
      ...parent.path,
      normalizedLabel
    ]);
    parent.childrenByLabel.set(normalizedLabel, child);
    parent.groups.push(child);
  }
  return parent.childrenByLabel.get(normalizedLabel);
}

function publicComposerMenuGroup(group) {
  return {
    groups: group.groups.map(publicComposerMenuGroup),
    items: group.items,
    key: group.path.join("\u001f"),
    label: group.label
  };
}

function composerMenuGroupsForItems(items = []) {
  const root = createComposerMenuGroup("", []);
  for (const item of Array.isArray(items) ? items : []) {
    const path = composerMenuItemGroupPath(item);
    const group = path.reduce((parent, label) => ensureComposerMenuGroup(parent, label), root);
    group.items.push(item);
  }
  return root.groups.map(publicComposerMenuGroup);
}

export {
  composerMenuGroupsForItems,
  composerMenuItemGroupPath
};
