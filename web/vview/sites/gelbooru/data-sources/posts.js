// https://gelbooru.com/index.php?page=post&s=list&tags=<query>#ppixiv
//
// Gelbooru's post search.  The tags parameter holds the whole query, tags and conditions (see
// sites/gelbooru/query.js).  Each list page is one API request of 100 posts.
import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { parseQuery, buildQuery, favoritesUserId } from '/vview/sites/gelbooru/query.js';
import { registerPosts } from '/vview/sites/gelbooru/media.js';
import { setFavorite } from '/vview/sites/gelbooru/favorites.js';
import { createConditionsUi, createConditionsNote } from '/vview/sites/gelbooru/conditions-ui.js';
import { categoriesForTags } from '/vview/sites/gelbooru/tag-categories.js';
import RelatedTagsRow from '/vview/next/related-tags-row.js';

const PER_PAGE = 100;

// The related tags row shows up to this many of the most frequent tags on the first page.
const RELATED_TAGS = 20;

// Gelbooru refuses offsets past about 20000.
const MAX_OFFSET = 20000;

export function queryFromUrl(url)
{
    let tags = new URL(url).searchParams.get("tags") ?? "";
    return tags.trim() == "all"? "":tags.trim();
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

        // Remember the search, like a Pixiv tag search does, but not the plain list or the
        // favorites list.
        let tags = this._searchTags;
        if(tags && favoritesUserId(tags) == null)
            SavedSearchTags.add(tags);
    }

    // The whole query.
    get query() { return queryFromUrl(this.url); }

    // The query's tags without its conditions.  This is what the search box shows.
    get _searchTags()
    {
        return buildQuery({ tags: parseQuery(this.query).tags });
    }

    async loadPageInternal(page)
    {
        let pid = page - 1;
        if(pid * PER_PAGE >= MAX_OFFSET)
            return;

        let query = this.query;
        let { posts, count, tooDeep } = await api.searchPosts({ tags: query, pid, limit: PER_PAGE });
        if(tooDeep)
        {
            console.log(`Gelbooru won't page past page ${page - 1}`);
            return;
        }

        // Before the update below, so the related tags row sees them.
        if(this.relatedTags == null)
            this._findRelatedTags(posts);

        if(this.totalCount != count)
        {
            this.totalCount = count;
            this.callUpdateListeners();
        }

        // Every post on the user's own favorites list is a favorite.
        if(favoritesUserId(query) == api.userId())
        {
            for(let post of posts)
                setFavorite(post.id, true);
        }

        return { mediaIds: await registerPosts(posts) };
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
    // related tags row.  Ask again on each update until it answers.
    async _loadRelatedTagCategories()
    {
        let categories = await categoriesForTags(this.relatedTags);
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
        let tags = this._searchTags;
        return tags? `${tags} - Gelbooru`:"Gelbooru";
    }

    getDisplayingText()
    {
        let title = document.createElement("vv-container");
        let tags = parseQuery(this.query).tags;
        if(tags.length == 0)
        {
            let label = document.createElement("span");
            label.textContent = "全部作品";
            title.appendChild(label);
        }

        for(let tag of tags)
        {
            let span = document.createElement("span");
            span.className = "word tag";
            span.textContent = tag;
            title.appendChild(span);
        }

        if(this.totalCount != null)
        {
            let count = document.createElement("span");
            count.className = "gb-result-count";
            count.textContent = `${this.totalCount.toLocaleString()} 件`;
            title.appendChild(count);
        }
        return title;
    }
}

// The list's option row: the condition menus, then the filter bar after it on the same line, and
// the related tags as a line of chips under both.
class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=gb-posts-ui>
                <div class="box-button-row gb-conditions"></div>
            </div>
        `});

        createConditionsUi({ dataSource, container: this.querySelector(".gb-conditions"), signal: this.shutdownSignal });

        let header = this.root.closest(".thumbnail-ui-box");
        if(!ppixiv.mobile && header)
            new RelatedTagsRow({ container: header, dataSource, maxChips: RELATED_TAGS, signal: this.shutdownSignal });
    }
}
