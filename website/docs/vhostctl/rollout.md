---
id: rollout
title: vhostctl Staged Rollout
sidebar_label: Rollout
sidebar_position: 2
---

# vhostctl Staged Rollout

Operator guide for enabling nginx apply through `vhostctl` on enrolled nodes.
There is no fleet automation in the packaging repo; apply flags via
`/etc/edgewatch/endpoint.yaml` (see comments in the package sample config).

## Feature flags

| Flag | Default | Meaning |
|---|---|---|
| `vhostctl.enabled` | `false` | Master switch. Off = legacy builtin only. |
| `vhostctl.shadow_mode` | `true` when enabled and unset | Read-only Plan/Validate parity; **no** vhostctl writes. |
| `vhostctl.drift_policy` | `overwrite` | Use `keep-live` before write-mode canary. |
| `vhostctl.post_apply_probe_enabled` | `false` | After successful reload, run probe before commit. |
| `vhostctl.post_apply_probe_command` | `[]` | Argv for probe (e.g. curl stub_status). Empty = skip. |

`WriteMode` = `enabled && !shadow_mode`.

### Emergency fallback

1. Set `vhostctl.enabled: false` **or** `shadow_mode: true` (with `enabled: true` if you still want shadow telemetry).
2. Restart `bastion-telemetry` / `ew-node-agent`.
3. Confirm the next `apply_config` ack has `engine: builtin` and no write-mode fields.

## Stages A–E

### Stage A — Dev / CI shadow

**Config**

```yaml
vhostctl:
  enabled: true
  # shadow_mode defaults to true
  drift_policy: overwrite
  post_apply_probe_enabled: false
```

**Exit criteria**

- Every `apply_config` in CI/unit harness attaches `vhostctl_shadow` with
  `validation_parity`, `drift_parity`, `render_parity` when shadow is on.
- Flags-off path emits **no** `vhostctl_shadow` (legacy behavior).
- Deterministic unit coverage for shadow and disabled paths.

### Stage B — Canary write mode

**Config**

```yaml
vhostctl:
  enabled: true
  shadow_mode: false
  drift_policy: keep-live
  post_apply_probe_enabled: true
  post_apply_probe_command: ["curl", "-fsS", "--max-time", "5", "http://127.0.0.1:18101/edgewatch_status"]
```

**Exit criteria**

- Canary nodes show `engine: vhostctl`, `vhostctl_writer: builtin`.
- Drift-blocked applies return `phase: drift_gate` (no silent overwrite).
- Forced probe failure restores previous active and acks `phase: probe`.
- Immediate fallback toggle verified once per canary class.

### Stage C — Partial fleet

Raise coverage gradually. Monitor:

- Drift-block rate vs false positives
- Probe/rollback rate
- Cert validation failures (`phase: certs`)
- DNS publication inventory (`dns_publication` section)

### Stage D — Fleet default

```yaml
vhostctl:
  enabled: true
  shadow_mode: false
  drift_policy: keep-live
  post_apply_probe_enabled: true
  post_apply_probe_command: ["curl", "-fsS", "--max-time", "5", "http://127.0.0.1:18101/edgewatch_status"]
```

Keep the legacy path available for one release window via emergency fallback above.

### Stage E — Deprecation

Freeze or remove legacy-only apply internals once operational SLOs are stable
(no silent overwrites, rollback exercises green, drift workflow audited).

## Shared exit criteria (promote between stages)

- No silent overwrite incidents under `keep-live`.
- Successful rollback on forced test/reload/probe failures.
- Drift workflow exercised (keep-live / import-live / overwrite) with audit traces.
- Cert/DNS preflight error quality accepted by operators.

## Probe behavior summary

When `post_apply_probe_enabled` is true and a command is set:

1. Apply activates pending → active (previous tree stashed as `active.old`).
2. Reload succeeds.
3. Probe runs (**before** commit), retried with exponential backoff for up to
   ~30s so a listener that is slow to accept right after reload (e.g.
   ModSecurity-heavy configs) does not cause a spurious rollback. The probe
   command needs no retry flags of its own (plain `curl -fsS --max-time 5`).
4. On probe failure: restore previous active + reload; ack `phase: probe`.
5. On success: commit (delete `.old`).

Probe failures in write mode **do not** fall back to a second builtin apply
(that would re-apply the bad candidate).

## See also

- [Architecture](./architecture)
- [Runbook](./runbook)
