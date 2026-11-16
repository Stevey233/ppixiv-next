// https://gelbooru.com/index.php?page=post&s=view&id=<n>#ppixiv
//
// One post with no list around it, like Pixiv's /artworks/<id>.  The post loads through
// SiteGelbooru.loadMediaInfo.
import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';

export default class DataSource_GelbooruPost extends DataSource
{
    get name() { return "gb-post"; }
    get defaultScreen() { return "illust"; }
    get pageTitle() { return "Gelbooru"; }
    get allowExpandingMangaPages() { return false; }

    // This data source only views one post and returns no list.
    async loadPageInternal(page) { }

    getUrlMediaId(args)
    {
        return helpers.mediaId.fromIllustId(args.query.get("id"));
    }

    setUrlMediaId(mediaId, args)
    {
        let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
        args.query.set("id", illustId);
    }

    // Leaving the viewer goes to the posts list.
    get searchUrl()
    {
        return new URL("/index.php?page=post&s=list#ppixiv", this.url);
    }
}
