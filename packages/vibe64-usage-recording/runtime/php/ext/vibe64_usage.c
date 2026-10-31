/*
 * Vibe64 usage recorder for PHP (non-thread-safe builds).
 *
 * Vibe64 loads this module, through PHP_INI_SCAN_DIR, only into the processes
 * of an Output target it is recording. At startup it reads:
 *   VIBE64_USAGE_RECORDING_DIR  absolute existing directory, not a symlink;
 *   VIBE64_USAGE_SOURCE_ROOT    absolute existing project source root;
 *   VIBE64_USAGE_TARGET_KIND    "web" or "terminal".
 * Anything missing or invalid, or a control.json that already says
 * "stopping", leaves the module fully inert: no observer and no file.
 *
 * Otherwise it observes the start of every PHP function declared in a file
 * under the source root (never under vendor/ or node_modules/), counts calls
 * per scope and appends vibe64.usage-trace.v1 lines to its own
 * hits-php-<pid>.ndjson. A file's top-level code counts once each time it
 * runs as a script and each time it is included. A request's scope is the
 * Preview proxy's x-vibe64-recording-request id, else a local request scope
 * labelled with the method and path (never the query). A process without an
 * HTTP request is run_<pid> for a terminal target and bg_<pid> for a web
 * target.
 *
 * It records paths, file hashes, function names, positions and counts only:
 * never arguments, headers, cookies, bodies or query strings. It opens no
 * socket and never raises a PHP error; any failure just stops recording.
 */
#ifdef HAVE_CONFIG_H
#include "config.h"
#endif

#include "php.h"
#include "SAPI.h"
#include "ext/hash/php_hash.h"
#include "ext/hash/php_hash_sha.h"
#include "ext/standard/info.h"
#include "zend_observer.h"
#include "zend_smart_str.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#ifdef ZTS
# error "The Vibe64 usage recorder supports non-thread-safe (NTS) PHP builds only."
#endif

#define V64_VERSION "1"
#define V64_FILE_LIMIT (16 * 1024 * 1024)   /* hits file per process */
#define V64_FLUSH_ENTRIES 2000              /* also the most pairs in one hits line */
#define V64_FLUSH_BYTES (4 * 1024 * 1024)
#define V64_FLUSH_NS 1000000000ULL
#define V64_TICK_CALLS 4096
#define V64_LABEL_PATH 256
#define V64_NAME_LIMIT 1024

enum { V64_OFF, V64_ON, V64_IDLE };

static struct {
	int state;
	bool terminal;
	char dir[PATH_MAX];
	char root[PATH_MAX];
	size_t root_len;
	char real_root[PATH_MAX];
	size_t real_root_len;
	pid_t pid;
	int fd;
	size_t written;
	zend_long next_file;
	zend_long next_function;
	zend_long local_requests;
	HashTable files;     /* persistent: relative path -> file index, -1 if unreadable */
	HashTable functions; /* persistent: identity -> function index */
	smart_str out;       /* persistent: lines not yet written */
	/* The current scope: one per request (a CLI process has one request). */
	bool scope_active;
	bool scope_written;
	char scope[64];
	const char *kind;
	char label[300];
	char started_at[32];
	HashTable map;    /* opcodes address -> function index */
	HashTable counts; /* function index -> calls */
	uint32_t calls;
	uint64_t last_tick;
	bool compile_hooked;
} v64;

static zend_op_array *(*v64_compile_file_next)(zend_file_handle *file_handle, int type);

#define V64_PUT(literal) smart_str_appendl_ex(&v64.out, literal, sizeof(literal) - 1, 1)

static void v64_put_long(zend_long number)
{
	smart_str_append_long_ex(&v64.out, number, 1);
}

static void v64_put_json(const char *text, size_t length)
{
	static const char hex[] = "0123456789abcdef";
	smart_str_appendc_ex(&v64.out, '"', 1);
	for (size_t i = 0; i < length; i++) {
		unsigned char c = (unsigned char) text[i];
		if (c == '"' || c == '\\') {
			smart_str_appendc_ex(&v64.out, '\\', 1);
			smart_str_appendc_ex(&v64.out, (char) c, 1);
		} else if (c < 0x20) {
			char escaped[6] = {'\\', 'u', '0', '0', hex[c >> 4], hex[c & 15]};
			smart_str_appendl_ex(&v64.out, escaped, sizeof(escaped), 1);
		} else {
			smart_str_appendc_ex(&v64.out, (char) c, 1);
		}
	}
	smart_str_appendc_ex(&v64.out, '"', 1);
}

static void v64_put_point(zend_long line, zend_long column)
{
	V64_PUT("{\"line\":");
	v64_put_long(line);
	V64_PUT(",\"column\":");
	v64_put_long(column);
	V64_PUT("}");
}

static uint64_t v64_monotonic(void)
{
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return (uint64_t) now.tv_sec * 1000000000ULL + (uint64_t) now.tv_nsec;
}

static void v64_now(char out[32])
{
	struct timeval now;
	struct tm parts;
	gettimeofday(&now, NULL);
	gmtime_r(&now.tv_sec, &parts);
	size_t length = strftime(out, 32, "%Y-%m-%dT%H:%M:%S", &parts);
	snprintf(out + length, 32 - length, ".%03dZ", (int) (now.tv_usec / 1000));
}

static void v64_close(void)
{
	if (v64.fd >= 0) {
		close(v64.fd);
	}
	v64.fd = -1;
	smart_str_free_ex(&v64.out, 1);
}

static void v64_scope_end(void)
{
	if (v64.scope_active) {
		v64.scope_active = false;
		zend_hash_destroy(&v64.map);
		zend_hash_destroy(&v64.counts);
	}
}

/* Recording stops for good in this process. */
static void v64_quit(void)
{
	v64_scope_end();
	v64.state = V64_IDLE;
	v64_close();
}

static bool v64_write_all(const char *data, size_t length)
{
	while (length) {
		ssize_t written = write(v64.fd, data, length);
		if (written < 0 && errno == EINTR) {
			continue;
		}
		if (written <= 0) {
			return false;
		}
		data += written;
		length -= (size_t) written;
	}
	return true;
}

/* Writes the buffered lines. Past the per-process limit it writes one
 * truncated line instead and records nothing more. */
static void v64_drain(void)
{
	static const char truncated[] = "{\"type\":\"truncated\",\"reason\":\"size-limit\"}\n";
	if (!v64.out.s || !ZSTR_LEN(v64.out.s) || v64.fd < 0) {
		return;
	}
	size_t length = ZSTR_LEN(v64.out.s);
	if (v64.written + length + sizeof(truncated) - 1 > V64_FILE_LIMIT) {
		v64_write_all(truncated, sizeof(truncated) - 1);
		v64_quit();
		return;
	}
	if (!v64_write_all(ZSTR_VAL(v64.out.s), length)) {
		v64_quit();
		return;
	}
	v64.written += length;
	ZSTR_LEN(v64.out.s) = 0;
}

/* Only {"state":"stopping"} stops recording; missing or malformed keeps it. */
static bool v64_stopping(void)
{
	char path[PATH_MAX + 16], buffer[4096];
	snprintf(path, sizeof(path), "%s/control.json", v64.dir);
	int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
	if (fd < 0) {
		return false;
	}
	ssize_t length = read(fd, buffer, sizeof(buffer) - 1);
	close(fd);
	if (length <= 0) {
		return false;
	}
	buffer[length] = '\0';
	const char *p = buffer + strspn(buffer, " \t\r\n");
	if (*p++ != '{') {
		return false;
	}
	p += strspn(p, " \t\r\n");
	if (strncmp(p, "\"state\"", 7) != 0) {
		return false;
	}
	p += 7;
	p += strspn(p, " \t\r\n");
	if (*p++ != ':') {
		return false;
	}
	p += strspn(p, " \t\r\n");
	if (strncmp(p, "\"stopping\"", 10) != 0) {
		return false;
	}
	p += 10;
	p += strspn(p, " \t\r\n");
	return *p == '}' || *p == ',';
}

/* Starts this process's own hits file: a fork of a recorded process (such as
 * a `php -S` worker) never writes into its parent's file. */
static bool v64_open(void)
{
	char path[PATH_MAX + 64], started[32];
	pid_t pid = getpid();
	v64_close();
	zend_hash_clean(&v64.files);
	zend_hash_clean(&v64.functions);
	v64.next_file = v64.next_function = v64.local_requests = 0;
	v64.written = 0;
	v64.pid = pid;
	for (int n = 1; n <= 100 && v64.fd < 0; n++) {
		if (n == 1) {
			snprintf(path, sizeof(path), "%s/hits-php-%ld.ndjson", v64.dir, (long) pid);
		} else {
			snprintf(path, sizeof(path), "%s/hits-php-%ld-%d.ndjson", v64.dir, (long) pid, n);
		}
		v64.fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_APPEND | O_NOFOLLOW | O_CLOEXEC, 0666);
		if (v64.fd < 0 && errno != EEXIST) {
			break;
		}
	}
	if (v64.fd < 0) {
		v64_quit();
		return false;
	}
	const char *version = zend_get_module_version("standard");
	version = version ? version : PHP_VERSION;
	v64_now(started);
	V64_PUT("{\"type\":\"header\",\"schema\":\"vibe64.usage-trace.v1\",\"runtime\":\"php\",\"runtimeVersion\":");
	v64_put_json(version, strlen(version));
	V64_PUT(",\"pid\":");
	v64_put_long(pid);
	V64_PUT(",\"startedAt\":");
	v64_put_json(started, strlen(started));
	V64_PUT("}\n{\"type\":\"tracer\",\"state\":\"ready\"}\n");
	v64_drain();
	return v64.state == V64_ON;
}

/* The source-root-relative path of a compiled file, or NULL when it is outside
 * the root, inside vendor/ or node_modules/, or not a plain file path. */
static const char *v64_relative(const zend_string *filename)
{
	const char *name = ZSTR_VAL(filename);
	size_t length = ZSTR_LEN(filename);
	const char *relative = NULL;
	if (strlen(name) != length) {
		return NULL;
	}
	if (length > v64.root_len + 1 && memcmp(name, v64.root, v64.root_len) == 0 && name[v64.root_len] == '/') {
		relative = name + v64.root_len + 1;
	} else if (v64.real_root_len && length > v64.real_root_len + 1
			&& memcmp(name, v64.real_root, v64.real_root_len) == 0 && name[v64.real_root_len] == '/') {
		relative = name + v64.real_root_len + 1;
	}
	if (!relative || strstr(relative, "eval()'d code")) {
		return NULL;
	}
	const char *segment = relative;
	for (const char *p = relative;; p++) {
		if (*p == '\\') {
			return NULL;
		}
		if (*p != '/' && *p != '\0') {
			continue;
		}
		size_t size = (size_t) (p - segment);
		if (size == 0 || (size == 1 && segment[0] == '.') || (size == 2 && memcmp(segment, "..", 2) == 0)
				|| (size == 6 && memcmp(segment, "vendor", 6) == 0)
				|| (size == 12 && memcmp(segment, "node_modules", 12) == 0)) {
			return NULL;
		}
		if (*p == '\0') {
			return relative;
		}
		segment = p + 1;
	}
}

/* The trace index of a file, declared the first time this process runs code
 * from it with the hash of its bytes on disk; -1 when it cannot be read. */
static zend_long v64_file_index(const char *relative, const zend_string *filename)
{
	static const char hex[] = "0123456789abcdef";
	size_t relative_len = strlen(relative);
	zval *known = zend_hash_str_find(&v64.files, relative, relative_len);
	if (known) {
		return Z_LVAL_P(known);
	}
	unsigned char buffer[16384], digest[32];
	char digest_hex[64];
	PHP_SHA256_CTX context;
	PHP_SHA256Init(&context);
	ssize_t got = -1;
	int fd = open(ZSTR_VAL(filename), O_RDONLY | O_CLOEXEC);
	if (fd >= 0) {
		while ((got = read(fd, buffer, sizeof(buffer))) > 0 || (got < 0 && errno == EINTR)) {
			if (got > 0) {
				PHP_SHA256Update(&context, buffer, (size_t) got);
			}
		}
		close(fd);
	}
	zval value;
	ZVAL_LONG(&value, got == 0 ? v64.next_file++ : -1);
	zend_hash_str_add_new(&v64.files, relative, relative_len, &value);
	if (Z_LVAL(value) < 0) {
		V64_PUT("{\"type\":\"diagnostic\",\"code\":\"READ_FAILED\",\"path\":");
		v64_put_json(relative, relative_len);
		V64_PUT("}\n");
		return -1;
	}
	PHP_SHA256Final(digest, &context);
	for (int i = 0; i < 32; i++) {
		digest_hex[i * 2] = hex[digest[i] >> 4];
		digest_hex[i * 2 + 1] = hex[digest[i] & 15];
	}
	V64_PUT("{\"type\":\"file\",\"fileIndex\":");
	v64_put_long(Z_LVAL(value));
	V64_PUT(",\"path\":");
	v64_put_json(relative, relative_len);
	V64_PUT(",\"hash\":\"sha256:");
	smart_str_appendl_ex(&v64.out, digest_hex, sizeof(digest_hex), 1);
	V64_PUT("\"}\n");
	return Z_LVAL(value);
}

/* The trace index of a function, declaring it (and its file) on first use;
 * -1 when it is not recorded. PHP keeps no columns, so every function starts
 * at column 1: a file's own code is its module at 1:1, named functions and
 * methods join by name and line, and closures are named "". */
static zend_long v64_function_index(const zend_op_array *op)
{
	const char *relative = v64_relative(op->filename);
	zend_long file = relative ? v64_file_index(relative, op->filename) : -1;
	if (file < 0) {
		return -1;
	}
	bool module = op->function_name == NULL;
	bool closure = !module && (op->fn_flags & ZEND_ACC_CLOSURE);
	const char *name = "";
	size_t name_len = 0;
	if (!module && !closure) {
		name = ZSTR_VAL(op->function_name);
		name_len = ZSTR_LEN(op->function_name);
		const char *separator = zend_memrchr(name, '\\', name_len);
		if (separator) {
			name_len -= (size_t) (separator + 1 - name);
			name = separator + 1;
		}
		name_len = MIN(name_len, V64_NAME_LIMIT);
	}
	uint32_t start = module ? 1 : op->line_start, end = MAX(op->line_end, start);
	char key[64 + V64_NAME_LIMIT];
	int key_len = snprintf(key, sizeof(key), "%ld:%u:%u:%c:%.*s", (long) file, start, end,
		module ? 'm' : closure ? 'c' : 'f', (int) name_len, name);
	zval *known = zend_hash_str_find(&v64.functions, key, (size_t) key_len);
	if (known) {
		return Z_LVAL_P(known);
	}
	zval value;
	ZVAL_LONG(&value, v64.next_function++);
	zend_hash_str_add_new(&v64.functions, key, (size_t) key_len, &value);
	V64_PUT("{\"type\":\"function\",\"functionIndex\":");
	v64_put_long(Z_LVAL(value));
	V64_PUT(",\"fileIndex\":");
	v64_put_long(file);
	V64_PUT(",\"name\":");
	v64_put_json(name, name_len);
	V64_PUT(",\"start\":");
	v64_put_point(start, 1);
	V64_PUT(",\"end\":");
	v64_put_point(end, 1);
	V64_PUT("}\n");
	return Z_LVAL(value);
}

/* Writes the scope's counts so far. A scope appears only once it has hits;
 * its final flush repeats the scope line with endedAt. */
static void v64_flush(bool final)
{
	if (getpid() != v64.pid) {
		/* A fork made inside a recorded request records nothing. */
		v64_quit();
		return;
	}
	uint32_t pairs = zend_hash_num_elements(&v64.counts);
	if (pairs || (final && v64.scope_written)) {
		if (!v64.scope_written || final) {
			V64_PUT("{\"type\":\"scope\",\"scope\":");
			v64_put_json(v64.scope, strlen(v64.scope));
			V64_PUT(",\"kind\":");
			v64_put_json(v64.kind, strlen(v64.kind));
			if (v64.label[0]) {
				V64_PUT(",\"label\":");
				v64_put_json(v64.label, strlen(v64.label));
			}
			V64_PUT(",\"startedAt\":");
			v64_put_json(v64.started_at, strlen(v64.started_at));
			if (final) {
				char ended[32];
				v64_now(ended);
				V64_PUT(",\"endedAt\":");
				v64_put_json(ended, strlen(ended));
			}
			V64_PUT("}\n");
			v64.scope_written = true;
		}
		uint32_t in_line = 0;
		zend_ulong index;
		zval *count;
		ZEND_HASH_FOREACH_NUM_KEY_VAL(&v64.counts, index, count) {
			if (in_line == 0) {
				V64_PUT("{\"type\":\"hits\",\"scope\":");
				v64_put_json(v64.scope, strlen(v64.scope));
				V64_PUT(",\"counts\":[");
			} else {
				V64_PUT(",");
			}
			V64_PUT("[");
			v64_put_long((zend_long) index);
			V64_PUT(",");
			v64_put_long(Z_LVAL_P(count));
			V64_PUT("]");
			if (++in_line == V64_FLUSH_ENTRIES) {
				V64_PUT("]}\n");
				in_line = 0;
			}
		} ZEND_HASH_FOREACH_END();
		if (in_line) {
			V64_PUT("]}\n");
		}
		zend_hash_clean(&v64.counts);
	}
	v64_drain();
}

/* control.json said "stopping": final flush, then idle for good. */
static void v64_stop(void)
{
	if (v64.scope_active) {
		v64_flush(true);
		v64_scope_end();
	}
	if (v64.state == V64_ON) {
		V64_PUT("{\"type\":\"tracer\",\"state\":\"idle\"}\n");
		v64_drain();
	}
	v64_quit();
}

static void v64_tick(void)
{
	v64.calls = 0;
	uint64_t now = v64_monotonic();
	bool full = zend_hash_num_elements(&v64.counts) >= V64_FLUSH_ENTRIES
		|| (v64.out.s && ZSTR_LEN(v64.out.s) >= V64_FLUSH_BYTES);
	if (!full && now - v64.last_tick < V64_FLUSH_NS) {
		return;
	}
	v64.last_tick = now;
	v64_flush(false);
	if (v64.scope_active && v64.state == V64_ON && v64_stopping()) {
		v64_stop();
	}
}

static void v64_count(zend_long index)
{
	zval *count = zend_hash_index_lookup(&v64.counts, (zend_ulong) index);
	if (Z_TYPE_P(count) == IS_LONG) {
		Z_LVAL_P(count)++;
	} else {
		ZVAL_LONG(count, 1);
	}
	if (++v64.calls >= V64_TICK_CALLS || zend_hash_num_elements(&v64.counts) >= V64_FLUSH_ENTRIES) {
		v64_tick();
	}
}

static void v64_begin(zend_execute_data *execute_data)
{
	/* An included file's top-level code was counted when it was included. */
	if (!v64.scope_active || ZEND_CALL_KIND(execute_data) == ZEND_CALL_NESTED_CODE) {
		return;
	}
	zval *index = zend_hash_index_find(&v64.map, (zend_ulong) (uintptr_t) execute_data->func->op_array.opcodes);
	if (index) {
		v64_count(Z_LVAL_P(index));
	}
}

/* Counts an included file's top-level code once per include, when PHP compiles
 * (or takes from OPcache) the file for an include or require. PHP skips running
 * a body that only returns a constant, such as a file that only declares
 * classes and functions, unless an extension like Xdebug replaces its executor,
 * so counting the run itself would depend on the PHP setup. Scripts PHP runs
 * itself (the main script, auto_prepend_file, a router script) are counted when
 * they start, by the observer. */
static zend_op_array *v64_compile_file(zend_file_handle *file_handle, int type)
{
	zend_op_array *op_array = v64_compile_file_next(file_handle, type);
	zend_execute_data *includer = EG(current_execute_data);
	if (op_array && op_array->filename && v64.scope_active && v64.state == V64_ON
			&& includer && includer->func && ZEND_USER_CODE(includer->func->type)
			&& includer->opline && includer->opline->opcode == ZEND_INCLUDE_OR_EVAL) {
		zend_long index = v64_function_index(op_array);
		if (index >= 0) {
			v64_count(index);
		}
	}
	return op_array;
}

/* Called once per function per request: only project functions are observed.
 * An address reused within a request is re-mapped here before its first call. */
static zend_observer_fcall_handlers v64_init(zend_execute_data *execute_data)
{
	zend_observer_fcall_handlers none = {NULL, NULL};
	zend_function *function = execute_data->func;
	if (!v64.scope_active || v64.state != V64_ON || !function || function->type != ZEND_USER_FUNCTION
			|| !function->op_array.filename) {
		return none;
	}
	zend_long index = v64_function_index(&function->op_array);
	if (index < 0) {
		return none;
	}
	zval value;
	ZVAL_LONG(&value, index);
	zend_hash_index_update(&v64.map, (zend_ulong) (uintptr_t) function->op_array.opcodes, &value);
	return (zend_observer_fcall_handlers) {v64_begin, NULL};
}

static zval *v64_server_string(const char *name, size_t length)
{
	zval *server = &PG(http_globals)[TRACK_VARS_SERVER];
	if (Z_TYPE_P(server) != IS_ARRAY) {
		zend_is_auto_global_str(ZEND_STRL("_SERVER"));
	}
	if (Z_TYPE_P(server) != IS_ARRAY) {
		return NULL;
	}
	zval *value = zend_hash_str_find(Z_ARRVAL_P(server), name, length);
	return value && Z_TYPE_P(value) == IS_STRING ? value : NULL;
}

static void v64_scope_begin(void)
{
	const char *method = SG(request_info).request_method;
	zend_hash_init(&v64.map, 64, NULL, NULL, 0);
	zend_hash_init(&v64.counts, 64, NULL, NULL, 0);
	v64.scope_active = true;
	v64.scope_written = false;
	v64.calls = 0;
	v64.last_tick = v64_monotonic();
	v64.label[0] = '\0';
	v64_now(v64.started_at);
	if (!method) {
		snprintf(v64.scope, sizeof(v64.scope), "%s_%ld", v64.terminal ? "run" : "bg", (long) v64.pid);
		v64.kind = v64.terminal ? "run" : "background";
		return;
	}
	zval *request = v64_server_string(ZEND_STRL("HTTP_X_VIBE64_RECORDING_REQUEST"));
	if (request && Z_STRLEN_P(request) == 8 && memcmp(Z_STRVAL_P(request), "r_", 2) == 0
			&& strspn(Z_STRVAL_P(request) + 2, "0123456789") == 6) {
		memcpy(v64.scope, Z_STRVAL_P(request), 9);
		v64.kind = "request";
		return;
	}
	snprintf(v64.scope, sizeof(v64.scope), "l_%ld_%ld", (long) v64.pid, (long) ++v64.local_requests);
	v64.kind = "local-request";
	zval *uri = v64_server_string(ZEND_STRL("REQUEST_URI"));
	const char *path = uri ? Z_STRVAL_P(uri) : SG(request_info).request_uri ? SG(request_info).request_uri : "";
	size_t path_len = strcspn(path, "?#");
	if (path_len > V64_LABEL_PATH) {
		path_len = V64_LABEL_PATH;
		while (path_len && ((unsigned char) path[path_len] & 0xC0) == 0x80) {
			path_len--;
		}
	}
	snprintf(v64.label, sizeof(v64.label), "%.16s %.*s", method, (int) path_len, path);
}

static bool v64_directory(const char *path, bool follow)
{
	struct stat status;
	return path && path[0] == '/' && strlen(path) < PATH_MAX - 64
		&& (follow ? stat(path, &status) : lstat(path, &status)) == 0 && S_ISDIR(status.st_mode);
}

static bool v64_configure(void)
{
	const char *dir = getenv("VIBE64_USAGE_RECORDING_DIR");
	const char *root = getenv("VIBE64_USAGE_SOURCE_ROOT");
	const char *kind = getenv("VIBE64_USAGE_TARGET_KIND");
	if (!v64_directory(dir, false) || !v64_directory(root, true) || !realpath(root, v64.real_root)) {
		return false;
	}
	strcpy(v64.dir, dir);
	strcpy(v64.root, root);
	v64.root_len = strlen(v64.root);
	while (v64.root_len > 1 && v64.root[v64.root_len - 1] == '/') {
		v64.root[--v64.root_len] = '\0';
	}
	v64.real_root_len = strcmp(v64.real_root, v64.root) == 0 ? 0 : strlen(v64.real_root);
	v64.terminal = kind && strcmp(kind, "terminal") == 0;
	return v64.root_len > 1 && !v64_stopping();
}

PHP_MINIT_FUNCTION(vibe64_usage)
{
	v64.fd = -1;
	if (!v64_configure()) {
		return SUCCESS;
	}
	zend_hash_init(&v64.files, 64, NULL, NULL, 1);
	zend_hash_init(&v64.functions, 256, NULL, NULL, 1);
	v64.state = V64_ON;
	if (v64_open()) {
		zend_observer_fcall_register(v64_init);
	}
	return SUCCESS;
}

PHP_MSHUTDOWN_FUNCTION(vibe64_usage)
{
	if (v64.compile_hooked && zend_compile_file == v64_compile_file) {
		zend_compile_file = v64_compile_file_next;
	}
	if (v64.state != V64_OFF) {
		v64_close();
		zend_hash_destroy(&v64.files);
		zend_hash_destroy(&v64.functions);
	}
	return SUCCESS;
}

PHP_RINIT_FUNCTION(vibe64_usage)
{
	if (v64.state != V64_ON) {
		return SUCCESS;
	}
	if (!v64.compile_hooked) {
		/* Installed here, after OPcache installs its own at startup, so files
		 * OPcache already holds still pass through it. */
		v64_compile_file_next = zend_compile_file;
		zend_compile_file = v64_compile_file;
		v64.compile_hooked = true;
	}
	bool stopping = v64_stopping();
	if (v64.pid != getpid()) {
		/* A fork (a `php -S` worker): its own file, or none once stopped. */
		if (stopping) {
			v64_quit();
			return SUCCESS;
		}
		if (!v64_open()) {
			return SUCCESS;
		}
	} else if (stopping) {
		v64_stop();
		return SUCCESS;
	}
	v64_scope_begin();
	return SUCCESS;
}

PHP_RSHUTDOWN_FUNCTION(vibe64_usage)
{
	if (!v64.scope_active) {
		return SUCCESS;
	}
	v64_flush(true);
	v64_scope_end();
	if (v64.state == V64_ON && v64_stopping()) {
		v64_stop();
	}
	return SUCCESS;
}

PHP_MINFO_FUNCTION(vibe64_usage)
{
	php_info_print_table_start();
	php_info_print_table_row(2, "Vibe64 usage recorder", v64.state == V64_ON ? "recording" : "inactive");
	php_info_print_table_end();
}

zend_module_entry vibe64_usage_module_entry = {
	STANDARD_MODULE_HEADER,
	"vibe64_usage",
	NULL,
	PHP_MINIT(vibe64_usage),
	PHP_MSHUTDOWN(vibe64_usage),
	PHP_RINIT(vibe64_usage),
	PHP_RSHUTDOWN(vibe64_usage),
	PHP_MINFO(vibe64_usage),
	V64_VERSION,
	STANDARD_MODULE_PROPERTIES
};

#ifdef COMPILE_DL_VIBE64_USAGE
ZEND_GET_MODULE(vibe64_usage)
#endif
