#!/usr/bin/env bash
# OnCue — one-shot setup. Installs all deps and prepares env files.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Installing root deps (concurrently)"
npm install

echo "==> Installing server deps"
npm --prefix server install

echo "==> Installing client deps"
npm --prefix client install

if [ ! -f server/.env ]; then
  echo "==> Creating server/.env (set your GROQ_API_KEY in this file)"
  cp .env.example server/.env
fi

if [ ! -f client/.env ]; then
  echo "==> Creating client/.env"
  cp client/.env.example client/.env
fi

echo ""
echo "Setup complete."
echo "Next: edit server/.env and set GROQ_API_KEY, then run:  npm run dev"
