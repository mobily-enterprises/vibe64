import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Python recorder loads through runtime/python/sitecustomize.py. That
// directory goes first on PYTHONPATH, with no trailing separator, so no empty
// segment (the working directory) reaches sys.path. Its sitecustomize starts
// the recorder and then runs the project's or Python's own sitecustomize.
const PYTHON_RUNTIME_DIRECTORY = path.dirname(fileURLToPath(new URL("../../../runtime/python/sitecustomize.py", import.meta.url)));
const PYTHON_RUNTIME_FILES = Object.freeze(["sitecustomize.py", "vibe64_usage/__init__.py", "vibe64_usage/tracer.py"]);

function pythonRuntimeInstalled() {
  try {
    return PYTHON_RUNTIME_FILES.every((file) => statSync(path.join(PYTHON_RUNTIME_DIRECTORY, file)).isFile());
  } catch {
    return false;
  }
}

export default Object.freeze({
  runtime: "python",
  label: "Python",
  prepare() {
    if (!pythonRuntimeInstalled()) {
      return { available: false, reason: "This Vibe64 installation is missing its Python recorder files." };
    }
    return { available: true, environment: {}, prependEnvironment: { PYTHONPATH: PYTHON_RUNTIME_DIRECTORY } };
  }
});
