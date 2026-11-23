# Maintainer guide

How to run, deploy and record the demo. Readers who only want to understand the system can skip
this folder.

Private values (the relayer key, API keys, the host address, the demo accounts' emails) live in
`.env`, which is never committed. `.env.example` lists every variable.

## Setup

Requires Node 24 and pnpm.

```sh
pnpm install
cp .env.example .env   # then fill in the values
```

## Run locally

```sh
pnpm chain                                             # terminal 1: local chain on :8545
cd contracts
pnpm exec hardhat run scripts/deploy.ts --network localhost
ORGANISER_ADDRESS=0x... pnpm exec hardhat run scripts/seed-event.ts --network localhost
cd ..
TICKETLOCK_NETWORK=local pnpm dev                      # terminal 2: app on http://localhost:3000
```

The organiser is fixed in the contract. Sign in to the app once with the organiser's email, get
that account's address with `pnpm account-address <email>` and pass it as `ORGANISER_ADDRESS`. The
local chain forgets everything when it stops, so deploy and seed again after a restart. The header
shows a LOCAL badge on this network.

## Deploy the contract to Base Sepolia

```sh
cd contracts
pnpm exec hardhat run scripts/deploy.ts --network baseSepolia
ORGANISER_ADDRESS=0x... pnpm exec hardhat run scripts/seed-event.ts --network baseSepolia
pnpm exec hardhat verify --network baseSepolia <contract> <issuer>
```

The scripts write `deployments/base-sepolia.json`, which the web app reads. A new contract starts
with a new database file under `data/`.

## Hosting

The live site runs on a small Linux VM as two systemd services, `ticketlock-app` and
`ticketlock-tunnel` (a Cloudflare Tunnel that gives it HTTPS on our domain without opening any
port). Both start on boot and restart on failure.

```sh
deploy/push.sh    # builds here, copies source and build output to TICKETLOCK_HOST, restarts the app
```

`deploy/provision.sh` is the one-time host setup. The host keeps its own `.env`, its database under
`/opt/ticketlock-demo/data`, and the tunnel ID in `/etc/cloudflared/tunnel.env`. The 1 GB host
cannot finish `next build`, which is why the build is done locally and copied.

**Run the tunnel in one place only.** While the host serves the site, do not run `pnpm tunnel` on
a laptop: a second connector would split visitors between two databases and two relayer workers.

To serve from a laptop instead: stop both services on the host, then run `pnpm build && pnpm start`
and `pnpm tunnel`. The app's URL must be listed under Allowed origins in the Privy dashboard.

## Recording the demo video

`recording/` drives the live app in three browser profiles (the organiser on a desktop page, two
customers on phone-sized pages), captures every frame and renders a captioned 1920×1080 video. It
needs Google Chrome and `ffmpeg`, and the three account emails in `.env`.

```sh
cd recording
node record.mjs setup    # sign the three accounts in once; one sign-in becomes the login clip
node record.mjs take     # buy, transfer, scan, admit: real Base Sepolia transactions
node render.mjs          # writes out/ticketlock-login.mp4, -demo.mp4, -full.mp4 and segments.txt
```

`setup` asks for each sign-in code through files in `/tmp/ticketlock-otp`: it writes
`need-<name>`, waits for `ready-<name>`, then reads the six digits from `code-<name>`. `take` can
be repeated; if one is interrupted, `node record.mjs tidy` uses up leftover tickets first. Run
`take` with `TICKETLOCK_SHOTS=1` to refresh the screenshots used by the diagrams, then
`node record.mjs scanshot` to retake the scanning screen with the entry code in focus. Both write
to `out/shots/`; copy the ones you want into `docs/diagrams/src/shots/`.

The phone is a desktop browser with a phone-sized page, and its camera is fed a generated clip
that closes in on the organiser's real entry code. The app, the signatures and the transactions
are real, and the video says so on screen.

## Checks

```sh
pnpm contracts:test     # 24 contract tests
pnpm web:test           # backend lifecycle against the local chain (needs pnpm chain running)
pnpm --filter @ticketlock/web typecheck
pnpm --filter @ticketlock/web lint
pnpm verify-ticket 1    # independent read of token 1 from https://sepolia.base.org
```
