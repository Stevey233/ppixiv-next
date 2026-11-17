// Turn Gelbooru posts (the dapi post JSON) into ppixiv media info.  Posts use illust:<id> media
// IDs and are registered as full info straight from the list response, so opening one in the
// viewer costs no request.  See .work/gelbooru/DESIGN.md, "Media info".
import { helpers } from '/vview/misc/helpers.js';
import { isFavorite } from '/vview/sites/gelbooru/favorites.js';
import { knownCategories, categoriesForTags } from '/vview/sites/gelbooru/tag-categories.js';

export function isVideoUrl(url)
{
    return /\.(mp4|webm)$/i.test(url ?? "");
}

// Characters shown in a title, before the rest are left out.
const MAX_TITLE_CHARACTERS = 3;

function tagsOf(tagList, categories, category)
{
    return categories == null? []:tagList.filter((tag) => categories[tag] == category);
}

// The artist tags joined with ", ", or "" while categories aren't known.
function artistName(tagList, categories)
{
    return tagsOf(tagList, categories, "artist").join(", ");
}

// Posts rarely have a title.  Without one, the title is the post's character tags once the
// categories are known, or #<id>.  The tab title and download names use it too.
function fallbackTitle(illustId, tagList, categories)
{
    let characters = tagsOf(tagList, categories, "character");
    if(characters.length == 0)
        return `#${illustId}`;
    let title = characters.slice(0, MAX_TITLE_CHARACTERS).join(", ");
    return characters.length > MAX_TITLE_CHARACTERS? `${title} 等`:title;
}

// Return the media info object for a post, ready for MediaCache.addFullMediaInfo.
export function mediaInfoFromPost(post, { extraData={} }={})
{
    let illustId = String(post.id);
    let video = isVideoUrl(post.file_url);
    let tagList = (post.tags ?? "").split(" ").filter((tag) => tag != "");
    let tagCategories = knownCategories(tagList);

    let urls = {
        original: post.file_url,
        regular: post.sample_url || post.file_url,
        small: post.preview_url,
    };

    // A video's preview is tiny.  The same directory has a full-size poster with the same name.
    if(video)
        urls.poster = post.file_url.replace(/\.(mp4|webm)$/i, ".jpg");

    return {
        mediaId: helpers.mediaId.fromIllustId(illustId),
        illustId,
        full: true,
        illustType: video? "video":0,
        illustTitle: post.title || fallbackTitle(illustId, tagList, tagCategories),
        illustComment: "",
        pageCount: 1,
        width: post.width,
        height: post.height,
        previewUrls: [video? urls.poster:post.preview_url],
        mangaPages: [{ width: post.width, height: post.height, urls }],
        tagList,
        createDate: new Date(post.created_at).toISOString(),
        userId: null,
        userName: artistName(tagList, tagCategories),
        bookmarkData: isFavorite(illustId)? { id: illustId, private: false }:null,
        aiType: tagList.includes("ai-generated")? 2:0,
        likeCount: null,
        bookmarkCount: null,
        seriesNavData: null,
        ugoiraMetadata: null,
        extraData,

        // Gelbooru's own fields.
        score: post.score,
        rating: post.rating,
        source: post.source ?? "",
        md5: post.md5,
        uploader: post.owner ?? "",
        parentId: post.parent_id? String(post.parent_id):null,
        hasNotes: post.has_notes == "true" || post.has_notes === true,
        hasChildren: post.has_children == "true" || post.has_children === true,
        tagCategories,
    };
}

// The posts registered most recently, by post ID, so the viewer can store a copy of the one it
// opens (see storePostCopy in data-sources/history.js).  The oldest are dropped past this many.
const RECENT_POSTS = 5000;
let recentPosts = new Map();

// Return the API object of a post registered recently, or null.
export function recentPost(postId)
{
    return recentPosts.get(String(postId)) ?? null;
}

// Register posts as full media info and return their media IDs in order.
export async function registerPosts(posts)
{
    for(let post of posts)
    {
        recentPosts.delete(String(post.id));
        recentPosts.set(String(post.id), post);
    }
    for(let postId of recentPosts.keys())
    {
        if(recentPosts.size <= RECENT_POSTS)
            break;
        recentPosts.delete(postId);
    }

    let illustIds = posts.map((post) => String(post.id));
    let extraData = await ppixiv.extraImageData.batchLoadAllPagesForIllust(illustIds);

    let mediaIds = [];
    for(let post of posts)
    {
        let info = mediaInfoFromPost(post, { extraData: extraData[String(post.id)] ?? {} });
        ppixiv.mediaCache.addFullMediaInfo(info);
        mediaIds.push(info.mediaId);
    }
    return mediaIds;
}

// Load the categories of a post's tags if they aren't known yet, then fill in what depends on
// them: tagCategories, the artist as userName, and the fallback title.  Changing them tells
// listeners (mediamodified).  Called when the viewer opens the post.
export async function loadPostCategories(mediaId)
{
    let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
    if(mediaInfo == null || mediaInfo.tagCategories != null)
        return;

    let categories = await categoriesForTags(mediaInfo.tagList);

    // The list may have registered the post again while this ran.
    mediaInfo = ppixiv.mediaCache.getMediaInfoSync(mediaId);
    if(mediaInfo == null || mediaInfo.tagCategories != null)
        return;

    let { illustId, tagList } = mediaInfo;
    mediaInfo.tagCategories = categories;
    mediaInfo.userName = artistName(tagList, categories);
    if(mediaInfo.illustTitle == fallbackTitle(illustId, tagList, null))
        mediaInfo.illustTitle = fallbackTitle(illustId, tagList, categories);
}
