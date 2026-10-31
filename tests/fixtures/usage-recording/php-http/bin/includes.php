<?php
// Includes files more than once: a plain include runs a file's top-level code
// each time, require_once only the first time.
$first = include __DIR__ . '/../src/settings.php';
$second = include __DIR__ . '/../src/settings.php';
require_once __DIR__ . '/../src/helpers.php';
require_once __DIR__ . '/../src/helpers.php';
echo $first['name'] === $second['name'] ? "included\n" : "different\n";
