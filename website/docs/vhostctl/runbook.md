---
id: runbook
title: vhostctl Operator Runbook
sidebar_label: Runbook
sidebar_position: 3
---

# vhostctl Operator Runbook

Operational guide for drift-blocked applies, cert/DNS failures, probe rollback,
and read-only `ewctl` inspection. See also [architecture](./architecture)
and [rollout](./rollout).

## Quick triage

| Symptom | Likely phase / signal | Action |
|---|---|---|
| Apply blocked; live edits preserved | `phase: drift_gate` | Inspect drift; keep-live (default) or force overwrite / import-live |
| Bad TLS material | `phase: certs` | Fix key/cert match, hostname SAN/CN, expiry; re-push bundle |
| Reload failed | `phase: reload`, `rolled_back` | Check nginx error log; previous active should be restored |
| Probe failed | `phase: probe`, `rolled_back` | Fix probe target/health; previous active restored |
| Lock busy | lock busy | Wait for in-flight mutate; do not force parallel applies |

## Drift-blocked applies (`keep-live`)

When `drift_policy: keep-live` and live config diverges from the desired render,
write-mode apply refuses overwrite:

```text
phase: drift_gate
error: vhostctl: apply blocked by keep-live drift policy
```

**Operator options**

1. **Keep live** — leave acknowledgement in place; fix control-plane desired state later.
2. **Import live** — capture unknown directives for control-plane adoption (`import-live`).
3. **Overwrite** — explicit force / `overwrite-live` when the signed bundle must win.
4. **Mark unmanaged** — stop managing that site id.

Inspect:

```bash
ewctl drift --json
ewctl vhosts --json
ewctl status --json
```

## Certificate failures

Validate reports hostname mismatch, key mismatch, expired, expires-soon (warning),
or insecure key permissions. Apply fails with `phase: certs` when blocking.

```bash
ewctl validate --json
```

Check inventory `tls` section for on-node material and `dns_publication` for
hostname publication state.

## DNS publication

Inventory section `dns_publication` lists enabled site hostnames with states:

- `published` — resolved (inventory uses empty expected-IP set; any answer counts)
- `not_published` — NXDOMAIN / empty
- `partial` / `unexpected` — when expected IPs are supplied at validate/apply time

Apply-time DNS checks (when enabled on Validate/Apply options) use cluster IPs
for stricter matching.

## Post-apply probe rollback

Config (in `/etc/edgewatch/endpoint.yaml`):

```yaml
vhostctl:
  post_apply_probe_enabled: true
  post_apply_probe_command: ["curl", "-fsS", "--max-time", "5", "http://127.0.0.1:18101/edgewatch_status"]
```

The agent retries the probe with exponential backoff for up to ~30s before
declaring failure: right after `nginx -s reload` a ModSecurity-heavy config can
take a moment before the listener accepts, and probing once immediately used to
cause spurious rollbacks. Keep the probe command simple — no `curl --retry`
flags are needed (the ack reports `post_apply_probe_attempts` when retried).

On failure the agent restores `active.old`, reloads, and acks `phase: probe`.
Empty command with probe enabled skips the probe (`post_apply_probe_skipped`).

## ACME preflight

`acme_preflight` writes the challenge token and runs a loopback self-check.
Detail includes `local_selfcheck.ok`. Self-check failure is reported but does
not necessarily fail the command (control-plane external verify remains
authoritative).

## ewctl read-only ops

```bash
ewctl status [--json]          # agent/vhostctl summary
ewctl validate [--json]        # cert/model validation against current bundle
ewctl vhosts [--json]          # live vhost discovery
ewctl drift [--json] [--live-dir DIR]
```

These commands do not mutate the data plane.

## Emergency disable

```yaml
vhostctl:
  enabled: false
```

Restart the agent (`bastion-telemetry` / `ew-node-agent`). Next applies use
`engine: builtin` only.
