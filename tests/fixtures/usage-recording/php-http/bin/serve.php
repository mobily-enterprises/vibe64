<?php
// Starts `php -S` with the router script the way `php artisan serve` does: a
// child PHP found through PHP_BINARY that inherits this environment.
$port = (int) ($argv[1] ?? 8000);
$root = dirname(__DIR__);
$server = proc_open([PHP_BINARY, '-S', "127.0.0.1:{$port}", "{$root}/server.php"], [STDIN, STDOUT, STDERR], $pipes, "{$root}/public");
while (proc_get_status($server)['running']) {
    usleep(100000);
}
