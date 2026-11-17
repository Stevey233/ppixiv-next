// gelbooru.com.  See .work/gelbooru/DESIGN.md.
//
// The lists keep Gelbooru's own URLs with #ppixiv added, so reloading, #no-ppixiv and a pasted
// Gelbooru link all land on the same list:
//
//   /index.php?page=post&s=list&tags=<query>#ppixiv     gb-posts
//   /index.php?page=post&s=view&id=<n>#ppixiv           gb-post
//   /index.php#ppixiv/history                           gb-history (最近看过)
import { helpers } from '/vview/misc/helpers.js';
import * as Site from '/vview/sites/site.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { searchFromList, refineQuery, favoritesUserId, parseQuery, buildQuery } from '/vview/sites/gelbooru/query.js';
import { registerPosts, loadPostCategories } from '/vview/sites/gelbooru/media.js';
import TagLibrary from '/vview/sites/gelbooru/tag-library.js';
import { chineseNames, watchTagNames } from '/vview/sites/gelbooru/tag-names.js';
import { openTagLibrary } from '/vview/sites/gelbooru/tag-library-dialog.js';
import { fillPostDetails, originalPostUrl } from '/vview/sites/gelbooru/post-details.js';
import { fillSettingsPage } from '/vview/sites/gelbooru/settings.js';
import { setFavorite, syncFavorites } from '/vview/sites/gelbooru/favorites.js';
import { rememberCategories } from '/vview/sites/gelbooru/tag-categories.js';
import * as links from '/vview/sites/gelbooru/links.js';
import Posts, { queryFromUrl, searchToRemember } from '/vview/sites/gelbooru/data-sources/posts.js';
import Post from '/vview/sites/gelbooru/data-sources/post.js';
import History, { storePostCopy } from '/vview/sites/gelbooru/data-sources/history.js';
import { defaultConditions, createSearchSettings } from '/vview/sites/gelbooru/search-defaults.js';

// Autocomplete shows this many tags from the tag library for text that isn't sent to Gelbooru,
// and at most AUTOCOMPLETE_LIBRARY_EXTRA after Gelbooru's own suggestions.
const AUTOCOMPLETE_LIBRARY_LIMIT = 10;
const AUTOCOMPLETE_LIBRARY_EXTRA = 5;

const CAPS = Object.freeze({
    ...Site.DEFAULT_CAPS,
    users: false,
    likes: false,
    privateBookmarks: false,
    bookmarkTags: false,
    mangaPages: false,
    tagTranslations: false,
    recommendations: false,
    rankings: false,
    imageTranslation: false,
    series: false,
});

export default class SiteGelbooru extends Site.Site
{
    get caps() { return CAPS; }
    get name() { return "Gelbooru"; }
    get iconUrl() { return "/favicon.ico"; }
    get downloadReferer() { return "https://gelbooru.com/"; }

    async init()
    {
        helpers.html.setClass(document.body, "gelbooru", true);

        // Move Gelbooru's page, with its ads, out of the document.
        let html = document.createElement("document");
        helpers.html.moveChildren(document.head, html);
        helpers.html.moveChildren(document.body, html);

        let credentials;
        try {
            credentials = await api.getCredentials();
        } catch(error) {
            console.log("Gelbooru account page not read:", error.message);
            this._showStartFailed({ unreachable: true });
            return false;
        }

        if(credentials == null)
        {
            this._showStartFailed({ unreachable: false });
            return false;
        }

        // Shared code reads Pixiv's account info without checking.  Gelbooru has no premium,
        // content mode or recaptcha.
        ppixiv.pixivInfo = {
            userId: credentials.userId,
            premium: false,
            include_r18: true,
            include_r18g: true,
            hideAiWorks: false,
            pixivTests: {},
            recaptchaKey: null,
        };

        // Read or check the favorites in the background.  The first list doesn't wait for it.
        syncFavorites(credentials.userId).catch((error) => console.log("Favorites not read:", error.message));

        // The tag library gives categories (and later Chinese names) without requests.  Nothing
        // waits for it, and without it tags are looked up with the tag API.
        this.tagLibrary = new TagLibrary();
        watchTagNames(this.tagLibrary);
        this.tagLibrary.load().catch((error) => console.log("Tag library not loaded:", error.message));
        return true;
    }

    // Without an API key nothing loads.  Say why: not logged in (with a way to log in), or the
    // account page didn't load (with a retry), and offer a way back to the page.
    _showStartFailed({ unreachable })
    {
        if(!unreachable)
            console.log("No Gelbooru API key: not logged in");
        document.documentElement.style.filter = "";
        let back = new URL(location.href);
        back.hash = "#no-ppixiv";

        let box = document.createElement("div");
        box.className = "gb-logged-out";
        box.style.cssText = "max-width:420px;margin:20vh auto;padding:24px;border-radius:12px;background:#222;color:#eee;font:15px/1.6 system-ui,sans-serif;text-align:center;";
        box.innerHTML = `
            <p class=gb-start-message></p>
            <p><a class=gb-login-link style="color:#8cf"></a> · <a class=gb-back-link style="color:#8cf"></a></p>
        `;
        box.querySelector(".gb-start-message").textContent = unreachable?
            "连不上 Gelbooru 的账号设置页，读不到 API key。":
            "还没有登录 Gelbooru，新界面需要登录后的 API key 才能读取作品。";
        let login = box.querySelector(".gb-login-link");
        if(unreachable)
        {
            login.href = location.href;
            login.textContent = "重试";
            login.addEventListener("click", (e) => {
                e.preventDefault();
                location.reload();
            });
        }
        else
        {
            login.href = api.loginUrl;
            login.textContent = "登录 Gelbooru";
        }
        let original = box.querySelector(".gb-back-link");
        original.href = back.toString();
        original.textContent = "使用原页面";
        document.body.appendChild(box);
    }

    async setInitialUrl()
    {
        let args = helpers.args.location;
        let page = args.query.get("page");
        let s = args.query.get("s");

        if(page == "favorites" && s == "view")
        {
            let userId = args.query.get("id") ?? api.userId();
            args = new helpers.args(`/index.php?page=post&s=list#ppixiv`);
            args.query.set("tags", `fav:${userId}`);
        }
        else if(page == "post" && s == "list")
        {
            // Gelbooru's pid is an offset into its HTML pages.  Paging uses our own p.
            args.query.delete("pid");
        }

        if(this.getDataSourceForUrl(args.url) == null)
            args = new helpers.args("/index.php?page=post&s=list#ppixiv");

        if(!helpers.args.isPPixivUrl(args.url))
            args.hash = "#ppixiv";

        helpers.navigate(args, { addToHistory: false, cause: "initial" });
    }

    getDataSourceForUrl(url)
    {
        let args = new helpers.args(url);
        if(args.path != "/index.php")
            return null;

        let page = args.query.get("page"), s = args.query.get("s");
        if(page == null && args.hashPath == "/history")
            return History;
        if(page == "post" && s == "list")
            return Posts;
        if(page == "post" && s == "view" && args.query.get("id"))
            return Post;
        return null;
    }

    // The viewer opened a post: keep a copy of it for 最近看过.
    workSeen(mediaId)
    {
        storePostCopy(mediaId);
    }

    // The search box's link handling, see misc/pixiv-links.js.
    get links() { return links; }

    // The search a clicked link adds to recent searches, or null.
    searchToRemember(url)
    {
        return this.getDataSourceForUrl(url) == Posts? searchToRemember(url):null;
    }

    // Media info for posts that no list registered, like a reloaded viewer URL.  One request
    // per post.
    async loadMediaInfo(mediaId)
    {
        let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        let post = await api.getPost(postId);
        if(post == null)
            return null;

        await registerPosts([post]);
        return ppixiv.mediaCache.getMediaInfoSync(mediaId);
    }

    async batchLoadMediaInfo(mediaIds)
    {
        // A post whose request fails is left unregistered, which the cache reports as missing.
        await Promise.all(mediaIds.map((mediaId) => this.loadMediaInfo(mediaId).catch((error) =>
            console.log(`Couldn't load ${mediaId}:`, error.message))));
    }

    // The viewer opened a post, or it's being downloaded: load its tag categories, for the grouped
    // tags, the artist and the title.  A failed lookup leaves the post as it was.
    async loadMediaDetails(mediaId)
    {
        await loadPostCategories(mediaId).catch((error) => console.log("Couldn't load tag categories:", error.message));
    }

    // The viewer's info panel: score, rating, uploader, source and related posts, and a link to
    // the post's page on Gelbooru.
    fillPostDetails(container, mediaInfo)
    {
        fillPostDetails(container, mediaInfo);
    }

    // The link of a post: its own page on Gelbooru, with our viewer on it.
    getUrlForMediaId(mediaId)
    {
        let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        return new helpers.args(`/index.php?page=post&s=view&id=${encodeURIComponent(postId)}#ppixiv`);
    }

    originalPostUrl(mediaId)
    {
        return originalPostUrl(helpers.mediaId.toIllustIdAndPage(mediaId)[0]);
    }

    // The settings dialog's Gelbooru page.
    fillSettingsPage(globalOptions)
    {
        fillSettingsPage(globalOptions);
    }

    // The larger image a thumbnail switches to with 高清缩略图 on (misc/hd-thumbnails.js): the
    // 850 px sample, or the file itself when there's no sample, because the image is no larger.
    // Videos keep their poster, which is already full size, and GIFs their still preview.
    hdThumbnailUrl(mediaId)
    {
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
        if(mediaInfo == null || mediaInfo.illustType == "video")
            return null;

        let url = mediaInfo.mangaPages[0].urls.regular;
        return /\.gif$/i.test(url)? null:url;
    }

    // Favorites.  Return true on success.  The vote Gelbooru's own button also sends is a
    // setting, off by default.
    async bookmarkAdd(mediaId)
    {
        let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        if(!await api.addFavorite(postId).catch(() => false))
            return false;

        setFavorite(postId, true);
        if(ppixiv.settings.get("gelbooru_upvote_on_favorite"))
            api.upvote(postId).catch((error) => console.log("Upvote failed:", error.message));
        return true;
    }

    async bookmarkRemove(mediaId)
    {
        let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        if(!await api.removeFavorite(postId).catch(() => false))
            return false;

        setFavorite(postId, false);
        return true;
    }

    // Tag autocomplete for the word being typed.  A leading - (exclude) is kept on the results.
    //
    // Text with Latin letters or digits asks Gelbooru, and tags from the tag library that
    // Gelbooru didn't suggest come after its own.  Other text, like Chinese, is only looked up in
    // the library (names, Chinese names and aliases), without a request.  Either way the results
    // are real tags, so picking one puts the tag itself in the search box.
    async autocomplete(word, { signal }={})
    {
        let [, prefix, text] = /^(-?)(.*)$/.exec(word);
        if(text == "")
            return [];

        let library = this.tagLibrary.search(text, { limit: AUTOCOMPLETE_LIBRARY_LIMIT }).results.map((entry) => ({
            tag: entry.tag,
            label: entry.tag.replaceAll("_", " "),
            category: entry.category,
            count: entry.count,
        }));

        let results = [];
        if(/[a-z0-9]/i.test(text.normalize("NFKC")))
        {
            results = await api.autocomplete(text, { signal });
            rememberCategories(results);
            let suggested = new Set(results.map((result) => result.tag));
            library = library.filter((entry) => !suggested.has(entry.tag)).slice(0, AUTOCOMPLETE_LIBRARY_EXTRA);
        }

        return [...results, ...library].map((result) => ({ ...result, tag: prefix + result.tag }));
    }

    // Chinese tag names, see tag-names.js.
    tagNames(tags)
    {
        return chineseNames(tags);
    }

    // The 标签库 screen, see tag-library-dialog.js.
    openTagLibrary()
    {
        openTagLibrary();
    }

    // The search helpers in misc/helpers.js and util/pixiv.js ask these.
    //
    // A new search takes each kind of condition it doesn't set itself from the posts list it's
    // started from, and then from the default conditions in settings.
    getArgsForTagSearch(tags, url)
    {
        let current = this.getDataSourceForUrl(url) == Posts? queryFromUrl(url):"";
        let args = new helpers.args("/index.php?page=post&s=list#ppixiv");
        let query = searchFromList(searchFromList(tags, current), buildQuery({ conditions: defaultConditions() }));
        if(query)
            args.query.set("tags", query);
        return args;
    }

    getArgsForTagRefine(tag, url, { exclude=false }={})
    {
        if(this.getDataSourceForUrl(url) != Posts)
            return null;

        let args = new helpers.args(url);
        args.query.set("tags", refineQuery(queryFromUrl(url), tag, { exclude }));
        args.query.delete("p");
        args.hash.delete("illust_id");
        args.hash.delete("view");
        return args;
    }

    createSearchSettings(globalOptions)
    {
        createSearchSettings(globalOptions);
    }

    // The tags of a posts list without its conditions, or null for other URLs.
    getSearchTagsFromUrl(url)
    {
        if(this.getDataSourceForUrl(url) != Posts)
            return null;
        return buildQuery({ tags: parseQuery(queryFromUrl(url)).tags });
    }

    // The rail.  最新, 随机 and 热门 are the posts list without tags, so the condition menus work on
    // them too; 热门 is marked by its period in the hash (data-sources/posts.js).
    mainDestinations()
    {
        let userId = api.userId();
        let plain = (ds, sort) => ds?.name == "gb-posts" && ds.popularPeriod == null &&
            parseQuery(ds.query).tags.length == 0 && parseQuery(ds.query).conditions.sort == sort;
        return [
            {
                key: "new", label: "最新", icon: "mat:schedule",
                url: "/index.php?page=post&s=list#ppixiv",
                matches: (ds) => plain(ds, null),
            },
            {
                key: "popular", label: "热门", icon: "mat:local_fire_department",
                url: "/index.php?page=post&s=list&tags=sort%3Ascore#ppixiv?popular=week",
                matches: (ds) => ds?.name == "gb-posts" && ds.popularPeriod != null,
            },
            {
                key: "random", label: "随机", icon: "mat:shuffle",
                url: "/index.php?page=post&s=list&tags=sort%3Arandom#ppixiv",
                matches: (ds) => plain(ds, "random"),
            },
            {
                key: "favorites", label: "收藏", icon: "mat:favorite",
                url: `/index.php?page=post&s=list&tags=fav%3A${userId}#ppixiv`,
                matches: (ds) => ds?.name == "gb-posts" && favoritesUserId(ds.query) == userId,
            },
            {
                key: "history", label: "看过", icon: "mat:history",
                url: "/index.php#ppixiv/history",
                matches: (ds) => ds?.name == "gb-history",
            },
            {
                // Not a list: the tag library opens over the current one.
                key: "tag-library", label: "标签库", icon: "mat:sell",
                onclick: () => openTagLibrary(),
                matches: () => false,
            },
        ];
    }

    otherDestinations()
    {
        return [];
    }

    // The mobile tab bar.  The list has no search box on mobile, so the tag library is the search.
    mobileTabs()
    {
        return ["new", "popular", "tag-library", "favorites"];
    }
}
