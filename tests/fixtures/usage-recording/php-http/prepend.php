<?php
// The project's own auto_prepend_file. (A body that only returns a constant
// would be inlined by OPcache and so never run.)
function fixture_prepended(): bool
{
    return function_exists('fixture_prepended');
}
fixture_prepended();
