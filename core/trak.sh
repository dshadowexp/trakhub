#!/bin/sh

set -e # Exit early if any commands fail

exec bun run $(dirname $0)/main.ts "$@"
