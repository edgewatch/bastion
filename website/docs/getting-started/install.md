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

## Remove or purge

```bash
sudo apt remove bastion-base
sudo apt purge bastion-base
```

`remove` keeps configuration. `purge` removes package-owned persistent runtime data such as `/var/log/nginx`, `/var/log/nginx-grafana`, `/var/lib/nginx`, `/var/cache/nginx`, and `/etc/modsecurity`. It intentionally avoids deleting the whole `/etc/nginx` tree in case operators added custom site data.
