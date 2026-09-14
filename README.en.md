# dsh-workbuddy-expert

**Expert folders for DeepSeek Harness: hand-written expert directories + in-session soft switching + the WorkBuddy expert market**

[中文](README.md) · [Design doc](docs/design.md) · [LICENSE](LICENSE)

## What it is

A DSH (DeepSeek Harness) web plugin and the **single home** of the "expert" concept in DSH:

1. **Expert folders** — an expert is a standalone directory (`expert.yml` + `role.md` + optional `skills/`, `scripts/`); drop it into a discovery root and it is picked up.
2. **Soft switching** — `/expert <name>` in any session, at any time, swaps the role section and skills as one group while keeping the full history; it takes effect at the next model-request boundary. **No preset opening, no summoning.**
3. **WorkBuddy market** (Settings → WorkBuddy Experts) — a runtime read-only scan of your local WorkBuddy expert directory (default `~/.workbuddy/plugins/marketplaces/experts/plugins`), with card browse/search/categories and inline install (= export into an expert folder under `~/.dsh/experts/`), update (in-place re-export), and uninstall (delete the folder).

## Quick start (hand-written expert)

```sh
mkdir -p ~/.dsh/experts/video-editor/skills/cut-video
```

`~/.dsh/experts/video-editor/expert.yml`:

```yaml
id: video-editor
display_name: Video Editor
description: Short-video cutting, subtitle burning, exports
order: 100
trust_scripts: false
```

`~/.dsh/experts/video-editor/role.md`: the role description body (becomes a system-prompt role section). Optional `skills/cut-video/SKILL.md` follows the dsh skill convention; an optional `scripts/` directory holds executables referenced from SKILL.md as `./scripts/...`.

Then, in any session:

```
/expert                # list all experts (broken rows included, with reasons)
/expert video-editor   # soft switch; history kept, effective at the next request boundary
```

No restart needed for added/removed folders — the discovery roots are watched and the selector (composer area + session-creation entry) refreshes itself.

## Discovery roots and trust model

| Rank | Source | Root | scripts/ executable by default |
|---|---|---|---|
| 100 | project | `<projectRoot>/.agents/experts` | ❌ (requires `trust_scripts: true`, with a first-compose UI notice) |
| 200 | user | `~/.dsh/experts` (`DSH_HOME` overrides) | ✅ (hand-writing / market-installing is the trust gesture) |

- Same-name experts resolve by rank: project wins over user; market exports always land at user rank.
- **user-rank experts may execute scripts/**; **project rank denies by default** — skills still register, but script calls are rejected at the execution layer with a notice; `trust_scripts: true` in expert.yml opts in.
- Extra roots come only via mount config and must declare `trust: user` explicitly:

```yaml
- name: '@deepseek-ai/dsh-workbuddy-expert'
  config:
    roots:
      - path: ~/company-experts
        trust: user
```

## Installing this plugin

```sh
git clone <this repo>
cd dsh-workbuddy-expert
dsh plugin --profile web add .
dsh --profile web --dump-config
```

`dsh-workbuddy-expert` should appear in the config dump. Then **restart `dsh web`** (the bundle list is read at startup only) and **hard-refresh the browser**. Zero build, zero runtime dependencies.

## The WorkBuddy market page

Settings → WorkBuddy Experts:

- **Source path**: editable in the page topbar (host settings namespace `workbuddy-expert`, key `sourcePath`; the tilde is stored verbatim and expanded on use; a nonexistent path may be saved — the page shows a notice until it exists). Refresh forces a rescan; otherwise per-file fingerprints trigger automatic rescans.
- **Install = export**: a scanned card lands as `~/.dsh/experts/<id>/` (expert.yml + sanitized role.md + the whole skills tree), with the fingerprint manifest in `.expert-source.json`.
- **Update**: cards light up updatable when the source changed; update is an in-place re-export. A missing/corrupt manifest shows broken with "manifest missing — uninstall and reinstall".
- **Uninstall**: deletes the expert folder.
- **Orphans**: after switching sources, experts installed from another source are listed under "installed but not in the current source" — listed only, never blocking.
- HTTP routes under `/dsh-workbuddy-expert` (`/api/state|avatar|config|refresh|install|update|uninstall`): same-origin POST only, 4 KiB body cap, one mutation at a time, `no-store` (avatar `max-age=60`). The WorkBuddy directory is only ever read; zero data egress.

## Configuration

- `sourcePath`: as above — page topbar or settings.
- `roots`: optional extra discovery roots, explicit `trust: user` required.
- `dshHome`: overrides DSH home resolution (default `$DSH_HOME` or `~/.dsh`).

## Retirement & migration: dsh-workbuddy-market

This plugin **fully supersedes** [dsh-workbuddy-market](../dsh-workbuddy-market) (its scanner/fingerprint/market-page code moved here). wb-market is retired — remove it from your profile:

```sh
dsh plugin --profile web remove dsh-workbuddy-market
```

Migration notes:

- **Existing `wb-*` presets are NOT auto-migrated** (design decision #5). Clean them up either way:
  - have the host run `agentPresets.remove('wb-<id>')`, or
  - simply delete the directory: `rm -rf ~/.dsh/.agent-presets/wb-<id>/`.
- **Leaving them is harmless** — they just have no update source and receive no maintenance.
- To keep using an expert, **install** (export) it again from the new market page; it then rides this plugin's install/update/uninstall pipeline.
- The old summon tools (`workbuddy_experts` / `summon_workbuddy_expert`) have **no successor by design** — soft switching replaces them: `/expert <name>` anytime, history preserved.

## Development

```sh
node scripts/smoke.mjs            # contract/sanitize/registry/switch smoke, zero deps
node scripts/smoke-client.mjs     # client side
node scripts/smoke-importer.mjs   # importer/market routes
node scripts/smoke-install.mjs    # install=export pipeline
```

Host-side changes (`src/`, `package.json`) need a `dsh web` restart; client-only changes (`client/client.js`) take effect on page refresh. Design and decision log: [docs/design.md](docs/design.md).

## License

MIT
