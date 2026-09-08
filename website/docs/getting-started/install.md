---
sidebar_position: 1
title: Getting Started and Installation
---

# Getting Started and Installation

This project targets Debian 13 (Trixie) on `amd64`. The recommended local build path is Docker because it keeps the host clean and mirrors the CI environment.

## Build the Debian package

From the repository root:

```bash
make docker
```

The Docker target builds `packaging/docker/Dockerfile`, mounts the repository at `/work`, and runs `scripts/all.sh`. The output is written to:

```text
build/dist/*.deb
build/dist/*.deb.sha256
```

On a Debian 13 host, you can also build directly:

```bash
sudo make deps
make all
```

## Install from the APT repository

Published releases are mirrored on **download.edgewatch.com** as a static Debian archive (suite **trixie**, component **main**, architecture **amd64**). Browse the tree at [/debian/bastion/dists/trixie/](https://download.edgewatch.com/debian/bastion/dists/trixie/).

Create `/etc/apt/sources.list.d/bastion-base.list`:

```sourceslist
deb [trusted=yes] https://download.edgewatch.com/debian/bastion trixie main
```

Then install:

```bash
sudo apt update
sudo apt install bastion-base
```

The package name was renamed from `edgewatch-bastion-base` to `bastion-base`. The new `.deb` declares `Provides`/`Replaces`/`Conflicts` for `edgewatch-bastion-base`, so existing installs upgrade in place.

The archive is unsigned (`[trusted=yes]`). For production hosts, verify the SHA256 published on the [Downloads](/) page or GitHub Releases before trusting the mirror.

## Install the telemetry / node agent

The same APT source line also serves **`bastion-telemetry`** (the node agent: `ew-node-agent` + `ewctl`). It declares `Depends: bastion-base, ca-certificates, debconf, csync2, certbot, fail2ban`, so apt installs (or requires) the bastion-base data plane and those runtime tools automatically and refuses to install without them. Fail2ban ships with a curated jail catalog (SSH + nginx jails on by default; optional jails toggled from the console).

```bash
sudo apt update
sudo apt install bastion-telemetry
```

### Auto-enrollment on install

On install, the agent tries to enroll automatically against the public API (`https://api.bastion.edgewatch.net`). Provide the one-time enrollment token in any of these ways (checked in this order):

1. `EW_ENROLL_TOKEN` environment variable — `sudo EW_ENROLL_TOKEN=enk-XXXX apt install bastion-telemetry`.
2. The interactive debconf prompt shown during install.
3. A token file at `/etc/edgewatch/enroll.token` (first line; removed after a successful enroll).

Override the endpoint with the `bastion-telemetry/endpoint_url` debconf value or `EW_ENROLL_ENDPOINT`.

On success the node is enrolled and `bastion-telemetry.service` is enabled and started. If enrollment cannot complete (no token, network error, or server rejection) the install still succeeds, the agent stays idle (not started), and a message explains how to finish enrollment manually:

```bash
ewctl endpoint enroll --endpoint https://api.bastion.edgewatch.net --token <TOKEN>
sudo systemctl enable --now bastion-telemetry
```

You can re-run enrollment after providing a token with `sudo dpkg-reconfigure bastion-telemetry`.

## Install a local package

Install with `apt`, not plain `dpkg`, so dependencies are resolved automatically:

```bash
sudo apt update
sudo apt install ./build/dist/Bastion-base_<version>_amd64.deb
```

The package declares `Provides: nginx` and conflicts with Debian's nginx packages. This prevents two web server packages from writing to the same runtime paths or binding the same service ports.

## Verify the installation

```bash
systemctl status openresty
openresty -V
sudo openresty -t
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
```

The `postinst` script creates runtime directories, generates a default self-signed certificate and `dhparam.pem` when missing, runs `ldconfig`, enables `openresty.service`, validates the nginx/OpenResty configuration, and starts or reloads the service only when validation succeeds.

## Post-install customization

On first install, `postinst` creates `/etc/nginx/conf.d/occentus.conf` as an
admin-owned include. Put your own `http{}`-level directives, snippets, or
`include` statements there instead of editing `/etc/nginx/nginx.conf` directly.
That file is **not** a dpkg conffile: the package creates it once and never
modifies or overwrites it on future upgrades.

## Upgrade

Use the explicit conffile policy for non-interactive upgrades (validated on
staging; see `docs/staging-v1.0.8-gap-analysis.md` in the repository):

```bash
sudo apt update
sudo apt-get install -y \
  -o Dpkg::Options::=--force-confdef \
  -o Dpkg::Options::=--force-confold \
  --only-upgrade bastion-base bastion-telemetry
```

With `--force-confdef --force-confold`:

- **Modified conffiles** (for example a hand-edited `/etc/nginx/nginx.conf`) are
  always kept; the package's new default is written alongside as
  `<file>.dpkg-dist` for manual review or merge.
- **Unmodified conffiles** are updated automatically to the package version.
- **Seed-once files** created by `postinst` but not listed as conffiles — for
  example `/etc/nginx/conf.d/occentus.conf` — are never touched by dpkg during
  an upgrade.

The `postinst` script validates the configuration with `openresty -t` before
reloading. If validation fails, it does **not** reload and leaves the previous
process intact. Review `/etc/nginx/` and retry with `apt install --reinstall`.

## Remove or purge

```bash
sudo apt remove bastion-base
sudo apt purge bastion-base
```

`remove` keeps configuration. `purge` removes package-owned persistent runtime data such as `/var/log/nginx`, `/var/log/nginx-grafana`, `/var/lib/nginx`, `/var/cache/nginx`, and `/etc/modsecurity`. It intentionally avoids deleting the whole `/etc/nginx` tree in case operators added custom site data.
