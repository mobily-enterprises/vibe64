// Copyable commands for a database server the person runs on their own
// computer: install it, start it, and create this project's login and
// database. Vibe64 never runs these; the person pastes them into a terminal.
// Lines exist for Debian/Ubuntu/WSL ("apt") and macOS ("brew"); everything
// else is behind the guide link, which opens this computer's setup guide.
// Checked on 2026-10-23.

import { SQL_QUOTING } from "./sqlQuoting.js";

const SUDO_NOTE = "You'll be asked for your computer password. Nothing shows while you type.";
const SETUP_GUIDES = Object.freeze({
  apt: "https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/set-up-linux.md#databases",
  brew: "https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/set-up-macos.md#databases"
});
const ADMIN_USERS = new Set(["root", "postgres", "mysql", "mariadb"]);

const SERVERS = Object.freeze({
  mysql: {
    product: "MariaDB",
    apt: {
      install: "sudo apt install mariadb-server",
      start: "sudo service mariadb start",
      admin: "sudo mariadb"
    },
    brew: {
      install: "brew install mariadb && brew services start mariadb",
      start: "brew services start mariadb",
      admin: "mariadb"
    },
    // Fedora, Arch and other Linux: root signs in through the system's own account.
    other: { admin: "sudo mariadb" }
  },
  postgresql: {
    product: "PostgreSQL",
    apt: {
      install: "sudo apt install postgresql",
      start: "sudo service postgresql start",
      admin: "sudo -u postgres psql"
    },
    brew: {
      install: "brew install postgresql@18 && brew services start postgresql@18",
      start: "brew services start postgresql@18",
      admin: "\"$(brew --prefix postgresql@18)/bin/psql\" postgres"
    },
    other: { admin: "sudo -u postgres psql" }
  }
});

const { quoteIdentifier: mysqlName, stringLiteral: mysqlString } = SQL_QUOTING.mysql;
const { quoteIdentifier: pgName, stringLiteral: pgString } = SQL_QUOTING.postgresql;

// The longest database name a GRANT takes, each escaping \ counted: MariaDB refuses a longer one or, in some
// versions, keeps its first 64 characters, so that once it reloads its grants it grants another name.
const GRANT_NAME_LENGTH = 64;

/**
 * A database as a GRANT names it exactly. In a GRANT's database name `_` matches any one character, `%` any
 * characters, and `\_`, `\%` and `\\` only themselves, so a grant naming `shop_dev` as it is also reaches `shopxdev`:
 * each `\`, `_` and `%` is escaped. CREATE DATABASE takes the name as it is.
 */
function grantName(name) {
  return name.replace(/[\\_%]/gu, "\\$&");
}

/**
 * The GRANT names of a test database's numbered copies, which a JSKIT test run makes for each test file or browser
 * worker running at once (`<name>_1`, `<name>_2`, ...): `<name>\__` and `<name>\___` are the name escaped, a literal
 * `_` and one or two characters, so copies 1 to 99. None when the escaped name is too long for a GRANT.
 */
function copyGrantNames(name) {
  const escaped = grantName(name);
  return [...escaped].length + 4 > GRANT_NAME_LENGTH ? [] : [`${escaped}\\__`, `${escaped}\\___`];
}

/**
 * Why there is no MariaDB command, naming the fix: the database or a test database is longer than a GRANT can name
 * exactly once escaped. A test database Vibe64 guesses is named from the database, so the database is the one to
 * shorten. Empty when every name fits.
 */
function grantRefusal({ database, testDatabases, testDeclared, databaseVariable, testDatabaseVariable }) {
  const databaseName = databaseVariable || "the database name";
  for (const [name, what] of [[database, "database"], ...testDatabases.map((name) => [name, "test database"])]) {
    const length = [...grantName(name)].length;
    if (length <= GRANT_NAME_LENGTH) continue;
    const fix = what === "database" ? `Shorten ${databaseName} to fit.`
      : testDeclared ? `Shorten ${testDatabaseVariable || "the test database name"} in Env to fit.`
        : `Shorten ${databaseName} to fit: its test databases are named from it.`;
    return `MariaDB can't grant the ${what} “${name}” exactly: a grant names at most ${GRANT_NAME_LENGTH} characters, `
      + `each _, % and \\ counting as two, and this one needs ${length}. ${fix}`;
  }
  return "";
}

function mysqlStatements({ database, username, password, testDatabases }) {
  const user = `${mysqlString(username)}@'%'`;
  return [
    `CREATE DATABASE IF NOT EXISTS ${mysqlName(database)} CHARACTER SET utf8mb4;`,
    `CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ${mysqlString(password)};`,
    `ALTER USER ${user} IDENTIFIED BY ${mysqlString(password)};`,
    ...[database, ...testDatabases].map((name) => `GRANT ALL PRIVILEGES ON ${mysqlName(grantName(name))}.* TO ${user};`),
    ...testDatabases.flatMap(copyGrantNames).map((copies) => `GRANT ALL PRIVILEGES ON ${mysqlName(copies)}.* TO ${user};`)
  ];
}

function postgresqlStatements({ database, username, password }) {
  // CREATEDB lets the project's tests create and drop their own databases.
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${pgString(username)}) THEN CREATE ROLE ${pgName(username)}; END IF; END $$;`,
    `ALTER ROLE ${pgName(username)} LOGIN CREATEDB PASSWORD ${pgString(password)};`,
    `SELECT ${pgString(`CREATE DATABASE ${pgName(database)} OWNER ${pgName(username)}`)} WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = ${pgString(database)})\\gexec`
  ];
}

function isAdminUser(username = "") {
  return ADMIN_USERS.has(String(username || "").trim().toLowerCase());
}

/** Test database names worth a grant: the declared one, else both usual names. */
function testDatabaseNames(database = "", testDatabase = "") {
  const declared = String(testDatabase || "").trim();
  if (declared) return [declared];
  return database ? [`test_${database}`, `${database}_test`] : [];
}

/**
 * The commands for one server kind on this computer's family ("apt", "brew"
 * or ""). `create` is null until a database, a non-administrator user and a
 * password are known; `password` may be a stand-in shown to the person.
 * `refusal` says why a MariaDB command can't be given and which value to
 * shorten, by its Env name when `databaseVariable` or `testDatabaseVariable`
 * gives it.
 */
function databaseServerGuide({ kind, family = "", database = "", username = "", password = "", testDatabase = "", databaseVariable = "", testDatabaseVariable = "" } = {}) {
  const server = SERVERS[kind];
  if (!server) return null;
  const lines = server[family] || null;
  const admin = (lines || server.other).admin;
  const testDatabases = testDatabaseNames(database, testDatabase);
  const testDeclared = Boolean(String(testDatabase || "").trim());
  const refusal = kind === "mysql" && database
    ? grantRefusal({ database, testDatabases, testDeclared, databaseVariable, testDatabaseVariable })
    : "";
  const ready = Boolean(database && username && password && !isAdminUser(username) && !refusal);
  const statements = !ready ? []
    : kind === "mysql"
      ? mysqlStatements({ database, username, password, testDatabases })
      : postgresqlStatements({ database, username, password });
  const sudo = (command) => command.startsWith("sudo ");
  return {
    product: server.product,
    guideUrl: SETUP_GUIDES[family] || SETUP_GUIDES.apt,
    install: lines ? { command: lines.install, note: sudo(lines.install) ? SUDO_NOTE : "" } : null,
    start: lines ? { command: lines.start, note: sudo(lines.start) ? SUDO_NOTE : "" } : null,
    create: ready
      ? { command: [`${admin} <<'SQL'`, ...statements, "SQL"].join("\n"), note: sudo(admin) ? SUDO_NOTE : "" }
      : null,
    refusal
  };
}

const __testables = Object.freeze({ copyGrantNames, testDatabaseNames });

export {
  databaseServerGuide,
  isAdminUser,
  __testables
};
