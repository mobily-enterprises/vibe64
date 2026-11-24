import { startServer } from "../server.js";

try {
  await startServer();
} catch (error) {
  console.error("Failed to start reading-room server:", error);
  process.exitCode = 1;
}
