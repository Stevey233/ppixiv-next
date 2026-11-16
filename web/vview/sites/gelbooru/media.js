// Turn Gelbooru posts (the dapi post JSON) into ppixiv media info.  Posts use illust:<id> media
// IDs and are registered as full info straight from the list response, so opening one in the
// viewer costs no request.  See .work/gelbooru/DESIGN.md, "Media info".
import { helpers } from '/vview/misc/helpers.js';
import { isFavorite } from '/vview/sites/gelbooru/favorites.js';
import { categoriesForTags } from '/vview/sites/gelbooru/tag-categories.js';

export function isVideoUrl(url)
{
    return /\.(mp4|webm)$/i.test(url ?? "");
}

// Return the media info object for a post, ready for MediaCache.addFullMediaInfo.
export function mediaInfoFromPost(post, { extraData={} }={})
{
    let illustId = String(post.id);
    let video = isVideoUrl(post.file_url);
    let tagList = (post.tags ?? "").split(" ").filter((tag) => tag != "");

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
        illustTitle: post.title ?? "",
        illustComment: "",
        pageCount: 1,
        width: post.width,
        height: post.height,
        previewUrls: [video? urls.poster:post.preview_url],
        mangaPages: [{ width: post.width, height: post.height, urls }],
        tagList,
        createDate: new Date(post.created_at).toISOString(),
        userId: null,
        userName: "",
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
        hasChildren: post.has_children == "true" || post.has_children === true,
        tagCategories: categoriesForTags(tagList),
    };
}

// Register posts as full media info and return their media IDs in order.
export async function registerPosts(posts)
{
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
