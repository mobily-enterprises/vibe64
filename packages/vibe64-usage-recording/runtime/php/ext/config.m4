dnl The Vibe64 usage recorder: a PHP extension built with phpize by
dnl runtime/php/build.mjs and loaded only into recorded processes.
PHP_ARG_ENABLE([vibe64-usage], [whether to enable the Vibe64 usage recorder],
  [AS_HELP_STRING([--enable-vibe64-usage], [Enable the Vibe64 usage recorder])], [no])

if test "$PHP_VIBE64_USAGE" != "no"; then
  PHP_NEW_EXTENSION(vibe64_usage, vibe64_usage.c, $ext_shared)
fi
