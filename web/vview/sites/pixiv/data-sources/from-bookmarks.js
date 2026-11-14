// https://www.pixiv.net/#ppixiv/from-bookmarks
//
// 收藏相关: related works of the user's most recent public bookmarks, the works several bookmarks
// point at first.  misc/seed-feed.js loads and caches the data and ranks it; this lists the
// result 60 at a time without further requests.  Like 最近看过, the URL is under the top page's
// hash, since Pixiv has no page for this list.  The mode (#mode=safe, r18) filters locally by the
// works' age rating.

import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { SeedFeed, SEED_COUNT } from '/vview/misc/seed-feed.js';

const seedFeed = new SeedFeed();
seedFeed.watchBookmarks();

// Set by 重新查找, so the data source created by the refresh ignores the cache.
let refreshRequested = false;

const FAILED_TEXT = {
    "no-bookmarks": "还没有公开收藏，先收藏几件作品",
    "bookmarks-failed": "没能读到收藏，稍后点\"重新查找\"再试",
    "related-failed": "没能取到相关作品，稍后点\"重新查找\"再试",
};

export default class DataSources_FromBookmarks extends DataSource
{
    get name() { return "from-bookmarks"; }
    get pageTitle() { return "收藏相关"; }
    get ui() { return UI; }
    get estimatedItemsPerPage() { return 60; }

    // Leaving for another list discards this data source, so entering again drops works
    // bookmarked meanwhile.  The viewer keeps the same one, so the order stays put.
    get transient() { return true; }

    get noResultsText() { return FAILED_TEXT[this.feed?.status] ?? null; }

    constructor(options)
    {
        super(options);
        this._refresh = refreshRequested;
        refreshRequested = false;
    }

    // Refresh the title's progress line while this list is shown.
    startup()
    {
        super.startup();
        this._progressListener = new AbortController();
        seedFeed.addEventListener("progress", () => this.callUpdateListeners(), { signal: this._progressListener.signal });
    }

    shutdown()
    {
        super.shutdown();
        this._progressListener?.abort();
    }

    getDisplayingText()
    {
        let fragment = document.createDocumentFragment();
        fragment.append("收藏相关");

        let status = document.createElement("span");
        status.className = "n-seed-feed-status";
        if(this.mediaIds == null)
        {
            let progress = seedFeed.progress;
            let total = progress?.total ?? SEED_COUNT;
            let count = progress? ` ${progress.done}/${total}`:"";
            status.textContent = ppixiv.mobile? `查找中${count}`:`正在按最近 ${total} 件收藏查找相关作品${count}`;
            fragment.append(status);
            return fragment;
        }

        if(this.feed.status == "ok")
        {
            // The phone's title bar has room for the count only.
            let count = `共 ${this.mediaIds.length} 件`;
            status.textContent = ppixiv.mobile? count:`按最近 ${this.feed.used} 件收藏 · ${count}`;
            fragment.append(status);
        }

        let refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "n-seed-feed-refresh";
        refresh.textContent = "重新查找";
        refresh.title = "不用缓存，重新从 Pixiv 读取最近的收藏和相关作品";
        refresh.addEventListener("click", () => {
            refreshRequested = true;
            ppixiv.app.setCurrentDataSource({ refresh: true, startAtBeginning: true });
        });
        fragment.append(refresh);
        return fragment;
    }

    async loadPageInternal(page)
    {
        if(this.mediaIds == null)
        {
            this.feed = await seedFeed.build({ refresh: this._refresh });
            this.mediaIds = this.feed.status == "ok"? await this._listFeed(this.feed):[];
            this.callUpdateListeners();
        }

        let perPage = this.estimatedItemsPerPage;
        let mediaIds = this.mediaIds.slice((page-1)*perPage, page*perPage);
        if(mediaIds.length == 0)
            return;
        return { mediaIds };
    }

    // Return the media IDs to list from a built feed, and register the works' thumbnail data.
    async _listFeed({ order, works, excluded })
    {
        let mode = this.args.hash.get("mode") ?? "all";
        let infoFor = (id) => ppixiv.mediaCache.getMediaInfoSync(helpers.mediaId.fromIllustId(id), { full: false });
        let kept = order.filter((id) => {
            let work = works.get(id);
            if(excluded.has(id) || work.isMasked || work.bookmarkData != null || infoFor(id)?.bookmarkData != null)
                return false;

            // The result filters leave these out too (misc/muted-works.js), but dropping them
            // here keeps them out of the count in the title.
            if(ppixiv.muting.anyTagMuted(work.tags))
                return false;
            if(mode == "safe")
                return work.xRestrict == 0;
            if(mode == "r18")
                return work.xRestrict != 0;
            return true;
        });

        // A cached record may be a day old, so it doesn't replace what the media cache already
        // knows, like a bookmark made since.
        await ppixiv.mediaCache.addMediaInfosPartial(kept.filter((id) => infoFor(id) == null).map((id) => works.get(id)), "normal");

        return kept.map((id) => helpers.mediaId.fromIllustId(id));
    }
}

// The leading pair on 推荐作品 and 收藏相关 that switches between them, keeping the mode.
// current is "discovery" or "from-bookmarks", and mode is "all", "safe" or "r18".  Return the
// two links, to put first in the list's option row.
export function createSourceSwitch(current, mode)
{
    let links = [
        ["discovery", "Pixiv 推荐", "Pixiv 自己的推荐", `/discovery${mode != "all"? `?mode=${mode}`:""}#ppixiv`],
        ["from-bookmarks", "收藏相关", "按最近 10 件收藏找相关作品，几件收藏都指向的排在前面", `/#ppixiv/from-bookmarks${mode != "all"? `?mode=${mode}`:""}`],
    ];
    return links.map(([key, label, popup, url]) => {
        let link = helpers.createBoxLink({ label, popup, link: url, asElement: true });
        link.classList.add("n-source-switch");
        helpers.html.setClass(link, "selected", key == current);
        return link;
    });
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    ${ helpers.createBoxLink({label: "All",      popup: "Show all works",    dataType: "all" }) }
                    ${ helpers.createBoxLink({label: "All ages", popup: "All ages",          dataType: "safe" }) }
                    ${ helpers.createBoxLink({label: "R18",      popup: "R18",               dataType: "r18", classes: ["r18"] }) }
                </div>
            </div>
        `});

        let mode = dataSource.args.hash.get("mode") ?? "all";
        this.root.querySelector(".box-button-row").prepend(...createSourceSwitch("from-bookmarks", mode));
        dataSource.setItem(this.root, { type: "all", fields: {"#mode": "all"}, defaults: {"#mode": "all"} });
        dataSource.setItem(this.root, { type: "safe", fields: {"#mode": "safe"}, defaults: {"#mode": "all"} });
        dataSource.setItem(this.root, { type: "r18", fields: {"#mode": "r18"}, defaults: {"#mode": "all"} });
    }
}
