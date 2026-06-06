# Grokian

**English** | [日本語 (README.ja.md)](README.ja.md)

Grokian is a Grok-powered Obsidian writing assistant derived from
[Claudian](https://github.com/YishenTu/claudian).

The project starts from Claudian's sidebar chat and inline edit architecture,
then reshapes it for novel writing with a local Grok CLI runtime.

## Current Status

This repository is a separate Obsidian Desktop plugin fork with plugin id
`grokian`, so it can sit beside an existing Claudian install without using the
`claudian` plugin folder.

Grokian v0.1 is Grok-only. Claudian, OpenCode, and Codex code from the upstream
project may remain as reference scaffolding during the fork, but they are not
supported product surfaces or release gates for this workflow.

## Goals

- Embed a Grokian chat sidebar in Obsidian.
- Support selected-text rewrite and draft continuation.
- Keep manuscripts as normal Markdown.
- Store project metadata, generated candidates, and session metadata under
  `.grokian/`.
- Use the local Grok CLI as the execution layer.

## Non-Goals For v0.1

- Obsidian mobile support.
- Hosted cloud backend.
- Shipping or maintaining Claudian, OpenCode, or Codex providers as user-facing
  Grokian features.
- Secret, token, cookie, or OAuth artifact storage.
- Automatic Path or environment-variable modification.

## Development

```bash
git clone <public-repo-url>
cd <repo-directory>
npm install
npm run build
```

### Build output note

`main.js` and `styles.css` are build artifacts and not tracked in Git by default.
If `npm run build` is skipped and you want an installable package, use the
release distribution below.

## Source Install into Obsidian

From a source checkout, build Grokian and copy the plugin into an existing vault:

```bash
npm run install:obsidian -- --vault "<path-to-vault>"
```

The installer copies only `manifest.json`, `main.js`, and `styles.css` into
`<path-to-vault>/.obsidian/plugins/grokian/`. It refuses to install into a
folder with a different plugin id, which prevents overwriting Claudian.

## Release Install

Use the latest GitHub Release asset for manual install.

1. Download the release archive that contains:
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. Extract into `<path-to-vault>/.obsidian/plugins/grokian/`.
3. Enable Grokian in Obsidian settings under **Community plugins**.

If you want to share release assets, publish `manifest.json`, `main.js`, and
`styles.css` from this repository as a GitHub Release package.

## Attribution

Grokian is based on Claudian by Yishen Tu and keeps the original MIT license.
See `LICENSE` and `GROKIAN.md` for project notes.
