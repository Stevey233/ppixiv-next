// https://gelbooru.com/index.php?page=post&s=list&tags=<query>#ppixiv
//
// Gelbooru's post search.  The tags parameter holds the whole query, tags and conditions (see
// sites/gelbooru/query.js).  Each list page is one API request of 100 posts.
//
// The rail's 热门 and 随机 are queries of this list too, so the condition menus work on them:
//
// - 热门 is sort:score with #ppixiv?popular=day|week|month, which adds id:>N for posts of about
//   that age (popular.js).
// - Any sort:random query is random: every request is a new random set from the whole result, so
//   posts already listed are dropped and the list goes on until it has listed them all.
//
// Gelbooru won't page past page 200 (pid 200).  In the default order the list continues with
// id:<the lowest ID of the previous page and pid=0; sorted lists end there with a note.
import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import { helpers } from '/vview/misc/helpers.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { parseQuery, buildQuery, splitQuery, favoritesUserId } from '/vview/sites/gelbooru/query.js';
import { registerPosts } from '/vview/sites/gelbooru/media.js';
import { noteFavorites } from '/vview/sites/gelbooru/favorites.js';
import { createConditionsUi, createConditionsNote } from '/vview/sites/gelbooru/conditions-ui.js';
import { categoriesForTags } from '/vview/sites/gelbooru/tag-categories.js';
import { tokenLabel } from '/vview/sites/gelbooru/tag-names.js';
import RelatedTagsRow from '/vview/next/related-tags-row.js';
import { PERIODS, periodKey, periodLabel, popularMinId } from '/vview/sites/gelbooru/popular.js';

const PER_PAGE = 100;

// The related tags row shows up to this many of the most frequent tags on the first page.
const RELATED_TAGS = 20;

// Gelbooru answers "Too deep!" past pid 200, so pages 1 to 200 can be asked for by page.
const MAX_PAGES = 200;

export function queryFromUrl(url)
{
    let tags = new URL(url).searchParams.get("tags") ?? "";
    return tags.trim() == "all"? "":tags.trim();
}

// The search a posts list URL adds to recent searches: its tags without conditions, or null for
// the plain list and the favorites list.
export function searchToRemember(url)
{
    let query = queryFromUrl(url);
    let tags = buildQuery({ tags: parseQuery(query).tags });
    return tags && favoritesUserId(query) == null? tags:null;
}

export default class DataSource_GelbooruPosts extends DataSource
{
    get name() { return "gb-posts"; }
    get ui() { return UI; }
    get supportsStartPage() { return true; }
    get estimatedItemsPerPage() { return PER_PAGE; }
    get allowExpandingMangaPages() { return false; }

    constructor(args)
    {
        super(args);

        // Remember the search, like a Pixiv tag search does.
        let tags = searchToRemember(this.url);
        if(tags)
            SavedSearchTags.add(tags);

        // The lowest post ID each page's response had, for continuing past page 200.
        this._lowestIdByPage = new Map();

        // The post IDs a random list has returned.
        this._randomIds = new Set();
    }

    // Redraw the title when Chinese tag names arrive or are turned on or off.
    startup()
    {
        super.startup();
        window.addEventListener("tag-translations-changed", this._tagNamesChanged);
    }

    shutdown()
    {
        super.shutdown();
        window.removeEventListener("tag-translations-changed", this._tagNamesChanged);
    }

    _tagNamesChanged = () => this.callUpdateListeners();

    // The whole query.
    get query() { return queryFromUrl(this.url); }

    // The query's tags without its conditions.  This is what the search box shows.
    get _searchTags()
    {
        return buildQuery({ tags: parseQuery(this.query).tags });
    }

    // The user's own favorites, which show posts with a muted tag (misc/muted-works.js).
    get isOwnFavorites() { return favoritesUserId(this.query) == api.userId(); }

    // "day", "week" or "month" on 热门, otherwise null.
    get popularPeriod()
    {
        let period = this.args.hash.get("popular");
        return period == null? null:periodKey(period);
    }

    // Any sort, including one query.js doesn't know, like sort:id:asc.
    get _sorted()
    {
        return splitQuery(this.query).some((token) => /^sort:/i.test(token));
    }

    get randomPages() { return parseQuery(this.query).conditions.sort == "random"; }

    // A cold start past page 200 starts at page 200.
    getStartPage(args)
    {
        return Math.min(super.getStartPage(args), MAX_PAGES);
    }

    async loadPageInternal(page)
    {
        let query = this.query;
        if(this.popularPeriod != null)
        {
            this._popularMinId ??= await popularMinId(this.popularPeriod);
            query = `${query} id:>${this._popularMinId}`;
        }

        let pid = page - 1;
        if(this.randomPages)
        {
            // Every request is a new random set, so always ask for the first page, and stop once
            // every post in the result has been listed.
            if(this.totalCount != null && this._randomIds.size >= this.totalCount)
                return;
            pid = 0;
        }
        else if(page > MAX_PAGES)
        {
            let lowest = this._lowestIdByPage.get(page - 1);
            if(this._sorted || lowest == null)
            {
                this.reachedDepthLimit = this._sorted;
                this.callUpdateListeners();
                return;
            }
            query = `${query} id:<${lowest}`;
            pid = 0;
        }

        let { posts, count, tooDeep } = await api.searchPosts({ tags: query.trim(), pid, limit: PER_PAGE });
        if(tooDeep)
        {
            console.log(`Gelbooru won't page past page ${page - 1}`);
            return;
        }

        // Before the update below, so the related tags row sees them.
        if(this.relatedTags == null)
            this._findRelatedTags(posts);

        // Past page 200 the count is of what's left below the cursor, so keep the first one.
        if(page <= MAX_PAGES && this.totalCount != count)
        {
            this.totalCount = count;
            this.callUpdateListeners();
        }

        if(posts.length)
            this._lowestIdByPage.set(page, Math.min(...posts.map((post) => post.id)));
        for(let post of posts)
            this._randomIds.add(post.id);

        // Every post on the user's own favorites list is a favorite.
        if(this.isOwnFavorites)
            noteFavorites(posts.map((post) => post.id));

        return { mediaIds: await registerPosts(posts) };
    }

    // Shown at the end of the list when a sorted list reached Gelbooru's limit.
    get listEndText()
    {
        if(!this.reachedDepthLimit)
            return null;
        return "Gelbooru 最多只能翻到大约 2 万件（200 页），排序的列表到这里为止。想看更多可以加标签或条件，缩小搜索范围。";
    }

    // The tags most frequent among the first page loaded, without the ones the query has, for the
    // related tags row.  They're only taken from the first page, so the row doesn't change as the
    // list grows.  A search without tags (the plain list, favorites) has none.
    _findRelatedTags(posts)
    {
        let searched = parseQuery(this.query).tags.map((tag) => tag.replace(/^-/, ""));
        if(searched.every((tag) => tag.includes(":")))
        {
            this.relatedTags = [];
            return;
        }

        let counts = new Map();
        for(let post of posts)
        {
            for(let tag of post.tags.split(" "))
            {
                if(tag != "" && !searched.includes(tag))
                    counts.set(tag, (counts.get(tag) ?? 0) + 1);
            }
        }

        this.relatedTags = [...counts.entries()]
            .sort(([tagA, countA], [tagB, countB]) => countB - countA || (tagA < tagB? -1:1))
            .slice(0, RELATED_TAGS)
            .map(([tag]) => tag);
        this._loadRelatedTagCategories();
    }

    // The category of each related tag, once tag-categories.js knows it, as a class name for the
    // related tags row.  Ask again on each update until it answers, one question at a time.
    async _loadRelatedTagCategories()
    {
        if(this._loadingRelatedTagCategories)
            return;

        // A failed lookup leaves the row uncolored, and the next update asks again.
        this._loadingRelatedTagCategories = true;
        let categories = null;
        try {
            categories = await categoriesForTags(this.relatedTags);
        } catch(error) {
            console.log("Couldn't load tag categories:", error.message);
        } finally {
            this._loadingRelatedTagCategories = false;
        }

        if(categories == null)
            return;

        this.relatedTagCategories = categories;
        this.callUpdateListeners();
    }

    relatedTagClass(tag)
    {
        if(this.relatedTagCategories == null)
            this._loadRelatedTagCategories();
        let category = this.relatedTagCategories?.[tag];
        return category? `tag-category-${category}`:null;
    }

    // The active conditions and a link without them, at the end of the list or under 没有结果.
    createListEndNote()
    {
        return createConditionsNote(this);
    }

    get pageTitle()
    {
        if(this.popularPeriod != null)
            return "热门 - Gelbooru";
        let tags = parseQuery(this.query).tags.map(tokenLabel).join(" ");
        if(!tags && this.randomPages)
            return "随机 - Gelbooru";
        return tags? `${tags} - Gelbooru`:"Gelbooru";
    }

    getDisplayingText()
    {
        let title = document.createElement("vv-container");
        let tags = parseQuery(this.query).tags;
        if(this.popularPeriod != null || tags.length == 0)
        {
            let label = document.createElement("span");
            label.textContent =
                this.popularPeriod != null? `热门 · ${periodLabel(this.popularPeriod)}`:
                this.randomPages? "随机":
                "全部作品";
            title.appendChild(label);
        }

        // Tags with a Chinese name show it, with the tag on hover.
        for(let tag of tags)
        {
            let span = document.createElement("span");
            span.className = "word tag";
            span.textContent = tokenLabel(tag);
            if(span.textContent != tag)
                span.title = tag;
            title.appendChild(span);
        }

        // A random list's count is the whole result's, which isn't what it lists.
        if(this.totalCount != null && !this.randomPages)
        {
            let count = document.createElement("span");
            count.className = "gb-result-count";
            count.textContent = `${this.totalCount.toLocaleString()} 件`;
            title.appendChild(count);
        }
        return title;
    }
}

// The list's option row: 热门's periods, then the condition menus, then the filter bar after them
// on the same line, and the related tags as a line of chips under all of them.
class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=gb-posts-ui>
                <div class="box-button-row gb-popular-periods" hidden></div>
                <div class="box-button-row gb-conditions"></div>
            </div>
        `});

        if(dataSource.popularPeriod != null)
        {
            let row = this.querySelector(".gb-popular-periods");
            row.hidden = false;
            for(let [key, label] of PERIODS)
            {
                let link = helpers.createBoxLink({ label, popup: `${label}发的帖子里分数最高的`, dataType: key, asElement: true });
                row.appendChild(link);
                dataSource.setItem(row, { type: key, fields: { "#popular": key } });
            }
        }

        createConditionsUi({ dataSource, container: this.querySelector(".gb-conditions"), signal: this.shutdownSignal });

        let header = this.root.closest(".thumbnail-ui-box");
        if(!ppixiv.mobile && header)
            new RelatedTagsRow({ container: header, dataSource, maxChips: RELATED_TAGS, signal: this.shutdownSignal });
    }
}
