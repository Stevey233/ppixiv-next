// Which posts are the user's Gelbooru favorites.  See .work/gelbooru/DESIGN.md, "Requests".
//
// The set of favorite post IDs is kept in IndexedDB (store.js).  At start, syncFavorites makes one
// fav:<me> request of 100 posts, which gives the count and the newest favorites.  If the count
// differs from the stored set's size, or a post on that page isn't in it, the whole list is read
// again in the background, 100 posts per request, one request at a time, so the lists' own
// requests go first.  Adding and removing a favorite here updates the set directly, and other
// tabs hear about it on a BroadcastChannel.
//
// The post mapper (media.js) reads isFavorite for every post it registers.  When the set changes
// under posts already registered (the stored set or a re-read finishing, another tab), their
// media info is corrected, which sends mediamodified and redraws their hearts.
import { helpers } from '/vview/misc/helpers.js';
import * as api from '/vview/sites/gelbooru/api.js';
import { dbOp } from '/vview/sites/gelbooru/store.js';

const PER_REQUEST = 100;

// Gelbooru won't page past pid 200.
const MAX_PID = 200;

let favorites = new Set();

// Every post ID the mapper asked about, so their media info can be corrected.
let registered = new Set();

// Changes made in this tab while the set is loading or being read again.  They're applied on top
// of what the load or the re-read finds.
let pendingChanges = null;

let channel = typeof BroadcastChannel == "function"? new BroadcastChannel("ppixiv-gelbooru-favorites"):null;
if(channel)
    channel.onmessage = (e) => receive(e.data);

export function isFavorite(postId)
{
    postId = String(postId);
    registered.add(postId);
    return favorites.has(postId);
}

// Record that the user added or removed a favorite in this tab.
export function setFavorite(postId, favorite)
{
    postId = String(postId);
    pendingChanges?.set(postId, favorite);
    changeInMemory(postId, favorite);
    dbOp(["favorites"], "readwrite", ({ favorites: store }) => {
        if(favorite)
            store.put(1, Number(postId));
        else
            store.delete(Number(postId));
    });
    channel?.postMessage({ postId, favorite });
}

// Posts on the user's own fav:<me> list are favorites.  This only changes memory: the stored set
// is the one the last sync read.
export function noteFavorites(postIds)
{
    for(let postId of postIds)
        changeInMemory(String(postId), true);
}

// Resolves when the first sync has finished.  Steps and tests wait on it.
export let synced = Promise.resolve();

// Load the stored set and check it against Gelbooru.  Call once at start, without waiting.
export function syncFavorites(userId)
{
    synced = sync(userId);
    return synced;
}

async function sync(userId)
{
    pendingChanges = new Map();

    let stored = await readStored(userId);
    if(stored != null)
        replaceSet(stored);

    let tags = `fav:${userId}`;
    let first = await api.searchPosts({ tags, limit: PER_REQUEST });
    let firstIds = first.posts.map((post) => String(post.id));
    // Only the first MAX_PID pages can be read, so a longer list is in sync once those are stored.
    let readable = MAX_PID * PER_REQUEST;
    let sameSize = stored != null && (stored.size == first.count || (first.count > readable && stored.size >= readable));
    if(sameSize && firstIds.every((id) => stored.has(id)))
    {
        pendingChanges = null;
        return;
    }

    console.log(`Reading ${first.count} Gelbooru favorites (${stored?.size ?? "none"} stored)`);
    let ids = new Set(firstIds);
    for(let pid = 1; pid < MAX_PID && pid * PER_REQUEST < first.count; pid++)
    {
        let { posts, tooDeep } = await api.searchPosts({ tags, pid, limit: PER_REQUEST });
        if(tooDeep || posts.length == 0)
            break;
        for(let post of posts)
            ids.add(String(post.id));
    }

    await writeStored(userId, ids);
    replaceSet(ids);
    pendingChanges = null;
    channel?.postMessage({ reload: true });
}

// Replace the set with ids and the changes made in this tab since the sync started, and correct
// the posts already registered.
function replaceSet(ids)
{
    let next = new Set(ids);
    for(let [postId, favorite] of pendingChanges ?? [])
    {
        if(favorite)
            next.add(postId);
        else
            next.delete(postId);
    }

    let old = favorites;
    favorites = next;
    for(let postId of registered)
    {
        if(old.has(postId) != next.has(postId))
            refreshMediaInfo(postId);
    }
}

function changeInMemory(postId, favorite)
{
    if(favorites.has(postId) == favorite)
        return;
    if(favorite)
        favorites.add(postId);
    else
        favorites.delete(postId);
    refreshMediaInfo(postId);
}

// Make a registered post's bookmark state match the set.
function refreshMediaInfo(postId)
{
    let mediaId = helpers.mediaId.fromIllustId(postId);
    let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
    if(info == null)
        return;

    let favorite = favorites.has(postId);
    if((info.bookmarkData != null) != favorite)
        info.bookmarkData = favorite? { id: postId, private: false }:null;
}

async function receive(data)
{
    if(data?.reload)
    {
        let stored = await readStored(api.userId());
        if(stored != null)
            replaceSet(stored);
    }
    else if(typeof data?.postId == "string" && /^\d+$/.test(data.postId))
    {
        pendingChanges?.set(data.postId, !!data.favorite);
        changeInMemory(data.postId, !!data.favorite);
    }
}

// Return the stored set of favorite IDs as strings, or null if there is none for userId.
async function readStored(userId)
{
    let requests = await dbOp(["favorites", "meta"], "readonly", ({ favorites, meta }) => [favorites.getAllKeys(), meta.get("favoritesUser")]);
    if(requests == null)
        return null;

    let [keys, user] = requests.map((request) => request.result);
    if(user != userId)
        return null;
    return new Set(keys.map(String));
}

async function writeStored(userId, ids)
{
    await dbOp(["favorites", "meta"], "readwrite", ({ favorites, meta }) => {
        favorites.clear();
        for(let id of ids)
            favorites.put(1, Number(id));

        // The response is a snapshot from before these edits.  Apply them inside the same
        // transaction so a sync can't overwrite a favorite changed while it was loading.
        for(let [postId, favorite] of pendingChanges ?? [])
        {
            if(favorite)
                favorites.put(1, Number(postId));
            else
                favorites.delete(Number(postId));
        }
        meta.put(userId, "favoritesUser");
    });
}
