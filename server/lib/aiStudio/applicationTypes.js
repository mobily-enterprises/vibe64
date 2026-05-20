import {
  aiStudioError,
  normalizeText
} from "./core.js";
import {
  deepFreeze
} from "./deepFreeze.js";

const AI_STUDIO_APPLICATION_TYPE_WEB = "web_application";
const AI_STUDIO_APPLICATION_TYPE_PHONE = "phone_app";
const AI_STUDIO_APPLICATION_TYPE_SYSTEM = "system_program";

const AI_STUDIO_APPLICATION_TYPES = deepFreeze([
  {
    description: "Browser-based products, dashboards, admin systems, SaaS apps, and full-stack web applications.",
    iconPaths: [
      "M10 18h44a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z",
      "M6 28h52",
      "M18 40h10M36 40h10M18 48h28"
    ],
    iconViewBox: "0 0 64 64",
    id: AI_STUDIO_APPLICATION_TYPE_WEB,
    label: "Web application",
    summary: "Build something people use in a browser."
  },
  {
    description: "Mobile-first apps delivered with web technology and packaged for phones when the project needs it.",
    iconPaths: [
      "M23 6h18a5 5 0 0 1 5 5v42a5 5 0 0 1-5 5H23a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5Z",
      "M27 15h10",
      "M29 51h6"
    ],
    iconViewBox: "0 0 64 64",
    id: AI_STUDIO_APPLICATION_TYPE_PHONE,
    label: "Phone app",
    summary: "Build a mobile app from a web app base."
  },
  {
    description: "Native command-line tools, libraries, services, and low-level programs built around system toolchains.",
    iconPaths: [
      "M9 14h46a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z",
      "M17 29l8 7-8 7",
      "M34 43h13"
    ],
    iconViewBox: "0 0 64 64",
    id: AI_STUDIO_APPLICATION_TYPE_SYSTEM,
    label: "System program",
    summary: "Build native software that runs close to the machine."
  }
]);

const APPLICATION_TYPES_BY_ID = new Map(AI_STUDIO_APPLICATION_TYPES.map((applicationType) => [
  applicationType.id,
  applicationType
]));

function publicApplicationType(applicationType = {}) {
  return {
    description: normalizeText(applicationType.description),
    iconPaths: Array.isArray(applicationType.iconPaths)
      ? applicationType.iconPaths.map(normalizeText).filter(Boolean)
      : [],
    iconViewBox: normalizeText(applicationType.iconViewBox || "0 0 64 64"),
    id: normalizeText(applicationType.id),
    label: normalizeText(applicationType.label || applicationType.id),
    summary: normalizeText(applicationType.summary)
  };
}

function requireApplicationType(id = "", {
  adapterId = ""
} = {}) {
  const normalizedId = normalizeText(id);
  const definition = APPLICATION_TYPES_BY_ID.get(normalizedId);
  if (!definition) {
    const adapterText = adapterId ? ` for adapter ${adapterId}` : "";
    throw aiStudioError(
      `Unknown AI Studio application type${adapterText}: ${normalizedId || "(empty)"}.`,
      "ai_studio_unknown_application_type"
    );
  }
  return definition;
}

function normalizeCoveragePriority(value) {
  const priority = Number(value);
  return Number.isFinite(priority) ? priority : 0;
}

function normalizeApplicationTypeCoverage(coverage = {}, {
  adapterId = ""
} = {}) {
  const applicationTypeId = normalizeText(coverage.id || coverage.type || coverage.applicationType);
  if (!applicationTypeId) {
    return null;
  }
  requireApplicationType(applicationTypeId, {
    adapterId
  });
  return {
    explanation: normalizeText(coverage.explanation),
    id: applicationTypeId,
    priority: normalizeCoveragePriority(coverage.priority)
  };
}

function normalizeApplicationTypeCoverageList(coverageList = [], {
  adapterId = ""
} = {}) {
  const normalizedCoverage = Array.isArray(coverageList)
    ? coverageList
        .map((coverage) => normalizeApplicationTypeCoverage(coverage, {
          adapterId
        }))
        .filter(Boolean)
    : [];
  const seen = new Set();
  const uniqueCoverage = [];
  for (const coverage of normalizedCoverage) {
    if (seen.has(coverage.id)) {
      throw aiStudioError(
        `Duplicate AI Studio application type for adapter ${adapterId || "(unknown)"}: ${coverage.id}.`,
        "ai_studio_duplicate_application_type"
      );
    }
    seen.add(coverage.id);
    uniqueCoverage.push(coverage);
  }
  return uniqueCoverage;
}

export {
  AI_STUDIO_APPLICATION_TYPES,
  AI_STUDIO_APPLICATION_TYPE_PHONE,
  AI_STUDIO_APPLICATION_TYPE_SYSTEM,
  AI_STUDIO_APPLICATION_TYPE_WEB,
  normalizeApplicationTypeCoverageList,
  publicApplicationType
};
