# Repository-owned synthetic Chrome proof runtime

`scripts/qa/chrome-owner.mjs` is repository-only prerequisite tooling for the isolated Chrome portion of dotfiles ticket #41.
It is not a Pi extension or global command and changes no active Nix/Pi configuration.
Current `browser-routing` policy is authoritative.
The public `~/.local/bin/chrome-devtools-axi` now forwards to the existing npm-owned upstream CLI.
The removed dotfiles guard's preparation, attachment and receipt APIs are not part of this runtime.

## Launch contract

Use an ordinary task-owned foreground Herdr shell at this checkout's physical Git root, with the named session and workspace explicit in placement.
Use a fresh bounded task name for each proof.

```sh
env -u NODE_OPTIONS -u NODE_PATH node scripts/qa/chrome-owner.mjs --task pi41-browser-upstream1
```

The helper accepts only `--task`, refusing arbitrary URLs, executables, existing profiles and inherited browser/backend overrides.
It requires macOS, installed stable Google Chrome, the existing public CLI and npm-owned Chrome DevTools MCP installation, `/bin/ps`, `/usr/sbin/lsof` and `/opt/homebrew/bin/herdr`.
Missing prerequisites fail without substitution or installation.
Initial preflight verifies physical Git root, Chrome's vendor signature and the current ordinary Herdr foreground placement.
This placement check is not a replacement for the removed browser guard or an upstream caller-binding mechanism.

The helper creates a new private task directory and empty disposable profile, plus a fresh synthetic HTTP fixture bound only to `127.0.0.1`.
The fixed fixture has a unique visible title/token, fabricated account label, counter and draft input, with no external assets or provider operations.
It serves only its fixed document with a restrictive content policy.
The fixture and profile are not browser-network confinement.

Chrome is a referenced child of the foreground repository owner, using the fixed stable executable, fresh profile, loopback CDP, disabled sync/extensions, mock keychain, basic password store and no-first-run/default-browser flags.
Its initial target is the exact origin allocated by this owner.
A separate signal process group prevents owner Ctrl+C from signaling Chrome.
The helper always selects exactly `--disable-features=PreloadTopChromeWebUI` as its declared QA configuration, with no feature-selection or caller-supplied flag interface.
This suppresses background TopChrome WebUI preloading and differs from default Chrome startup; it does not guarantee absence of browser UI or establish broader compatibility.

## Upstream attachment and readiness

The helper generates a fresh unpredictable named upstream session and a separate bridge port.
It refuses existing session state and an occupied bridge port before invoking upstream.
This matters because upstream's `ensureBridge` may reuse healthy saved state or terminate an unhealthy saved PID.
The default upstream session is never used.

Before attachment, bounded OS probes verify the self-launched Chrome PID, parent, UID, original start identity, exact launch command and exclusive IPv4 loopback CDP listener.
The private profile's inode, type, ownership and permissions must remain unchanged.
Missing, malformed, stale, foreign or ambiguous evidence fails closed.
These are checks of this runtime's own resources, not a generic browser-target allowlist or an OS security sandbox.

The owner invokes only the public CLI's `pages` command with a source-constructed environment:

- `CHROME_DEVTOOLS_AXI_SESSION` selects the newly allocated named session.
- `CHROME_DEVTOOLS_AXI_PORT` selects its reserved bridge port.
- `CHROME_DEVTOOLS_AXI_BROWSER_URL` selects the verified exact `http://127.0.0.1:<CDP port>` endpoint.
- `CHROME_DEVTOOLS_AXI_MCP_PATH` selects the existing declared npm MCP entry point without fallback installation.

Personal auto-connect, inherited profile selection, shared MCP URLs and arbitrary backend overrides are not forwarded.
Upstream launches its own detached bridge as its supported implementation.
The repository owner keeps Chrome and the fixture foreground-owned; there is no custom foreground attach-bridge command.

Exit zero, bridge health and a named session alone are insufficient for readiness.
The public page inventory must contain exactly the selected synthetic fixture page at its exact URL.
Chrome ownership is rechecked after the public command, and the new bridge's recorded PID, UID, start identity, command and exclusive loopback listener are checked.
While foreground, the owner monitors those original process/profile/listener identities and closes the fixture on loss.
It does not navigate or inspect unrelated pages or reconstruct the deleted browser UI target rejection policy.
Do not issue standalone CLI commands from copied state; further diagnostics require fresh owner verification and reviewed scope.
The unsigned private state file is convenience evidence, not a durable approval lease.

## Native proof

Readiness prints the private state path, which contains the exact synthetic page routing context.
Keep the owner foreground for the bounded proof.
The active root Codex host must independently acquire the actual matching Chrome window using its own normal Computer Use API.
Match live process/profile evidence and the actual fixture URL/title/rendered state before interaction.
App selection or title alone does not prove ownership.
If the native API cannot uniquely acquire that window, stop and record the routing gap.

Use a fresh Pi visual-tester session and owner-private queue bound to its session header, canonical checkout, role, exact fixture, task, root thread, nonce and expiry.
Only the active root host opens the lease and services its normal native tool.
Return actual observed findings and screenshot to that child, then verify completion and independent parent delivery.
CLI output, fixture source and token reads are not rendered evidence.
Chrome observations do not establish Zen, terminal UI or unattended native acceptance.

## Retention and validation

There is no stop/cleanup subcommand, automatic browser signal, profile removal, kill-all or worktree pruning.
Interruption closes only the helper's synthetic listener and reports Chrome/profile retained.
Failure retains private state/logs, the profile and any launched browser/bridge.
The separate Chrome signal group prevents owner interruption from signaling Chrome.
Closing the fixture ends this proof even if a rendered page remains visible.
Retiring exact resources requires separate current ownership verification and scope.

Tests exercise admission, fresh-session sequencing, fixed launch/environment, exact selected fixture matching, ownership failure, profile changes, interruption retention and the synthetic HTTP boundary.
A real newly spawned Node process and IPv4 listener exercise macOS process/socket parsing without launching a browser.
Test adapters are import-only and cannot be selected by production CLI or environment.
Source/mock and Node process/socket evidence do not establish successful Chrome isolation or native permissions.
Browser acceptance still requires a fresh actual Chrome run and root Computer Use evidence.

## Historical guard refusal

On 2026-10-14 the previous helper launched a fresh Chrome/profile, and the then-active public guard verified ownership but refused target scope.
The original report counted one permitted page, one foreign target and three unsupported targets.
The owner closed only its fixture and retained exact browser/profile/state resources, preserving prior focus and workspaces.
No successful Chrome navigation, native Chrome proof or Pi browser visual request followed that refusal.
That refusal remains historical evidence for its original configuration.
The user subsequently removed the custom guard in dotfiles commit `abed985`; its deleted APIs and target-category policy are not current prerequisites.
Do not reuse the historical profile, receipt, PID, bridge or closed fixture as fresh proof.
Ticket #41's browser criterion remains incomplete until the new upstream route and native child/parent delivery are actually exercised.
