<?php
namespace Fixture;

class AlphaService
{
    public function run(): array
    {
        return ['service' => 'alpha', 'value' => $this->alphaOnly()];
    }

    private function alphaOnly(): int
    {
        return array_sum(array_map(fn ($n) => $n * 2, range(1, 3)));
    }
}
