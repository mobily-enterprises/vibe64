<?php
// A command-line run of project code.
require_once __DIR__ . '/../src/AlphaService.php';

$alpha = new Fixture\AlphaService();
for ($i = 0; $i < 3; $i++) {
    $alpha->run();
}
// Replace this process with a fresh PHP that keeps the same pid.
if (getenv('FIXTURE_EXEC_AGAIN') === '1' && function_exists('pcntl_exec')) {
    $environment = getenv();
    unset($environment['FIXTURE_EXEC_AGAIN']);
    pcntl_exec(PHP_BINARY, [__FILE__], $environment);
}
echo "ran\n";
