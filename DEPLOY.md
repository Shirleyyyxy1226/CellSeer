# CellSeer Deployment

Two-container production stack: FastAPI + built React frontend in one image,
PostgreSQL in a sidecar container, shared bearer token for auth.

Three ways to expose it to the public internet — pick one:

- **Path A — Mac (or other Unix box) via Cloudflare Tunnel.**
  No router config, no port forwarding, no Let's Encrypt. Cloudflare terminates
  TLS at the edge and the connector container opens an outbound tunnel from
  your machine to Cloudflare. Works behind any NAT.
- **Path B — Cloud VM with Caddy.** Classic setup: a Linux box with a public IP,
  your domain's A-record points at it, Caddy handles TLS via Let's Encrypt.
- **Path C — Windows PC via Cloudflare Tunnel.** Same idea as Path A but with
  Docker Desktop on Windows (WSL2 backend). Best balance of "uses hardware I
  already own" + "actually works reliably." Recommended for anyone with a
  spare Windows box at home/office.

The bearer-token, backups, sharing, and updating sections at the bottom apply
to all three paths.

---

## Path A — Mac (or any machine) via Cloudflare Tunnel

### A1. Install Docker Desktop

```bash
brew install --cask docker
open -a Docker
```

Open Docker Desktop → Settings → General → **enable "Start Docker Desktop when
you log in"**. Wait for the whale icon in the menu bar to stop animating.

> Free disk reminder: Docker Desktop reserves ~5 GB by default plus image
> storage. `df -h /` first — your machine needs ~10 GB headroom after install.

### A2. Create a Cloudflare Tunnel

In the Cloudflare dashboard:

1. **Zero Trust → Networks → Tunnels → Create a tunnel.** Connector type:
   `Cloudflared`. Name it `cellseer` (or anything).
2. On the **Install connector** screen, switch to the **Docker** tab and copy
   the long string after `--token`. That's your `CF_TUNNEL_TOKEN`.
3. Click **Next**. Add a **Public Hostname**:
   - Subdomain: *(leave empty for the apex)*
   - Domain: `cellseer.com`
   - Service: **Type** `HTTP`, **URL** `app:8000`
   - (Optional) repeat with subdomain `www` if you also want `www.cellseer.com`.
4. Click **Save tunnel**. Cloudflare auto-creates the CNAME DNS record for you;
   you do **not** need to add anything to DNS manually.
5. Cloudflare's orange-cloud proxy is the default and correct setting — leave it on.

### A3. Configure the repo

```bash
cd ~/Downloads/CellSeer        # or wherever your clone lives
cp .env.example .env

# Generate a strong shared bearer token
echo "CELLSEER_API_TOKEN=$(openssl rand -hex 32)" >> .env

# Open .env in $EDITOR and set:
#   POSTGRES_PASSWORD=<a strong password, e.g. CellSeer2026>
#   CELLSEER_DOMAIN=cellseer.com
#   CELLSEER_ALLOWED_ORIGINS=https://cellseer.com
#   CF_TUNNEL_TOKEN=<paste the long token from step A2.2>
#   DATALAB_API_KEY=<your DIGIBAT key, or leave blank>
```

### A4. Build and start

The Dockerfile expects the React SPA to be pre-built on the host (avoids
running both `npm` and `pip` simultaneously in a tiny VM):

```bash
# One-time: install Node deps and build the SPA bundle.
( cd frontend && npm install && npm run build )

# Now build the Python image and bring the stack up.
docker compose build app
docker compose --profile cloudflared up -d
docker compose --profile cloudflared logs -f
```

When the frontend changes, repeat the `npm run build` step then
`docker compose build app && docker compose up -d app` to publish a new
image. The `cloudflared` container is untouched by app rebuilds.

Healthy output looks like:

```
app           | INFO:     Uvicorn running on http://0.0.0.0:8000
cloudflared   | Registered tunnel connection ...
cloudflared   | Tunnel connection registered
```

Open `https://cellseer.com` — you should land on the SPA shell. (You'll get a
401 from any API call until you append `?token=...`; see "Sharing access" below.)

### A5. Auto-start at every login

Once you've confirmed the stack works manually:

```bash
./scripts/install_launch_agent.sh
```

This:
- Writes `~/Library/LaunchAgents/com.cellseer.app.plist` pointing at this repo.
- Runs `scripts/launch_mac.sh` on every user login.
- `launch_mac.sh` waits up to 2 min for Docker Desktop to come up, then runs
  `docker compose --profile cloudflared up -d`.

Verify:

```bash
launchctl list | grep com.cellseer
tail -f ~/Library/Logs/cellseer.log
```

To disable later: `launchctl unload ~/Library/LaunchAgents/com.cellseer.app.plist`.
To re-enable after edits: rerun `./scripts/install_launch_agent.sh`.

### A6. Keep the Mac awake (one-time)

The site is unreachable when the Mac sleeps. From the **Settings → Lock Screen
& Battery** pane:

- **Battery (laptops):** "Prevent sleeping when the display is off" — on.
- **Power Adapter:** turn the display sleep timer to "Never," or at least set
  the system sleep slider all the way to "Never." Display can still sleep.
- **Optional, recommended on laptops:** install Amphetamine from the App Store
  and create a session that activates while Docker is running. Cheaper than
  fiddling with `pmset`.

Verify with `pmset -g` — `sleep` should be `0` on AC power.

### A7. Move on to "All paths" sections below

Skip down to **Sharing access**, **Backups**, and **Updating** — they apply to
all three paths.

---

## Path B — Cloud VM with Caddy

### B1. Provision a host (5 min)

Any Linux box with Docker + ports 80/443 reachable. Sized for v1:

- **2 vCPU / 2 GB RAM / 40 GB SSD.** Examples:
  - Hetzner CX22 — €4.51/mo
  - DigitalOcean Basic — $6/mo

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out / back in
```

### B2. Point DNS at the host

In Cloudflare for `cellseer.com`:

- **A record** `cellseer.com` → your VM's IPv4.
- **Set the proxy status to DNS-only (grey cloud).** Required so Caddy can
  complete the Let's Encrypt HTTP-01 challenge on port 80. Once HTTPS is up
  and stable, flip back to proxied (orange cloud) if you want Cloudflare's
  CDN/WAF in the path.

```bash
dig +short cellseer.com   # should print your VM's IP
```

### B3. Configure and start

```bash
git clone https://github.com/<you>/CellSeer.git
cd CellSeer
cp .env.example .env
echo "CELLSEER_API_TOKEN=$(openssl rand -hex 32)" >> .env
# Edit .env: set POSTGRES_PASSWORD, CELLSEER_DOMAIN, CELLSEER_ALLOWED_ORIGINS, DATALAB_API_KEY
# Leave CF_TUNNEL_TOKEN empty.

# The Dockerfile copies a host-built frontend/dist (see Path A step A4
# for the rationale); build it first on this VM.
( cd frontend && npm install && npm run build )

docker compose build app
docker compose --profile caddy up -d
docker compose --profile caddy logs -f
```

First boot: Caddy takes ~20–60 s to obtain the cert. Look for
`certificate obtained successfully` in the Caddy logs.

---

## Path C — Windows PC via Cloudflare Tunnel

Recommended over Path A in practice: Docker Desktop on Windows uses the
WSL2 backend, which is far more reliable than Docker Desktop's macOS
virtualization layer. Windows boxes also typically have more RAM headroom
for the build step.

### C1. Prerequisites

- Windows 10 (version 2004+) or Windows 11.
- Admin rights (one-time, to install Docker Desktop + WSL2).
- ~5 GB free disk (Docker Desktop + image + a bit of headroom).

### C2. Install Docker Desktop

1. Download from <https://www.docker.com/products/docker-desktop/>
   (the page auto-detects Windows; pick the Windows AMD64 installer).
2. Run the installer. On the configuration screen, **leave "Use WSL 2
   instead of Hyper-V" checked.** It's the default and what we want.
3. After install completes, Windows will ask you to sign out / restart.
   Do it.
4. Open **Docker Desktop** from the Start menu. Accept the TOS. Skip
   any sign-in prompts (account is not required).
5. Once Docker Desktop is up (whale icon in the system tray, "Engine
   running"), go to **Settings (gear icon) → General → enable "Start
   Docker Desktop when you log in."** This is the *only* auto-start
   wiring we need — see C7 below.

### C3. Get the CellSeer repo onto Windows

Pick whichever is easiest for you:

- **Git clone (recommended):** if your repo is on GitHub, just
  `git clone https://github.com/<you>/CellSeer.git` in a PowerShell or
  WSL terminal. Install Git from <https://git-scm.com/download/win> if
  needed. Clone the repo into your Windows user folder, e.g.
  `C:\Users\<you>\CellSeer`. **Do not** clone into a network share or
  OneDrive folder — Docker bind-mount performance is terrible there.
- **Copy from your Mac:** zip the folder (excluding `.venv/`,
  `node_modules/`, `data_lake/`, `frontend/dist/`) and copy via USB
  stick, AirDrop-to-iCloud-Drive, or a shared SMB folder. Same caveat:
  unzip into your local profile, not into a cloud-synced folder.

In either case, **do NOT copy `.env` or `backend/.env`** — recreate them
fresh on Windows (next step) so secrets don't accidentally travel
through cloud sync or git history.

### C4. Configure `.env` on Windows

Open **PowerShell** (Start menu → search "PowerShell"), then:

```powershell
cd $HOME\CellSeer
Copy-Item .env.example .env
notepad .env
```

In Notepad, fill in:

- `POSTGRES_PASSWORD=` — a strong password (e.g. `CellSeer2026`). Required;
  docker-compose refuses to start without it.
- `CELLSEER_DOMAIN=cellseer.com`
- `CELLSEER_ALLOWED_ORIGINS=https://cellseer.com`
- `CELLSEER_API_TOKEN=` — generate a fresh one (don't reuse the one we
  pasted in chat earlier). In PowerShell:
  ```powershell
  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
  ```
  Copy the 64-character string into `CELLSEER_API_TOKEN=`.
- `CF_TUNNEL_TOKEN=` — paste the same connector token from the Cloudflare
  dashboard. (If you don't have it written down, re-open the tunnel in
  Cloudflare → click "Configure" → "Install connector" → Docker tab.)
- `DATALAB_API_KEY=` — your DIGIBAT API key. If you have it on the Mac
  at `backend/.env`, copy that value across by hand. If not, you can
  leave it empty for now and add later.

Save and close Notepad.

### C5. Build the frontend on Windows

Install Node.js once (any version 20+) from <https://nodejs.org/>, then:

```powershell
cd $HOME\CellSeer\frontend
npm install
npm run build
cd ..
```

(If you'd rather, you can build the frontend on the Mac and copy
`frontend/dist/` over — it's just JS/CSS, architecture-agnostic.)

### C6. Build the image and start the stack

```powershell
docker compose build app
docker compose --profile cloudflared up -d
docker compose --profile cloudflared logs -f
```

Healthy output:

```
app           | INFO:     Uvicorn running on http://0.0.0.0:8000
cloudflared   | Registered tunnel connection ...
```

Open `https://cellseer.com/?token=<your-token>` in any browser — that
should land you on the SPA. Cloudflare dashboard's tunnel page should
show the connector as **Active**.

### C7. Auto-start at every reboot

You already did the work in C2 by enabling "Start Docker Desktop when
you log in." The compose file's `restart: unless-stopped` policy then
means **the containers come back automatically** whenever Docker Desktop
itself starts up — no Task Scheduler entry, no PowerShell script, no
extra wiring needed.

Verify by rebooting once. After login, give Docker Desktop ~60 seconds
to warm up, then hit `https://cellseer.com/?token=...` from your phone.

### C8. Keep the Windows machine awake

Settings → **System → Power & battery → Screen and sleep**:

- "When plugged in, turn off my screen after" — your preference (display
  can sleep, the OS shouldn't).
- "When plugged in, put my device to sleep after" — set to **Never**.

Optional but recommended on laptops: **Settings → System → Power &
battery → Power mode → Best performance** (keeps the CPU responsive for
the tunnel + Docker VM even under low load).

If you want extra-paranoid uptime, also disable Windows automatic
restart for updates:

```powershell
# Run as Administrator
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Name "ActiveHoursStart" -Value 0 -PropertyType DWord -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" -Name "ActiveHoursEnd"   -Value 23 -PropertyType DWord -Force
```

(That declares "active hours" 0–23, telling Windows it must not auto-
reboot for updates at any time. Updates still install, just no reboot
until you do it manually.)

### C9. Move on to "All paths" sections below

Skip down to **Sharing access**, **Backups**, and **Updating** — they
apply to all three paths. The Windows-specific notes for those sections
are inlined where relevant.

---

## All paths: sharing access

The frontend has no login UI. You hand out a one-time URL:

```
https://cellseer.com/?token=<value-of-CELLSEER_API_TOKEN>
```

The SPA captures `?token=...` on first load, strips it from the address bar,
and stores it in `localStorage`. Every subsequent `/api/*` call sends it via
the `Authorization: Bearer` header.

To rotate the token:

```bash
NEW="$(openssl rand -hex 32)"
sed -i.bak "s|^CELLSEER_API_TOKEN=.*|CELLSEER_API_TOKEN=$NEW|" .env
docker compose --profile <caddy|cloudflared> up -d --force-recreate app
# Hand out: https://cellseer.com/?token=$NEW
```

Browsers still holding the old token will get 401s; the frontend auto-clears
bad tokens on a 401, so users just need the new link to recover.

---

## All paths: seeding data

The PostgreSQL schema is created automatically on first startup — no migration
script needed. Start fresh by uploading your metadata and cycling files through
the UI, or copy across an existing Parquet data lake:

```bash
# Copy a local data_lake/ tree into the running container's volume.
# Path A (Mac, local Docker Desktop):
docker compose cp ./data_lake app:/data/data_lake
docker compose restart app

# Path B (cloud VM — scp first, then copy into the container):
scp -r ./data_lake user@vm:~/CellSeer/data_lake
# (on the VM)
docker compose cp ./data_lake app:/data/data_lake
docker compose restart app
```

Or run an initial DIGIBAT sync to pull data from upstream:

```bash
docker compose exec app python backend/scripts/sync_digibat.py \
  --base-url "$DATALAB_BASE_URL" \
  --api-key  "$DATALAB_API_KEY"
```

---

## All paths: backups

Runtime state lives across two named volumes: `pg-data` (PostgreSQL) and
`cellseer-data` (Parquet files). The nightly script dumps the database with
`pg_dump` and prunes old copies:

```bash
# Run a backup now (DATABASE_URL is injected from the compose environment):
docker compose exec -T app /app/scripts/backup.sh
```

### Path A (Mac) — cron equivalent via launchd

```bash
# Edit your user crontab; the host's `docker compose` runs as you.
crontab -e
# Add (3 AM local time):
0 3 * * *  cd /Users/<you>/Downloads/CellSeer && /usr/local/bin/docker compose exec -T app /app/scripts/backup.sh >> ~/Library/Logs/cellseer-backup.log 2>&1
```

(Adjust the docker path: `which docker` to find it. With Docker Desktop on
Apple Silicon it's usually `/usr/local/bin/docker`.)

For off-host backups, copy the volume's backups directory out periodically
(Time Machine, iCloud, rsync to an external drive, etc.):

```bash
docker run --rm \
  -v cellseer_cellseer-data:/data:ro \
  -v "$HOME/CellSeerBackups":/dest \
  alpine sh -c "cp -a /data/backups/. /dest/"
```

### Path B (cloud VM) — host crontab

```cron
0 3 * * *  cd /home/<you>/CellSeer && docker compose exec -T app /app/scripts/backup.sh >> /var/log/cellseer-backup.log 2>&1
```

### Path C (Windows) — Task Scheduler

Create a daily 3 AM task that runs the backup script inside the container.
From an **Administrator PowerShell** prompt:

```powershell
$repo = "$HOME\CellSeer"   # adjust if you cloned elsewhere
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -Command `"cd '$repo'; docker compose exec -T app /app/scripts/backup.sh`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
Register-ScheduledTask -TaskName "CellSeerBackup" `
    -Action $action -Trigger $trigger -Settings $settings `
    -Description "Nightly pg_dump backup of CellSeer" -User $env:USERNAME -RunLevel Highest
```

For off-host copies, have the Task Scheduler entry also `Copy-Item` the dump
files out to a folder synced by OneDrive / File History. The backup script
writes gzipped dumps into the `cellseer-data` volume; Docker Desktop exposes
that volume under
`\\wsl$\docker-desktop-data\data\docker\volumes\cellseer_cellseer-data\_data\backups`
on Windows.

---

## All paths: updating to a new app version

```bash
git pull
docker compose build app
docker compose --profile <caddy|cloudflared> up -d app
```

Data volume, Caddy / cloudflared, and tunnel auth are all untouched.

---

## Troubleshooting

**`docker compose` fails with "POSTGRES_PASSWORD must be set."**
Open `.env` and add `POSTGRES_PASSWORD=<your-password>`. Any non-empty string works;
use the same value on every restart so the database can be unlocked.

**App starts but every API call returns 500 / "could not connect to server".**
The `app` container started before PostgreSQL was ready, or `POSTGRES_PASSWORD`
in `.env` doesn't match what the `db` container was initialised with.
- `docker compose logs db` — look for "database system is ready to accept connections."
- If the password was changed after the volume was created, remove the volume and
  re-upload data: `docker compose down -v && docker compose up -d`.

**`docker compose --profile cloudflared up -d` fails with "CF_TUNNEL_TOKEN must be set."**
Open `.env`, ensure `CF_TUNNEL_TOKEN=<long-string>` with no quotes / whitespace.

**Cloudflare dashboard shows the tunnel as "Inactive."**
The cloudflared container isn't running, or it can't reach Cloudflare's edge:
- `docker compose logs cloudflared` — look for the actual error.
- Most common cause: the token in `.env` doesn't match the tunnel you created.
  Recopy from the dashboard's Docker tab and `docker compose up -d --force-recreate cloudflared`.

**Tunnel is "Active" but `https://cellseer.com` shows a 502.**
The Public Hostname rule's service URL is wrong. In the Cloudflare dashboard,
edit the tunnel → Public Hostnames → check the rule for `cellseer.com`. The
service should be `HTTP` and the URL exactly `app:8000`. Hostname `app` matches
the docker-compose service name.

**Caddy keeps failing to get a cert (Path B).**
- DNS still pointing at the wrong IP? `dig +short cellseer.com`
- Cloudflare proxy enabled? Switch to DNS-only for the first cert.
- Port 80 blocked at the cloud provider's firewall? Open it.

**`401 Missing or invalid API token` on every request.**
- Confirm: `docker compose exec app env | grep TOKEN`
- Confirm the URL you sent uses the same value (no quotes / whitespace).
- If you rotated the token, hand users the new URL.

**Frontend loads but every API call shows CORS errors.**
- Set `CELLSEER_ALLOWED_ORIGINS=https://cellseer.com` in `.env` and
  `docker compose up -d --force-recreate app`. Empty value falls back to
  localhost-only.

**Mac: site goes down at night.**
- The Mac is sleeping. Recheck step A6. `pmset -g sleep` on AC should be 0.

**Windows: site goes down when I'm not at the PC.**
- Windows is sleeping. Recheck step C8. `Settings → System → Power & battery
  → Screen and sleep → "When plugged in, put my device to sleep after"`
  should read **Never**.

**Windows: `docker compose` works in PowerShell but containers aren't running
after a reboot.**
- Confirm Docker Desktop is set to start at login (C2 step 5). Right-click
  the system-tray whale → **Settings → General**.
- Confirm containers were created with `restart: unless-stopped` — they will
  be if you brought them up with the compose file in this repo. Inspect with
  `docker inspect cellseer-app-1 | findstr RestartPolicy`.

**Upload of a large NEWARE file fails (Path B / Caddy only).**
- Raise `request_body { max_size 1GB }` in `Caddyfile` and
  `docker compose restart caddy`. (Cloudflare Tunnel has its own ~100 MB
  request limit on the free plan — if you hit that, you'll need to
  upload via a different channel or upgrade.)
