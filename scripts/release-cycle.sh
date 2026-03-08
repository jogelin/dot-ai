#!/bin/bash
# Release cycle: push → release → update plugin → update kiwi → restart gateway
# Usage: ./scripts/release-cycle.sh [message]
set -e

cd "$(dirname "$0")/.."
MSG="${1:-Release cycle complete}"

echo "📦 Pushing..."
git pull --rebase origin main
git push origin main

echo "🚀 Triggering release..."
RUN_URL=$(gh workflow run Release 2>&1)
echo "$RUN_URL"

echo "⏳ Waiting for release..."
sleep 10
# Poll until done (max 5 min)
for i in $(seq 1 30); do
  LATEST=$(gh run list --workflow=Release --limit=1 --json status,conclusion -q '.[0]')
  STATUS=$(echo "$LATEST" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "completed" ]; then
    echo "✅ Release done"
    break
  fi
  sleep 10
done

echo "📥 Updating plugin..."
cd ~/.openclaw/extensions/dot-ai
npm install @dot-ai/adapter-openclaw@latest @dot-ai/core@latest 2>/dev/null

echo "📥 Updating kiwi/.ai/packages..."
cd ~/dev/kiwi/.ai/packages
npm install @dot-ai/ext-file-identity@latest @dot-ai/ext-file-skills@latest @dot-ai/ext-sqlite-memory@latest @dot-ai/ext-file-tools@latest @dot-ai/ext-file-prompts@latest @dot-ai/ext-rules-routing@latest @dot-ai/core@latest 2>/dev/null

echo "📥 Updating kiwi pnpm..."
cd ~/dev/kiwi
pnpm update @dot-ai/core @dot-ai/ext-file-identity @dot-ai/ext-file-skills @dot-ai/ext-sqlite-memory @dot-ai/ext-file-tools @dot-ai/ext-file-prompts @dot-ai/ext-rules-routing 2>/dev/null

echo "🔄 Restarting gateway..."
kill $(pgrep -f "openclaw.*gateway" | head -1) 2>/dev/null
sleep 2
openclaw gateway start 2>/dev/null &
sleep 5

echo "📊 Checking result..."
VERSION=$(cat ~/.openclaw/extensions/dot-ai/node_modules/@dot-ai/core/package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
echo "Installed version: $VERSION"

# Write result for agent to pick up
echo "{\"version\": \"$VERSION\", \"message\": \"$MSG\", \"timestamp\": \"$(date -Iseconds)\"}" > ~/.openclaw/logs/dot-ai-release-result.json
echo "✅ Done — $VERSION"
