function normalizedPromptFields(fields = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }
  return Object.fromEntries(Object.entries(fields)
    .map(([key, value]) => [String(key || ""), String(value ?? "")])
    .filter(([key]) => key));
}

function promptTemplateText(item = {}) {
  return String(item?.text || "").trim();
}

function composerMenuItemCanInsertText(item = {}) {
  return ["task", "template"].includes(String(item?.kind || "template")) &&
    Boolean(promptTemplateText(item));
}

function promptTemplateLabel(item = {}) {
  return String(item?.label || item?.id || "Prompt").replace(/\s+/gu, " ").trim() || "Prompt";
}

function promptTemplateToken(item = {}) {
  return `[${promptTemplateLabel(item).replace(/[[\]\r\n]+/gu, " ").replace(/\s+/gu, " ").trim()}]`;
}

function promptTemplateDisplayText(item = {}) {
  return `Prompt: ${promptTemplateLabel(item)}`;
}

function promptTemplateBlock(ref = {}) {
  const label = String(ref.label || "Prompt").trim() || "Prompt";
  const text = String(ref.text || "").trim();
  return text ? `[Prompt: ${label}]\n${text}` : "";
}

function promptTemplateRefForItem(item = {}) {
  const text = promptTemplateText(item);
  if (!text) {
    return null;
  }
  return {
    displayText: promptTemplateDisplayText(item),
    id: String(item?.id || promptTemplateLabel(item)).trim(),
    label: promptTemplateLabel(item),
    text,
    token: promptTemplateToken(item)
  };
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function promptTokenRegExp(ref = {}) {
  const token = String(ref.token || "");
  return token ? new RegExp(escapeRegExp(token), "giu") : null;
}

function promptTextHasToken(text = "", ref = {}) {
  const expression = promptTokenRegExp(ref);
  return expression ? expression.test(String(text || "")) : false;
}

function knownComposerPromptRefs(menuItems = []) {
  return (Array.isArray(menuItems) ? menuItems : [])
    .filter((item) => String(item?.kind || "template") === "template")
    .map(promptTemplateRefForItem)
    .filter(Boolean);
}

function composerPromptRefsForText(text = "", {
  menuItems = [],
  promptRefs = []
} = {}) {
  const sourceText = String(text || "");
  const refs = new Map();
  for (const ref of Array.isArray(promptRefs) ? promptRefs : []) {
    if (
      sourceText.includes(ref.displayText) ||
      promptTextHasToken(sourceText, ref)
    ) {
      refs.set(ref.token, ref);
    }
  }
  for (const ref of knownComposerPromptRefs(menuItems)) {
    if (
      (
        sourceText.includes(ref.displayText) ||
        promptTextHasToken(sourceText, ref)
      ) &&
      !refs.has(ref.token)
    ) {
      refs.set(ref.token, ref);
    }
  }
  return [...refs.values()];
}

function expandComposerPromptText(text = "", refs = []) {
  let expanded = String(text || "");
  for (const ref of refs) {
    const block = promptTemplateBlock(ref);
    if (!block || expanded.includes(block)) {
      continue;
    }
    if (expanded.trim() === String(ref.displayText || "").trim()) {
      expanded = block;
      continue;
    }
    if (ref.displayText && expanded.includes(ref.displayText)) {
      expanded = expanded.replaceAll(ref.displayText, block);
    }
    const tokenExpression = promptTokenRegExp(ref);
    if (tokenExpression) {
      expanded = expanded.replace(tokenExpression, block);
    }
  }
  return expanded;
}

function expandedComposerPromptSubmissionOptions(options = {}, {
  menuItems = [],
  promptRefs = []
} = {}) {
  const sourceOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const fields = normalizedPromptFields(sourceOptions.fields);
  const displayFields = normalizedPromptFields(sourceOptions.displayFields);
  const sourceText = String(fields.conversationRequest || displayFields.conversationRequest || "").trim();
  if (!sourceText) {
    return sourceOptions;
  }
  const refs = composerPromptRefsForText(sourceText, {
    menuItems,
    promptRefs
  });
  if (!refs.length) {
    return sourceOptions;
  }
  const expandedText = expandComposerPromptText(sourceText, refs);
  if (!expandedText || expandedText === fields.conversationRequest) {
    return sourceOptions;
  }
  const visibleText = String(displayFields.conversationRequest || fields.conversationRequest || sourceText);
  return {
    ...sourceOptions,
    ...(refs.length === 1 ? { promptTemplateId: refs[0].id } : {}),
    ...(Object.hasOwn(sourceOptions, "message") ? { message: expandedText } : {}),
    displayFields: {
      ...displayFields,
      conversationRequest: visibleText
    },
    fields: {
      ...fields,
      conversationRequest: expandedText
    }
  };
}

export {
  composerMenuItemCanInsertText,
  expandedComposerPromptSubmissionOptions,
  promptTemplateDisplayText,
  promptTemplateRefForItem,
  promptTemplateToken
};
