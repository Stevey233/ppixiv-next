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
import { createConditionsUi } from '/vview/sites/gelbooru/conditions-ui.js';

const PER_PAGE = 100;

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

// The list's option row.  The condition menus go in .gb-conditions.
class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=gb-posts-ui>
                <vv-container class=gb-conditions></vv-container>
            </div>
        `});

        createConditionsUi({ dataSource, container: this.querySelector(".gb-conditions"), signal: this.shutdownSignal });
    }
}
