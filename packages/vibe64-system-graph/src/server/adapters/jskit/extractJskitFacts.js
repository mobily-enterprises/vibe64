import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { compileScript, parse as parseVueSfc } from "@vue/compiler-sfc";
import tsMorph from "ts-morph";
import {
  ensureArray,
  ensureObject,
  sortStrings
} from "../valueUtils.js";
import {
  readJskitProject
} from "./jskitProjectReader.js";

const {
  ModuleKind,
  ModuleResolutionKind,
  Project,
  ScriptTarget,
  ts
} = tsMorph;

const JSKIT_FACTS_SCHEMA = "vibe64.system.jskit-facts.v1";
const JSKIT_FACTS_VERSION = 1;
const CODE_EXTENSIONS = Object.freeze([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue"]);
const CODE_EXTENSION_SET = new Set(CODE_EXTENSIONS);
const APP_SCAN_ROOTS = Object.freeze(["src", "packages", "config", "server", "scripts"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".jskit",
  ".npm-cache",
  "coverage",
  "dist",
  "node_modules"
]);
const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"]);
const ROUTE_RECEIVER_PATTERN = /(?:^|\.)(?:app|fastify|instance|router|server)$/u;
const HELPER_NAME_PATTERN =
  /^(assert|build|coerce|create|ensure|extract|format|get|has|is|list|load|make|map|normalize|parse|read|render|resolve|run|serialize|to|update|use|validate|write)[A-Z_]/u;
const EXECUTION_SIDE_ORDER = Object.freeze(["client", "server", "shared", "external", "unknown"]);

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePosixPath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
}

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function sourceLineCount(source = "") {
  const normalized = String(source || "").replace(/\r\n?|\n/gu, "\n");
  if (!normalized) {
    return 0;
  }
  const separators = normalized.match(/\n/gu)?.length || 0;
  return separators + (normalized.endsWith("\n") ? 0 : 1);
}

function isSystemModelCodePath(filePath = "") {
  return CODE_EXTENSION_SET.has(path.extname(String(filePath || "")).toLowerCase());
}

function classifySymbol(name = "") {
  if (!name || name === "default") {
    return "default";
  }
  if (/^use[A-Z]/u.test(name)) {
    return "composable";
  }
  if (/^[A-Z]/u.test(name)) {
    return "component_or_class";
  }
  if (HELPER_NAME_PATTERN.test(name)) {
    return "helper";
  }
  return "export";
}

function createExportAnalysisProject() {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
      target: ScriptTarget.ESNext
    }
  });
}

function addSymbol(symbols, symbol) {
  if (!symbol.name) {
    return;
  }
  const key = `${symbol.name}:${symbol.kind}`;
  if (symbols.has(key)) {
    return;
  }
  symbols.set(key, {
    name: symbol.name,
    kind: symbol.kind,
    role: classifySymbol(symbol.name)
  });
}

function compilerNodeHasModifier(node, modifierKind) {
  return Array.isArray(node?.modifiers) && node.modifiers.some((modifier) => modifier.kind === modifierKind);
}

function exportedDeclarationName(node) {
  if (compilerNodeHasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return "default";
  }
  return String(node?.name?.text || node?.name?.escapedText || "").trim();
}

function addExportedDeclarationSymbol(symbols, node, kind = "export") {
  const name = exportedDeclarationName(node);
  if (!name) {
    return;
  }
  addSymbol(symbols, {
    kind: name === "default" ? "default" : kind,
    name
  });
}

function bindingNameTexts(bindingName, names = []) {
  if (!bindingName) {
    return names;
  }
  if (ts.isIdentifier(bindingName)) {
    names.push(String(bindingName.text || ""));
    return names;
  }
  if (ts.isObjectBindingPattern(bindingName) || ts.isArrayBindingPattern(bindingName)) {
    for (const element of bindingName.elements || []) {
      if (element.name) {
        bindingNameTexts(element.name, names);
      }
    }
  }
  return names;
}

function addVariableStatementExports(symbols, statement) {
  if (!compilerNodeHasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return;
  }
  for (const declaration of statement.declarationList?.declarations || []) {
    for (const name of bindingNameTexts(declaration.name)) {
      addSymbol(symbols, {
        kind: declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
          ? "function"
          : "value",
        name
      });
    }
  }
}

function addNamedExportSymbols(symbols, exportClause) {
  if (!exportClause) {
    return;
  }
  if (ts.isNamespaceExport(exportClause)) {
    addSymbol(symbols, {
      kind: "export",
      name: String(exportClause.name?.text || "")
    });
    return;
  }
  if (!ts.isNamedExports(exportClause)) {
    return;
  }
  for (const specifier of exportClause.elements || []) {
    addSymbol(symbols, {
      kind: "export",
      name: String(specifier.name?.text || "")
    });
  }
}

function extractExportedSymbols(sourceFile) {
  const symbols = new Map();
  for (const statement of sourceFile.compilerNode.statements || []) {
    if (ts.isExportDeclaration(statement)) {
      addNamedExportSymbols(symbols, statement.exportClause);
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      addSymbol(symbols, {
        kind: "default",
        name: "default"
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      addVariableStatementExports(symbols, statement);
      continue;
    }
    if (!compilerNodeHasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      addExportedDeclarationSymbol(symbols, statement, "function");
    } else if (ts.isClassDeclaration(statement)) {
      addExportedDeclarationSymbol(symbols, statement, "class");
    } else if (ts.isInterfaceDeclaration(statement)) {
      addExportedDeclarationSymbol(symbols, statement, "interface");
    } else if (ts.isTypeAliasDeclaration(statement)) {
      addExportedDeclarationSymbol(symbols, statement, "type");
    } else if (ts.isEnumDeclaration(statement)) {
      addExportedDeclarationSymbol(symbols, statement, "enum");
    }
  }

  return stableSort(symbols.values(), (symbol) => `${symbol.name}:${symbol.kind}`);
}

function extractVueScriptSource(source = "", filePath = "") {
  const parsed = parseVueSfc(source, {
    filename: filePath
  });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message || String(error)).join("; "));
  }
  const descriptor = parsed.descriptor;
  if (descriptor.scriptSetup) {
    return compileScript(descriptor, {
      id: filePath
    }).content;
  }
  if (descriptor.script) {
    return descriptor.script.content;
  }
  return "";
}

async function addCodeFileToProject(project, file) {
  if (path.extname(file.absolutePath) !== ".vue") {
    return project.addSourceFileAtPath(file.absolutePath);
  }
  const source = extractVueScriptSource(await readFile(file.absolutePath, "utf8"), file.absolutePath);
  if (!source.trim()) {
    return null;
  }
  return project.createSourceFile(`${file.absolutePath}.ts`, source, {
    overwrite: true
  });
}

async function walkCodeFiles(rootPath, relativeRoot = "") {
  const entries = await readdir(rootPath, {
    withFileTypes: true
  });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = normalizePosixPath(path.join(relativeRoot, entry.name));
    if (entry.isDirectory()) {
      files.push(...await walkCodeFiles(absolutePath, relativePath));
      continue;
    }
    if (!entry.isFile() || !isSystemModelCodePath(entry.name)) {
      continue;
    }
    files.push({
      absolutePath,
      relativePath
    });
  }
  return files;
}

async function collectCodeFiles(targetRoot) {
  const files = [];
  for (const scanRoot of APP_SCAN_ROOTS) {
    const rootPath = path.join(targetRoot, scanRoot);
    if (await fileExists(rootPath)) {
      files.push(...await walkCodeFiles(rootPath, scanRoot));
    }
  }
  return stableSort(files, (file) => file.relativePath);
}

function stringLiteralValue(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return String(node.text || "");
  }
  return "";
}

function sourceLine(sourceFile, node) {
  return sourceFile.getLineAndColumnAtPos(node.getStart()).line;
}

function addImportRecord(records, record) {
  const key = `${record.kind}:${record.specifier}:${record.line}`;
  if (!records.has(key)) {
    records.set(key, record);
  }
}

function importDeclarationSymbols(statement) {
  const clause = statement.importClause;
  if (!clause) {
    return [];
  }
  const symbols = [];
  if (clause.name) {
    symbols.push("default");
  }
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    symbols.push("*");
  } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements || []) {
      symbols.push(String(element.propertyName?.text || element.name?.text || ""));
    }
  }
  return sortStrings(new Set(symbols.filter(Boolean)));
}

function exportDeclarationSymbols(statement) {
  const clause = statement.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) {
    return ["*"];
  }
  if (!ts.isNamedExports(clause)) {
    return [];
  }
  return sortStrings(new Set(
    (clause.elements || [])
      .map((element) => String(element.propertyName?.text || element.name?.text || ""))
      .filter(Boolean)
  ));
}

function callImportSymbols(callExpression) {
  const parent = callExpression.compilerNode.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === callExpression.compilerNode) {
    return [String(parent.name?.text || "")].filter(Boolean);
  }
  if (ts.isVariableDeclaration(parent)) {
    if (ts.isObjectBindingPattern(parent.name)) {
      return sortStrings(new Set(
        (parent.name.elements || [])
          .map((element) => String(element.propertyName?.text || element.name?.text || ""))
          .filter(Boolean)
      ));
    }
    return ["*"];
  }
  return ["*"];
}

function extractStaticImports(sourceFile) {
  const records = new Map();
  for (const statement of sourceFile.compilerNode.statements || []) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      if (specifier) {
        addImportRecord(records, {
          kind: "import",
          line: sourceLine(sourceFile, sourceFile.getDescendantAtPos(statement.moduleSpecifier.pos) || sourceFile),
          specifier,
          symbols: importDeclarationSymbols(statement)
        });
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      if (specifier) {
        addImportRecord(records, {
          kind: "export",
          line: sourceLine(sourceFile, sourceFile.getDescendantAtPos(statement.moduleSpecifier.pos) || sourceFile),
          specifier,
          symbols: exportDeclarationSymbols(statement)
        });
      }
    }
  }

  for (const callExpression of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)) {
    const node = callExpression.compilerNode;
    const expression = node.expression;
    const isRequire = ts.isIdentifier(expression) && expression.text === "require";
    const isDynamicImport = expression.kind === ts.SyntaxKind.ImportKeyword;
    if (!isRequire && !isDynamicImport) {
      continue;
    }
    const specifier = stringLiteralValue(node.arguments?.[0]);
    if (!specifier) {
      continue;
    }
    addImportRecord(records, {
      kind: isRequire ? "require" : "dynamic-import",
      line: sourceLine(sourceFile, callExpression),
      specifier,
      symbols: callImportSymbols(callExpression)
    });
  }

  return stableSort(records.values(), (record) => `${record.specifier}:${record.kind}:${record.line}`);
}

function addTokenBinding(records, binding) {
  const token = String(binding.token || "").trim();
  if (!token) {
    return;
  }
  const key = `${binding.direction}:${token}:${binding.line}:${binding.mechanism}`;
  if (!records.has(key)) {
    records.set(key, {
      direction: binding.direction,
      line: Math.max(1, Number(binding.line) || 1),
      mechanism: binding.mechanism,
      token
    });
  }
}

function staticTokenValue(sourceFile, node) {
  if (!node) {
    return "";
  }
  const literal = stringLiteralValue(node);
  if (literal || !ts.isIdentifier(node)) {
    return literal;
  }
  for (const statement of sourceFile.compilerNode.statements || []) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations || []) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === node.text) {
        return stringLiteralValue(declaration.initializer);
      }
    }
  }
  return "";
}

function actionDependencyTokens(sourceFile, callExpression) {
  if (callExpressionName(callExpression.compilerNode) !== "withActionDefaults") {
    return [];
  }
  const options = callExpression.compilerNode.arguments?.[1];
  if (!ts.isObjectLiteralExpression(options)) {
    return [];
  }
  const dependencies = (options.properties || []).find((property) => (
    ts.isPropertyAssignment(property) && objectPropertyName(property.name) === "dependencies"
  ));
  if (!dependencies || !ts.isObjectLiteralExpression(dependencies.initializer)) {
    return [];
  }
  return (dependencies.initializer.properties || [])
    .filter(ts.isPropertyAssignment)
    .map((property) => staticTokenValue(sourceFile, property.initializer))
    .filter(Boolean);
}

function callExpressionReceiver(node) {
  return ts.isPropertyAccessExpression(node?.expression)
    ? String(node.expression.expression?.getText?.() || "").trim()
    : "";
}

function extractJskitTokenBindings(sourceFile) {
  const records = new Map();
  for (const callExpression of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)) {
    const name = callExpressionName(callExpression.compilerNode);
    const receiver = callExpressionReceiver(callExpression.compilerNode);
    const token = staticTokenValue(sourceFile, callExpression.compilerNode.arguments?.[0]);
    if ((name === "service" || name === "singleton") && receiver === "app" && token) {
      addTokenBinding(records, {
        direction: "provides",
        line: sourceLine(sourceFile, callExpression),
        mechanism: name,
        token
      });
    } else if (name === "make" && (receiver === "scope" || receiver === "app") && token) {
      addTokenBinding(records, {
        direction: "consumes",
        line: sourceLine(sourceFile, callExpression),
        mechanism: "make",
        token
      });
    }
    for (const dependencyToken of actionDependencyTokens(sourceFile, callExpression)) {
      addTokenBinding(records, {
        direction: "consumes",
        line: sourceLine(sourceFile, callExpression),
        mechanism: "action-dependency",
        token: dependencyToken
      });
    }
  }
  for (const property of sourceFile.getDescendantsOfKind(ts.SyntaxKind.PropertyDeclaration)) {
    const node = property.compilerNode;
    const isStatic = compilerNodeHasModifier(node, ts.SyntaxKind.StaticKeyword);
    if (!isStatic || objectPropertyName(node.name) !== "dependsOn" || !ts.isArrayLiteralExpression(node.initializer)) {
      continue;
    }
    for (const element of node.initializer.elements || []) {
      addTokenBinding(records, {
        direction: "consumes",
        line: sourceLine(sourceFile, property),
        mechanism: "provider-depends-on",
        token: staticTokenValue(sourceFile, element)
      });
    }
  }
  return stableSort(records.values(), (record) => (
    `${record.direction}:${record.token}:${record.line}:${record.mechanism}`
  ));
}

function normalizeHttpPath(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
}

function routeCallDetails(callExpression) {
  const node = callExpression.compilerNode;
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  const method = String(node.expression.name?.text || "").toLowerCase();
  if (!HTTP_METHODS.has(method)) {
    return null;
  }
  const receiver = String(node.expression.expression?.getText?.() || "").trim();
  if (!ROUTE_RECEIVER_PATTERN.test(receiver)) {
    return null;
  }
  const routePath = normalizeHttpPath(stringLiteralValue(node.arguments?.[0]));
  return {
    dynamic: !routePath,
    method: method.toUpperCase(),
    path: routePath,
    receiver
  };
}

function extractHttpRoutes(sourceFile) {
  const diagnostics = [];
  const routes = [];
  for (const callExpression of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)) {
    const details = routeCallDetails(callExpression);
    if (!details) {
      continue;
    }
    const line = sourceLine(sourceFile, callExpression);
    if (details.dynamic) {
      diagnostics.push({
        code: "dynamic_route_path",
        line,
        message: `Could not resolve ${details.method} route path statically.`
      });
      continue;
    }
    routes.push({
      id: `http:operation:http:${details.method}:${details.path}`,
      interfaceId: `http:interface:http:${details.path.split("/").filter(Boolean)[0] ? `/${details.path.split("/").filter(Boolean)[0]}` : "/"}`,
      line,
      method: details.method,
      path: details.path
    });
  }
  return {
    diagnostics,
    routes: stableSort(routes, (route) => `${route.method}:${route.path}:${route.line}`)
  };
}

function callExpressionName(node) {
  const expression = node?.expression;
  if (ts.isIdentifier(expression)) {
    return String(expression.text || "");
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return String(expression.name?.text || "");
  }
  return "";
}

function objectPropertyName(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteralLike(nameNode) || ts.isNumericLiteral(nameNode)) {
    return String(nameNode.text || "");
  }
  return "";
}

function staticExpressionValue(node, depth = 0) {
  if (!node || depth > 2) {
    return null;
  }
  const stringValue = stringLiteralValue(node);
  if (stringValue) {
    return stringValue;
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
  if (ts.isIdentifier(node)) {
    return {
      identifier: String(node.text || "")
    };
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => staticExpressionValue(element, depth + 1));
  }
  if (!ts.isObjectLiteralExpression(node)) {
    return null;
  }
  const value = {};
  for (const property of node.properties || []) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const name = objectPropertyName(property.name);
    if (name) {
      value[name] = staticExpressionValue(property.initializer, depth + 1);
    }
  }
  return value;
}

function ownerFunctionName(callExpression) {
  for (const ancestor of callExpression.getAncestors()) {
    const node = ancestor.compilerNode;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      return String(node.name?.text || "");
    }
    if (ts.isVariableDeclaration(node)) {
      return String(node.name?.getText?.() || "");
    }
  }
  return "";
}

function enclosingCallNames(callExpression) {
  const names = [];
  for (const ancestor of callExpression.getAncestors()) {
    if (ancestor.getKind() !== ts.SyntaxKind.CallExpression) {
      continue;
    }
    const name = callExpressionName(ancestor.compilerNode);
    if (name && !names.includes(name)) {
      names.push(name);
    }
    if (names.length >= 3) {
      break;
    }
  }
  return names;
}

function extractStaticCallFacts(sourceFile) {
  const calls = [];
  for (const callExpression of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)) {
    const node = callExpression.compilerNode;
    const name = callExpressionName(node);
    if (!name) {
      continue;
    }
    const args = [...(node.arguments || [])].map((argument) => staticExpressionValue(argument));
    if (!args.some((argument) => typeof argument === "string" && argument.length > 0)) {
      continue;
    }
    calls.push({
      arguments: args,
      contextCalls: enclosingCallNames(callExpression),
      line: sourceLine(sourceFile, callExpression),
      name,
      ownerFunction: ownerFunctionName(callExpression)
    });
  }
  return stableSort(calls, (call) => `${call.line}:${call.name}:${JSON.stringify(call.arguments)}`);
}

function packageIdFromSpecifier(specifier = "") {
  const parts = String(specifier || "").split("/").filter(Boolean);
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return parts[0] || "";
}

function packageOwner(relativePath, packageRoots = []) {
  return packageRoots.find((entry) => (
    relativePath === entry.relativeDir || relativePath.startsWith(`${entry.relativeDir}/`)
  ))?.packageId || "";
}

function candidateCodePaths(basePath = "") {
  const base = normalizePosixPath(basePath);
  if (!base) {
    return [];
  }

  const extension = path.posix.extname(base);
  const candidates = new Set([base]);
  if (extension) {
    const withoutExtension = base.slice(0, -extension.length);
    for (const codeExtension of CODE_EXTENSIONS) {
      candidates.add(`${withoutExtension}${codeExtension}`);
    }
  } else {
    for (const codeExtension of CODE_EXTENSIONS) {
      candidates.add(`${base}${codeExtension}`);
      candidates.add(`${base}/index${codeExtension}`);
    }
  }
  return [...candidates];
}

function candidateModulePaths(fromPath, specifier) {
  const normalizedSpecifier = String(specifier || "").trim().replace(/\\/gu, "/");
  if (normalizedSpecifier.startsWith("@/")) {
    return candidateCodePaths(`src/${normalizedSpecifier.slice(2)}`);
  }
  if (/^\/(?:config|packages|scripts|server|src)\//u.test(normalizedSpecifier)) {
    return candidateCodePaths(normalizedSpecifier.slice(1));
  }
  if (normalizedSpecifier.startsWith(".")) {
    return candidateCodePaths(path.posix.normalize(
      path.posix.join(path.posix.dirname(fromPath), normalizedSpecifier)
    ));
  }
  return [];
}

function conditionalExportTargets(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(conditionalExportTargets);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap(conditionalExportTargets);
}

function packageExportTargets(packageEntry, specifier) {
  const exportMap = packageEntry?.packageExports;
  const packageId = String(packageEntry?.packageId || "");
  if (!packageId || !specifier.startsWith(packageId)) {
    return [];
  }
  const suffix = specifier.slice(packageId.length);
  if (suffix && !suffix.startsWith("/")) {
    return [];
  }
  const exportKey = suffix ? `.${suffix}` : ".";
  if (typeof exportMap === "string" || Array.isArray(exportMap)) {
    return exportKey === "." ? conditionalExportTargets(exportMap) : [];
  }
  if (!exportMap || typeof exportMap !== "object") {
    return [];
  }
  if (Object.hasOwn(exportMap, exportKey)) {
    return conditionalExportTargets(exportMap[exportKey]);
  }
  if (exportKey === "." && !Object.keys(exportMap).some((key) => key.startsWith("."))) {
    return conditionalExportTargets(exportMap);
  }
  const wildcardMatches = Object.entries(exportMap)
    .filter(([key]) => key.includes("*"))
    .map(([key, value]) => {
      const [prefix, suffixPattern = ""] = key.split("*");
      return exportKey.startsWith(prefix) && exportKey.endsWith(suffixPattern)
        ? {
            key,
            match: exportKey.slice(prefix.length, exportKey.length - suffixPattern.length),
            value
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.key.length - left.key.length);
  const match = wildcardMatches[0];
  return match
    ? conditionalExportTargets(match.value).map((target) => target.replaceAll("*", match.match))
    : [];
}

function resolvePackageTargetFile({ filesByPath, packageEntry, specifier }) {
  for (const target of packageExportTargets(packageEntry, specifier)) {
    if (!target.startsWith("./")) {
      continue;
    }
    const targetBase = normalizePosixPath(path.posix.join(packageEntry.relativeDir, target.slice(2)));
    if (targetBase !== packageEntry.relativeDir && !targetBase.startsWith(`${packageEntry.relativeDir}/`)) {
      continue;
    }
    for (const candidate of candidateCodePaths(targetBase)) {
      if (filesByPath.has(candidate)) {
        return candidate;
      }
    }
  }
  return "";
}

function resolveImportRecord({ file, record, filesByPath, localPackages }) {
  const specifier = String(record.specifier || "");
  for (const candidate of candidateModulePaths(file.path, specifier)) {
    const target = filesByPath.get(candidate);
    if (!target) {
      continue;
    }
    const crossesPackage = Boolean(file.packageId && target.packageId && file.packageId !== target.packageId);
    return {
      ...record,
      classification: crossesPackage ? "cross-package" : "local-file",
      targetFile: target.path,
      targetPackageId: target.packageId || ""
    };
  }

  const internalSpecifier = specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("/");
  const importedExtension = path.posix.extname(specifier.split(/[?#]/u)[0] || "").toLowerCase();
  if (internalSpecifier && importedExtension && !CODE_EXTENSION_SET.has(importedExtension)) {
    return {
      ...record,
      classification: "local-asset",
      targetFile: "",
      targetPackageId: ""
    };
  }

  if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("/")) {
    const targetPackageId = packageIdFromSpecifier(specifier);
    const packageEntry = localPackages.get(targetPackageId);
    const targetFile = packageEntry
      ? resolvePackageTargetFile({ filesByPath, packageEntry, specifier })
      : "";
    return {
      ...record,
      classification: packageEntry ? targetFile ? "cross-package" : "package-specifier" : "external-package",
      targetFile,
      targetPackageId
    };
  }

  return {
    ...record,
    classification: "unresolved",
    targetFile: "",
    targetPackageId: ""
  };
}

function executionSideFromSet(sides = new Set()) {
  if (sides.has("client") && sides.has("server")) {
    return "shared";
  }
  if (sides.has("client")) {
    return "client";
  }
  if (sides.has("server")) {
    return "server";
  }
  return "unknown";
}

function providerRecords(packageEntry) {
  const runtime = ensureObject(packageEntry?.descriptor?.runtime);
  const providers = [];
  for (const side of ["client", "server"]) {
    for (const rawProvider of ensureArray(ensureObject(runtime[side]).providers)) {
      const provider = ensureObject(rawProvider);
      const entrypoint = normalizePosixPath(provider.entrypoint);
      if (!entrypoint) {
        continue;
      }
      const exportName = String(provider.export || "").trim();
      const relativePath = normalizePosixPath(path.posix.join(packageEntry.relativeDir, entrypoint));
      providers.push({
        id: `jskit:component:provider:${packageEntry.packageId}:${exportName || path.posix.basename(entrypoint)}`,
        entrypoint: relativePath,
        evidence: [{
          path: packageEntry.descriptorRelativePath
        }],
        exportName,
        side
      });
    }
  }
  return stableSort(providers, (provider) => `${provider.side}:${provider.entrypoint}:${provider.exportName}`);
}

function packageRecords(packageRegistry = new Map()) {
  return stableSort(
    [...packageRegistry.values()].map((entry) => {
      const descriptor = ensureObject(entry.descriptor);
      const capabilities = ensureObject(descriptor.capabilities);
      const apiSummary = ensureObject(ensureObject(descriptor.metadata).apiSummary);
      const containerTokens = ensureObject(apiSummary.containerTokens);
      return {
        id: `jskit:subsystem:package:${entry.packageId}`,
        packageId: entry.packageId,
        version: String(entry.version || ""),
        description: String(descriptor.description || ""),
        relativeDir: normalizePosixPath(entry.relativeDir),
        descriptorPath: normalizePosixPath(entry.descriptorRelativePath),
        sourceType: String(entry.sourceType || ""),
        dependsOn: sortStrings(ensureArray(descriptor.dependsOn).map(String)),
        capabilities: {
          provides: sortStrings(ensureArray(capabilities.provides).map(String)),
          requires: sortStrings(ensureArray(capabilities.requires).map(String))
        },
        containerTokens: {
          client: sortStrings(ensureArray(containerTokens.client).map(String)),
          server: sortStrings(ensureArray(containerTokens.server).map(String))
        },
        providers: providerRecords(entry),
        executionSides: []
      };
    }),
    (entry) => entry.packageId
  );
}

function resolveJskitTokenBindings(files, packages) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const providersByToken = new Map();

  function addProvider(token, provider) {
    if (!token || !provider.filePath) {
      return;
    }
    const records = providersByToken.get(token) || [];
    if (!records.some((record) => record.filePath === provider.filePath)) {
      records.push(provider);
      providersByToken.set(token, records);
    }
  }

  for (const file of files) {
    for (const binding of file.tokenBindings || []) {
      if (binding.direction === "provides") {
        addProvider(binding.token, {
          filePath: file.path,
          packageId: file.packageId
        });
      }
    }
  }
  for (const packageEntry of packages) {
    for (const side of ["client", "server"]) {
      const provider = (packageEntry.providers || []).find((entry) => entry.side === side);
      if (!provider || !filesByPath.has(provider.entrypoint)) {
        continue;
      }
      for (const token of packageEntry.containerTokens?.[side] || []) {
        addProvider(token, {
          filePath: provider.entrypoint,
          packageId: packageEntry.packageId
        });
      }
    }
  }

  for (const file of files) {
    file.tokenBindings = (file.tokenBindings || []).map((binding) => {
      if (binding.direction !== "consumes") {
        return binding;
      }
      const providers = providersByToken.get(binding.token) || [];
      if (providers.length !== 1) {
        return {
          ...binding,
          targetExternalId: `token:${binding.token}`
        };
      }
      return {
        ...binding,
        targetFile: providers[0].filePath,
        targetPackageId: providers[0].packageId
      };
    });
  }
}

function seedExecutionSides(filesByPath, packages) {
  const sidesByFile = new Map([...filesByPath.keys()].map((filePath) => [filePath, new Set()]));
  const queue = [];

  function seed(filePath, side) {
    const sides = sidesByFile.get(filePath);
    if (!sides || sides.has(side)) {
      return;
    }
    sides.add(side);
    queue.push({
      filePath,
      side
    });
  }

  for (const packageEntry of packages) {
    for (const provider of packageEntry.providers) {
      seed(provider.entrypoint, provider.side);
    }
  }
  for (const file of filesByPath.values()) {
    if (file.routes.length > 0) {
      seed(file.path, "server");
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const file = filesByPath.get(current.filePath);
    for (const importRecord of file?.imports || []) {
      if (importRecord.targetFile) {
        seed(importRecord.targetFile, current.side);
      }
    }
  }

  return sidesByFile;
}

async function inspectSystemSource({ targetRoot, packageRoots = [] }) {
  const project = createExportAnalysisProject();
  const diagnostics = [];
  const files = [];
  for (const sourceFileRecord of await collectCodeFiles(targetRoot)) {
    const source = await readFile(sourceFileRecord.absolutePath, "utf8");
    let parsedSourceFile = null;
    try {
      parsedSourceFile = await addCodeFileToProject(project, sourceFileRecord);
    } catch (error) {
      diagnostics.push({
        code: "source_parse_failed",
        message: String(error?.message || error),
        path: sourceFileRecord.relativePath
      });
    }
    const routeExtraction = parsedSourceFile
      ? extractHttpRoutes(parsedSourceFile)
      : { diagnostics: [], routes: [] };
    diagnostics.push(...routeExtraction.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      path: sourceFileRecord.relativePath
    })));
    files.push({
      path: sourceFileRecord.relativePath,
      hash: sha256(source),
      bytes: Buffer.byteLength(source),
      lines: sourceLineCount(source),
      packageId: packageOwner(sourceFileRecord.relativePath, packageRoots),
      executionSide: "unknown",
      executionSideEvidence: [],
      exports: parsedSourceFile ? extractExportedSymbols(parsedSourceFile) : [],
      calls: parsedSourceFile ? extractStaticCallFacts(parsedSourceFile) : [],
      tokenBindings: parsedSourceFile ? extractJskitTokenBindings(parsedSourceFile) : [],
      rawImports: parsedSourceFile ? extractStaticImports(parsedSourceFile) : [],
      imports: [],
      routes: routeExtraction.routes
    });
  }
  return {
    diagnostics: stableSort(diagnostics, (diagnostic) => `${diagnostic.path}:${diagnostic.line || 0}:${diagnostic.code}`),
    files
  };
}

function resolveImports(files, localPackages) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    file.imports = file.rawImports.map((record) => resolveImportRecord({
      file,
      filesByPath,
      localPackages,
      record
    }));
    delete file.rawImports;
  }
  return filesByPath;
}

function applyExecutionSides({ filesByPath, packages, diagnostics }) {
  const sidesByFile = seedExecutionSides(filesByPath, packages);
  for (const file of filesByPath.values()) {
    const sides = sidesByFile.get(file.path) || new Set();
    file.executionSide = executionSideFromSet(sides);
    file.executionSideEvidence = stableSort([...sides].map((side) => ({
      side,
      source: "static-runtime-reachability"
    })), (entry) => entry.side);
    if (file.routes.length > 0 && sides.has("client")) {
      diagnostics.push({
        code: "execution_side_conflict",
        message: "A registered server route is statically reachable from the client runtime.",
        path: file.path
      });
    }
  }

  for (const packageEntry of packages) {
    const sides = new Set(packageEntry.providers.map((provider) => provider.side));
    for (const file of filesByPath.values()) {
      if (file.packageId === packageEntry.packageId && file.executionSide !== "unknown") {
        sides.add(file.executionSide);
      }
    }
    if (sides.size === 0) {
      sides.add("unknown");
    }
    packageEntry.executionSides = EXECUTION_SIDE_ORDER.filter((side) => sides.has(side));
  }
}

function dependencyRelationships(packages) {
  const localIds = new Set(packages.map((entry) => entry.packageId));
  const relationships = [];
  for (const packageEntry of packages) {
    for (const dependencyId of packageEntry.dependsOn) {
      relationships.push({
        id: `jskit:relationship:depends_on:${packageEntry.packageId}:${dependencyId}`,
        kind: "depends_on",
        from: packageEntry.id,
        to: localIds.has(dependencyId) ? `jskit:subsystem:package:${dependencyId}` : `jskit:external:package:${dependencyId}`
      });
    }
  }
  return stableSort(relationships, (relationship) => relationship.id);
}

function normalizeScopes(scopes = []) {
  return sortStrings(new Set(
    ensureArray(scopes)
      .flatMap((value) => String(value || "").split(","))
      .map((value) => value.trim())
      .filter(Boolean)
  ));
}

function scopedPayload({ packages, files, relationships, scopes }) {
  if (scopes.length === 0) {
    return {
      packages,
      files,
      relationships,
      scope: {
        mode: "full",
        requestedPackageIds: [],
        authoritativePackageIds: packages.map((entry) => entry.packageId),
        fullScanRequired: false,
        unknownPackageIds: []
      }
    };
  }

  const availableIds = new Set(packages.map((entry) => entry.packageId));
  const unknownPackageIds = scopes.filter((scope) => !availableIds.has(scope));
  const scopeSet = new Set(scopes);
  return {
    packages: packages.filter((entry) => scopeSet.has(entry.packageId)),
    files: files.filter((file) => scopeSet.has(file.packageId)),
    relationships: relationships.filter((relationship) => scopes.some((scope) => relationship.from === `jskit:subsystem:package:${scope}`)),
    scope: {
      mode: "partial",
      requestedPackageIds: scopes,
      authoritativePackageIds: scopes.filter((scope) => availableIds.has(scope)),
      fullScanRequired: unknownPackageIds.length > 0,
      unknownPackageIds
    }
  };
}

async function extractJskitFacts({ targetRoot, scopes = [] }) {
  const {
    packageJson,
    lock,
    packageRegistry
  } = await readJskitProject(targetRoot);
  const packages = packageRecords(packageRegistry);
  const packageRoots = stableSort(packages.map((entry) => ({
    packageId: entry.packageId,
    packageExports: packageRegistry.get(entry.packageId)?.packageExports ?? {},
    relativeDir: entry.relativeDir
  })), (entry) => `${String(entry.relativeDir.length).padStart(8, "0")}:${entry.relativeDir}`).reverse();
  const source = await inspectSystemSource({
    packageRoots,
    targetRoot
  });
  const filesByPath = resolveImports(
    source.files,
    new Map(packageRoots.map((entry) => [entry.packageId, entry]))
  );
  applyExecutionSides({
    diagnostics: source.diagnostics,
    filesByPath,
    packages
  });
  const files = stableSort(filesByPath.values(), (file) => file.path);
  resolveJskitTokenBindings(files, packages);
  const relationships = dependencyRelationships(packages);
  const scoped = scopedPayload({
    files,
    packages,
    relationships,
    scopes: normalizeScopes(scopes)
  });
  const input = {
    lockVersion: Number(lock.lockVersion || 1),
    rootPackage: {
      name: String(packageJson.name || ""),
      version: String(packageJson.version || "")
    },
    digest: sha256(JSON.stringify({
      files: files.map((file) => [file.path, file.hash]),
      packages: packages.map((entry) => [entry.packageId, entry.version, entry.descriptorPath])
    }))
  };

  if (scoped.scope.fullScanRequired) {
    source.diagnostics.push({
      code: "full_scan_required",
      message: `Unknown requested package scope: ${scoped.scope.unknownPackageIds.join(", ")}.`
    });
  }

  return {
    schema: JSKIT_FACTS_SCHEMA,
    version: JSKIT_FACTS_VERSION,
    input,
    scope: scoped.scope,
    packages: scoped.packages,
    files: scoped.files,
    relationships: scoped.relationships,
    diagnostics: source.diagnostics,
    coverage: {
      files: scoped.files.length,
      packages: scoped.packages.length,
      relationships: scoped.relationships.length,
      routes: scoped.files.reduce((total, file) => total + file.routes.length, 0),
      unresolvedImports: scoped.files.reduce(
        (total, file) => total + file.imports.filter((record) => record.classification === "unresolved").length,
        0
      )
    }
  };
}

export {
  JSKIT_FACTS_SCHEMA,
  extractJskitFacts
};
