import {
  tryAcquireExclusiveFileLock as acquireExclusiveFileLock
} from "@jskit-ai/kernel/server/support";

const FILE_LOCK_ERROR_CODE = "vibe64_execution_file_lock_failed";

function tryAcquireExclusiveFileLock(lockPath = "", { cwd = "" } = {}) {
  return acquireExclusiveFileLock(lockPath, { cwd, errorCode: FILE_LOCK_ERROR_CODE });
}

export {
  FILE_LOCK_ERROR_CODE,
  tryAcquireExclusiveFileLock
};
