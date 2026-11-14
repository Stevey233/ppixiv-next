// 收藏相关: related works of the user's most recent public bookmarks, see docs/design.md.
//
// A build reads the newest page of public bookmarks, takes the first SEED_COUNT real works as
// seeds, and loads each seed's related works with Pixiv's recommend/init endpoint (the set Pixiv
// shows under a work, about 150 to 175 works in one request).  Works that several seeds point at
// come first.
//
// Requests are spaced REQUEST_SPACING apart and cached in IndexedDB: the seed list for
// SEEDS_FRESH, each seed's related works for RELATED_FRESH.  Nothing is requested unless the
// list is opened.
//
// Cached records say whether a work was bookmarked when they were fetched.  Works bookmarked
// since then are left out with the bookmarks page, the media cache, and the IDs this script saw
// bookmarked (the "bookmarked" event from Actions), which last as long as a cached record does.

import { helpers } from '/vview/misc/helpers.js';

export const SEED_COUNT = 10;
const SEED_PAGE_SIZE = 48;
const RELATED_LIMIT = 180;
const REQUEST_SPACING = 1200;
const SEEDS_FRESH = 10*60*1000;
const RELATED_FRESH = 24*60*60*1000;
const FAILED_FRESH = 10*60*1000; // retry a seed that failed after this
const BOOKMARKED_KEEP = RELATED_FRESH + 60*60*1000;

const DB_NAME = "ppixiv-seed-feed";
const STORE = "entries";

// Order related works.  lists holds each seed's related work IDs in Pixiv's order, the newest
// seed first.  A work's first key is how many lists have it, more first.  Then its best relative
// position (rank / list length) in any list, so every seed's first matches come before any
// seed's tail, and then the newest seed.  Each ID appears once.
export function rankRelated(lists)
{
    let entries = new Map();
    lists.forEach((ids, seed) => {
        let unique = [...new Set(ids)];
        unique.forEach((id, rank) => {
            let position = rank / unique.length;
            let entry = entries.get(id);
            if(entry == null)
                entries.set(id, entry = { id, count: 0, position, seed });
            entry.count++;
            if(position < entry.position)
            {
                entry.position = position;
                entry.seed = seed;
            }
        });
    });

    return [...entries.values()]
        .sort((a, b) => b.count - a.count || a.position - b.position || a.seed - b.seed)
        .map((entry) => entry.id);
}

// Return ids reordered so no more than max works by one artist are among any window consecutive
// works.  A work that doesn't fit moves down to the first place it fits; nothing is dropped.  If
// no waiting work fits and the input has run out, the rest go at the end in order.
export function spreadArtists(ids, artistOf, { max=3, window=30 }={})
{
    // counts covers the last window-1 works placed.
    let result = [], waiting = [], counts = new Map(), next = 0;
    let fits = (id) => (counts.get(artistOf(id)) ?? 0) < max;
    let place = (id) => {
        result.push(id);
        counts.set(artistOf(id), (counts.get(artistOf(id)) ?? 0) + 1);
        if(result.length >= window)
        {
            let old = artistOf(result[result.length - window]);
            counts.set(old, counts.get(old) - 1);
        }
    };

    while(result.length < ids.length)
    {
        let index = waiting.findIndex(fits);
        if(index != -1)
            place(waiting.splice(index, 1)[0]);
        else if(next < ids.length)
        {
            let id = ids[next++];
            if(fits(id))
                place(id);
            else
                waiting.push(id);
        }
        else
            place(waiting.shift());
    }
    return result;
}

export class SeedFeed extends EventTarget
{
    constructor()
    {
        super();
        this._lastRequest = 0;
        this._building = null;

        // { done, total } while a build loads related works, or null.
        this.progress = null;
    }

    // Record works bookmarked through this script, so a cached record can't show them as not
    // bookmarked after a reload.
    watchBookmarks()
    {
        window.addEventListener("bookmarked", (e) => {
            let now = Date.now();
            this._dbOp("readwrite", (store) => {
                let request = store.get("bookmarked");
                request.onsuccess = () => {
                    let times = Object.fromEntries(Object.entries(request.result ?? {}).filter(([, time]) => now - time < BOOKMARKED_KEEP));
                    times[e.illustId] = now;
                    store.put(times, "bookmarked");
                };
            });
        });
    }

    // Build the feed.  With refresh, load everything from Pixiv, ignoring the cache.  A build
    // already running is shared, so opening the list in another mode doesn't send its requests
    // again.  Resolve to:
    //
    // { status: "ok", seeds, used, order, works, excluded }: order is the ranked work IDs, works
    //   maps an ID to its thumbnail record, used is how many seeds gave related works, and
    //   excluded holds IDs to leave out (the seeds, the bookmarks page, works bookmarked here).
    // { status: "no-bookmarks" }, { status: "bookmarks-failed" }, { status: "related-failed" }
    build({ refresh=false }={})
    {
        this._building ??= this._build(refresh).finally(() => {
            this._building = null;
            this._setProgress(null);
        });
        return this._building;
    }

    async _build(refresh)
    {
        let stored = await this._get("seeds");
        let seedList = !refresh && stored != null && Date.now() - stored.time < SEEDS_FRESH? stored:null;
        if(seedList == null)
        {
            let userId = ppixiv.pixivInfo.userId;
            let result = await this._request(`/ajax/user/${userId}/illusts/bookmarks`, {
                tag: "", offset: 0, limit: SEED_PAGE_SIZE, rest: "show",
            });
            if(result.error)
                return { status: "bookmarks-failed" };

            // Deleted and hidden works stay in the bookmarks list.
            let works = result.body.works;
            let real = works.filter((work) => !work.isMasked && work.isBookmarkable !== false);
            seedList = {
                time: Date.now(),
                seeds: real.slice(0, SEED_COUNT).map((work) => String(work.id)),
                bookmarked: works.map((work) => String(work.id)),
            };
            await this._put("seeds", seedList);
        }

        let { seeds } = seedList;
        if(seeds.length == 0)
            return { status: "no-bookmarks" };

        let entries = await Promise.all(seeds.map((seed) => this._get(`seed:${seed}`)));
        let isFresh = (entry) => entry != null && Date.now() - entry.time < (entry.failed? FAILED_FRESH:RELATED_FRESH);
        let needed = seeds.filter((seed, index) => refresh || !isFresh(entries[index]));
        this._setProgress({ done: seeds.length - needed.length, total: seeds.length });

        for(let seed of needed)
        {
            let result = await this._request(`/ajax/illust/${seed}/recommend/init`, { limit: RELATED_LIMIT });
            let entry = result.error?
                { time: Date.now(), failed: true }:
                { time: Date.now(), works: result.body.illusts.filter((work) => !work.isAdContainer) };
            entries[seeds.indexOf(seed)] = entry;
            await this._put(`seed:${seed}`, entry);
            this._setProgress({ done: this.progress.done + 1, total: seeds.length });
        }

        await this._forgetOtherSeeds(seeds);

        let lists = entries.filter((entry) => entry.works != null).map((entry) => entry.works);
        if(lists.length == 0)
            return { status: "related-failed" };

        let works = new Map();
        for(let list of lists)
            for(let work of list)
                works.set(String(work.id), work);

        let bookmarkedHere = Object.keys(await this._get("bookmarked") ?? {});
        return {
            status: "ok",
            seeds,
            used: lists.length,
            order: rankRelated(lists.map((list) => list.map((work) => String(work.id)))),
            works,
            excluded: new Set([...seeds, ...seedList.bookmarked, ...bookmarkedHere]),
        };
    }

    _setProgress(progress)
    {
        this.progress = progress;
        this.dispatchEvent(new Event("progress"));
    }

    // Send a GET request, starting at least REQUEST_SPACING after the previous one.
    async _request(url, data)
    {
        let wait = this._lastRequest + REQUEST_SPACING - Date.now();
        if(wait > 0)
            await helpers.other.sleep(wait);
        this._lastRequest = Date.now();
        return await helpers.pixivRequest.get(url, data);
    }

    async _forgetOtherSeeds(seeds)
    {
        let keep = new Set(seeds.map((seed) => `seed:${seed}`));
        await this._dbOp("readwrite", (store) => {
            let request = store.getAllKeys();
            request.onsuccess = () => {
                for(let key of request.result)
                    if(key.startsWith("seed:") && !keep.has(key))
                        store.delete(key);
            };
        });
    }

    async _get(key)
    {
        let request = await this._dbOp("readonly", (store) => store.get(key));
        return request?.result ?? null;
    }

    _put(key, value)
    {
        return this._dbOp("readwrite", (store) => { store.put(value, key); });
    }

    // Run func(store) in a transaction, and resolve to what it returned once the transaction
    // completes, or to null if IndexedDB is unavailable.  Without IndexedDB nothing is cached,
    // and every open loads from Pixiv, still spaced.
    async _dbOp(mode, func)
    {
        let db;
        try {
            db = await new Promise((resolve, reject) => {
                let request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch(e) {
            return null;
        }

        try {
            return await new Promise((resolve, reject) => {
                let transaction = db.transaction(STORE, mode);
                let result = func(transaction.objectStore(STORE)) ?? true;
                transaction.oncomplete = () => resolve(result);
                transaction.onerror = transaction.onabort = () => reject(transaction.error);
            });
        } catch(e) {
            return null;
        } finally {
            db.close();
        }
    }
}
