// gelbooru.com.  See .work/gelbooru/DESIGN.md.
//
// The lists keep Gelbooru's own URLs with #ppixiv added, so reloading, #no-ppixiv and a pasted
// Gelbooru link all land on the same list:
//
//   /index.php?page=post&s=list&tags=<query>#ppixiv     gb-posts
//   /index.php?page=post&s=view&id=<n>#ppixiv           gb-post
import { helpers } from '/vview/misc/helpers.js';
import * as Site from '/vview/sites/site.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { searchFromList, refineQuery, favoritesUserId, parseQuery, buildQuery } from '/vview/sites/gelbooru/query.js';
import { registerPosts, loadPostCategories } from '/vview/sites/gelbooru/media.js';
import TagLibrary from '/vview/sites/gelbooru/tag-library.js';
import { fillPostDetails, originalPostUrl } from '/vview/sites/gelbooru/post-details.js';
import { fillSettingsPage } from '/vview/sites/gelbooru/settings.js';
import { setFavorite } from '/vview/sites/gelbooru/favorites.js';
import { rememberCategories } from '/vview/sites/gelbooru/tag-categories.js';
import Posts, { queryFromUrl } from '/vview/sites/gelbooru/data-sources/posts.js';
import Post from '/vview/sites/gelbooru/data-sources/post.js';
import { defaultConditions, createSearchSettings } from '/vview/sites/gelbooru/search-defaults.js';

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

        let credentials = await api.getCredentials();
        if(credentials == null)
        {
            this._showLoggedOut();
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

        // The tag library gives categories (and later Chinese names) without requests.  Nothing
        // waits for it, and without it tags are looked up with the tag API.
        this.tagLibrary = new TagLibrary();
        this.tagLibrary.load().catch((error) => console.log("Tag library not loaded:", error.message));
        return true;
    }

    // Without an API key nothing loads.  Say so, with a way to log in and a way back to the page.
    _showLoggedOut()
    {
        console.log("No Gelbooru API key: not logged in");
        document.documentElement.style.filter = "";
        let back = new URL(location.href);
        back.hash = "#no-ppixiv";

        let box = document.createElement("div");
        box.className = "gb-logged-out";
        box.style.cssText = "max-width:420px;margin:20vh auto;padding:24px;border-radius:12px;background:#222;color:#eee;font:15px/1.6 system-ui,sans-serif;text-align:center;";
        box.innerHTML = `
            <p>还没有登录 Gelbooru，新界面需要登录后的 API key 才能读取作品。</p>
            <p><a class=gb-login-link style="color:#8cf"></a> · <a class=gb-back-link style="color:#8cf"></a></p>
        `;
        let login = box.querySelector(".gb-login-link");
        login.href = api.loginUrl;
        login.textContent = "登录 Gelbooru";
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
        if(page == "post" && s == "list")
            return Posts;
        if(page == "post" && s == "view" && args.query.get("id"))
            return Post;
        return null;
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
        await Promise.all(mediaIds.map((mediaId) => this.loadMediaInfo(mediaId)));
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
        if(!await api.addFavorite(postId))
            return false;

        setFavorite(postId, true);
        if(ppixiv.settings.get("gelbooru_upvote_on_favorite"))
            api.upvote(postId);
        return true;
    }

    async bookmarkRemove(mediaId)
    {
        let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        if(!await api.removeFavorite(postId))
            return false;

        setFavorite(postId, false);
        return true;
    }

    // Tag autocomplete for the word being typed.  A leading - (exclude) is kept on the results.
    async autocomplete(word, { signal }={})
    {
        let [, prefix, text] = /^(-?)(.*)$/.exec(word);
        if(text == "")
            return [];

        let results = await api.autocomplete(text, { signal });
        rememberCategories(results);
        return results.map((result) => ({ ...result, tag: prefix + result.tag }));
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

    // The rail.  Piece C adds 热门, 随机 and 最近看过.
    mainDestinations()
    {
        let userId = api.userId();
        return [
            {
                key: "new", label: "最新", icon: "mat:schedule",
                url: "/index.php?page=post&s=list#ppixiv",
                matches: (ds) => ds?.name == "gb-posts" && ds.query == "",
            },
            {
                key: "favorites", label: "收藏", icon: "mat:favorite",
                url: `/index.php?page=post&s=list&tags=fav%3A${userId}#ppixiv`,
                matches: (ds) => ds?.name == "gb-posts" && favoritesUserId(ds.query) == userId,
            },
        ];
    }

    otherDestinations()
    {
        return [];
    }
}
