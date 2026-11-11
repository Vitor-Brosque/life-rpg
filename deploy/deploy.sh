#!/usr/bin/env bash
# Sends the committed state of the current branch to the home_lab and rebuilds the container.
# Uses `git archive` (works from Git Bash on Windows, where rsync is not available).
# Only committed files are sent; the server's ./data folder is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE_DIR='~/projects/life-rpg'

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Aviso: há alterações não commitadas; só o que está commitado será enviado." >&2
fi

echo "Enviando $(git rev-parse --short HEAD) para homelab:${REMOTE_DIR} ..."
git archive --format=tar HEAD | ssh homelab "mkdir -p ${REMOTE_DIR} && tar -xf - -C ${REMOTE_DIR}"

echo "Construindo e subindo o container ..."
ssh homelab "cd ${REMOTE_DIR} && (docker compose up -d --build || sudo -n docker compose up -d --build) && (docker compose ps || sudo -n docker compose ps)"

echo "Pronto. Verifique: ssh homelab \"curl -s http://127.0.0.1:8787/api/health\""
