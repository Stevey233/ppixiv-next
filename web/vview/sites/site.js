import { helpers } from '/vview/misc/helpers.js';

// What a site supports.  Shared code that shows or uses a site-dependent feature checks
// ppixiv.site.caps.<name>.  Each missing capability also sets body.no-<name> (kebab-case), for
// elements that are hidden from CSS.  These defaults are Pixiv's.
export const DEFAULT_CAPS = Object.freeze({
    users: true,                // avatars, follows, user pages and mutes, user search
    likes: true,
    privateBookmarks: true,
    bookmarkTags: true,
    mangaPages: true,
    tagTranslations: true,
    recommendations: true,      // similar works and the recommendation lists
    rankings: true,
    imageTranslation: true,
    series: true,
    download: true,
    tagSearch: true,            // the header search box
});

// Each site we support has a singleton Site class.  We currently only support
// using a single site (the site we're on) and only create its singleton.
//
// A site can also define these hooks.  Shared code calls them when they exist and runs Pixiv's code
// otherwise:
//
// - loadMediaInfo(mediaId), batchLoadMediaInfo(mediaIds): load media info that isn't cached
// - bookmarkAdd(mediaId), bookmarkRemove(mediaId): add or remove a bookmark, returning true on success
// - autocomplete(word, { signal }): tag completions, [{ tag, label, category, count }]
// - getArgsForTagSearch(tags, url), getArgsForTagRefine(tag, url, { exclude }), getSearchTagsFromUrl(url)
// - mainDestinations(), otherDestinations(): the navigation rail's lists
// - createSearchSettings(globalOptions): the site's search settings, in place of Pixiv's related
//   tags and new search defaults
export class Site
{
    constructor()
    {
        this.dataSourcesByUrl = {};
    }

    get caps() { return DEFAULT_CAPS; }

    // The site's name, for "回到 <name> 原页面".
    get name() { return "Pixiv"; }

    // The page icon, or null for ppixiv's default.
    get iconUrl() { return null; }

    // The Referer and Origin sent when downloading images.
    get downloadReferer() { return "https://www.pixiv.net/"; }

    // Set body.no-<cap> for each capability the site lacks.
    applyCapClasses()
    {
        for(let [name, supported] of Object.entries(this.caps))
        {
            let className = "no-" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
            helpers.html.setClass(document.body, className, !supported);
        }
    }

    // Run initial setup.  Return false if initialization failed and we should stop.
    async init() { return true; }

    // This is called early in initialization.  If we're running natively and the URL is
    // empty, navigate to a default directory, so we don't start off on an empty page
    // every time.  If we're on Pixiv, make sure we're on a supported page.
    async setInitialUrl() { }

    // Return the data source for a URL, or null if the page isn't supported.
    getDataSourceForUrl(url) { return null; }

    // Create the data source for a given URL.
    //
    // If we've already created a data source for this URL, the same one will be
    // returned.
    createDataSourceForUrl(url, {
        // If force is true, we'll always create a new data source, replacing any
        // previously created one.
        force=false,

        // If startAtBeginning is true, the data source page number in url will be
        // ignored, returning to page 1.  This only matters for data sources that support
        // a start page.
        startAtBeginning=false,
    }={})
    {
        let args = new helpers.args(url);

        let dataSourceClass = this.getDataSourceForUrl(url);
        if(dataSourceClass == null)
        {
            console.error("Unexpected path:", url.pathname);
            return;
        }

        // Canonicalize the URL to see if we already have a data source for this URL.  We only
        // keep one data source around for each canonical URL (eg. search filters).
        let canonicalUrl = helpers.getCanonicalUrl(url, { startAtBeginning: true }).url.toString();
        let oldDataSource = this.dataSourcesByUrl[canonicalUrl];
        if(!force && oldDataSource != null)
        {
            // console.log("Reusing data source for", url.toString());
            // If the URL has a page number in it, only return it if this data source can load the
            // page the caller wants.  If we have a data source that starts at page 10 and the caller
            // wants page 1, the data source probably won't be able to load it since pages are always
            // contiguous.
            let page = oldDataSource.getStartPage(args);
            if(!oldDataSource.canLoadPage(page))
                console.log(`Not using cached data source because it can't load page ${page}`);
            else
                return oldDataSource;
        }
        
        // The search page isn't part of the canonical URL, but keep it in the URL we create
        // the data source with, so it starts at the current page.
        let baseUrl = helpers.getCanonicalUrl(url, { startAtBeginning }).url.toString();
        let dataSource = new dataSourceClass({ url: baseUrl });
        this.dataSourcesByUrl[canonicalUrl] = dataSource;
        return dataSource;
    }

    // If we have the given data source cached, discard it, so it'll be recreated
    // the next time it's used.
    discardDataSource(dataSource)
    {
        let urlsToRemove = [];
        for(let url in this.dataSourcesByUrl)
        {
            if(this.dataSourcesByUrl[url] === dataSource)
                urlsToRemove.push(url);
        }

        for(let url of urlsToRemove)
            delete this.dataSourcesByUrl[url];
    }
}
