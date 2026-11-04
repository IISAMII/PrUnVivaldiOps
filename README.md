# PrUnVivaldiOps

Vivaldi Ops: a private-use dashboard for the Prosperous Universe company Vivaldi II.

- `docs/` is the site (GitHub Pages). `docs/index.html` is one self-contained page; `docs/data/` holds the data it reads.
- `.github/workflows/snapshot.yml` runs `scripts/snapshot.cjs` about every 30 minutes. It reads FIO (secret `FIO_KEY`), writes `docs/data/latest.json`, `history.json`, `alerts.json`, and sends urgent alerts through ntfy (secret `NTFY_TOPIC`).
- `docs/data/settings.json`, `cash.json`, `adjust.json`, `bases.json`, `finch.json` are your own entries, saved from the page with a fine-grained token.
