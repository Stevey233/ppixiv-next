# ppixiv 新界面

这是 Stevey 的 ppixiv 分支（`stevey` 分支），把 ppixiv-zh 的功能直接并进 ppixiv 源码，并从头重做了界面。它取代原版 ppixiv 加 ppixiv-zh 的组合：装这一个脚本就够了。ppixiv-zh 的仓库已在 2026-11-13 删除。脚本名是"ppixiv 新界面"，命名空间 `stevey-ppixiv-next`。

- 设计方向、配色和字体、每处功能和交互改动的原因：[docs/design.md](docs/design.md)
- 构建好的脚本：`dist/ppixiv-next.user.js`
- 最近一次界面审计和修复记录：[docs/audit-2026-11-11.md](docs/audit-2026-11-11.md)

同一个脚本也在 gelbooru.com 上运行，界面和 Pixiv 上一样：帖子列表和看图、排序和分数、分级、类型、尺寸等搜索条件、热门和随机、Gelbooru 收藏（缩略图上的心）、最近看过、按分类分组的标签和中文标签名、标签库、下载。要先登录 Gelbooru：脚本从账号设置页读出 API key，存在 gelbooru.com 自己的 localStorage 里，只发给 gelbooru.com。中文标签名来自仓库里的标签包 `data/gelbooru-tags.*.tsv.gz`，第一次从 GitHub 下载约 5 MB，之后存在浏览器的 IndexedDB 里。手机版只在模拟器里检查过：底栏是最新、热门、标签库、收藏，搜索标签用标签库。各处的行为和原因见 [docs/design.md](docs/design.md) 的"Gelbooru"一节。

## 安装

1. 在 Tampermonkey 里停用或删除 ppixiv 和 ppixiv-zh。原版 ppixiv 同时启用时，新脚本会在页面上提示并且不启动。
2. 打开 <https://raw.githubusercontent.com/Stevey233/ppixiv-next/stevey/dist/ppixiv-next.user.js>，Tampermonkey 会弹出安装页，点"安装"。
3. 刷新 pixiv.net 或 gelbooru.com 的页面。

更新：脚本的 `@updateURL` 指向上面这个地址，Tampermonkey 按它的检查间隔自动更新，也可以在 Tampermonkey 里对"ppixiv 新界面"点"检查更新"。新版本要推到 GitHub 的 `stevey` 分支才会被检查到。

脚本匹配两个网站：`@match https://*.pixiv.net/*` 和 `@match https://gelbooru.com/*`。从只匹配 Pixiv 的旧版本更新时，多了一个网站，Tampermonkey 可能会弹出更新页让你确认。

设置存在同一个 localStorage 里，ppixiv-zh 的设置会在新脚本第一次启动时导入一次，原值不删。localStorage 按网站分开，gelbooru.com 上的设置是另一份。

## 构建

```
./tools/build.sh
```

它在仓库根目录运行上游的 `python3 -m vview.build.build_ppixiv`（第一次会下载 dart-sass 和 esbuild 到 `bin/`），再把 `output/ppixiv-main.user.js` 复制成 `dist/ppixiv-next.user.js`。

---

以下是上游 ppixiv 的说明。

This user script improves viewing illustrations on Pixiv.

The most recent version [can be installed here](https://ppixiv.org/install).

![](https://ppixiv.org/screenshot.png)

Features:

- Fast endless search results and an uncluttered image view.
- One-click bookmarks and following.
- Dark theme.
- Download Pixiv animations (ugoira) as an MKV.
- Download manga pages as a ZIP.
- Seek, pause and fullscreen animations.
- Navigate search results with the mouse wheel or keyboard (pgup, pgdn).
- Faster image loading.
- Background image loading for fast navigation.
- Better scaling for pixel art.
- Slideshow mode for viewing bookmarks.

When viewing an image:

- Click to zoom and drag to pan around.
- Right-click to like, bookmark, view the artist, edit bookmark tags, etc.
- Right-click + mousewheel to adjust zoom.
- Click videos to pause and unpause.
- Click the thumbnail icon to switch to the result list (or press escape).
- Mouse wheel to go the next/previous image.
- Double-click to toggle fullscreen.

Other stuff:

- Click the Pixiv icon in any page to view the regular page, and click the Pp icon in the
  corner to come back.
- Automatically pan images (optional).
- When viewing an image:
  Page down: move to the next image
  Page up: move to the previous image
  Home: jump to the first manga page
  End: jump to the last manga page (useful to skip past very long posts)
  ^B to quick bookmark, Alt-^B to bookmark privately, and ^V to like.
- When playing a video:
  Home: rewind
  Space: pause
  Q, W: frame advance
  1-9: set playback speed

Supported pages:

- Image and user searches
- Artist work listings
- Viewing bookmarks
- Recommended works and users
- Similar bookmarks, illustrations, artists
- New following posts
- Rankings

Portions under MIT/BSD license as listed in source.  All other code is in the
public domain.

