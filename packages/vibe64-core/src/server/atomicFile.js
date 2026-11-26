// The editor's name for Vibe64's one atomic file writer, @local/vibe64-atomic-file, which lives in a package of its
// own so the packages below Core (the privileged helper, Genesis, the deploy engine) use the same one; hosts import
// it from here too.
export {
  ATOMIC_WRITE_TEMPORARY_PATTERN,
  syncDirectory,
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonFileAtomic
} from "@local/vibe64-atomic-file";

/**
 * Runs operation after every earlier operation queued under the same key in
 * pending (a Map the caller owns), whether or not they failed.
 */
async function serializeByKey(pending, key, operation) {
  // The earlier operation's failure reached its own caller; this one only waits for it.
  const current = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}

export { serializeByKey };
