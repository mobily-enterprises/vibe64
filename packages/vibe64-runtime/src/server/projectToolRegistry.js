import {
  isPlainObject,
  normalizeText,
  plainClone,
  vibe64Error
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const PROJECT_TOOL_TYPES = new Set(["command", "prompt"]);
const PROJECT_TOOL_PARAMETER_TYPES = new Set(["integer", "string", "enum"]);
const PROJECT_TOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

function normalizeProjectToolId(toolId = "") {
  const normalizedToolId = normalizeText(toolId);
  if (!PROJECT_TOOL_ID_PATTERN.test(normalizedToolId)) {
    throw vibe64Error(
      `Invalid Vibe64 project tool id: ${normalizedToolId || "(empty)"}.`,
      "vibe64_project_tool_invalid"
    );
  }
  return normalizedToolId;
}

function normalizeProjectToolType(type = "") {
  const normalizedType = normalizeText(type);
  if (!PROJECT_TOOL_TYPES.has(normalizedType)) {
    throw vibe64Error(
      `Invalid Vibe64 project tool type: ${normalizedType || "(empty)"}.`,
      "vibe64_project_tool_invalid"
    );
  }
  return normalizedType;
}

function normalizeParameterType(type = "") {
  const normalizedType = normalizeText(type);
  if (!PROJECT_TOOL_PARAMETER_TYPES.has(normalizedType)) {
    throw vibe64Error(
      `Invalid Vibe64 project tool parameter type: ${normalizedType || "(empty)"}.`,
      "vibe64_project_tool_invalid"
    );
  }
  return normalizedType;
}

function normalizeToolOption(option = {}) {
  const optionObject = isPlainObject(option) ? option : {
    value: option
  };
  const value = normalizeText(optionObject.value);
  if (!value) {
    throw vibe64Error(
      "Vibe64 project tool enum option requires a value.",
      "vibe64_project_tool_invalid"
    );
  }
  return {
    label: normalizeText(optionObject.label || value),
    value
  };
}

function normalizeToolParameter(moduleId = "", toolId = "", parameter = {}, index = 0) {
  const parameterObject = isPlainObject(parameter) ? parameter : {};
  const parameterId = normalizeText(parameterObject.id);
  const type = normalizeParameterType(parameterObject.type);
  const context = `${moduleId} project tool ${toolId} parameter ${index + 1}`;

  if (!parameterId) {
    throw vibe64Error(
      `Vibe64 ${context} requires an id.`,
      "vibe64_project_tool_invalid"
    );
  }

  const normalizedParameter = {
    defaultValue: parameterObject.defaultValue,
    description: normalizeText(parameterObject.description),
    id: parameterId,
    label: normalizeText(parameterObject.label || parameterId),
    options: [],
    required: parameterObject.required !== false,
    type
  };

  if (type === "enum") {
    normalizedParameter.options = (Array.isArray(parameterObject.options) ? parameterObject.options : [])
      .map(normalizeToolOption);
    if (!normalizedParameter.options.length) {
      throw vibe64Error(
        `Vibe64 ${context} enum parameter requires options.`,
        "vibe64_project_tool_invalid"
      );
    }
  }

  return deepFreeze(normalizedParameter);
}

function assertUniqueParameterIds(toolId = "", parameters = []) {
  const seen = new Set();
  for (const parameter of parameters) {
    if (seen.has(parameter.id)) {
      throw vibe64Error(
        `Duplicate Vibe64 project tool parameter ${toolId}.${parameter.id}.`,
        "vibe64_project_tool_invalid"
      );
    }
    seen.add(parameter.id);
  }
}

function normalizeToolParameters(moduleId = "", toolId = "", parameters = []) {
  const normalizedParameters = (Array.isArray(parameters) ? parameters : [])
    .map((parameter, index) => normalizeToolParameter(moduleId, toolId, parameter, index));
  assertUniqueParameterIds(toolId, normalizedParameters);
  return deepFreeze(normalizedParameters);
}

function normalizeProjectToolContribution(moduleId = "", contribution = {}, index = 0) {
  const tool = isPlainObject(contribution) ? contribution : {};
  const toolId = normalizeProjectToolId(tool.id);
  const type = normalizeProjectToolType(tool.type);
  const context = `${moduleId} project tool ${index + 1}`;
  const command = typeof tool.command === "function" ? tool.command : null;
  const prompt = typeof tool.prompt === "function" || typeof tool.prompt === "string"
    ? tool.prompt
    : null;

  if (!toolId) {
    throw vibe64Error(
      `Vibe64 ${context} requires an id.`,
      "vibe64_project_tool_invalid"
    );
  }
  if (type === "command" && !command) {
    throw vibe64Error(
      `Vibe64 ${context} command tool requires a command function.`,
      "vibe64_project_tool_invalid"
    );
  }
  if (type === "prompt" && !prompt) {
    throw vibe64Error(
      `Vibe64 ${context} prompt tool requires a prompt string or function.`,
      "vibe64_project_tool_invalid"
    );
  }

  return Object.freeze({
    command,
    confirmationMessage: normalizeText(tool.confirmationMessage),
    description: normalizeText(tool.description),
    disabledReason: tool.disabledReason,
    enabled: tool.enabled,
    id: toolId,
    label: normalizeText(tool.label || toolId),
    moduleId,
    parameters: normalizeToolParameters(moduleId, toolId, tool.parameters),
    prompt,
    requiresConfirmation: tool.requiresConfirmation === true,
    type
  });
}

function normalizeContributionList(moduleId = "", contributions = []) {
  if (contributions === undefined) {
    return [];
  }
  if (Array.isArray(contributions)) {
    return contributions;
  }
  if (isPlainObject(contributions)) {
    return [contributions];
  }
  throw vibe64Error(
    `Vibe64 project tool module ${moduleId} tools must be an object or array.`,
    "vibe64_project_tool_invalid"
  );
}

function normalizeContributorModules(modules = []) {
  const moduleList = Array.isArray(modules) ? modules : [modules];
  return moduleList.map((module, index) => {
    if (!isPlainObject(module)) {
      throw vibe64Error(
        `Vibe64 project tool module entry ${index + 1} must be an object.`,
        "vibe64_project_tool_invalid"
      );
    }
    return module;
  });
}

async function resolveToolValue(value, context = {}) {
  return typeof value === "function" ? value(context) : value;
}

async function publicProjectToolRecord(record = {}, context = {}) {
  const enabledValue = record.enabled === undefined
    ? true
    : await resolveToolValue(record.enabled, {
        ...context,
        tool: record
      });
  const disabledReason = normalizeText(await resolveToolValue(record.disabledReason, {
    ...context,
    tool: record
  }));
  const enabled = enabledValue !== false && !disabledReason;
  return deepFreeze({
    confirmationMessage: record.confirmationMessage,
    description: record.description,
    disabledReason: enabled ? "" : disabledReason || `${record.label} is disabled.`,
    enabled,
    id: record.id,
    label: record.label,
    parameters: plainClone(record.parameters),
    requiresConfirmation: record.requiresConfirmation,
    type: record.type
  });
}

function sortPublicTools(left, right) {
  return left.label.localeCompare(right.label) ||
    left.id.localeCompare(right.id);
}

function parameterInputValue(parameters = {}, parameter = {}) {
  if (Object.hasOwn(parameters, parameter.id)) {
    return parameters[parameter.id];
  }
  return parameter.defaultValue;
}

function normalizeIntegerParameter(value, parameter = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw vibe64Error(
      `Project tool parameter ${parameter.id} must be an integer.`,
      "vibe64_project_tool_parameter_invalid"
    );
  }
  return number;
}

function normalizeEnumParameter(value, parameter = {}) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return "";
  }
  const allowedValues = new Set(parameter.options.map((option) => option.value));
  if (!allowedValues.has(normalizedValue)) {
    throw vibe64Error(
      `Project tool parameter ${parameter.id} must be one of: ${[...allowedValues].join(", ")}.`,
      "vibe64_project_tool_parameter_invalid"
    );
  }
  return normalizedValue;
}

function normalizeStringParameter(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value);
}

function normalizeParameterValue(value, parameter = {}) {
  if (parameter.type === "integer") {
    return normalizeIntegerParameter(value, parameter);
  }
  if (parameter.type === "enum") {
    return normalizeEnumParameter(value, parameter);
  }
  return normalizeStringParameter(value);
}

function validateKnownParameterInput(tool = {}, parameters = {}) {
  const knownIds = new Set(tool.parameters.map((parameter) => parameter.id));
  for (const parameterId of Object.keys(isPlainObject(parameters) ? parameters : {})) {
    if (!knownIds.has(parameterId)) {
      throw vibe64Error(
        `Unknown project tool parameter ${tool.id}.${parameterId}.`,
        "vibe64_project_tool_parameter_invalid"
      );
    }
  }
}

function normalizeToolInput(tool = {}, parameters = {}) {
  const input = isPlainObject(parameters) ? parameters : {};
  validateKnownParameterInput(tool, input);
  return Object.fromEntries(tool.parameters.map((parameter) => {
    const value = normalizeParameterValue(parameterInputValue(input, parameter), parameter);
    if (
      parameter.required &&
      (value === null || value === "")
    ) {
      throw vibe64Error(
        `Project tool parameter ${tool.id}.${parameter.id} is required.`,
        "vibe64_project_tool_parameter_required"
      );
    }
    return [parameter.id, value];
  }));
}

function createProjectToolRegistry() {
  const toolRecords = new Map();

  function storeToolContribution(moduleId = "", tool = {}) {
    if (toolRecords.has(tool.id)) {
      throw vibe64Error(
        `Duplicate Vibe64 project tool id: ${tool.id}.`,
        "vibe64_project_tool_duplicate"
      );
    }
    toolRecords.set(tool.id, Object.freeze({
      ...tool,
      moduleId
    }));
  }

  function registerTools(moduleId = "", tools = []) {
    const normalizedModuleId = normalizeText(moduleId);
    if (!normalizedModuleId) {
      throw vibe64Error(
        "Vibe64 project tool modules require an id.",
        "vibe64_project_tool_invalid"
      );
    }
    const contributions = normalizeContributionList(normalizedModuleId, tools)
      .map((tool, index) => normalizeProjectToolContribution(normalizedModuleId, tool, index));
    for (const tool of contributions) {
      storeToolContribution(normalizedModuleId, tool);
    }
    return deepFreeze(contributions.map((tool) => ({
      confirmationMessage: tool.confirmationMessage,
      description: tool.description,
      disabledReason: "",
      enabled: tool.enabled !== false,
      id: tool.id,
      label: tool.label,
      parameters: plainClone(tool.parameters),
      requiresConfirmation: tool.requiresConfirmation,
      type: tool.type
    })));
  }

  async function listTools(context = {}) {
    const tools = await Promise.all([...toolRecords.values()].map((record) => {
      return publicProjectToolRecord(record, context);
    }));
    return tools.sort(sortPublicTools);
  }

  function toolRecord(toolId = "") {
    return toolRecords.get(normalizeProjectToolId(toolId)) || null;
  }

  async function resolveToolRun(toolId = "", {
    context = {},
    parameters = {}
  } = {}) {
    const record = toolRecord(toolId);
    if (!record) {
      throw vibe64Error(
        `Unknown Vibe64 project tool: ${normalizeText(toolId) || "(empty)"}.`,
        "vibe64_project_tool_unknown"
      );
    }
    const tool = await publicProjectToolRecord(record, context);
    if (tool.enabled !== true) {
      throw vibe64Error(
        tool.disabledReason || `${tool.label} is disabled.`,
        "vibe64_project_tool_disabled"
      );
    }
    const input = normalizeToolInput(record, parameters);
    const runContext = {
      ...context,
      input,
      parameters: input,
      tool
    };
    if (record.type === "command") {
      return {
        input,
        spec: await record.command(runContext),
        tool,
        type: "command"
      };
    }
    return {
      input,
      prompt: normalizeText(await resolveToolValue(record.prompt, runContext)),
      tool,
      type: "prompt"
    };
  }

  return Object.freeze({
    listTools,
    registerTools,
    resolveToolRun
  });
}

function registerProjectToolContributorModules(registry, {
  toolModules = []
} = {}) {
  const normalizedToolModules = normalizeContributorModules(toolModules);
  normalizedToolModules.forEach((module) => {
    if (!Object.hasOwn(module, "tools")) {
      throw vibe64Error(
        `Vibe64 project tool module ${normalizeText(module.id) || "(unknown)"} must define tools.`,
        "vibe64_project_tool_invalid"
      );
    }
    registry.registerTools(module.id, module.tools);
  });
  return registry;
}

export {
  PROJECT_TOOL_PARAMETER_TYPES,
  PROJECT_TOOL_TYPES,
  createProjectToolRegistry,
  normalizeProjectToolId,
  registerProjectToolContributorModules
};
