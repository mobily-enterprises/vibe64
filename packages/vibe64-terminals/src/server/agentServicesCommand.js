// `vibe64-helper services`: the session's AI controls the servers the host runs for its project (serviceControl.js),
// for its development or, with --staging, its Staging app: their state and logs, a restart, stop or start, and on the
// session's own databases their connections, who waits on whom and an end for one, which the host reads and ends
// itself; the AI never gets a database login. It runs through the session control's group route
// (helperCommandGroups.js), which checks the session's identity and binding first, so every call names the session's
// own project, never one the caller chose. A database server every project on the workspace shares is restarted or
// stopped only while the session's Need help is raised: this checks the flag, gives it to the host (which refuses
// without it too), and adds what was done to the session's Need help, where the person sees it.
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

const SERVICES_GROUP_NAME = "services";
const SERVICES_GROUP_SUMMARY = "The project's servers: state, logs, restart, stop, start, and its database connections and locks";
const LOG_LINES_DEFAULT = 100;
const LOG_LINES_MAX = 2000;
// What one call prints at most.
const OUTPUT_MAX_BYTES = 256 * 1024;
const ACTIONS = Object.freeze(["restart", "stop", "start"]);
const DB_COMMANDS = Object.freeze(["sessions", "locks", "end", "restart"]);
// The options each command takes; --lines and --service take a value.
const COMMAND_OPTIONS = Object.freeze({
  list: ["--staging", "--json"],
  logs: ["--staging", "--lines"],
  restart: ["--staging"],
  stop: ["--staging"],
  start: ["--staging"],
  "db sessions": ["--staging", "--json", "--service"],
  "db locks": ["--staging", "--json", "--service"],
  "db end": ["--staging", "--service"],
  "db restart": ["--staging", "--service"]
});
const SERVICE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const CONNECTION_ID = /^[1-9][0-9]{0,15}$/u;

const SERVICES_GROUP_HELP = `Usage: vibe64-helper services list [--staging] [--json]
       vibe64-helper services logs <service> [--staging] [--lines N]
       vibe64-helper services restart|stop|start <service> [--staging]
       vibe64-helper services db sessions|locks [--service <service>] [--staging] [--json]
       vibe64-helper services db end <connection id> [--service <service>] [--staging]
       vibe64-helper services db restart [--service <service>] [--staging]

The servers the host runs for this session's project: its database server (MariaDB or PostgreSQL), a cache such as
Redis, and the like, for its development, or with --staging for its Staging app, while the person lets AI sessions use
its Staging. Read their state and logs whenever it helps, and act on them when the work needs it. Each restart, stop,
start and ended connection is recorded with this session, where the host's people see it.

list         each service's id, what it is, its state, and whether every project on the workspace shares it.
logs         its recent log lines, newest first: ${LOG_LINES_DEFAULT} unless --lines says how many (at most ${LOG_LINES_MAX}).
restart      stops the service, killing it when it does not stop in time, and starts it again. Its data stays. Every
             connection to it drops; Preview, tests and the Staging app reconnect by themselves.
stop         stops it until something uses it again. A server a running Staging app needs stays.
start        starts it, and waits until it answers.
db sessions  the connections on this session's databases (its development and test databases, or with --staging its
             Staging database): id, database, seconds, state with what it waits on, and its statement's start.
db locks     which of them waits on which, and how many blockers are on another project's database.
db end <id>  ends one of those connections; the host ends only one on this session's databases.
db restart   restarts the project's database server; --service names it when the project uses more than one.
--json prints list, db sessions and db locks as JSON.

A database server is shared by every project on the workspace. Its restart and stop (and db restart) run only while
this session's Need help is raised (vibe64-helper need-help raise "<what you will restart and why>"), never while real
people use a Staging app on it; what was done is added to the session's Need help, for the person.

When a lock never clears (a statement waits on a metadata or table lock, or rows stay held for minutes):
  1. vibe64-helper services db locks: what holds it. db sessions shows every connection's state.
  2. vibe64-helper services db end <id>: end the holder, then look again after a few seconds.
  3. Only when that cannot clear it (a MariaDB connection stays "Killed", keeping its lock until the server restarts):
     raise Need help saying what you will restart and why, then vibe64-helper services db restart.
The app's own data and schema change through the app's database user and the Stack's Workspace setup.
`;

function usage(message) {
  return { usage: `${message}\n\n${SERVICES_GROUP_HELP}` };
}

/** The value of `--name value` or `--name=value` at `index`, and how many words it took; null when it is not that option. */
function optionValue(args, index, name) {
  const word = args[index];
  if (word === name) return { value: String(args[index + 1] ?? ""), taken: 2 };
  if (word.startsWith(`${name}=`)) return { value: word.slice(name.length + 1), taken: 1 };
  return null;
}

/** `rest`'s options for `command` into `parsed`, and its other words; a usage when one is not the command's. */
function readOptions(command, rest, parsed) {
  const takes = COMMAND_OPTIONS[command];
  const words = [];
  for (let index = 0; index < rest.length;) {
    const word = rest[index];
    const valued = ["--lines", "--service"].map((name) => [name, optionValue(rest, index, name)]).find(([, found]) => found);
    const name = valued ? valued[0] : word;
    if (!name.startsWith("-")) {
      words.push(word);
      index += 1;
      continue;
    }
    if (!takes.includes(name)) return usage(`services ${command} takes ${takes.join(", ")}, not ${word}.`);
    if (!valued) {
      parsed[name.slice(2)] = true;
      index += 1;
      continue;
    }
    const { value, taken } = valued[1];
    if (name === "--lines") {
      parsed.lines = Number(value);
      if (!/^[0-9]+$/u.test(value) || parsed.lines < 1 || parsed.lines > LOG_LINES_MAX) {
        return usage(`--lines is a whole number from 1 to ${LOG_LINES_MAX}.`);
      }
    } else {
      if (!SERVICE_ID.test(value)) return usage("--service names a service by its id, as services list shows it.");
      parsed.serviceId = value;
    }
    index += taken;
  }
  return { words };
}

/**
 * The caller's words as one call: its command, the service or connection it names and its options, or why they are not
 * one.
 * @param {string[]} args
 */
function parseServicesArgs(args) {
  const [first = "", ...afterFirst] = args;
  if (!first || first === "--help" || first === "-h" || first === "help") return { help: true };
  let command = first;
  let rest = afterFirst;
  if (first === "db") {
    const [sub = "", ...afterSub] = afterFirst;
    if (!DB_COMMANDS.includes(sub)) {
      return usage(sub ? `vibe64-helper services db has no ${sub} command.` : "services db takes sessions, locks, end or restart.");
    }
    command = `db ${sub}`;
    rest = afterSub;
  } else if (!Object.hasOwn(COMMAND_OPTIONS, first)) {
    return usage(`vibe64-helper services has no ${first} command.`);
  }
  const parsed = { command, staging: false, json: false, lines: LOG_LINES_DEFAULT, serviceId: "", connectionId: 0 };
  const read = readOptions(command, rest, parsed);
  if (read.usage) return read;
  const { words } = read;
  if (command === "logs" || ACTIONS.includes(command)) {
    if (words.length !== 1 || !SERVICE_ID.test(words[0])) {
      return usage(`services ${command} needs one service's id, as services list shows it.`);
    }
    parsed.serviceId = words[0];
  } else if (command === "db end") {
    if (words.length !== 1 || !CONNECTION_ID.test(words[0])) {
      return usage("services db end needs one connection's id, as services db sessions lists it.");
    }
    parsed.connectionId = Number(words[0]);
  } else if (words.length) {
    return usage(`services ${command} takes no ${words[0]}.`);
  }
  return parsed;
}

/** At most OUTPUT_MAX_BYTES of `text`, ending in a newline, saying when it was cut. */
function bounded(text) {
  const value = String(text ?? "");
  const bytes = Buffer.from(value, "utf8");
  const kept = bytes.length <= OUTPUT_MAX_BYTES ? value
    : `${bytes.subarray(0, OUTPUT_MAX_BYTES).toString("utf8")}\n… cut at ${OUTPUT_MAX_BYTES / 1024} KiB: read fewer lines.`;
  return kept.endsWith("\n") || !kept ? kept : `${kept}\n`;
}

/** Rows as columns, the last one as it is. */
function table(rows) {
  const widths = rows[0].slice(0, -1).map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows.map((row) => row.map((cell, column) => (column < widths.length ? String(cell).padEnd(widths[column]) : String(cell)))
    .join("  ").trimEnd()).join("\n");
}

function listText(services, note) {
  if (!services.length) return note || "This project has no services the host runs for it yet: the first use of its database or cache makes them.";
  return table(services.map((service) => [service.id, service.label || service.id, service.state || "unknown",
    service.shared ? "shared" : "", service.detail || ""]));
}

/** An Error the AI reads, with its code. */
function refusal(message, code) {
  return Object.assign(new Error(message), { code });
}

const named = (service, fallback) => `${service?.label || fallback} (${service?.id || fallback})`;
const statement = (connection) => String(connection.query || "").replace(/\s+/gu, " ").trim() || "(no statement)";
const notRunning = (service) => `${named(service, "The database server")} is not running, so nothing runs on it; this does not start it.`;

function sessionsText(read) {
  if (!read.running) return notRunning(read.service);
  const connections = Array.isArray(read.connections) ? read.connections : [];
  if (!connections.length) return `${named(read.service, "The database server")}: no connection is on this session's databases.`;
  return [`${named(read.service, "The database server")}: ${connections.length} connection${connections.length === 1 ? "" : "s"} on this session's databases.`,
    table([["ID", "DATABASE", "SECONDS", "STATE", "STATEMENT"],
      ...connections.map((connection) => [connection.id, connection.database, connection.seconds, connection.state || "", statement(connection)])])
  ].join("\n");
}

function locksText(read) {
  if (!read.running) return notRunning(read.service);
  const waits = Array.isArray(read.waits) ? read.waits : [];
  if (!waits.length) return `${named(read.service, "The database server")}: no connection on this session's databases waits on another.`;
  return [`${named(read.service, "The database server")}: ${waits.length} connection${waits.length === 1 ? "" : "s"} wait${waits.length === 1 ? "s" : ""}.`,
    ...waits.flatMap(({ waiting, blockers = [], elsewhere = 0 }) => [
      `${waiting.id} (${waiting.database}, ${waiting.seconds} s, ${waiting.state}): ${statement(waiting)}`,
      ...blockers.map((blocker) => `  waits on ${blocker.id} (${blocker.lock} lock; ${blocker.state}, ${blocker.seconds} s): ${statement(blocker)}`),
      ...(elsewhere ? [`  and on ${elsewhere} connection${elsewhere === 1 ? "" : "s"} on another project's database, which this session can't see or end`] : [])
    ])
  ].join("\n");
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").ServiceControl} dependencies.serviceControl the host's, or NO_SERVICE_CONTROL
 * @param {() => import("./types.js").NeedHelpService | null} dependencies.readNeedHelp the session's Need help, or null
 *   while Vibe64 starts or stops
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @returns {import("./types.js").HelperCommandGroup}
 */
function createServicesCommandGroup({ serviceControl, readNeedHelp, logger }) {
  /** The session's Need help as the host is given it, or why a shared server can't be restarted or stopped now. */
  async function raisedNeedHelp(sessionId) {
    const needHelp = readNeedHelp();
    if (!needHelp) return { raised: false, why: "Need help is unavailable while Vibe64 starts or stops. Try again in a minute." };
    const flag = (await needHelp.read(sessionId)).needHelp;
    return flag ? { raised: true, id: String(flag.id || "") } : { raised: false, why: "" };
  }

  /** The database server a db command names: --service, or the project's only one. */
  async function databaseServer(call, serviceId) {
    const { services = [] } = await serviceControl.listServices(call);
    const servers = services.filter((service) => service.shared);
    const found = serviceId ? servers.find((service) => service.id === serviceId)
      : servers.length === 1 ? servers[0] : null;
    if (found) return found;
    const list = `vibe64-helper services list${call.target === "staging" ? " --staging" : ""}`;
    const ids = servers.map((service) => service.id).join(", ");
    const message = serviceId || !servers.length
      ? `This project uses no database server${serviceId ? ` "${serviceId}"` : ""} the host runs: ${list} shows its servers.`
      : `This project uses more than one database server (${ids}): name one with --service.`;
    throw refusal(message, "vibe64_service_not_found");
  }

  /** The service a restart, stop or start names, as the host lists it; none for a start, which interrupts nothing. */
  async function actedOn(call, parsed, action) {
    if (parsed.command === "db restart") return databaseServer(call, parsed.serviceId);
    if (action === "start") return null;
    const { services = [] } = await serviceControl.listServices(call);
    return services.find((service) => service.id === parsed.serviceId) || null;
  }

  /**
   * A restart or stop: a shared database server's only with the session's Need help raised, which the host is given,
   * and what was done is added to it.
   */
  async function act(request, call, parsed, action) {
    const listed = await actedOn(call, parsed, action);
    const shared = listed?.shared === true;
    const needHelp = shared ? await raisedNeedHelp(request.sessionId) : { raised: false };
    if (shared && !needHelp.raised) {
      const verb = action === "stop" ? "stopped" : "restarted";
      throw refusal(needHelp.why || `${named(listed)} was not ${verb}: every project on this workspace shares it, so it is `
        + `${verb} only while this session's Need help is raised. Raise it saying what you will do and why `
        + '(vibe64-helper need-help raise "<message>"), then run this again.', "vibe64_service_need_help_required");
    }
    const done = await serviceControl.controlService({ ...call, serviceId: listed?.id || parsed.serviceId, action, needHelp });
    const message = String(done.message || `${parsed.serviceId}: ${done.outcome || "done"}.`);
    if (shared && done.ok !== false) {
      const where = call.target === "staging" ? " for its Staging" : "";
      const text = `This session's AI ran services ${action} of ${named(listed)}${where}: ${message}`;
      try {
        await readNeedHelp()?.raise(request.sessionId, { text, from: "agent", actor: request.actor });
      } catch (error) {
        logger.warn({ error: String(error?.message || error) }, "Vibe64 could not add a service's restart to the session's Need help.");
      }
    }
    return { exit: done.ok === false ? 1 : 0, text: message };
  }

  /** @param {import("./types.js").HelperCommandRequest} request @param {ReturnType<typeof parseServicesArgs>} parsed */
  async function perform(request, parsed) {
    const call = {
      actor: request.actor,
      projectSlug: request.projectSlug,
      sessionId: request.sessionId,
      signal: request.signal,
      sourceRoot: request.sourceRoot,
      target: parsed.staging ? "staging" : "development",
      turnId: request.turnId
    };
    const json = (value) => ({ exit: 0, text: JSON.stringify(value, null, 2) });
    if (parsed.command === "list") {
      const { services = [], note = "" } = await serviceControl.listServices(call);
      return parsed.json ? json({ services }) : { exit: 0, text: listText(services, note) };
    }
    if (parsed.command === "logs") {
      const read = await serviceControl.readServiceLogs({ ...call, serviceId: parsed.serviceId, lines: parsed.lines });
      const lines = Array.isArray(read.lines) ? read.lines.map(String) : [];
      const header = `${named(read.service, parsed.serviceId)}: ${read.state || "unknown"}. `
        + `${lines.length ? `Its last ${lines.length} log lines, newest first` : "Its log is empty"}${read.source ? `, from ${read.source}` : ""}.`;
      return { exit: 0, text: [header, ...lines].join("\n") };
    }
    if (parsed.command === "db sessions" || parsed.command === "db locks") {
      const input = { ...call, serviceId: parsed.serviceId };
      const read = parsed.command === "db sessions" ? await serviceControl.listDatabaseSessions(input) : await serviceControl.listDatabaseLocks(input);
      if (parsed.json) return json(read);
      return { exit: 0, text: parsed.command === "db sessions" ? sessionsText(read) : locksText(read) };
    }
    if (parsed.command === "db end") {
      const done = await serviceControl.endDatabaseConnection({ ...call, serviceId: parsed.serviceId, connectionId: parsed.connectionId });
      return { exit: done.ok === false ? 1 : 0, text: String(done.message || `Connection ${parsed.connectionId}: ${done.outcome || "done"}.`) };
    }
    return act(request, call, parsed, parsed.command === "db restart" ? "restart" : parsed.command);
  }

  /** @param {import("./types.js").HelperCommandRequest} request @param {import("./types.js").HelperCommandOutput} output */
  async function run(request, output) {
    const parsed = parseServicesArgs(request.args);
    if (parsed.help) {
      output.stdout(SERVICES_GROUP_HELP);
      return { exit: 0 };
    }
    if (parsed.usage) {
      output.stderr(parsed.usage);
      return { exit: 2 };
    }
    const startedAt = Date.now();
    let exit = 0;
    let code = "";
    try {
      const done = await perform(request, parsed);
      exit = done.exit;
      output.stdout(bounded(done.text));
    } catch (error) {
      code = String(error?.code || "vibe64_service_control_failed");
      output.stderr(bounded(String(error?.message || "The host could not do that.")));
      exit = 1;
    }
    logOperationalEvent(logger, exit === 0 ? "info" : "warn", {
      code,
      command: parsed.command,
      component: "vibe64.agent_services_command",
      durationMs: Date.now() - startedAt,
      event: "vibe64.agent_services_command.finished",
      exitCode: exit,
      projectSlug: request.projectSlug,
      serviceId: parsed.serviceId || "",
      sessionId: request.sessionId,
      target: parsed.staging ? "staging" : "development"
    }, "Vibe64 agent services command finished.");
    return { exit };
  }

  return Object.freeze({
    name: SERVICES_GROUP_NAME,
    summary: SERVICES_GROUP_SUMMARY,
    help: SERVICES_GROUP_HELP,
    run
  });
}

export {
  LOG_LINES_DEFAULT,
  LOG_LINES_MAX,
  SERVICES_GROUP_HELP,
  SERVICES_GROUP_NAME,
  SERVICES_GROUP_SUMMARY,
  createServicesCommandGroup,
  parseServicesArgs
};
