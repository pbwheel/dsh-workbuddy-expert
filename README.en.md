<div align="center">

# DSH WorkBuddy Expert

**Bring WorkBuddy experts into DSH: one-click import from the expert market · switch experts anytime via the session selector**

[中文](README.md) · [Features](#features) · [Installation](#install-the-plugin) · [Design doc](docs/design.md) · [MIT](LICENSE)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DSH Web Plugin](https://img.shields.io/badge/DSH%20Web-Plugin-0f766e.svg)](#install-the-plugin)
[![Zero build](https://img.shields.io/badge/Build-zero%20build-0f766e.svg)](#development)

</div>

> DSH WorkBuddy Expert is a community-maintained [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) plugin, not an official DeepSeek AI product.

<!-- Demo gif (placeholder): summon → install → select → effective. Replace docs/images/hero-demo.gif with a real recording, same filename. -->
<img src="docs/images/hero-demo.gif" width="70%" alt="Demo: summon → install → select → effective" />

## What it is

A DSH web plugin that brings the experts from the [WorkBuddy](https://www.workbuddy.cn/) Expert Center into your DSH workflow:

- **Expert market** (Settings → WorkBuddy Experts) — a read-only scan of your local WorkBuddy expert directory, with card browse/search/categories and one-click **install / update / uninstall** that exports into standard expert folders;
- **Session selector** — the expert capsule next to the composer switches the current session's expert anytime: the role section and skills are swapped as one group, **the full session history is kept**, and the change takes effect at the next model-request boundary without interrupting an in-flight turn;
- **A complete expert experience** — installed experts carry their role description, dedicated skills, and avatar; the selector list is ready to use right away.

## Expert source

The plugin **does not download experts from the network** — the market page reads a **local** expert directory that the WorkBuddy desktop app maintains (default `~/.workbuddy/plugins/marketplaces/experts/plugins`). An expert lands there only after you click **Summon** on it in the WorkBuddy **Expert Center**; only then can this plugin scan it:

<!-- WorkBuddy "Summon" button screenshot (placeholder). Replace docs/images/workbuddy-summon.jpg with a real one, same filename. -->
<img src="docs/images/workbuddy-summon.jpg" width="40%" alt="WorkBuddy Expert Center &quot;Summon&quot; button (placeholder)" />

If you have never summoned any expert, the market page shows an empty list — summon a few in the Expert Center and cards appear automatically. "Default source directory" below always means this path.

## Features

### 1. WorkBuddy expert market (Settings → WorkBuddy Experts)

<img src="docs/images/market.jpg" width="50%" alt="Expert market (placeholder)" />

- **Read-only scan** of your local WorkBuddy expert directory (default path see "Expert source") — never written to, zero data egress;
- Card browse/search/categories; action buttons live on the card's top-right corner (not installed → Install; installed → Uninstall/Update);
- **Install = export** into a standard expert folder at `~/.dsh/experts/<id>/` (expert.yml, sanitized role.md, the whole skills tree, plus an avatar when the source card has a PNG), with the fingerprint manifest in `.expert-source.json`;
- **Update**: cards light up updatable when the source changed; update is an in-place re-export. **Uninstall**: deletes the expert folder;
- **Orphans**: after switching sources, experts installed from another source are listed under "installed but not in the current source" — listed only, never blocking.

### 2. Session selector (with avatars)

<img src="docs/images/picker.jpg" width="50%" alt="Session selector (placeholder)" />

- The expert capsule next to the composer expands into an avatar-carrying expert list; pick one to switch;
- Avatars are exported at install time (`avatar.png`, fetched on demand via `/api/expert-avatar`); no avatar falls back to an emoji;
- **Switching keeps the full session history**: the role section and skills are swapped as one group, taking effect at the next model-request boundary; an in-flight turn queues the switch until its boundary, never interrupting streaming output;
- Switch transactions are serialized: one switch per session at a time;
- Every registration lands in agent scope: it affects only the current session and unwinds automatically when the session ends;
- You can also pick an expert when creating a new session — it composes immediately on creation, so a cold session never sits in a "selected but not effective" state;
- No restart needed for added/removed experts — the discovery roots are watched and the selector (composer area + session-creation entry) refreshes itself.

### 3. Expert capabilities ride the session

<img src="docs/images/switch-trace.jpg" width="50%" alt="Session trace after switch (placeholder)" />

Once an expert is selected, its capabilities mount onto the current session:

- The **role description** (role.md) is injected as a system-prompt role section;
- **Dedicated skills** (the whole skills/ tree) register and unregister with the expert;
- An optional **tool allowlist** (expert.yml `tools.allow`) mounts a scoped tool restriction that lifts automatically on switch-away;
- Experts with broken manifests are listed as **broken with reasons** in the selector — never silently hidden.

## Quick start

Prerequisites:

- one of two hosts: the **DeepSeek Harness desktop app** (Electron) or terminal `dsh web`. They run **different profiles** (`desktop` vs `web`) with different install entrances — see below, and don't install into the wrong one;
- the [WorkBuddy](https://www.workbuddy.cn/) desktop app installed, with at least one expert **summoned** — see ["Expert source"](#expert-source) for the mechanism and default path;

### Install the plugin

The two hosts run **different profiles** (desktop: `~/.dsh/profiles/desktop`; CLI: `~/.dsh/profiles/web`) that never mix — installing into the wrong one does nothing for your host. The desktop's `desktop` profile is managed exclusively by Electron — `dsh --profile desktop ...` fails with `managed exclusively by the Electron application` — so desktop users should **not** copy the `--profile web` commands below.

**Desktop app (DeepSeek Harness)** — install via the in-app plugin panel:

1. Open the sidebar **Plugins** panel and click **Add plugin**;
2. Enter the plugin's **npm package name** `dsh-workbuddy-expert` (i.e. the part after `dsh plugin add` in the official plugin-download instructions; the Git address `github:pbwheel/dsh-workbuddy-expert`, a tarball, or the absolute path of a local clone also works);
3. **Restart the desktop app** after install (the bundle list is read at startup only).

**Terminal (`dsh web`)** — one-liner, npm package name or Git address both work (always the latest version, no manual clone):

```sh
dsh plugin --profile web add dsh-workbuddy-expert
# or install from GitHub:
dsh plugin --profile web add github:pbwheel/dsh-workbuddy-expert
```

Or clone and install from the directory:

```sh
git clone https://github.com/pbwheel/dsh-workbuddy-expert.git
cd dsh-workbuddy-expert
dsh plugin --profile web add .
dsh --profile web --dump-config
```

Both install the latest version on the default branch; `dsh-workbuddy-expert` should appear in the config dump. Then **restart `dsh web`** (the bundle list is read at startup only) and **hard-refresh the browser**. Zero build; the only runtime dependency is the host's own schema factory, @deepseek-ai/schemastery (exact-pinned).

### Ask an agent to install it

Inside the desktop app, send this to any agent (it installs into the current profile — no terminal needed):

```text
Please install the DSH plugin dsh-workbuddy-expert (source: github:pbwheel/dsh-workbuddy-expert) into the current profile, then tell me how to restart and start using it.
```

Terminal users send this to any agent that can run terminal commands on your machine:

```text
Install the DSH plugin dsh-workbuddy-expert from this repository into my web profile: git clone https://github.com/pbwheel/dsh-workbuddy-expert.git, then run dsh plugin --profile web add <directory>. After installation, run dsh --profile web --dump-config, confirm the configuration includes dsh-workbuddy-expert, and explain how to restart dsh web and start using it.
```

### Use a WorkBuddy expert in three steps

1. Open **Settings → WorkBuddy Experts** (default source path see "Expert source"; editable in the topbar). **Empty list?** No expert summoned yet — see ["Expert source"](#expert-source);
2. Click **Install** on a card — the expert is exported to `~/.dsh/experts/`;
3. Back in a conversation, click the expert capsule next to the composer, pick the freshly installed expert, and start chatting.

The command line works too: `/expert` lists all experts, `/expert <name>` switches.

## Configuration

| Option | Default | Purpose |
|---|---|---|
| `sourcePath` | `~/.workbuddy/plugins/marketplaces/experts/plugins` | WorkBuddy source directory; the tilde is stored verbatim and expanded on use; a not-yet-existing path may be saved (the page shows a notice until it exists) |
| `roots` | — | Optional extra discovery roots; explicit `trust: user` required |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Overrides DSH home resolution |

Configuration rides DSH 0.2's **Config form model**: saving `sourcePath` takes effect through the host's volatile chain without remounting the plugin; `roots`/`dshHome` remount per Loader semantics. Form projection and the save chain: see the [design doc](docs/design.md).

Extra-root example:

```yaml
- name: 'dsh-workbuddy-expert'
  config:
    roots:
      - path: ~/company-experts
        trust: user
```

Per-file fingerprints trigger automatic rescans; the Refresh button forces one.

`sourcePath` has two editing entrances over the same data, kept in step through the host's volatile chain:

- **Settings → WorkBuddy Experts** (the market-page topbar);
- **Plugins → dsh-workbuddy-expert → Configure** (the Plugins page's native row config page, with revision conflict protection and reset-to-default).

## Development

```sh
node scripts/smoke.mjs            # contract/sanitize/registry/switch smoke
node scripts/smoke-client.mjs     # client side
node scripts/smoke-importer.mjs   # importer/market routes
node scripts/smoke-install.mjs    # install=export pipeline
node scripts/verify-host-contract.mjs  # Config/volatile chain against real host packages
```

Host-side changes (`src/`, `package.json`) need a host restart (restart the desktop app, or `dsh web` on the CLI); client-only changes (`client/client.js`) take effect on page refresh.

| Module | Responsibility |
|---|---|
| `src/registry.js` | Expert-folder scanning, validation, sanitization, watcher |
| `src/compose.js` | Session composition: role section + skills + tool allowlist |
| `src/switch.js` | Switch transaction |
| `src/importer/` | WorkBuddy scanner/fingerprint/export/market routes |
| `client/client.js` | Selector + market-page UI |

Design and decision log: [docs/design.md](docs/design.md).

## License

[MIT](LICENSE) © 2026 dsh-workbuddy-expert contributors
