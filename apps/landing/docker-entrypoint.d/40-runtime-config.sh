#!/bin/sh
set -eu

raw_id="${UMAMI_WEBSITE_ID:-${VITE_UMAMI_WEBSITE_ID:-}}"
raw_url="${UMAMI_SCRIPT_URL:-${VITE_UMAMI_SCRIPT_URL:-}}"

# Restrict to safe identifier/URL characters so config.js is immune to injection.
clean_id="$(printf '%s' "$raw_id" | tr -cd 'A-Za-z0-9_-')"
clean_url="$(printf '%s' "$raw_url" | tr -cd 'A-Za-z0-9._:/-')"

cat > /usr/share/nginx/html/config.js <<EOF
window.__DARTCLIP_CONFIG__ = {"umamiWebsiteId":"${clean_id}","umamiScriptUrl":"${clean_url}"};
EOF
