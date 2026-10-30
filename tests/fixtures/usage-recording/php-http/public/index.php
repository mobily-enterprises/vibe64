<?php
// Front controller: each path runs one service, after an optional sleep that
// makes concurrent requests overlap.
require_once __DIR__ . '/../src/helpers.php';
require_once __DIR__ . '/../src/AlphaService.php';
require_once __DIR__ . '/../src/BetaService.php';
require_once __DIR__ . '/../vendor/acme/tool/Tool.php';

use Fixture\AlphaService;
use Fixture\BetaService;

$started = microtime(true);
usleep((int) ($_GET['sleep'] ?? 0) * 1000);
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$result = match ($path) {
    '/alpha' => (new AlphaService())->run(),
    '/beta' => (new BetaService())->run(),
    default => ['service' => 'none'],
};
// Request values reach project code as arguments; the recorder never sees them.
Fixture\remember($_GET['token'] ?? '', $_COOKIE['session'] ?? '', $_SERVER['HTTP_AUTHORIZATION'] ?? '', (string) file_get_contents('php://input'));
header('Content-Type: application/json');
echo json_encode($result + ['pid' => getmypid(), 'tool' => acme_tool(), 'started' => $started, 'ended' => microtime(true)]);
