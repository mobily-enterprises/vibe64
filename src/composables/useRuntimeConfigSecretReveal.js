import { ref } from "vue";

// A secret is named by its key, or by the record that holds it.
function runtimeConfigSecretKey(value = {}) {
  return String(typeof value === "string" ? value : value.key || "").trim();
}

/**
 * Reveals and hides an Env value's secret; revealValue() reads it from the owner-only reveal action, and null or
 * undefined means nothing to reveal.
 * @param {{ revealValue: (key: string, record: string | { key?: string }) => Promise<unknown> }} options
 */
function useRuntimeConfigSecretReveal({ revealValue }) {
  const revealedSecrets = ref({});
  const secretRevealBusyKey = ref("");

  async function revealSecret(record = {}) {
    const key = runtimeConfigSecretKey(record);
    if (!key || secretRevealBusyKey.value) {
      return false;
    }
    secretRevealBusyKey.value = key;
    try {
      const value = await revealValue(key, record);
      if (value === undefined || value === null) {
        return false;
      }
      revealedSecrets.value = {
        ...revealedSecrets.value,
        [key]: String(value)
      };
      return true;
    } finally {
      secretRevealBusyKey.value = "";
    }
  }

  function hideSecret(record = {}) {
    const key = runtimeConfigSecretKey(record);
    if (!key || !Object.hasOwn(revealedSecrets.value, key)) {
      return false;
    }
    const next = { ...revealedSecrets.value };
    delete next[key];
    revealedSecrets.value = next;
    return true;
  }

  function clearRevealedSecrets() {
    revealedSecrets.value = {};
  }

  return {
    clearRevealedSecrets,
    hideSecret,
    revealedSecrets,
    revealSecret,
    secretRevealBusyKey
  };
}

export {
  useRuntimeConfigSecretReveal
};
