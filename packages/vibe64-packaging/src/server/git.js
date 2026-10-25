// Git facts a release relies on.

// A full Git commit id (SHA-1 or SHA-256 repositories).
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export { COMMIT_ID };
