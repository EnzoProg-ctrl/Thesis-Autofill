#!/bin/sh
# Point the tenant pages at the classifier named in FIRS_API_BASE.
#
# Both pages set window.FIRS_API_BASE in an inline script before bert-api.js
# loads. Only that URL is replaced, so the pages are otherwise identical to the
# deployed site. Runs on every start, and matches any existing URL, so changing
# FIRS_API_BASE and restarting is enough.
set -eu

api="${FIRS_API_BASE:-http://localhost:7860}"

for page in /usr/share/nginx/html/tenant/index.html /usr/share/nginx/html/tenant/home.html; do
  sed -i "s|window.FIRS_API_BASE = '[^']*'|window.FIRS_API_BASE = '${api}'|" "$page"
done

echo "firs-web: tenant pages will call the classifier at ${api}"
