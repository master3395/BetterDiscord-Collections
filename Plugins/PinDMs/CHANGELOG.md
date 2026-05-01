# Changelog

Dates use **DD.MM.YYYY** (day, month, year).

## 01.05.2026

- **2.0.8 (collection):** Fixed DM list duplication and broken pin layout on current Discord: the `before` hook no longer prepends pinned IDs into `privateChannelIds` (pinned rows are only driven by `pinnedChannelIds` + `injectCategories`). On the `after` path with virtualized `sections`, pinned IDs are stripped from `privateChannelIds` before injection, and the tail section row count uses the filtered list length.
- Added this changelog to track future edits in this collection.
- Baseline matches the plugin files in this folder on this date.
