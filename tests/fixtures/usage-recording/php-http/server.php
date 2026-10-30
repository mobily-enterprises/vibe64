<?php
// A router script, as `php artisan serve` passes one to `php -S`. PHP never
// runs auto_prepend_file for a router script.
$uri = urldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
if ($uri !== '/' && is_file(__DIR__ . '/public' . $uri)) {
    return false;
}
require_once __DIR__ . '/public/index.php';
