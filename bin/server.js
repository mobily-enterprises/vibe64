import { startServer } from "../server.js";

try {
  await startServer();
} catch (error) {
  console.error("Failed to start jskit-ai-studio server:", error);
  process.exitCode = 1;
}
