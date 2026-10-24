#!/bin/sh
set -eu

data_dir="/home/appuser/data"

# Compose can create a missing bind-mount directory as root. Prepare it before
# dropping privileges so appuser can initialize the database and downloads.
mkdir -p "$data_dir"
chown -R appuser:appuser "$data_dir"

exec su-exec appuser:appuser "$@"
