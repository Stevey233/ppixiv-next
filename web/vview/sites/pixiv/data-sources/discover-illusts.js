// /discovery - Recommended Works

import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { createSourceSwitch } from '/vview/sites/pixiv/data-sources/from-bookmarks.js';

export default class DataSource_Discovery extends DataSource
{
    get name() { return "discovery"; }
    get pageTitle() { return "Recommended Works"; }
    getDisplayingText() { return "Recommended Works"; }
    get ui() { return UI; }
    get estimatedItemsPerPage() { return 60; }

    // Each request returns a random 60 from a pool that runs dry within a sitting: about a third
    // repeats earlier requests (measured on pixiv.net, 2026-11-14), and with 隐藏看过的 most of the
    // rest can be hidden.  So a page of repeats isn't the end, requests after one that added
    // little are spaced out, and three in a row that each add almost nothing stop the list.
    get randomPages() { return true; }

    _stopAfterPage({ added, returnedNew })
    {
        this._lastAdded = added;
        this._lowPages ??= [];
        if(added >= 3)
        {
            this._lowPages = [];
            return null;
        }

        this._lowPages.push({ added, hidden: Math.max(0, returnedNew - added) });
        if(this._lowPages.length < 3)
            return null;

        let total = this._lowPages.reduce((sum, low) => sum + low.added, 0);
        let hidden = this._lowPages.reduce((sum, low) => sum + low.hidden, 0);
        return `这一轮推荐差不多看完了（最近 3 次请求只有 ${total} 件新作品${hidden? `，另有 ${hidden} 件被筛选隐藏`:""}）`;
    }

    loadMoreFiltered()
    {
        this._lowPages = [];
        return super.loadMoreFiltered();
    }

    async loadPageInternal(page)
    {
        // After a page that added fewer than 10 works, start the next request no sooner than
        // 1.5 seconds after the last one started.
        let wait = this._lastAdded < 10? this._lastRequestStart + 1500 - Date.now():0;
        if(wait > 0)
            await helpers.other.sleep(wait);
        this._lastRequestStart = Date.now();

        // Get "mode" from the URL.  If it's not present, use "all".
        let mode = this.url.searchParams.get("mode") || "all";
        let result = await helpers.pixivRequest.get("/ajax/discovery/artworks", {
            limit: this.estimatedItemsPerPage,
            mode: mode,
            lang: "en",
        });

        // result.body.recommendedIllusts[].recommendMethods, recommendSeedIllustIds
        // has info about why it recommended it.
        let thumbs = result.body.thumbnails.illust;
        await ppixiv.mediaCache.addMediaInfosPartial(thumbs, "normal");

        let mediaIds = [];
        for(let thumb of thumbs)
            mediaIds.push(helpers.mediaId.fromIllustId(thumb.id));

        ppixiv.tagTranslations.addTranslationsDict(result.body.tagTranslation);
        return { mediaIds }
    }
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

        // Pixiv 推荐 / 收藏相关 first, see from-bookmarks.js.
        let mode = dataSource.url.searchParams.get("mode") || "all";
        this.root.querySelector(".box-button-row").prepend(...createSourceSwitch("discovery", mode));

        dataSource.setItem(this.root, { type: "all", fields: {mode: "all"}, defaults: {mode: "all"} });
        dataSource.setItem(this.root, { type: "safe", fields: {mode: "safe"}, defaults: {mode: "all"} });
        dataSource.setItem(this.root, { type: "r18", fields: {mode: "r18"}, defaults: {mode: "all"} });
    }
}
