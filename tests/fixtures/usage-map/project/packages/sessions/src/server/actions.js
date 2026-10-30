import { createSession, listSessions } from "./service.js";

export const sessionActions = [
  { id: "demo.sessions.list", execute: (input) => listSessions(input) },
  { id: "demo.sessions.create", execute: (input) => createSession(input) }
];
