---
id: architecture
title: vhostctl Architecture
sidebar_label: Architecture
sidebar_position: 1
---

# vhostctl Architecture

`vhostctl` is the in-process package that owns vhost lifecycle planning,
validation, and (when write mode is enabled) apply gates for the node agent
(`bastion-telemetry` / `ew-node-agent`). The agent remains the control-plane
orchestrator: signed bundles, mTLS, command acks, and telemetry are unchanged.

## Package boundaries

| Area | Responsibility |
|---|---|
| Model | Desired-state structs (sites/streams) |
| Render | Artifacts + metadata headers |
| Live | Parse live nginx/OpenResty config |
| Differ | Hash + semantic drift |
| Reconcile | keep-live / import-live / overwrite / mark-unmanaged |
| Runtime | Stage → backup → promote → test → reload → optional probe → rollback |
| Backup | Collision-safe backups by category (`vhost`, `modsecurity`, `stream`, `json`) |
| Certs | Key/cert/hostname/expiry validation |
| DNS | Publication checks + ACME loopback self-check |
| Audit | JSONL events + activity log |
| Lock | Non-blocking exclusive flock (busy = in-flight mutate) |
| Panel state | Optional local diagnostic artifacts |

Public orchestration operations: **Plan**, **Apply**, **Reconcile**, **Validate**.

## Agent interaction

```text
signed bundle ──▶ apply_config
                    │
                    ├─ hooks/<apply_config> if present
                    ├─ vhostctl disabled → builtin apply (legacy)
                    ├─ enabled + shadow → builtin apply + read-only Plan/Validate parity
                    └─ enabled + write → Validate/Plan gates → builtin writer
                                         (+ post-apply probe when flagged)
```

Write mode still uses the proven pending/active **builtin writer** after
vhostctl gates (`vhostctl_writer: builtin`). A full runtime file-controller
cutover as the sole writer remains optional future work.

## Trust model

- **Desired state authority:** server-signed config bundle (Ed25519), not local JSON.
- **Honest acks:** failures report an exact `phase` (`certs`, `drift_gate`, `probe`, `reload`, …).
- **Drift policy:** under `keep-live`, manual drift blocks overwrite unless forced.
- **Probe rollback:** when `post_apply_probe_enabled` is set, probe runs **before**
  commit so the previous active tree can be restored.
- **Emergency fallback:** `vhostctl.enabled: false` restores pure legacy apply;
  or set `shadow_mode: true` to keep gates off writes while collecting parity.

## Related docs

- [Rollout](./rollout) — Stages A–E, flags, exit criteria
- [Runbook](./runbook) — drift, certs, DNS, probe, `ewctl`

### Design notes (contract freeze)

vhostctl **adopts** drift workflows, transactional apply phases, cert/DNS gates,
ACME preflight, audit, and locking. Ideas such as interactive CLI menus or local
JSON as the source of truth are **not** ported 1:1 — the signed bundle and agent
command contracts remain authoritative.
