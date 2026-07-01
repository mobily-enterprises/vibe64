import {
  parseRuntimeConfigDotenv
} from "@local/vibe64-core/server/runtimeConfig";

function parseEnvText(text = "") {
  return Object.fromEntries(parseRuntimeConfigDotenv(text)
    .map((entry) => [entry.key, entry.value]));
}

export {
  parseEnvText
};
