#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Applique le shim Supabase + toutes les migrations sur un Postgres jetable,
# puis joue les assertions de tests/sql/. Aucun service externe, aucun coût.
#   usage : scripts/verify-schema.sh
# ---------------------------------------------------------------------------
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/var/tmp/wallet-pg}"
PGHOST="${PGHOST:-/var/tmp}"
PGPORT="${PGPORT:-55432}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PGBIN:$PATH"

cleanup() { pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; }

if ! pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1; then
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"
  if [ "$(id -u)" = "0" ]; then
    id -u postgres >/dev/null 2>&1 || useradd -m postgres
    chown -R postgres:postgres "$PGDATA"
    su postgres -c "PATH=$PGBIN:\$PATH initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null
    su postgres -c "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-k $PGHOST -p $PGPORT -c listen_addresses=' -l $PGDATA/log start -w" >/dev/null
  else
    initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
    pg_ctl -D "$PGDATA" -o "-k $PGHOST -p $PGPORT -c listen_addresses=" -l "$PGDATA/log" start -w >/dev/null
  fi
  trap cleanup EXIT
fi

export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -h $PGHOST -p $PGPORT -U postgres -v ON_ERROR_STOP=1 -q"

DB="wallet_verify_$$"
$PSQL -d postgres -c "create database $DB" >/dev/null
trap "psql -h $PGHOST -p $PGPORT -U postgres -q -c 'drop database if exists $DB' >/dev/null 2>&1; cleanup" EXIT

echo "→ shim Supabase"
$PSQL -d "$DB" -f "$ROOT/scripts/supabase-shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL -d "$DB" -f "$f"
done

if compgen -G "$ROOT/tests/sql/*.sql" >/dev/null; then
  for f in "$ROOT"/tests/sql/*.sql; do
    echo "→ test $(basename "$f")"
    $PSQL -d "$DB" -f "$f"
  done
fi

echo "✅ schéma valide"
