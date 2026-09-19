# BIP47 & PayNyms

The source for **[paymentcode.io](https://paymentcode.io)** — a hub for BIP47 reusable
payment codes and PayNym identity, with a terminal-style cypherpunk interface.

Node/Express server, vanilla HTML/CSS/JS frontend, no build step.

## What's here

| Page | Path | What it does |
|------|------|--------------|
| **Hub** | `/` | Six-card showcase and the supported-by wall |
| **Auth47 Login** | `/auth` | Sign in with a Bitcoin wallet — no username, no password |
| **BIP47 Lab** | `/lab` | Payment code validator with byte-level analysis, an interactive "Alice pays Bob" walkthrough, and a signed-message verifier |
| **PayNym Explorer** | `/paynym` | Search PayNyms, browse payment codes, followers and following |
| **Guestbook** | `/guestbook` | Leave a message, authenticated with your wallet (MongoDB-backed) |
| **Documentation** | `/docs` | BIP47 and Auth47 reference, plus this site's API |
| **About** | `/about` | What BIP47 is and why address reuse costs you privacy |

## Requirements

**Node 24 or later.** `@dojo-tools/*` declares `engines: >=24`; `.nvmrc` pins it, so
`nvm use` in the repo root selects the right version. The app does run on Node 22 —
the test suite passes there — but the floor matches what the dependencies ask for.

MongoDB is optional. Without it the server starts normally and only the guestbook
is disabled.

## Quick start

```bash
npm install
npm start          # http://localhost:3000
```

## Tests

```bash
npm test
```

Regression tests for the Auth47 resource binding (see [Security](#security)). They
spawn a real server and relay a genuinely-signed proof at it. If the binding is
ever removed, three of them fail.

## Configuration

Create a `.env` file, or set these in your host's environment.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `CALLBACK_URL` | Auth47 callback URL. **Also the resource every proof is checked against**, so it must be the site's real public URL in production | `http://localhost:$PORT/callback` |
| `MONGODB_URI` | Guestbook storage. Omit to run without it | `mongodb://localhost:27017/bip47-guestbook` |
| `ONION_ADDRESS` | Hidden service address. When set, an `Onion-Location` header is sent so Tor Browser offers the onion site | unset |
| `PAYNYM_ORIGIN` | Upstream PayNym API origin. Exists so the proxy can be pointed at a stub in tests | `https://paynym.rs` |

`NODE_ENV` is not read by the application.

## API

### Auth47

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/start-auth` | Generate a challenge (nonce, expiry, QR) |
| `GET` | `/check-auth/:nonce` | Poll authentication status |
| `POST` | `/verify` | Verify a wallet's proof |
| `POST` | `/callback` | Wallet callback; same verification as `/verify` |

### PayNym

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/paynym/lookup` | Look up a PayNym by nymID or name |
| `POST` | `/api/paynym/followers` | Batch follower details (max 50 ids) |
| `GET` | `/api/paynym/avatar/:code` | Proxy and cache an avatar |

### BIP47 tools

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/bip47/validate` | Validate a payment code's format, checksum and version |
| `POST` | `/api/bip47/verify-message` | Verify a message signed by a payment code's notification address |
| `GET` | `/api/qr` | Generate a QR code for arbitrary text |

### Guestbook

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/guestbook/messages` | List messages |
| `POST` | `/api/guestbook/submit` | Submit a message (requires a verified Auth47 nonce) |

### System

`GET /health` returns status and whether the database is connected.

A valid 116-character test payment code, generated from a throwaway seed:

```
PM8TJJwnXi1t3jv52qM2MMZFWa8wJhj8eyZYcC5cjzEfzENMrxJM9fbnQANqmUSptJdiQmoScyf3Y41SGTPHWpf9PLDVvSSq2UEa8WympaepqxETMgPW
```

```bash
curl -X POST http://localhost:3000/api/bip47/validate \
  -H 'Content-Type: application/json' \
  -d '{"paymentCode":"PM8TJJwnXi1t3jv52qM2MMZFWa8wJhj8eyZYcC5cjzEfzENMrxJM9fbnQANqmUSptJdiQmoScyf3Y41SGTPHWpf9PLDVvSSq2UEa8WympaepqxETMgPW"}'
```

## Project structure

```
paymentcode-website/
├── public/
│   ├── *.html              # One file per page, markup only
│   ├── css/                # One stylesheet per page
│   ├── js/                 # One script per page, plus common.js
│   ├── styles.css          # Shared design system and @font-face
│   ├── fonts/              # Self-hosted variable fonts
│   └── logos/              # Supported-by logos
├── test/                   # Auth47 regression tests
├── scripts/setup-tor.sh    # One-time hidden service setup
├── tor/torrc               # Hidden service config
├── server.js               # Express server, all backend logic
└── AGENTS.md               # Detailed guide for contributors and AI agents
```

There are **no inline `<style>` or `<script>` blocks and no inline event handlers** —
the CSP sets `script-src 'self'`, so an `onclick=""` attribute simply will not fire.
Pages declare behaviour with `data-action` attributes and register handlers via
`common.js`. See AGENTS.md before adding frontend code.

## Security

### Auth47 proofs are bound to this site

`Auth47Verifier.verifyProof()` answers *"is this signed?"*, not *"is this signed **for
me**?"*. It checks that a challenge's `r` (resource) parses as a URL, but it cannot
know which URL is yours.

Without comparing `r` against your own callback URL, an attacker can request a live
nonce from your server, show a victim the same challenge with `r` naming the
attacker's site, and relay the victim's genuine signature back to you — opening a
session in the victim's name. Nonce expiry, single use and a valid signature do not
prevent this.

Every proof therefore goes through `verifyAuth47Proof(proof, expectedResource)`, which
takes the expected resource as a **required** argument and throws without it. Both
`/verify` and `/callback` use it. Never call `verifier.verifyProof()` directly.

> Reported by maxtannahill of [The Dojo Bay](https://dojobay.org). If you are
> implementing Auth47 yourself, this check is yours to write — no version of the
> library does it for you.

### Other measures

- **Rate limiting** on every externally reachable endpoint, tuned per cost
- **Input bounds** before any value reaches a library or an upstream URL: 32 kb JSON
  bodies, 500-character guestbook messages, 50 follower ids per request, 512-character
  QR text, 8-second upstream timeouts
- **CSP** with `script-src 'self'` — no `unsafe-inline` for scripts
- **CORS** opened only on read-only lookup endpoints; auth and guestbook writes stay
  same-origin
- Nonces expire after five minutes and are single use
- No private keys are ever handled or stored; payment codes are public by design

## Privacy

This is a privacy tool, so the site tries not to leak its own visitors:

- **Avatars are proxied**, never linked straight to `paynym.rs`. Linking them directly
  would hand a third party every visitor's IP and referer.
- **Fonts are self-hosted.** No Google Fonts, no CDN.
- **No analytics, no trackers, no third-party requests of any kind.**
- **Tor hidden service.** With `ONION_ADDRESS` set, an `Onion-Location` header lets
  Tor Browser offer the onion site automatically.

## Deployment

Production runs on a VPS under [pm2](https://pm2.keymetrics.io/), with a Tor hidden
service alongside it.

```bash
git pull
npm ci                     # respects package-lock.json
pm2 restart bip47          # or: pm2 start server.js --name bip47
pm2 logs bip47
```

Configuration comes from a `.env` file in the repo root, loaded automatically by
`dotenv`. At minimum set `CALLBACK_URL` to the real public URL — it is the resource
every Auth47 proof is verified against, so a wrong value means every login fails —
plus `MONGODB_URI` if you want the guestbook and `ONION_ADDRESS` once Tor is set up.

```
CALLBACK_URL=https://paymentcode.io/callback
MONGODB_URI=mongodb://localhost:27017/bip47-guestbook
ONION_ADDRESS=yourhiddenservice.onion
```

To survive a reboot:

```bash
pm2 save
pm2 startup                # then run the command it prints
```

### Reverse proxy

The app listens on `PORT` (default 3000) and speaks plain HTTP; TLS is terminated in
front of it. `server.js` sets `trust proxy` to `1`, meaning it trusts exactly one
proxy hop for the client IP.

**That number must match your setup.** Rate limiting keys on `req.ip`: with no proxy
in front, a client could spoof `X-Forwarded-For` and bypass the limits; with two hops
(a CDN in front of nginx, say), every request would appear to come from the same
address and legitimate users would rate-limit each other.

### Tor hidden service

For a VPS running the app behind systemd. Run once, as root, from the repo root:

```bash
sudo bash scripts/setup-tor.sh
```

It installs Tor, deploys `tor/torrc`, starts the service and prints the generated
`.onion` address. Add that to the VPS `.env` as `ONION_ADDRESS` and restart the app.
Back up `/var/lib/tor/hidden_service` — losing the key means losing the address.

## Contributing

Read **AGENTS.md** first; it documents the frontend conventions, request limits and
the Auth47 binding rule in detail.

1. Branch from `master`
2. Make your change
3. `npm test` and `npm start`, and check the browser console
4. Open a pull request

Corrections to the documentation are especially welcome — the Auth47 gap above was
found by someone implementing from `/docs` and reporting what was missing.

## Dependencies

| Package | Role |
|---------|------|
| `express` | Web server |
| `@bitcoinerlab/secp256k1` | secp256k1 implementation |
| `@dojo-tools/bip47` | BIP47 payment codes |
| `@dojo-tools/auth47` | Auth47 protocol |
| `@dojo-tools/bitcoinjs-message` | Bitcoin message signing and verification |
| `mongodb` | Guestbook storage |
| `qrcode` | QR generation |
| `express-rate-limit` | Per-endpoint rate limiting |
| `cors`, `dotenv` | CORS, `.env` loading |

The `@dojo-tools` packages were previously `@samouraiwallet/*`, before the projects
moved to the [dojo-tools](https://github.com/Dojo-Open-Source-Project/dojo-tools)
monorepo. The public API is unchanged across that move.

## License

GNU Affero General Public License v3.0 (`AGPL-3.0-only`). See [`LICENSE`](LICENSE).

This matches the licensing of the Dojo Open Source Project's network-served
applications, such as [samourai-dojo](https://github.com/Dojo-Open-Source-Project/samourai-dojo)
and [soroban](https://github.com/Dojo-Open-Source-Project/soroban). Because this
project is run as a network service, AGPL section 13 requires that users
interacting with a modified version over a network be able to obtain its source;
the footer on every page links back to this repository for that reason.

## Links

- **BIP47 specification** — [bips/bip-0047](https://github.com/bitcoin/bips/blob/master/bip-0047.mediawiki)
- **PayNym API** — see `paynym-api.md`
- **Issues** — [github.com/linkinparkrulz/paymentcode-website/issues](https://github.com/linkinparkrulz/paymentcode-website/issues)
