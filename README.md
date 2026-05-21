# Edgewatch Bastion

Public Debian package releases for **Edgewatch Bastion**, distributed as `edgewatch-bastion-base`.

Edgewatch Bastion is a hardened OpenResty/Nginx gateway package for Debian 13 (Trixie). It bundles OpenResty, ModSecurity v3, the OWASP Core Rule Set, Brotli compression, GeoIP2 support, AJP support, hardened systemd units, log rotation, sysctl tuning, and a default virtual host with error pages.

## Supported Platform

- Debian 13 (Trixie)
- amd64 packages

## Download

Packages are published as GitHub Release assets in this repository:

<https://github.com/edgewatch/bastion/releases>

For the latest release, download:

- `edgewatch-bastion-base_amd64.deb`
- `edgewatch-bastion-base_amd64.deb.sha256`

## Install

```bash
curl -LO https://github.com/edgewatch/bastion/releases/latest/download/edgewatch-bastion-base_amd64.deb
curl -LO https://github.com/edgewatch/bastion/releases/latest/download/edgewatch-bastion-base_amd64.deb.sha256
sha256sum -c edgewatch-bastion-base_amd64.deb.sha256
sudo apt install ./edgewatch-bastion-base_amd64.deb
```

Some releases may also include the full version in the asset filename. If the generic `edgewatch-bastion-base_amd64.deb` alias is not present, download the versioned `.deb` shown on the release page and install it with `sudo apt install ./<file>.deb`.

## Verify

```bash
openresty -t
systemctl status openresty
curl -I http://127.0.0.1/
```

The package installs and manages the `openresty.service` systemd unit.

## Upgrade

Download the newer `.deb` from the latest GitHub release, verify its SHA256 checksum, then run:

```bash
sudo apt install ./edgewatch-bastion-base_<version>_amd64.deb
```

Debian package version ordering is designed so newer generated builds replace older ones cleanly.

## Remove

```bash
sudo apt remove edgewatch-bastion-base
```

To remove package-managed configuration as well:

```bash
sudo apt purge edgewatch-bastion-base
```

## Configuration

Main configuration paths after installation:

- `/etc/nginx/`
- `/etc/modsecurity/`
- `/etc/modsecurity/crs/`
- `/var/log/nginx/`

Before reloading after configuration changes, validate the configuration:

```bash
sudo openresty -t
sudo systemctl reload openresty
```

## Notes

This package declares `Provides: nginx` and conflicts with Debian stock `nginx` package to prevent both stacks from managing the same service paths at the same time.

The build pipeline and source packaging logic live in the private/internal build repository. This public repository is only for end-user documentation and release downloads.
