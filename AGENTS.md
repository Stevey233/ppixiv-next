# Agent notes

This is Stevey's fork of ppixiv, branch `stevey`. It folds the ppixiv-zh features into the source and adds a redesigned interface. `origin` is upstream ppixiv, so never push there. The fork's own repo is the remote `fork` (public, `github.com/Stevey233/ppixiv-next`); the script's `@updateURL` reads `dist/ppixiv-next.user.js` from its `stevey` branch, so a push there updates every install. Push only when Stevey asks.

## Language

- Code, code comments and commit messages are in English.
- Repo docs for Stevey (the top of `readme.md`, `docs/design.md`) are in Simplified Chinese.
- UI strings are Chinese. Strings written in this fork are Chinese in the source. Upstream's English strings are translated at runtime by `web/vview/zh/` (`dict.js` and `i18n.js`), so add missing upstream strings to `dict.js` instead of editing upstream templates.

## Where things are

- `web/vview/next/`: the new widgets (navigation rail, filter bar, theme).
- `web/resources/css/_next.scss`: all styles of the redesign. It's imported last from `main.scss` and overrides upstream rules. Keep upstream's own SCSS unchanged where possible, so upstream merges stay easy.
- `web/vview/misc/result-filters.js`, `seen-works.js`, `download-names.js`, `hd-thumbnails.js`, `preload.js`: the features from ppixiv-zh.
- `docs/design.md`: the design and the reason for every behavior change. Update it when behavior changes.

## Build and check

- Build with `./tools/build.sh`. Commit `dist/ppixiv-next.user.js` at milestones, since that's the file Stevey installs.
- `.work/harness/` has a Playwright harness that serves fixture Pixiv responses, for screenshots without a login: `cd .work/harness && STEPS=shots.mjs PREFIX=x- node harness.mjs`. Other step files: `mobile.mjs`, `settings.mjs`, `probe.mjs`. Step files that print `ok` or `FAIL` per check and add their own fixture routes: `logic-*.mjs` (paging, seen works, bookmark, follow and download requests), `filters-logic.mjs`, `quickbm-logic.mjs`, `muted-logic.mjs`, `rwheel-logic.mjs`, `changelog-*.mjs`. Run them all after a merge. `visual-harness.mjs` with `visual-*.mjs` screenshots every screen and state, and `perf-harness.mjs` with `perf-*.mjs` measures startup, list growth and scrolling; `.work/optimize-2026-11-12/perf.md` has the commands and the baseline numbers.
- `test/run.sh` runs the feature tests.
- The build puts `.dirty` in `@version` when the tree has changes, and a modified `dist/` counts. Before the build you commit, commit the source and run `git checkout dist`.
- Check on the real pixiv.net before calling a UI change done. ppixiv needs a logged-in page. The T3 preview's Default profile is logged in and has no Tampermonkey: serve the build with `.work/live/serve.py dist/ppixiv-next.user.js 8899`, open `https://www.pixiv.net/robots.txt`, then run this in the page:

  ```js
  (async()=>{const t=await(await fetch('http://127.0.0.1:8899/b.js')).text();document.open();document.write('<!doctype html><html><head></head><body></body></html>');document.close();history.replaceState(null,'','/discovery#ppixiv');setTimeout(()=>(0,eval)(t),0)})()
  ```

  Load `http://127.0.0.1:8899/shim.js` the same way before the script, since a hidden tab stops timers. A hidden preview tab doesn't render: `preview_snapshot` times out, and a `preview_evaluate` that awaits a timer times out too, so click in one call and read the result in the next (`await null` is enough to let the translation observer run). For the same reason, `content-visibility: auto` rows skip hit testing and clicks miss. Click links from script (`a.click()`) or take a snapshot first. Only browse. Never bookmark, like or follow on Stevey's account from a test.
