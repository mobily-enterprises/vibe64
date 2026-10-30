import { listSessions } from "../../../sessions/src/server/service.js";

export async function buildWeeklyReport() {
  const sessions = await listSessions({ limit: 100 });
  return { total: sessions.length };
}
