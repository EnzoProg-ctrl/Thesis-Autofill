# ============================================================
#  Web front end — Nepo Mall FIRS
#
#  Serves the static web application, the same files Vercel hosts, from
#  nginx. Pairs with the classifier image through docker-compose.yml at the
#  repository root.
#
#  Only web assets are copied. The inference service, database definitions
#  and deployment files stay out of the image, exactly as .vercelignore keeps
#  them off the public site.
#
#  Build from the repository root:
#      docker build -f deploy/web/Dockerfile -t firs-web .
# ============================================================
FROM nginx:1.27-alpine

COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/web/40-firs-config.sh /docker-entrypoint.d/40-firs-config.sh
# Strip Windows line endings if the script was checked out with them; a CR
# after the shebang stops it from running at all.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-firs-config.sh \
 && chmod +x /docker-entrypoint.d/40-firs-config.sh

WORKDIR /usr/share/nginx/html
RUN rm -rf ./*
COPY index.html register.html reset-password.html favicon.ico favicon.svg site.webmanifest ./
COPY admin/ admin/
COPY tenant/ tenant/
COPY css/ css/
COPY js/ js/
COPY img/ img/

# Where the browser reaches the classifier. Written into the tenant pages when
# the container starts (see 40-firs-config.sh), so one image works against
# a classifier on this machine or a hosted one.
ENV FIRS_API_BASE=http://localhost:7860

# Which Supabase project the site uses, also applied at start-up. The default
# is the public demo database (fictional data, demo accounts in README.md), so
# running the published image on its own never reaches the real system's
# data. Override both to use another project.
ENV SUPABASE_URL=https://qcrrxpflkdtdnylkzojj.supabase.co     SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjcnJ4cGZsa2R0ZG55bGt6b2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzI3MDQsImV4cCI6MjEwNzY0ODcwNH0.wnZ_tLkhQUGa-oue7JZwOUCqnsw2O3kEwk7ierF6PjM

EXPOSE 80
