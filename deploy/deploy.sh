#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rsync -az --delete --exclude node_modules --exclude data --exclude .git ./ homelab:~/projects/life-rpg/
ssh homelab 'cd ~/projects/life-rpg && docker compose up -d --build && docker compose logs --tail 20'
