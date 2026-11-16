// https://gelbooru.com/index.php#ppixiv/history
//
// 最近看过 on Gelbooru: Pixiv's list of the posts opened in the viewer, newest first, read from the
// same seen record (misc/seen-works.js, which is per origin, so it only has Gelbooru posts here).
//
// Gelbooru has no request for many posts by ID, so the viewer keeps a copy of each post it opens
// (the API object) in IndexedDB, and this list is built from the copies without requests.  Only a
// post whose copy is missing, like one opened before this existed or forgotten as the oldest, is
// asked for with id:<n>, one request each.
import History from '/vview/sites/pixiv/data-sources/history.js';
import { helpers } from '/vview/misc/helpers.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { registerPosts, recentPost } from '/vview/sites/gelbooru/media.js';
import { dbOp } from '/vview/sites/gelbooru/store.js';

// The oldest copies are forgotten beyond this many.  A post's copy is about 1.5 KB.
const LIMIT = 20000;
const PRUNE_EXTRA = 1000;

export default class DataSource_GelbooruHistory extends History
{
    get name() { return "gb-history"; }
    get pageTitle() { return "最近看过 - Gelbooru"; }

    async loadWorks(illustIds)
    {
        let missing = illustIds.filter((illustId) => ppixiv.mediaCache.getMediaInfoSync(helpers.mediaId.fromIllustId(illustId), { full: false }) == null);
        let copies = await readPostCopies(missing);
        await registerPosts([...copies.values()]);

        // Posts deleted since they were seen come back as null and are left out.
        let posts = await Promise.all(missing.filter((illustId) => !copies.has(illustId)).map((illustId) => api.getPost(illustId)));
        posts = posts.filter((post) => post != null);
        await registerPosts(posts);
        for(let post of posts)
            writePostCopy(post);

        let mediaIds = illustIds.map((illustId) => helpers.mediaId.fromIllustId(illustId));
        return mediaIds.filter((mediaId) => ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }) != null);
    }
}

// Keep a copy of a post opened in the viewer.  Posts the lists didn't register recently have no
// API object at hand, and are left to an id: request if 最近看过 lists them.
export function storePostCopy(mediaId)
{
    let [postId] = helpers.mediaId.toIllustIdAndPage(mediaId);
    let post = recentPost(postId);
    if(post != null)
        writePostCopy(post);
}

let checkedSize = false;

async function writePostCopy(post)
{
    await dbOp(["posts"], "readwrite", ({ posts }) => posts.put({ post, time: Date.now() }, Number(post.id)));

    // Forget the oldest once per session, PRUNE_EXTRA more than needed, so this doesn't happen on
    // every start once the limit is reached.
    if(checkedSize)
        return;
    checkedSize = true;
    await dbOp(["posts"], "readwrite", ({ posts }) => {
        let count = posts.count();
        count.onsuccess = () => {
            if(count.result <= LIMIT)
                return;
            let remove = count.result - LIMIT + PRUNE_EXTRA;
            let cursor = posts.index("time").openKeyCursor();
            cursor.onsuccess = () => {
                if(cursor.result == null || remove-- <= 0)
                    return;
                posts.delete(cursor.result.primaryKey);
                cursor.result.continue();
            };
        };
    });
}

// Return a Map from post ID to the stored copy of each of postIds that has one.
async function readPostCopies(postIds)
{
    let copies = new Map();
    if(postIds.length == 0)
        return copies;

    let requests = await dbOp(["posts"], "readonly", ({ posts }) => postIds.map((postId) => posts.get(Number(postId))));
    for(let [idx, request] of (requests ?? []).entries())
    {
        if(request.result != null)
            copies.set(postIds[idx], request.result.post);
    }
    return copies;
}
