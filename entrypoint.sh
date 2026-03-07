#!/bin/sh
set -e

# Fix ownership of the data directory at startup (handles host-mounted volumes
# that may be owned by a different user, e.g. ubuntu on the host).
# We run as root initially so we can chown, then drop privileges to nextjs.
chown -R nextjs:nodejs /app/.data

exec gosu nextjs "$@"
