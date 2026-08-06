# Personal Space — Architecture Decisions

REQUIREMENTS.md is the product contract and leaves most stack choices to the build. This file
records the choices that are now **fixed** for this project. Where REQUIREMENTS.md and this file
overlap, REQUIREMENTS.md still wins on *what* the product does; this file decides *how* it is built.

## Stack (fixed)

- **Frontend:** React + TypeScript, built with Vite, using the **TanStack** stack:
  - TanStack Router for navigation, TanStack Query for server state, TanStack Table for the
    database table view, and TanStack Form where a form is warranted. Use TanStack pieces where
    they fit; do not force them where a plain component is simpler.
- **Progressive Web App:** the frontend is an installable PWA — a web app manifest, icons, and a
  service worker (via `vite-plugin-pwa` or equivalent) so it installs and launches from a phone
  home screen. The app shell works offline; data still needs the backend. HTTPS is required for the
  service worker, so any hosted deployment must serve over HTTPS.
- **Backend:** Node + TypeScript. In development it runs as its own server; in production it also
  serves the built PWA static assets, so the whole app is one process behind one origin.
- **Storage:** a single **SQLite** database file. SQLite is single-writer, single-file — this suits
  one user on one server and rules out serverless/multi-instance hosting unless the database is
  swapped out (see below).
- **Testing:** unit tests on frontend and backend (Vitest is the natural fit for a Vite/Node/TS
  project); end-to-end tests with **Playwright** driving a real browser, under `e2e/`.

## Local run

The single documented command still starts everything locally with no accounts and no internet —
that requirement is unchanged. The PWA and hosting are additive, not a replacement.

## Hosting on AWS (personal use, cheapest first)

Goal: run this privately for yourself, cheaply, with the option to make it public later. Because
storage is SQLite (one file, one writer), the app wants **one small always-on server**, not a
serverless/multi-instance setup.

**Recommended — AWS Lightsail, smallest instance (~USD 5/month, fixed and predictable):**

1. Launch a Lightsail instance (Ubuntu, smallest bundle). Attach a static IP (free while attached).
2. Install Node, build the frontend, and run the Node server so it serves both the API and the PWA
   static build on one origin. Keep it alive with a process manager (`pm2` or a systemd unit).
3. Put **Caddy** in front for automatic HTTPS (free Let's Encrypt certificates) — the service
   worker needs HTTPS. Point a domain or a free dynamic-DNS hostname at the static IP.
4. Back up the SQLite file on a schedule (a cron job copying it to S3 is pennies).

**Free for the first 12 months — EC2 free tier** (`t3.micro`, 750 hours/month): identical setup on
an EC2 instance. Zero cost for a year, then roughly USD 7-9/month — so Lightsail is cheaper to keep
long-term, while EC2 is the choice if you want the first year free.

**Frontend-only cheap path (optional):** serve the built PWA from S3 + CloudFront (essentially free
at personal traffic, and HTTPS is handled for you) and run only the API on the small instance. More
moving parts; only worth it if you outgrow one box.

**Avoid for now:** Lambda / API Gateway / App Runner and other serverless options. They do not fit
a single SQLite file (no persistent local disk, many instances writing at once). If you later want
serverless or multi-device sync, swap SQLite for a hosted SQLite-compatible service such as
Turso/libSQL (free tier) or a small Postgres such as Neon (free tier), then serverless becomes
viable.

**Domain and TLS:** a `.com` via Route 53 is about USD 12/year; TLS is free via Caddy/Let's Encrypt
on the instance, or via CloudFront + ACM on the S3 path. A free subdomain also works for private use.
