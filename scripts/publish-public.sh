#!/usr/bin/env bash
# Publish a cleaned snapshot of this repo to the public repo https://github.com/menchelab/asdf10k-agentic-backend
# (fresh history there: one commit per publish; the full history and tags stay in this repo).
# Usage: npm run publish:public [-- --no-push]
# Cleaning: spike fixtures lose local paths and the names of the account's claude.ai connectors;
# .env, sessions, models and node_modules are never tracked anyway (git archive of HEAD).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${PUBLIC_REMOTE:-https://github.com/menchelab/asdf10k-agentic-backend.git}"
CHECKOUT="${PUBLIC_CHECKOUT:-$ROOT/../asdf10k-agentic-backend-public}"
PUSH=1; [[ "${1:-}" == "--no-push" ]] && PUSH=0
# never prompt (a hidden prompt would hang)
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=15}"

cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo "Commit your changes first (the snapshot is HEAD)."; exit 1; }
HASH=$(git rev-parse --short HEAD); DATE=$(date +%Y-%m-%d)
DESC=$(git describe --tags --always 2>/dev/null || echo "$HASH")
git ls-remote "$REMOTE" >/dev/null 2>&1 || { echo "Cannot reach $REMOTE without a prompt: gh auth login && gh auth setup-git"; exit 1; }

if [[ -d "$CHECKOUT/.git" ]]; then
  git -C "$CHECKOUT" fetch --quiet origin
  if git -C "$CHECKOUT" rev-parse --verify --quiet origin/main >/dev/null; then
    git -C "$CHECKOUT" checkout --quiet main && git -C "$CHECKOUT" reset --quiet --hard origin/main
  fi
else
  git clone --quiet "$REMOTE" "$CHECKOUT" 2>/dev/null || { mkdir -p "$CHECKOUT"; git -C "$CHECKOUT" init --quiet -b main; git -C "$CHECKOUT" remote add origin "$REMOTE"; }
fi

find "$CHECKOUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive HEAD | tar -x -C "$CHECKOUT"
rm -f "$CHECKOUT/scripts/publish-public.sh"   # the publish step itself is not part of the public repo
rmdir "$CHECKOUT/scripts" 2>/dev/null || true

# scrub the recorded SDK messages
for f in "$CHECKOUT"/spike/fixtures/*; do
  [[ -f "$f" ]] || continue
  sed -i '' -E -e 's#/home/lab/"]+/#/home/lab/#g' -e 's#"name":"claude\.ai [^"]*"#"name":"claude.ai connector"#g' "$f"
done
if grep -rqE "/Users/[a-z]|lbi-netmed|@gmail|univie" "$CHECKOUT" --exclude-dir=.git; then
  echo "Personal data left in the snapshot:"
  grep -rnE "/Users/[a-z]|lbi-netmed|@gmail|univie" "$CHECKOUT" --exclude-dir=.git | cut -c1-160 | head
  exit 1
fi

git -C "$CHECKOUT" add -A
if git -C "$CHECKOUT" diff --cached --quiet; then echo "Nothing changed."; else git -C "$CHECKOUT" commit --quiet -m "asdf10k-agentic-backend $DESC ($DATE)"; fi
echo "Snapshot prepared at $CHECKOUT ($DESC)"
if [[ $PUSH -eq 1 ]]; then
  git -C "$CHECKOUT" push --quiet -u origin main && echo "Pushed to $REMOTE"
else
  echo "Not pushed (--no-push). Push: git -C $CHECKOUT push -u origin main"
fi
