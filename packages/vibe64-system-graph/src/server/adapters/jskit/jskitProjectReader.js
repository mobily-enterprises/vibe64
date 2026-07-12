import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import tsMorph from "ts-morph";

import {
  ensureObject
} from "../valueUtils.js";

const { ScriptTarget, ts } = tsMorph;
const UNRESOLVED = Symbol("unresolved");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function normalizeRelativePath(rootPath, filePath) {
  return path.relative(rootPath, filePath).replace(/\\/gu, "/");
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
    return String(node.text || "");
  }
  return "";
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression?.(current))
  ) {
    current = current.expression;
  }
  return current;
}

function localInitializer(sourceFile, identifier) {
  for (const statement of sourceFile.statements || []) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations || []) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier) {
        return declaration.initializer || null;
      }
    }
  }
  return null;
}

function staticDescriptorValue(rawNode, sourceFile, state = { depth: 0, identifiers: new Set() }) {
  const node = unwrapExpression(rawNode);
  if (!node || state.depth > 40) {
    return UNRESOLVED;
  }
  const nextState = {
    depth: state.depth + 1,
    identifiers: state.identifiers
  };

  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return String(node.text || "");
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = staticDescriptorValue(node.operand, sourceFile, nextState);
    return typeof operand === "number" ? -operand : UNRESOLVED;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") {
      return undefined;
    }
    if (state.identifiers.has(node.text)) {
      return UNRESOLVED;
    }
    const initializer = localInitializer(sourceFile, node.text);
    if (!initializer) {
      return UNRESOLVED;
    }
    const identifiers = new Set(state.identifiers);
    identifiers.add(node.text);
    return staticDescriptorValue(initializer, sourceFile, {
      depth: nextState.depth,
      identifiers
    });
  }
  if (ts.isCallExpression(node)) {
    const expression = node.expression;
    const isObjectWrapper = ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "Object" &&
      ["freeze", "seal"].includes(expression.name.text);
    return isObjectWrapper
      ? staticDescriptorValue(node.arguments[0], sourceFile, nextState)
      : UNRESOLVED;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values = [];
    for (const element of node.elements || []) {
      const value = staticDescriptorValue(element, sourceFile, nextState);
      if (value !== UNRESOLVED) {
        values.push(value);
      }
    }
    return values;
  }
  if (!ts.isObjectLiteralExpression(node)) {
    return UNRESOLVED;
  }

  const value = {};
  for (const property of node.properties || []) {
    if (ts.isSpreadAssignment(property)) {
      const spreadValue = staticDescriptorValue(property.expression, sourceFile, nextState);
      if (spreadValue && spreadValue !== UNRESOLVED && typeof spreadValue === "object" && !Array.isArray(spreadValue)) {
        Object.assign(value, spreadValue);
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const entry = staticDescriptorValue(property.name, sourceFile, nextState);
      if (entry !== UNRESOLVED) {
        value[property.name.text] = entry;
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = propertyName(property.name);
    if (!name) {
      continue;
    }
    const entry = staticDescriptorValue(property.initializer, sourceFile, nextState);
    if (entry !== UNRESOLVED) {
      value[name] = entry;
    }
  }
  return value;
}

function parseJskitDescriptor(source, descriptorPath) {
  const sourceFile = ts.createSourceFile(
    descriptorPath,
    source,
    ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const assignment = sourceFile.statements.find((statement) => (
    ts.isExportAssignment(statement) && statement.isExportEquals !== true
  ));
  if (!assignment) {
    throw new TypeError(`JSKIT package descriptor has no default export: ${descriptorPath}`);
  }
  const descriptor = staticDescriptorValue(assignment.expression, sourceFile);
  if (!descriptor || descriptor === UNRESOLVED || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError(`JSKIT package descriptor is not statically readable: ${descriptorPath}`);
  }
  return descriptor;
}

async function readJskitPackage(appRoot, entry) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) {
    return null;
  }
  const packageRoot = path.join(appRoot, "packages", entry.name);
  const packageJsonPath = path.join(packageRoot, "package.json");
  const descriptorPath = path.join(packageRoot, "package.descriptor.mjs");
  if (!await fileExists(packageJsonPath) || !await fileExists(descriptorPath)) {
    return null;
  }
  const [packageJson, descriptorSource] = await Promise.all([
    readJson(packageJsonPath),
    readFile(descriptorPath, "utf8")
  ]);
  const packageId = String(packageJson?.name || "").trim();
  if (!packageId) {
    throw new TypeError(`JSKIT package is missing package.json name: ${normalizeRelativePath(appRoot, packageRoot)}`);
  }
  const descriptor = parseJskitDescriptor(descriptorSource, descriptorPath);
  const descriptorPackageId = String(descriptor.packageId || "").trim();
  if (descriptorPackageId && descriptorPackageId !== packageId) {
    throw new TypeError(`JSKIT descriptor packageId ${descriptorPackageId} does not match ${packageId}.`);
  }
  return {
    packageId,
    version: String(descriptor.version || packageJson.version || "").trim(),
    descriptor: {
      ...ensureObject(descriptor),
      packageId
    },
    relativeDir: normalizeRelativePath(appRoot, packageRoot),
    descriptorRelativePath: normalizeRelativePath(appRoot, descriptorPath),
    sourceType: "app-local-package"
  };
}

async function readJskitPackageRegistry(appRoot) {
  const packagesRoot = path.join(appRoot, "packages");
  if (!await fileExists(packagesRoot)) {
    return new Map();
  }
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packages = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readJskitPackage(appRoot, entry))
  );
  return new Map(packages.filter(Boolean).map((entry) => [entry.packageId, entry]));
}

async function readJskitProject(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const lockPath = path.join(appRoot, ".jskit", "lock.json");
  const [packageJson, lock, packageRegistry] = await Promise.all([
    readJson(packageJsonPath),
    await fileExists(lockPath) ? readJson(lockPath) : { lockVersion: 1, installedPackages: {} },
    readJskitPackageRegistry(appRoot)
  ]);
  return {
    packageJson,
    lock: {
      lockVersion: Math.max(1, Number(lock?.lockVersion) || 1),
      installedPackages: ensureObject(lock?.installedPackages)
    },
    packageRegistry
  };
}

export {
  parseJskitDescriptor,
  readJskitProject,
  readJskitPackageRegistry
};
