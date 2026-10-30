<?php
namespace Fixture;

function remember(string ...$values): int
{
    return count(array_filter($values));
}
