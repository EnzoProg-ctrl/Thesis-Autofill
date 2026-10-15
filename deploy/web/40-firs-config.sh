#!/bin/sh
# Configure the web application from environment variables at start-up, so
# the published image works against any classifier and any Supabase project
# without being rebuilt. Runs on every start; changing a variable and
# restarting the container is enough.
#
#   FIRS_API_BASE      Classifier address, as seen from the browser.
#                      Default: http://localhost:7860
#   SUPABASE_URL       Supabase project. The image sets both to the public
#   SUPABASE_ANON_KEY  demo database; set both to use another project. Empty:
#                      the project in supabase-client.js (the real system).
set -eu

html=/usr/share/nginx/html

# Classifier. Both tenant pages set window.FIRS_API_BASE in an inline script
# before bert-api.js loads; only that URL is replaced.
api="${FIRS_API_BASE:-http://localhost:7860}"
for page in "$html/tenant/index.html" "$html/tenant/home.html"; do
  sed -i "s|window.FIRS_API_BASE = '[^']*'|window.FIRS_API_BASE = '${api}'|" "$page"
done
echo "firs-web: tenant pages will call the classifier at ${api}"

# Database. The project URL and anon key are constants in supabase-client.js.
url="${SUPABASE_URL:-}"
key="${SUPABASE_ANON_KEY:-}"
if [ -n "$url" ] && [ -n "$key" ]; then
  sed -i \
    -e "s|^const SUPABASE_URL *= *'[^']*'|const SUPABASE_URL  = '${url}'|" \
    -e "s|^const SUPABASE_ANON *= *'[^']*'|const SUPABASE_ANON = '${key}'|" \
    "$html/js/supabase-client.js"
  echo "firs-web: using Supabase project ${url}"
elif [ -n "$url" ] || [ -n "$key" ]; then
  echo "firs-web: set BOTH SUPABASE_URL and SUPABASE_ANON_KEY; keeping the built-in project" >&2
else
  echo "firs-web: using the Supabase project in supabase-client.js"
fi
