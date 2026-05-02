# Security policy

## Supported versions

Lumencast is pre-1.0. Until LSDP/1 and LSML 1.0 are frozen, only the latest spec version receives security advisories.

| Component                               | Supported                            |
| --------------------------------------- | ------------------------------------ |
| `lumencast-protocol` (specs, this repo) | latest commit on `main`              |
| `lumencast-js`, `lumencast-go`, etc.    | latest released version per SDK repo |

## Reporting a vulnerability

**Do not file public issues for security vulnerabilities.**

Send a report to **[security@lumencast.dev]** (placeholder until domain is registered).

Include:

- A description of the issue
- Steps to reproduce
- Affected components and versions
- Any proof-of-concept code (privately)

You will receive an acknowledgement within 72 hours and a triage update within 7 days.

## Scope

Security issues we treat as in-scope:

| Area               | Examples                                                                |
| ------------------ | ----------------------------------------------------------------------- |
| Protocol-level     | LSDP message that crashes a conformant runtime; auth bypass in the spec |
| Schema-level       | LSML scene that triggers unsafe rendering in any conformant runtime     |
| Reference SDK code | Memory safety, injection, auth handling, denial-of-service surface      |
| Conformance suite  | Fixtures that pass when they should fail                                |

Out of scope (file as regular issues):

- Bugs in third-party adoption code
- Performance issues without a security impact
- Style or convention disagreements

## Disclosure timeline

| Day  | Action                                                        |
| ---- | ------------------------------------------------------------- |
| 0    | Report received                                               |
| ≤ 3  | Acknowledgement, initial triage                               |
| ≤ 14 | Severity assessment, fix plan published privately to reporter |
| ≤ 90 | Fix released and CVE published if applicable                  |

We may extend timelines for hard problems but will keep the reporter informed.

## Hall of fame

Reporters who follow this policy will be credited in the release notes of the fix (with their consent), and their handle will be added to the security hall of fame in the repo once we have one.

## Cryptography

Lumencast itself is **token-agnostic** — it does not implement authentication. Operators authenticate via tokens (JWT or other) handed to `mount()`. Any cryptographic concerns belong to the operator's auth layer, not to Lumencast.

## Trust boundaries (recap)

```
HOST (browser/CEF/iframe/...)  ←  UNTRUSTED
                  │
                  │ WS + opaque token
                  ▼
SERVER  ←  TRUSTED
```

The spec mandates :

- Server validates every input against the LSML scene's `operator_inputs` declaration
- Server rejects `UNKNOWN_PATH`, `INVALID_VALUE`, `WRITE_FORBIDDEN`
- `__test.*` namespace cannot write to `__inputs.*` or `__system.*`
- Test sessions have a bounded TTL

A SDK or runtime that violates these is a vulnerability.
