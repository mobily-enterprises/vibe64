import { vibe64Host } from "../hostProfile.js";

/**
 * The tool homes the host gives `login`'s commands (vibe64Host().loginEnvironment), "%u" read as the login: the
 * variables that send installs there (npm's prefix and cache, Cargo, Go, Python's user base, Corepack, gems) and the
 * folders their programs start from. Both empty when the host gives none.
 * @param {string} login
 * @returns {{ env: Record<string, string>, path: string[] }}
 */
function loginToolEnv(login = "") {
  const tools = vibe64Host().loginEnvironment;
  if (!tools) return { env: {}, path: [] };
  const name = String(login || "");
  if (!/^[a-z_][a-z0-9_-]{0,31}$/u.test(name)) {
    throw new TypeError(`The host's tool homes need a command's login; "${name}" is not one.`);
  }
  const expand = (value) => value.replaceAll("%u", name);
  return {
    env: Object.fromEntries(Object.entries(tools.env).map(([key, value]) => [key, expand(value)])),
    path: tools.path.map(expand)
  };
}

export {
  loginToolEnv
};
