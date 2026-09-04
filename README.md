# dsh-thalamus

A DeepSeek Harness **notification center + document previewer** plugin. Thalamus — the brain's relay station: sensory signals converge here before reaching the cortex. In the same metaphor family as [`dsh-hippocampus`](https://github.com/iabetor/dsh-hippocampus) (the memory plugin), this project relays **events and content** from any plugin to you.

- Any plugin (hippocampus cleanup, a future git panel, …) pushes notifications through a shared service
- A sidebar bell with an unread badge opens a right-hand panel: notifications list + full-text preview of attached artifacts (markdown reports, plans, logs)
- Notifications persist across restarts (`~/.dsh/thalamus/notifications.jsonl`, capped at 200)

## Install

### From GitHub

```bash
dsh plugin --profile web add "https://github.com/iabetor/dsh-thalamus/releases/download/v0.1.0/dsh-thalamus-0.1.0.tgz"
```

Or add it manually to the profile's `package.json`:

```json
{
  "dependencies": {
    "dsh-thalamus": "github:iabetor/dsh-thalamus"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-thalamus"]
    }
  }
}
```

Then restart `dsh web`. A **bell** appears at the bottom of the left sidebar; clicking it opens the notification panel on the right.

### Development

```sh
git clone https://github.com/iabetor/dsh-thalamus.git
cd dsh-thalamus
pnpm install
pnpm run build   # typecheck + bundle (tsdown)
pnpm run test    # vitest
```

## For plugin authors: push a notification

Any host-side plugin can push a notification by declaring the service:

```ts
export const inject = ['notifications']  // or ctx.inject(['notifications'], ...)

// After some background work finished:
await ctx.notifications.push({
  source: 'hippocampus',              // your plugin id
  kind: 'success',                    // 'info' | 'success' | 'error'
  title: '记忆整理完成',
  detail: '清理 3 条记录',
  preview: {                          // optional: attached artifact,
    name: 'memory-maintain.md',       // viewable in the preview tab
    text: '## 本次清理记录\n\n- [项目] …',
    language: 'md',
  },
})
```

The service (`ThalamusService`, provided as `ctx.notifications`) offers:

| Method | What it does |
|---|---|
| `push(input)` | Store one notification (id/time/read are minted for you) |
| `list(limit?)` | Newest-first list |
| `markRead(id)` | Mark one read |
| `clear()` | Clear all |

The bell badge counts unread notifications; opening the panel auto-marks
them read (so the badge clears), and new pushes arrive live over SSE.

## How it works

### Notification model

```ts
interface ThalamusNotification {
  id: string                 // uuid
  source: string             // producer plugin ('hippocampus', 'git', ...)
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string            // short summary in the list
  preview?: { name: string; text: string; language?: string }
  time: number               // epoch ms
  read: boolean
}
```

`preview` carries an attached artifact (bounded, e.g. a maintenance report);
the panel's Preview tab renders it so users never need to open a local app
to read a plugin's output.

### UI

- **Entry**: `sidebar.footer.action` slot — the harness's additive foot-actions
  seat (narrow rail = 36px circle glyph; wide sidebar = labeled row), styled to
  match the settings trigger.
- **Panel**: a right-hand column rendered through `shell.overlay`, so it
  overlays the app without touching the layout (the harness `details` column
  is single-occupied by ui-chat and not available to plugins).
- **Live updates**: the host broadcasts each push over `/thalamus/events`
  (SSE); the always-mounted client host updates the badge whether the panel
  is open or not.

### Storage

- JSONL at `~/.dsh/thalamus/notifications.jsonl` (user-layer root, cross-project)
- Capped at 200 entries (oldest trimmed)
- Mutations are serialized so concurrent push/markRead/clear never interleave
- Atomic writes (temp file + rename)

### Zero upstream modification

Everything rides public harness interfaces: `ctx.webServer` routes with the
standard browser-trust fence, `ctx.locale`/`ctx.slots`, the `sidebar.footer.action`
and `shell.overlay` slots. No deepseek-harness source is touched.

## Design notes

- **Why not harness `ctx.jobs`?** Jobs are session-bound (owner = agent) and in
  web deployments job controllers only exist per agent preset, so unowned
  (global) jobs cannot start. Global notifications are therefore delivered over
  this plugin's own SSE + JSONL channel. See `docs/implementation-plan.md`.
- **Why notifications + preview together?** Both are passive information
  consumption (vs. active tools like git); they share the "relay content to
  the user" role. A future git/outline panel is expected as separate plugins.
- A clickable UI prototype comparing placement options lives in
  `docs/prototype.html`.

## Releasing

```sh
pnpm run build
pnpm pack                        # produces dsh-thalamus-<version>.tgz
gh release create v<version> dsh-thalamus-<version>.tgz
```

## License

MIT
