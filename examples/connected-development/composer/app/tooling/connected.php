<?php

/*
 * Connected development for Composer.
 *
 *   php tooling/connected.php prepare <sourcesFile>
 *   php tooling/connected.php verify  <sourcesFile>
 *
 * prepare: writes an untracked derived manifest (composer.connected.json) that
 * is the tracked composer.json plus one Composer "path" repository per
 * connected source, then runs Composer with COMPOSER pointing at it. Composer
 * names the lock after the manifest (composer.connected.lock), so the tracked
 * composer.json and composer.lock are never written.
 *
 * verify: proves that each connected package is installed from its sourceRoot
 * (installed path, vendor link and derived lock entry) and that the tracked
 * manifest and lock are unmodified.
 */

const CONTRACT = 'vibe64.connected-sources.v1';
const DERIVED_MANIFEST = 'composer.connected.json';
const DERIVED_LOCK = 'composer.connected.lock';

function fail(string $message): never
{
    fwrite(STDERR, "connected: $message\n");
    exit(1);
}

function readJson(string $path): array
{
    if (!is_file($path)) {
        fail("missing $path");
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        fail("invalid JSON in $path");
    }
    return $data;
}

/** @return list<array{name: string, sourceRoot: string, version: ?string, relationship: string}> */
function connectedPackages(string $sourcesFile): array
{
    $map = readJson($sourcesFile);
    if (($map['contract'] ?? null) !== CONTRACT) {
        fail("$sourcesFile is not a " . CONTRACT . ' sources map');
    }
    $lockedVersions = [];
    if (is_file('composer.lock')) {
        $lock = readJson('composer.lock');
        foreach (array_merge($lock['packages'] ?? [], $lock['packages-dev'] ?? []) as $package) {
            $lockedVersions[$package['name']] = $package['version'];
        }
    }
    $packages = [];
    foreach ($map['projects'] ?? [] as $project) {
        if (($project['type'] ?? 'composer') !== 'composer') {
            continue;
        }
        $root = realpath((string) ($project['sourceRoot'] ?? ''));
        if ($root === false || !is_file("$root/composer.json")) {
            fail('connected source has no composer.json: ' . ($project['sourceRoot'] ?? '(none)'));
        }
        $manifest = readJson("$root/composer.json");
        $name = $manifest['name'] ?? fail("$root/composer.json has no name");
        // A connected checkout is usually on a branch, which Composer would
        // see as dev-<branch>. Present it under the version the app expects:
        // the tracked lock's version, else the library's declared version.
        $version = $lockedVersions[$name] ?? ($manifest['version'] ?? null);
        $packages[] = [
            'name' => $name,
            'sourceRoot' => $root,
            'version' => $version,
            'relationship' => (string) ($project['relationship'] ?? 'dependency'),
        ];
    }
    if ($packages === []) {
        fail("$sourcesFile lists no composer projects");
    }
    return $packages;
}

function composerBinary(): string
{
    return getenv('COMPOSER_BINARY') ?: 'composer';
}

function runComposer(array $arguments): void
{
    $env = getenv();
    $env['COMPOSER'] = DERIVED_MANIFEST;
    $command = array_merge([composerBinary()], $arguments);
    fwrite(STDERR, '+ COMPOSER=' . DERIVED_MANIFEST . ' ' . implode(' ', $command) . "\n");
    $process = proc_open($command, [STDIN, STDOUT, STDERR], $pipes, getcwd(), $env);
    if (!is_resource($process) || proc_close($process) !== 0) {
        fail('composer ' . implode(' ', $arguments) . ' failed');
    }
}

function prepare(string $sourcesFile): void
{
    $packages = connectedPackages($sourcesFile);
    $manifest = readJson('composer.json');

    $repositories = [];
    foreach ($packages as $package) {
        $options = ['symlink' => true];
        if ($package['version'] !== null) {
            $options['versions'] = [$package['name'] => $package['version']];
        }
        // Path repositories are canonical: listed first, they win over
        // Packagist and any repositories from the tracked manifest.
        $repositories[] = ['type' => 'path', 'url' => $package['sourceRoot'], 'options' => $options];
    }
    $manifest['repositories'] = array_merge($repositories, $manifest['repositories'] ?? []);

    $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
    if (!is_file(DERIVED_MANIFEST) || file_get_contents(DERIVED_MANIFEST) !== $json) {
        file_put_contents(DERIVED_MANIFEST, $json);
    }

    $names = array_column($packages, 'name');
    if (is_file('composer.lock')) {
        // Keep every other dependency at its tracked locked version and
        // re-resolve only the connected packages.
        copy('composer.lock', DERIVED_LOCK);
        runComposer(array_merge(['update', '--no-interaction', '--no-progress'], $names));
    } else {
        runComposer(['update', '--no-interaction', '--no-progress']);
    }
}

function verify(string $sourcesFile): void
{
    $packages = connectedPackages($sourcesFile);
    if (!is_file('vendor/autoload.php') || !is_file(DERIVED_LOCK)) {
        fail('not prepared: run prepare first');
    }
    require getcwd() . '/vendor/autoload.php';

    $lock = readJson(DERIVED_LOCK);
    $locked = [];
    foreach (array_merge($lock['packages'] ?? [], $lock['packages-dev'] ?? []) as $entry) {
        $locked[$entry['name']] = $entry;
    }

    foreach ($packages as $package) {
        $name = $package['name'];
        $root = $package['sourceRoot'];
        if (!\Composer\InstalledVersions::isInstalled($name)) {
            fail("$name is not installed");
        }
        $installPath = realpath((string) \Composer\InstalledVersions::getInstallPath($name));
        if ($installPath !== $root) {
            fail("$name resolves to $installPath, not the connected source $root");
        }
        $vendorPath = "vendor/$name";
        if (!is_link($vendorPath) || realpath($vendorPath) !== $root) {
            fail("$vendorPath is not a link to $root");
        }
        $dist = $locked[$name]['dist'] ?? [];
        if (($dist['type'] ?? null) !== 'path' || realpath((string) ($dist['url'] ?? '')) !== $root) {
            fail(DERIVED_LOCK . " does not lock $name to path $root");
        }
        echo "verified $name " . \Composer\InstalledVersions::getPrettyVersion($name) . " -> $root\n";
    }

    // The tracked manifest and lock must be untouched.
    $status = shell_exec('git status --porcelain -- composer.json composer.lock 2>/dev/null');
    if (is_string($status) && trim($status) !== '') {
        fail("tracked Composer files changed:\n$status");
    }
}

[$script, $command, $sourcesFile] = array_pad($argv, 3, null);
if ($sourcesFile === null || !in_array($command, ['prepare', 'verify'], true)) {
    fail("usage: php $script prepare|verify <sourcesFile>");
}
$command === 'prepare' ? prepare($sourcesFile) : verify($sourcesFile);
