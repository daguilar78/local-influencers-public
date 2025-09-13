#!/usr/bin/env bash
set -euo pipefail

# Config
PUBLIC_REPO="git@github.com:daguilar78/local-influencers-public.git"

# Workspace
ROOT="$(git rev-parse --show-toplevel)"
MIRROR_DIR="${ROOT}/.mirror_publish"

rm -rf "$MIRROR_DIR"
mkdir -p "$MIRROR_DIR"

# Export a clean snapshot of HEAD (tracked files only)
rsync -a --delete \
  --exclude-from="${ROOT}/.mirrorignore" \
  --exclude ".git" \
  "${ROOT}/" "${MIRROR_DIR}/"

pushd "$MIRROR_DIR" >/dev/null

# Initialize a fresh repo & push as a single squashed commit
git init
git config user.name "mirror-bot"
git config user.email "mirror-bot@users.noreply.github.com"
git add -A
git commit -m "mirror: $(git -C "$ROOT" rev-parse --short HEAD)"
git branch -M main
git remote add origin "$PUBLIC_REPO"
git push -f origin main

popd >/dev/null
echo "✔ Pushed public mirror to $PUBLIC_REPO"
