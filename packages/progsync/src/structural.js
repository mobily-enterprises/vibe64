import fs from "node:fs/promises";
import path from "node:path";

import { parse as parseJavaScript } from "@babel/parser";
import { parse as parseHtml } from "@vue/compiler-dom";
import { parse as parseVueSfc } from "@vue/compiler-sfc";

import { ProgSyncError } from "./errors.js";
import {
  absoluteProjectPath,
  implementationToProgramPath,
  slashPath
} from "./paths.js";

const AMBIENT_NAMES = new Set([
  "console",
  "document",
  "fetch",
  "localStorage",
  "navigator",
  "process",
  "sessionStorage",
  "window"
]);

function parseFailure(error, implementationPath) {
  const location = error?.loc
    ? ` at ${error.loc.line}:${error.loc.column + 1}`
    : "";
  return new ProgSyncError(
    "INVALID_IMPLEMENTATION",
    `${implementationPath} does not parse${location}.`,
    {
      column: error?.loc?.column === undefined ? null : error.loc.column + 1,
      line: error?.loc?.line || null,
      parserMessage: String(error?.message || error)
    }
  );
}

function javascriptPlugins({ jsx = false, typescript = false } = {}) {
  return [
    "decorators-legacy",
    "explicitResourceManagement",
    "importAttributes",
    "topLevelAwait",
    ...(jsx ? ["jsx"] : []),
    ...(typescript ? ["typescript"] : [])
  ];
}

function javascriptAst(source, {
  implementationPath = "module.js",
  jsx = /\.[cm]?jsx$/iu.test(implementationPath),
  typescript = /\.[cm]?tsx?$/iu.test(implementationPath)
} = {}) {
  try {
    return parseJavaScript(String(source || ""), {
      allowAwaitOutsideFunction: true,
      createImportExpressions: true,
      errorRecovery: false,
      plugins: javascriptPlugins({ jsx, typescript }),
      sourceFilename: implementationPath,
      sourceType: "unambiguous"
    });
  } catch (error) {
    throw parseFailure(error, implementationPath);
  }
}

function walkAst(value, visit, parent = null) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkAst(entry, visit, parent);
    }
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    (typeof value.type !== "string" && typeof value.type !== "number")
  ) {
    return;
  }
  visit(value, parent);
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "comments" ||
      key === "errors" ||
      key === "extra" ||
      key === "loc" ||
      key === "tokens"
    ) {
      continue;
    }
    if (
      Array.isArray(child) ||
      (
        child &&
        typeof child === "object" &&
        (typeof child.type === "string" || typeof child.type === "number")
      )
    ) {
      walkAst(child, visit, value);
    }
  }
}

function identifierName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier" || node.type === "PrivateName") {
    return node.id?.name || node.name || null;
  }
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    return String(node.value);
  }
  return null;
}

function patternNames(node, output = []) {
  if (!node) {
    return output;
  }
  if (node.type === "Identifier") {
    output.push(node.name);
  } else if (node.type === "AssignmentPattern") {
    patternNames(node.left, output);
  } else if (node.type === "RestElement") {
    patternNames(node.argument, output);
  } else if (node.type === "ObjectPattern") {
    for (const property of node.properties || []) {
      patternNames(property.type === "RestElement" ? property.argument : property.value, output);
    }
  } else if (node.type === "ArrayPattern") {
    for (const element of node.elements || []) {
      patternNames(element, output);
    }
  } else if (node.type === "TSParameterProperty") {
    patternNames(node.parameter, output);
  }
  return output;
}

function parameterNames(parameters = []) {
  return [...new Set(parameters.flatMap((parameter) => publicParameterNames(parameter)))];
}

function publicParameterNames(node, output = []) {
  if (!node) {
    return output;
  }
  if (node.type === "Identifier") {
    output.push(node.name);
  } else if (node.type === "AssignmentPattern") {
    publicParameterNames(node.left, output);
  } else if (node.type === "RestElement") {
    publicParameterNames(node.argument, output);
  } else if (node.type === "ObjectPattern") {
    for (const property of node.properties || []) {
      if (property.type === "RestElement") {
        publicParameterNames(property.argument, output);
        continue;
      }
      const name = identifierName(property.key);
      if (name) {
        output.push(name);
      }
    }
  } else if (node.type === "ArrayPattern") {
    for (const element of node.elements || []) {
      publicParameterNames(element, output);
    }
  } else if (node.type === "TSParameterProperty") {
    publicParameterNames(node.parameter, output);
  }
  return output;
}

function parameterGroup(parameter) {
  let node = parameter;
  let defaulted = false;
  let rest = false;
  if (node?.type === "TSParameterProperty") {
    node = node.parameter;
  }
  if (node?.type === "AssignmentPattern") {
    defaulted = true;
    node = node.left;
  }
  if (node?.type === "RestElement") {
    rest = true;
    node = node.argument;
  }
  const names = parameterNames([node]);
  return {
    defaulted,
    kind: node?.type === "ObjectPattern"
      ? "object"
      : node?.type === "ArrayPattern"
        ? "array"
        : node?.type === "Identifier"
          ? "identifier"
          : "unknown",
    names,
    rest
  };
}

function parameterGroups(parameters = []) {
  return parameters.map((parameter) => parameterGroup(parameter));
}

function classMethods(node) {
  return (node?.body?.body || [])
    .filter((member) => (
      member.type === "ClassMethod" ||
      member.type === "ClassPrivateMethod" ||
      member.type === "TSDeclareMethod"
    ))
    .map((member) => {
      const name = identifierName(member.key);
      return {
        async: Boolean(member.async),
        kind: member.kind || "method",
        name,
        parameterGroups: parameterGroups(member.params),
        parameters: parameterNames(member.params),
        private: member.type === "ClassPrivateMethod" || Boolean(name?.startsWith("_")),
        static: Boolean(member.static)
      };
    })
    .filter((method) => method.name && method.kind !== "constructor");
}

function expressionFact(node, declarations = new Map()) {
  if (!node) {
    return { kind: "value", parameterGroups: [], parameters: [] };
  }
  if (node.type === "Identifier" && declarations.has(node.name)) {
    return declarations.get(node.name);
  }
  if (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  ) {
    return {
      async: Boolean(node.async),
      kind: "function",
      parameterGroups: parameterGroups(node.params),
      parameters: parameterNames(node.params)
    };
  }
  if (node.type === "ClassExpression" || node.type === "ClassDeclaration") {
    return {
      kind: "class",
      methods: classMethods(node),
      parameterGroups: [],
      parameters: []
    };
  }
  return { kind: "value", parameterGroups: [], parameters: [] };
}

function declarationFacts(programBody) {
  const declarations = new Map();
  for (const statement of programBody) {
    const declaration = statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration"
      ? statement.declaration
      : statement;
    if (!declaration) {
      continue;
    }
    if (declaration.type === "FunctionDeclaration" && declaration.id?.name) {
      declarations.set(declaration.id.name, expressionFact(declaration));
    } else if (declaration.type === "ClassDeclaration" && declaration.id?.name) {
      declarations.set(declaration.id.name, expressionFact(declaration));
    } else if (declaration.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        for (const name of patternNames(item.id)) {
          declarations.set(name, expressionFact(item.init));
        }
      }
    }
  }
  return declarations;
}

function exportedName(node) {
  return identifierName(node) || "default";
}

function exportedFact(name, fact, extra = {}) {
  return {
    ...fact,
    ...extra,
    name,
    parameterGroups: fact.parameterGroups || [],
    parameters: fact.parameters || []
  };
}

function addExport(exportsByName, name, fact, extra = {}) {
  exportsByName.set(name, exportedFact(name, fact, extra));
}

function addImport(importsBySpecifier, specifier, details = {}) {
  if (!specifier) {
    return null;
  }
  let entry = importsBySpecifier.get(specifier);
  if (!entry) {
    entry = {
      dynamic: false,
      names: [],
      reexport: false,
      sideEffect: false,
      specifier
    };
    importsBySpecifier.set(specifier, entry);
  }
  entry.dynamic ||= Boolean(details.dynamic);
  entry.reexport ||= Boolean(details.reexport);
  entry.sideEffect ||= Boolean(details.sideEffect);
  for (const name of details.names || []) {
    if (!entry.names.some((candidate) => (
      candidate.imported === name.imported && candidate.local === name.local
    ))) {
      entry.names.push({
        called: Boolean(name.called),
        imported: name.imported,
        local: name.local,
        members: [],
        typeOnly: Boolean(name.typeOnly),
        used: Boolean(name.used)
      });
    }
  }
  return entry;
}

function importNames(statement) {
  return (statement.specifiers || []).map((specifier) => {
    if (specifier.type === "ImportDefaultSpecifier") {
      return { imported: "default", local: specifier.local.name };
    }
    if (specifier.type === "ImportNamespaceSpecifier") {
      return { imported: "*", local: specifier.local.name };
    }
    return {
      imported: identifierName(specifier.imported),
      local: specifier.local.name,
      typeOnly: specifier.importKind === "type" || statement.importKind === "type"
    };
  });
}

function requireSpecifier(node) {
  if (
    node?.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments?.length === 1 &&
    node.arguments[0]?.type === "StringLiteral"
  ) {
    return node.arguments[0].value;
  }
  return null;
}

function requireNames(pattern) {
  if (pattern?.type === "Identifier") {
    return [{ imported: "*", local: pattern.name }];
  }
  if (pattern?.type !== "ObjectPattern") {
    return [];
  }
  return pattern.properties.flatMap((property) => {
    if (property.type === "RestElement") {
      return [{ imported: "*", local: identifierName(property.argument) }];
    }
    const imported = identifierName(property.key);
    const locals = patternNames(property.value);
    return locals.map((local) => ({ imported, local }));
  }).filter((entry) => entry.imported && entry.local);
}

function memberAssignmentName(node) {
  if (node?.type !== "MemberExpression" && node?.type !== "OptionalMemberExpression") {
    return null;
  }
  const property = identifierName(node.property);
  if (node.object?.type === "Identifier" && node.object.name === "exports") {
    return property;
  }
  if (
    node.object?.type === "MemberExpression" &&
    node.object.object?.type === "Identifier" &&
    node.object.object.name === "module" &&
    identifierName(node.object.property) === "exports"
  ) {
    return property;
  }
  return null;
}

function isModuleExports(node) {
  return Boolean(
    node?.type === "MemberExpression" &&
    node.object?.type === "Identifier" &&
    node.object.name === "module" &&
    identifierName(node.property) === "exports"
  );
}

function identifierIsBinding(node, parent) {
  if (!parent) {
    return false;
  }
  if (
    parent.type === "ImportDefaultSpecifier" ||
    parent.type === "ImportNamespaceSpecifier" ||
    parent.type === "ImportSpecifier"
  ) {
    return true;
  }
  if (
    parent.type === "VariableDeclarator" ||
    parent.type === "FunctionDeclaration" ||
    parent.type === "FunctionExpression" ||
    parent.type === "ClassDeclaration" ||
    parent.type === "ClassExpression"
  ) {
    return parent.id === node || parent.params?.includes(node);
  }
  return false;
}

function identifierIsPropertyName(node, parent) {
  return Boolean(
    parent &&
    (
      parent.type === "MemberExpression" ||
      parent.type === "OptionalMemberExpression" ||
      parent.type === "ObjectMethod" ||
      parent.type === "ObjectProperty" ||
      parent.type === "ClassMethod" ||
      parent.type === "ClassProperty"
    ) &&
    (parent.property === node || parent.key === node) &&
    !parent.computed
  );
}

function declaredBindingCounts(ast) {
  const counts = new Map();
  const add = (name) => counts.set(name, (counts.get(name) || 0) + 1);
  walkAst(ast.program, (node) => {
    if (node.type === "VariableDeclarator") {
      for (const name of patternNames(node.id)) {
        add(name);
      }
      return;
    }
    if (node.type === "CatchClause") {
      for (const name of patternNames(node.param)) {
        add(name);
      }
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "ObjectMethod" ||
      node.type === "ClassMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      if (node.id?.name) {
        add(node.id.name);
      }
      for (const name of node.params.flatMap((parameter) => patternNames(parameter))) {
        add(name);
      }
      return;
    }
    if (
      (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
      node.id?.name
    ) {
      add(node.id.name);
    }
  });
  return counts;
}

function collectJavaScriptStructure(ast) {
  const programBody = ast.program.body || [];
  const declarations = declarationFacts(programBody);
  const exportsByName = new Map();
  const importsBySpecifier = new Map();

  for (const statement of programBody) {
    if (statement.type === "ImportDeclaration") {
      addImport(importsBySpecifier, statement.source.value, {
        names: importNames(statement),
        sideEffect: statement.specifiers.length === 0
      });
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      const name = statement.exported ? exportedName(statement.exported) : "*";
      addExport(exportsByName, name, { kind: "forward", parameters: [] }, {
        from: statement.source.value,
        imported: name
      });
      addImport(importsBySpecifier, statement.source.value, {
        names: [{ imported: name, local: name }],
        reexport: true
      });
      continue;
    }
    if (statement.type === "ExportDefaultDeclaration") {
      addExport(exportsByName, "default", expressionFact(statement.declaration, declarations), {
        local: statement.declaration?.id?.name || null
      });
      continue;
    }
    if (statement.type !== "ExportNamedDeclaration") {
      continue;
    }
    if (statement.declaration?.type === "VariableDeclaration") {
      for (const item of statement.declaration.declarations) {
        for (const name of patternNames(item.id)) {
          addExport(exportsByName, name, declarations.get(name) || expressionFact(item.init));
        }
      }
    } else if (statement.declaration?.id?.name) {
      const name = statement.declaration.id.name;
      addExport(exportsByName, name, declarations.get(name) || expressionFact(statement.declaration));
    }
    for (const specifier of statement.specifiers || []) {
      const name = exportedName(specifier.exported);
      const local = identifierName(specifier.local) || name;
      addExport(
        exportsByName,
        name,
        statement.source
          ? { kind: "forward", parameters: [] }
          : declarations.get(local) || { kind: "value", parameters: [] },
        {
          ...(statement.source ? { from: statement.source.value, imported: local } : {}),
          local
        }
      );
    }
    if (statement.source) {
      addImport(importsBySpecifier, statement.source.value, {
        names: statement.specifiers.map((specifier) => ({
          imported: identifierName(specifier.local) || exportedName(specifier.exported),
          local: exportedName(specifier.exported)
        })),
        reexport: true
      });
    }
  }

  const declaredBindings = declaredBindingCounts(ast);
  const requireBindingCounts = new Map();
  const diagnostics = [];
  if (declaredBindings.has("require")) {
    diagnostics.push({
      code: "AMBIGUOUS_REQUIRE_BINDING",
      message: "A local `require` binding prevents exact CommonJS dependency extraction."
    });
  } else {
    walkAst(ast.program, (node, parent) => {
      const specifier = requireSpecifier(node);
      if (!specifier) {
        return;
      }
      if (parent?.type === "VariableDeclarator" && parent.init === node) {
        const names = requireNames(parent.id);
        for (const name of names) {
          requireBindingCounts.set(
            name.local,
            (requireBindingCounts.get(name.local) || 0) + 1
          );
        }
        addImport(importsBySpecifier, specifier, { names });
      } else if (parent?.type === "ExpressionStatement") {
        addImport(importsBySpecifier, specifier, { sideEffect: true });
      } else {
        diagnostics.push({
          code: "AMBIGUOUS_REQUIRE_USE",
          message: `The value returned by require(${JSON.stringify(specifier)}) is used in a form ProgSync cannot resolve exactly.`
        });
      }
    });
  }

  walkAst(ast.program, (node) => {
    if (node.type === "AssignmentExpression") {
      const memberName = memberAssignmentName(node.left);
      if (memberName) {
        addExport(exportsByName, memberName, expressionFact(node.right, declarations), {
          commonjs: true
        });
      } else if (isModuleExports(node.left)) {
        if (node.right?.type === "ObjectExpression") {
          for (const property of node.right.properties || []) {
            if (property.type === "SpreadElement") {
              continue;
            }
            const name = identifierName(property.key);
            if (name) {
              addExport(
                exportsByName,
                name,
                expressionFact(property.value || property.argument, declarations),
                { commonjs: true }
              );
            }
          }
        } else {
          addExport(exportsByName, "module.exports", expressionFact(node.right, declarations), {
            commonjs: true
          });
        }
      }
    }
    if (
      node.type === "ImportExpression" &&
      node.source?.type === "StringLiteral"
    ) {
      addImport(importsBySpecifier, node.source.value, { dynamic: true });
    }
  });

  const importedLocals = new Map();
  const importedLocalCounts = new Map();
  for (const entry of importsBySpecifier.values()) {
    for (const name of entry.names) {
      importedLocals.set(name.local, name);
      importedLocalCounts.set(
        name.local,
        (importedLocalCounts.get(name.local) || 0) + 1
      );
    }
  }
  const shadowedImports = [...importedLocals.keys()].filter((name) => (
    (declaredBindings.get(name) || 0) > (requireBindingCounts.get(name) || 0) ||
    (requireBindingCounts.get(name) || 0) > 1 ||
    (importedLocalCounts.get(name) || 0) > 1
  ));
  if (shadowedImports.length > 0) {
    diagnostics.push({
      code: "AMBIGUOUS_IMPORT_BINDING",
      message: `Imported bindings are shadowed locally: ${shadowedImports.join(", ")}.`
    });
  }
  const shadowedAmbientNames = new Set(
    [...AMBIENT_NAMES].filter((name) => declaredBindings.has(name))
  );
  if (shadowedAmbientNames.size > 0) {
    diagnostics.push({
      code: "AMBIGUOUS_AMBIENT_BINDING",
      message: `Possible platform bindings are declared locally: ${[...shadowedAmbientNames].join(", ")}.`
    });
  }
  const ambientNames = new Set();
  const ambientUses = new Map();
  const recordAmbientUse = ({ base, called = false, member = null }) => {
    const key = member ? `${base}.${member}` : base;
    const existing = ambientUses.get(key);
    ambientUses.set(key, {
      base,
      called: called || Boolean(existing?.called),
      member
    });
  };
  walkAst(ast.program, (node, parent) => {
    if (
      node.type === "Identifier" &&
      AMBIENT_NAMES.has(node.name) &&
      !shadowedAmbientNames.has(node.name)
    ) {
      if (!identifierIsBinding(node, parent) && !identifierIsPropertyName(node, parent)) {
        ambientNames.add(node.name);
        if (
          !(
            (parent?.type === "MemberExpression" ||
              parent?.type === "OptionalMemberExpression") &&
            parent.object === node
          )
        ) {
          recordAmbientUse({ base: node.name });
        }
      }
    }
    if (
      (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
      node.object?.type === "Identifier" &&
      AMBIENT_NAMES.has(node.object.name) &&
      !shadowedAmbientNames.has(node.object.name)
    ) {
      const member = identifierName(node.property);
      if (member) {
        recordAmbientUse({ base: node.object.name, member });
      }
    }
    if (
      node.type === "Identifier" &&
      importedLocals.has(node.name) &&
      !identifierIsBinding(node, parent)
    ) {
      importedLocals.get(node.name).used = true;
    }
    if (
      node.type !== "CallExpression" &&
      node.type !== "OptionalCallExpression" &&
      node.type !== "NewExpression" &&
      node.type !== "TaggedTemplateExpression"
    ) {
      return;
    }
    const callee = node.type === "TaggedTemplateExpression" ? node.tag : node.callee;
    if (
      callee?.type === "Identifier" &&
      AMBIENT_NAMES.has(callee.name) &&
      !shadowedAmbientNames.has(callee.name)
    ) {
      recordAmbientUse({
        base: callee.name,
        called: true
      });
    }
    if (
      (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") &&
      callee.object?.type === "Identifier" &&
      AMBIENT_NAMES.has(callee.object.name) &&
      !shadowedAmbientNames.has(callee.object.name)
    ) {
      const member = identifierName(callee.property);
      if (member) {
        recordAmbientUse({
          base: callee.object.name,
          called: true,
          member
        });
      }
    }
    if (callee?.type === "Identifier" && importedLocals.has(callee.name)) {
      importedLocals.get(callee.name).called = true;
      return;
    }
    if (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") {
      const objectName = callee.object?.type === "Identifier" ? callee.object.name : null;
      const member = identifierName(callee.property);
      if (objectName && member && importedLocals.has(objectName)) {
        const imported = importedLocals.get(objectName);
        imported.called = true;
        if (!imported.members.includes(member)) {
          imported.members.push(member);
        }
      }
    }
  });

  return {
    ambientNames: [...ambientNames].sort(),
    ambientUses: [...ambientUses.values()],
    diagnostics,
    exports: [...exportsByName.values()],
    imports: [...importsBySpecifier.values()]
  };
}

async function resolveRelativeImport({ implementationPath, projectRoot, specifier }) {
  const pathname = String(specifier || "").split(/[?#]/u)[0];
  let base;
  if (pathname.startsWith("./") || pathname.startsWith("../")) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(slashPath(implementationPath)), pathname)
    );
  } else if (pathname.startsWith("/")) {
    base = pathname.slice(1);
  } else if (pathname.startsWith("@/")) {
    base = pathname.slice(2);
  } else {
    return null;
  }
  const candidates = [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.vue`,
    `${base}.html`,
    `${base}/index.js`,
    `${base}/index.mjs`,
    `${base}/index.vue`
  ];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(absoluteProjectPath(projectRoot, candidate));
      if (stat.isFile()) {
        return candidate;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return base;
}

async function resolveImportFacts({ implementationPath, imports, projectRoot }) {
  return Promise.all(imports.map(async (entry) => {
    const resolvedTarget = await resolveRelativeImport({
      implementationPath,
      projectRoot,
      specifier: entry.specifier
    });
    let programProvider = null;
    if (resolvedTarget) {
      try {
        programProvider = implementationToProgramPath(resolvedTarget);
      } catch {
        programProvider = null;
      }
    }
    return {
      ...entry,
      programProvider,
      realizationOnly: Boolean(resolvedTarget && /\.(?:css|less|sass|scss|styl)$/iu.test(resolvedTarget)),
      resolvedTarget
    };
  }));
}

async function extractJavaScriptFacts({
  implementationPath,
  jsx = false,
  projectRoot,
  source,
  typescript = false
}) {
  const ast = javascriptAst(source, { implementationPath, jsx, typescript });
  const structure = collectJavaScriptStructure(ast);
  const normalizedPath = slashPath(implementationPath);
  const commandName = path.posix.basename(normalizedPath).replace(/\.(?:js|mjs)$/u, "");
  const testName = path.posix.basename(normalizedPath).match(/^(.+)\.test\.(?:js|mjs)$/u)?.[1];
  return {
    ...structure,
    entrypoint: String(source).startsWith("#!")
      ? {
        kind: "command",
        name: commandName
      }
      : testName
        ? {
          kind: "test",
          name: `${testName} tests`
        }
        : null,
    imports: await resolveImportFacts({
      implementationPath,
      imports: structure.imports,
      projectRoot
    })
  };
}

function macroCall(node, name) {
  if (node?.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === name) {
    return node;
  }
  return null;
}

function objectKeys(node) {
  if (node?.type !== "ObjectExpression") {
    return [];
  }
  return (node.properties || [])
    .filter((property) => property.type !== "SpreadElement")
    .map((property) => identifierName(property.key))
    .filter(Boolean);
}

function runtimeKeysAreResolvable(node) {
  if (!node) {
    return true;
  }
  if (node.type === "ArrayExpression") {
    return (node.elements || []).every((element) => element?.type === "StringLiteral");
  }
  if (node.type === "ObjectExpression") {
    return (node.properties || []).every((property) => (
      property.type !== "SpreadElement" &&
      !property.computed &&
      Boolean(identifierName(property.key))
    ));
  }
  return false;
}

function typeArgument(call) {
  return call?.typeParameters?.params?.[0] || call?.typeArguments?.params?.[0] || null;
}

function typeDefinitions(ast) {
  const definitions = new Map();
  for (const statement of ast.program.body || []) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    if (declaration?.type === "TSInterfaceDeclaration") {
      definitions.set(declaration.id.name, declaration.body);
    } else if (declaration?.type === "TSTypeAliasDeclaration") {
      definitions.set(declaration.id.name, declaration.typeAnnotation);
    }
  }
  return definitions;
}

function resolveTypeNode(node, definitions) {
  if (node?.type === "TSTypeReference" && node.typeName?.type === "Identifier") {
    return definitions.get(node.typeName.name) || node;
  }
  return node;
}

function typeMembers(call, definitions) {
  const parameter = resolveTypeNode(typeArgument(call), definitions);
  if (parameter?.type === "TSTypeLiteral") {
    return parameter.members || [];
  }
  if (parameter?.type === "TSInterfaceBody") {
    return parameter.body || [];
  }
  return [];
}

function macroTypeIsResolvable(call, definitions) {
  const argument = typeArgument(call);
  if (!argument) {
    return true;
  }
  const resolved = resolveTypeNode(argument, definitions);
  return resolved?.type === "TSTypeLiteral" || resolved?.type === "TSInterfaceBody";
}

function typeMemberNames(call, definitions) {
  const members = typeMembers(call, definitions);
  if (members.length === 0) {
    return [];
  }
  return members
    .map((member) => identifierName(member.key))
    .filter(Boolean);
}

function emittedTypeNames(call, definitions) {
  const names = new Set(typeMemberNames(call, definitions));
  for (const member of typeMembers(call, definitions)) {
    if (member.type !== "TSCallSignatureDeclaration") {
      continue;
    }
    const eventParameter = member.parameters?.[0];
    const literal = eventParameter?.typeAnnotation?.typeAnnotation?.literal;
    if (literal?.type === "StringLiteral") {
      names.add(literal.value);
    }
  }
  return [...names];
}

function collectVueMacros(ast) {
  const definitions = typeDefinitions(ast);
  const diagnostics = [];
  const props = new Set();
  const emits = new Set();
  const exposes = new Set();
  const slots = new Set();
  walkAst(ast.program, (node) => {
    const propsCall = macroCall(node, "defineProps");
    if (propsCall) {
      const runtimeProps = propsCall.arguments?.[0]?.type === "ArrayExpression"
        ? propsCall.arguments[0].elements
          .map((element) => element?.type === "StringLiteral" ? element.value : null)
          .filter(Boolean)
        : [];
      for (const name of [
        ...runtimeProps,
        ...objectKeys(propsCall.arguments?.[0]),
        ...typeMemberNames(propsCall, definitions)
      ]) {
        props.add(name);
      }
      if (!macroTypeIsResolvable(propsCall, definitions)) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_TYPE",
          message: "defineProps() uses a type that cannot be resolved atomically from this Vue file."
        });
      }
      if (!runtimeKeysAreResolvable(propsCall.arguments?.[0])) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_RUNTIME",
          message: "defineProps() uses runtime keys that cannot be resolved atomically."
        });
      }
    }
    const emitsCall = macroCall(node, "defineEmits");
    if (emitsCall) {
      const argument = emitsCall.arguments?.[0];
      const names = argument?.type === "ArrayExpression"
        ? argument.elements.map((element) => element?.value).filter(Boolean)
        : [
            ...objectKeys(argument),
            ...emittedTypeNames(emitsCall, definitions)
          ];
      for (const name of names) {
        emits.add(String(name));
      }
      if (!macroTypeIsResolvable(emitsCall, definitions)) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_TYPE",
          message: "defineEmits() uses a type that cannot be resolved atomically from this Vue file."
        });
      }
      if (!runtimeKeysAreResolvable(argument)) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_RUNTIME",
          message: "defineEmits() uses runtime keys that cannot be resolved atomically."
        });
      }
    }
    const exposeCall = macroCall(node, "defineExpose");
    if (exposeCall) {
      for (const name of objectKeys(exposeCall.arguments?.[0])) {
        exposes.add(name);
      }
      if (!runtimeKeysAreResolvable(exposeCall.arguments?.[0])) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_RUNTIME",
          message: "defineExpose() uses runtime keys that cannot be resolved atomically."
        });
      }
    }
    const slotsCall = macroCall(node, "defineSlots");
    if (slotsCall) {
      for (const name of typeMemberNames(slotsCall, definitions)) {
        slots.add(name);
      }
      if (!macroTypeIsResolvable(slotsCall, definitions)) {
        diagnostics.push({
          code: "UNRESOLVED_VUE_MACRO_TYPE",
          message: "defineSlots() uses a type that cannot be resolved atomically from this Vue file."
        });
      }
    }
    const modelCall = macroCall(node, "defineModel");
    if (modelCall) {
      const modelName = modelCall.arguments?.[0]?.type === "StringLiteral"
        ? modelCall.arguments[0].value
        : "modelValue";
      props.add(modelName);
      emits.add(`update:${modelName}`);
    }
  });
  return {
    diagnostics,
    emits: [...emits],
    exposes: [...exposes],
    props: [...props],
    slots: [...slots]
  };
}

function vueParseErrors(errors) {
  return (errors || []).map((error) => ({
    message: String(error?.message || error),
    line: error?.loc?.start?.line || error?.loc?.line || null
  }));
}

async function extractVueFacts({ implementationPath, projectRoot, source }) {
  const result = parseVueSfc(String(source || ""), { filename: implementationPath });
  const errors = vueParseErrors(result.errors);
  if (errors.length > 0) {
    throw new ProgSyncError(
      "INVALID_IMPLEMENTATION",
      `Vue candidate ${implementationPath} does not parse.`,
      { diagnostics: errors }
    );
  }
  const { descriptor } = result;
  if (descriptor.script) {
    throw new ProgSyncError(
      "UNSUPPORTED_VUE_SCRIPT",
      "The prototype supports Vue <script setup> or scriptless components, not ordinary <script>."
    );
  }
  for (const block of descriptor.customBlocks || []) {
    if (String(block.lang || "").toLowerCase() !== "json") {
      continue;
    }
    try {
      JSON.parse(block.content);
    } catch (error) {
      throw new ProgSyncError(
        "INVALID_IMPLEMENTATION",
        `Vue custom block <${block.type} lang="json"> is not valid JSON.`,
        { parserMessage: error.message }
      );
    }
  }
  let javascript = { ambientNames: [], ambientUses: [], diagnostics: [], exports: [], imports: [] };
  let macros = { diagnostics: [], emits: [], exposes: [], props: [], slots: [] };
  if (descriptor.scriptSetup) {
    const language = String(descriptor.scriptSetup.lang || "js").toLowerCase();
    const typescript = language === "ts" || language === "tsx";
    const jsx = language === "jsx" || language === "tsx";
    const ast = javascriptAst(descriptor.scriptSetup.content, {
      implementationPath: `${implementationPath}.${language}`,
      jsx,
      typescript
    });
    const structure = collectJavaScriptStructure(ast);
    javascript = {
      ...structure,
      imports: await resolveImportFacts({
        implementationPath,
        imports: structure.imports,
        projectRoot
      })
    };
    macros = collectVueMacros(ast);
  }
  const templateComponents = new Set();
  if (descriptor.template?.ast) {
    walkAst(descriptor.template.ast, (node) => {
      if (node.type === 1 && node.tagType === 1 && node.tag) {
        templateComponents.add(node.tag);
      }
    });
  }
  const templateSource = descriptor.template?.content || "";
  for (const importedModule of javascript.imports || []) {
    for (const importedName of importedModule.names || []) {
      if (
        importedName.local &&
        new RegExp(`(^|[^A-Za-z0-9_$])${importedName.local.replaceAll("$", "\\$")}([^A-Za-z0-9_$]|$)`, "u")
          .test(templateSource)
      ) {
        importedName.used = true;
      }
    }
  }
  return {
    ...javascript,
    ...macros,
    diagnostics: [...javascript.diagnostics, ...macros.diagnostics],
    hasOrdinaryScript: Boolean(descriptor.script),
    hasScriptSetup: Boolean(descriptor.scriptSetup),
    hasStyle: descriptor.styles.length > 0,
    hasTemplate: Boolean(descriptor.template),
    templateComponents: [...templateComponents]
  };
}

function htmlAttribute(node, name) {
  const property = (node.props || []).find((candidate) => (
    candidate.type === 6 && candidate.name?.toLowerCase() === name
  ));
  return property?.value?.content || null;
}

function htmlResourceProvider(value, implementationPath) {
  const source = String(value || "");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(source)) {
    return `asset:${source}`;
  }
  if (source.startsWith("//")) {
    return `asset:url:${source}`;
  }
  const pathname = source.split(/[?#]/u)[0];
  const resolved = pathname.startsWith("@/")
    ? pathname.slice(2)
    : pathname.startsWith("/")
      ? pathname.slice(1)
      : path.posix.normalize(path.posix.join(
        path.posix.dirname(slashPath(implementationPath)),
        pathname
      ));
  return `asset:${resolved}`;
}

async function extractHtmlFacts({ implementationPath, projectRoot, source }) {
  const diagnostics = [];
  let ast;
  try {
    ast = parseHtml(String(source || ""), {
      comments: true,
      onError(error) {
        diagnostics.push({
          code: error.code,
          line: error.loc?.start?.line || null,
          message: error.message
        });
      }
    });
  } catch (error) {
    diagnostics.push({ message: String(error?.message || error) });
  }
  if (diagnostics.length > 0 || !ast) {
    throw new ProgSyncError(
      "INVALID_IMPLEMENTATION",
      `HTML candidate ${implementationPath} does not parse.`,
      { diagnostics }
    );
  }
  const scripts = [];
  const styles = [];
  const inlineScripts = [];
  walkAst(ast, (node) => {
    if (node.type !== 1) {
      return;
    }
    if (node.tag?.toLowerCase() === "script") {
      const sourcePath = htmlAttribute(node, "src");
      if (sourcePath) {
        scripts.push(sourcePath);
      } else {
        const scriptType = htmlAttribute(node, "type");
        if (!scriptType || /^(?:application|text)\/javascript$/iu.test(scriptType) || scriptType === "module") {
          const scriptSource = (node.children || [])
            .filter((child) => child.type === 2)
            .map((child) => child.content)
            .join("");
          if (scriptSource.trim()) {
            inlineScripts.push(scriptSource);
          }
        }
      }
    }
    if (
      node.tag?.toLowerCase() === "link" &&
      htmlAttribute(node, "rel")?.toLowerCase() === "stylesheet"
    ) {
      const href = htmlAttribute(node, "href");
      if (href) {
        styles.push(href);
      }
    }
  });
  const inlineFacts = await Promise.all(inlineScripts.map((scriptSource, index) => (
    extractJavaScriptFacts({
      implementationPath: `${implementationPath}#inline-script-${index + 1}.js`,
      projectRoot,
      source: scriptSource
    })
  )));
  return {
    ambientNames: inlineFacts.flatMap((facts) => facts.ambientNames || []),
    ambientUses: inlineFacts.flatMap((facts) => facts.ambientUses || []),
    diagnostics: inlineFacts.flatMap((facts) => facts.diagnostics || []),
    exports: [],
    htmlResources: [...scripts, ...styles].map((resource) => ({
      provider: htmlResourceProvider(resource, implementationPath),
      symbol: resource
    })),
    imports: inlineFacts.flatMap((facts) => facts.imports || []),
    scripts,
    styles
  };
}

async function extractSourceFacts({
  implementationPath,
  projectRoot,
  source,
  targetKind
}) {
  if (source === null || source === undefined) {
    return { ambientNames: [], entrypoint: null, exports: [], imports: [] };
  }
  if (targetKind === "javascript") {
    return extractJavaScriptFacts({ implementationPath, projectRoot, source });
  }
  if (targetKind === "vue") {
    return extractVueFacts({ implementationPath, projectRoot, source });
  }
  return extractHtmlFacts({ implementationPath, projectRoot, source });
}

export {
  extractJavaScriptFacts,
  extractSourceFacts,
  extractVueFacts,
  javascriptAst
};
