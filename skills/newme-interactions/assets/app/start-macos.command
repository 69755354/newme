#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 22 or later from https://nodejs.org/'
  exit 1
fi
printf '%s\n' 'Open http://127.0.0.1:4320/ in your browser.'
exec node server.mjs
