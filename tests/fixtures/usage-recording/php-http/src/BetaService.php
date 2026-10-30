<?php
namespace Fixture;

class BetaService
{
    public function run(): array
    {
        return ['service' => 'beta', 'value' => $this->betaOnly()];
    }

    private function betaOnly(): int
    {
        $square = static function (int $n): int {
            return $n * $n;
        };
        return $square(4);
    }
}
