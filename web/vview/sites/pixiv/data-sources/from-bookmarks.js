// https://www.pixiv.net/#ppixiv/from-bookmarks
//
// 收藏相关: related works of 20 public bookmarks (10 of the newest 50, 10 older), the works
// several bookmarks point at first.  misc/seed-feed.js loads and caches the data and ranks it; this lists the
// result 60 at a time without further requests.  Like 最近看过, the URL is under the top page's
// hash, since Pixiv has no page for this list.  The mode (#mode=safe, r18) filters locally by the
// works' age rating.
//
// With 分组 on (the from_bookmarks_grouped setting, switched on the option row), the list is in
// sections like 常看标签: works that bookmarks of different groups point at, then one section per
// group of bookmarks sharing a tag, then one per remaining bookmark ("因为收藏了…").

import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';
import RecommendOptions from '/vview/next/recommend-options.js';
import { TagFeedUI, shownSectionsOf, sectionAtOf } from '/vview/next/tag-sections.js';
import { SeedFeed, SEED_COUNT, SEED_PAGE_SIZE, OLD_SEEDS, spreadArtists, groupSeeds } from '/vview/misc/seed-feed.js';

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
    // The grouped view adds the line of sections to jump to, like 常看标签.
    get ui() { return this._grouped? TagFeedUI:RecommendOptions; }
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
        this._grouped = ppixiv.settings.get("from_bookmarks_grouped");
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
            status.textContent = ppixiv.mobile? `查找中${count}`:`正在按 ${total} 件收藏查找相关作品${count}`;
            fragment.append(status);
            return fragment;
        }

        if(this.feed.status == "ok")
        {
            // The phone's title bar has room for the count only.
            let count = `共 ${this.mediaIds.length} 件`;
            let { used, usedOld } = this.feed;
            let seeds = usedOld? `按 ${used} 件收藏（最近 ${SEED_PAGE_SIZE} 件里 ${used - usedOld} 件，更早 ${usedOld} 件）`:`按最近 ${used} 件收藏`;
            status.textContent = ppixiv.mobile? count:`${seeds} · ${count}`;
            fragment.append(status);
        }

        let refresh = document.createElement("button");
        refresh.type = "button";
        refresh.className = "n-seed-feed-refresh";
        refresh.textContent = "重新查找";
        refresh.title = `不用缓存，重新从 Pixiv 读取收藏和相关作品，更早的 ${OLD_SEEDS} 件收藏重新抽`;
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
    // In the grouped view, set this.sections too.
    async _listFeed(feed)
    {
        let { order, works, excluded } = feed;
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

        let spread = (ids) => spreadArtists(ids, (id) => works.get(id).userId).map((id) => helpers.mediaId.fromIllustId(id));
        if(!this._grouped)
            return spread(kept);

        this.sections = await this._group(feed, kept);
        for(let section of this.sections)
            section.mediaIds = spread(section.ids);

        // Each section's last page, for shownSectionsOf.
        let mediaIds = this.sections.flatMap((section) => section.mediaIds);
        let end = 0;
        for(let section of this.sections)
        {
            end += section.mediaIds.length;
            section.lastPage = Math.ceil(end / this.estimatedItemsPerPage);
        }
        return mediaIds;
    }

    // Split kept into sections: works that bookmarks of different groups point at, then each
    // group's (groupSeeds), each in ranked order.  Return [{ kind, label, ids, ... }] without
    // empty ones.
    async _group({ listSeeds, seedInfo, seedsOf }, kept)
    {
        let seeds = listSeeds.map((id) => ({ id, ...seedInfo[id], tags: seedInfo[id]?.tags ?? [] }));
        let groups = groupSeeds(seeds);
        let groupOf = new Map();
        groups.forEach((group, index) => group.seeds.forEach((seed) => groupOf.set(seed.id, index)));

        let shared = [], byGroup = groups.map(() => []);
        for(let id of kept)
        {
            let { best, all } = seedsOf.get(id);
            if(new Set(all.map((seed) => groupOf.get(seed))).size > 1)
                shared.push(id);
            else
                byGroup[groupOf.get(best)].push(id);
        }

        let tags = groups.map((group) => group.tag).filter((tag) => tag != null);
        let translations = await ppixiv.tagTranslations.getTranslations(tags, "en", { lookups: tags.length });
        let sections = [{ kind: "shared", label: "几件收藏都指向", ids: shared }];
        groups.forEach((group, index) => {
            let ids = byGroup[index];
            if(group.tag != null)
            {
                let translation = translations[group.tag] ?? null;
                sections.push({ kind: "tag", label: translation ?? group.tag, tag: group.tag, translation, seeds: group.seeds, ids });
            }
            else
            {
                let seed = group.seeds[0];
                sections.push({ kind: "seed", label: seed.title ?? seed.id, seed, ids });
            }
        });
        return sections.filter((section) => section.ids.length > 0);
    }

    // The jump line (next/tag-sections.js) shows each section's tag, or here its label.
    get shownSections()
    {
        return shownSectionsOf(this, this.sections).map((section) => ({ ...section, tag: section.label, translation: null }));
    }

    sectionAt(mediaId)
    {
        if(this.sections == null)
            return null;
        return sectionAtOf(shownSectionsOf(this, this.sections), mediaId, (section) => this._createHeader(section));
    }

    // A section's header, in the look of 常看标签's (n-tag-section): the name, a pencil-colored
    // line after it, the number of works, and a link.
    _createHeader(section)
    {
        let header = document.createElement("div");
        header.className = "n-tag-section";

        let name = document.createElement("h2");
        name.className = "n-tag-section-name";
        let note = document.createElement("span");
        note.className = "n-tag-section-original";
        let link = document.createElement("a");
        link.className = "n-tag-section-search";

        if(section.kind == "shared")
        {
            name.textContent = section.label;
            note.textContent = "不同的几组收藏都推荐了这些";
        }
        else if(section.kind == "tag")
        {
            name.textContent = section.label;
            let original = section.translation != null && section.translation != section.tag? `${section.tag} · `:"";
            note.textContent = `${original}${section.seeds.length} 件收藏都有这个标签`;
            let searchArgs = helpers.getArgsForTagSearch(section.tag, ppixiv.plocation);
            if(this.args.hash.get("mode") == "r18")
                searchArgs.query.set("mode", "r18");
            link.href = searchArgs;
            link.textContent = "搜索这个标签";
        }
        else
        {
            name.textContent = `因为收藏了「${section.label}」`;
            note.textContent = `${section.seed.userName ?? ""}${section.seed.old? " · 更早的收藏":""}`;
            link.href = `/artworks/${section.seed.id}#ppixiv`;
            link.textContent = "打开这件收藏";
        }

        let count = document.createElement("span");
        count.className = "n-tag-section-count";
        count.textContent = `${section.mediaIds.length} 件`;

        header.append(name);
        if(note.textContent)
            header.append(note);
        header.append(count);
        if(link.href)
            header.append(link);
        return header;
    }
}
