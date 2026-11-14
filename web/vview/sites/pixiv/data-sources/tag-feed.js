// https://www.pixiv.net/#ppixiv/tag-feed
//
// 常看标签: Pixiv's recommendations for the tags the user looks at most, grouped by tag.
// misc/tag-feed.js loads and keeps the data; this drops what shouldn't show and lists the rest
// in Pixiv's order of tags.  The search view puts a header before each tag's first work
// (sectionAt).  Like 收藏相关, the URL is under the top page's hash, and the mode (#mode=safe,
// r18) filters locally by the works' age rating.
//
// Every work is on page 1.  The list is local, so there's nothing to page through, and a filter
// that empties several tags in a row can't count as several emptied pages and pause the list.

import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';
import { loadTagFeed, tagFeedLoading } from '/vview/misc/tag-feed.js';
import { createTagSectionHeader } from '/vview/next/tag-sections.js';
import RecommendOptions from '/vview/next/recommend-options.js';

// Set by 换一批, so the data source created by it sends a new request.
let refreshRequested = false;

export default class DataSources_TagFeed extends DataSource
{
    get name() { return "tag-feed"; }
    get pageTitle() { return "常看标签"; }
    get ui() { return RecommendOptions; }

    // Leaving for another list discards this data source, so entering again drops works
    // bookmarked meanwhile.  The viewer keeps the same one, so the order stays put.
    get transient() { return true; }

    get noResultsText() { return this.feed?.status == "failed"? "没能取到常看标签的推荐":null; }

    constructor(options)
    {
        super(options);
        this._refresh = refreshRequested;
        refreshRequested = false;
    }

    getDisplayingText()
    {
        let fragment = document.createDocumentFragment();
        fragment.append("常看标签");

        let loading = tagFeedLoading();
        if(loading && this.feed == null)
        {
            let status = document.createElement("span");
            status.className = "n-seed-feed-status";
            status.textContent = ppixiv.mobile? "读取中":"正在读取 Pixiv 首页的推荐";
            fragment.append(status);
        }
        else if(this.feed?.status == "ok")
        {
            // The phone's title bar has room for the count only.
            let status = document.createElement("span");
            status.className = "n-seed-feed-status";
            let count = `共 ${this.mediaIds.length} 件`;
            status.textContent = ppixiv.mobile? count:`${this.sections.length} 个标签 · ${count}`;
            fragment.append(status);
        }

        let refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "n-seed-feed-refresh";
        refresh.textContent = "换一批";
        refresh.title = "重新向 Pixiv 要一次常看标签的推荐，标签和作品可能不同";
        refresh.disabled = loading;
        refresh.addEventListener("click", () => {
            refreshRequested = true;
            ppixiv.app.setCurrentDataSource({ refresh: true, startAtBeginning: true });
        });
        fragment.append(refresh);
        return fragment;
    }

    async loadPageInternal(page)
    {
        if(page != 1)
            return;

        let loading = loadTagFeed({ refresh: this._refresh });
        this.callUpdateListeners();
        this.feed = await loading;
        if(this.feed.status == "ok")
            await this._listFeed(this.feed);
        this.callUpdateListeners();

        if(!this.mediaIds?.length)
            return;
        return { mediaIds: this.mediaIds };
    }

    // Set this.sections and this.mediaIds from a loaded feed, and register the works' data.
    async _listFeed({ sections, works, tagTranslation })
    {
        let mode = this.args.hash.get("mode") ?? "all";
        let infoFor = (id) => ppixiv.mediaCache.getMediaInfoSync(helpers.mediaId.fromIllustId(id), { full: false });

        // A work under two tags stays under the first.
        let listed = new Set();
        let kept = (id) => {
            if(listed.has(id))
                return false;
            listed.add(id);

            let work = works.get(id);
            if(work.isAdContainer || work.isMasked || work.bookmarkData != null || infoFor(id)?.bookmarkData != null)
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
        };
        let shown = sections.map(({ tag, ids }) => ({ tag, ids: ids.filter(kept) })).filter(({ ids }) => ids.length > 0);
        let ids = shown.flatMap((section) => section.ids);

        // Kept data may be 10 minutes old, so it doesn't replace what the media cache already
        // knows, like a bookmark made since.
        await ppixiv.mediaCache.addMediaInfosPartial(ids.filter((id) => infoFor(id) == null).map((id) => works.get(id)), "normal");
        await ppixiv.tagTranslations.addTranslationsDict(tagTranslation);
        let translations = await ppixiv.tagTranslations.getTranslations(shown.map((section) => section.tag));

        this.sections = shown.map(({ tag, ids }) => ({
            tag,
            translation: translations[tag] ?? null,
            mediaIds: ids.map((id) => helpers.mediaId.fromIllustId(id)),
        }));
        this.mediaIds = ids.map((id) => helpers.mediaId.fromIllustId(id));
    }

    // Return the sections as shown, after the filter bar: [{ tag, translation, mediaIds }], with
    // empty ones left out.
    get shownSections()
    {
        let shown = this.idList.mediaIdsByPage.get(1);
        if(shown == null || this.sections == null)
            return [];

        if(this._shownFor !== shown || this._shownLength != shown.length)
        {
            this._shownFor = shown;
            this._shownLength = shown.length;
            let shownSet = new Set(shown);
            this._shownSections = this.sections
                .map((section) => ({ ...section, mediaIds: section.mediaIds.filter((mediaId) => shownSet.has(mediaId)) }))
                .filter((section) => section.mediaIds.length > 0);
        }
        return this._shownSections;
    }

    // The search view calls this for each thumbnail it creates.  Return { header, end } for a work
    // that starts or ends a section, where header is the element to show before the work, or null
    // for any other work.
    sectionAt(mediaId)
    {
        for(let section of this.shownSections)
        {
            let start = section.mediaIds[0] == mediaId;
            let end = section.mediaIds.at(-1) == mediaId;
            if(start || end)
                return { header: start? createTagSectionHeader(section):null, end };
        }
        return null;
    }
}
