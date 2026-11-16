// 收藏相关: related works of the user's public bookmarks, see docs/design.md.
//
// A build reads the newest page of public bookmarks and picks RECENT_SEEDS seeds from it that
// differ from each other (pickDiverse), so a run of bookmarks from one series or artist gives one
// seed, not ten.  OLD_SEEDS more come from OLD_PAGES random pages of older bookmarks, to bring
// back older tastes.  Each seed's related works come from Pixiv's recommend/init endpoint (the
// set Pixiv shows under a work, about 150 to 175 works in one request).  Works that several
// seeds point at come first.
//
// Requests are spaced REQUEST_SPACING apart and cached in IndexedDB: the newest page for
// SEEDS_FRESH, the old seeds for OLD_FRESH (until 重新查找 draws new ones), each seed's related
// works for RELATED_FRESH.  Nothing is requested unless the list is opened.
//
// Cached records say whether a work was bookmarked when they were fetched.  Works bookmarked
// since then are left out with the bookmarks page, the media cache, and the IDs this script saw
// bookmarked (the "bookmarked" event from Actions), which last as long as a cached record does.

import { helpers } from '/vview/misc/helpers.js';

export const SEED_COUNT = 10;
const RECENT_SEEDS = 5;
const OLD_SEEDS = SEED_COUNT - RECENT_SEEDS;
const OLD_PAGES = 2;
const SEED_PAGE_SIZE = 48;
const RELATED_LIMIT = 180;
// A little over the 1.2 seconds the budget states: a timer can fire a millisecond early.
const REQUEST_SPACING = 1250;
const SEEDS_FRESH = 10*60*1000;
const RELATED_FRESH = 24*60*60*1000;
const OLD_FRESH = RELATED_FRESH;
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
    return rankRelatedEntries(lists).map((entry) => entry.id);
}

// rankRelated with each work's entry: { id, count, seed, seeds }, where seed is the index of the
// list it ranks best in and seeds holds the indexes of every list that has it.
export function rankRelatedEntries(lists)
{
    let entries = new Map();
    lists.forEach((ids, seed) => {
        let unique = [...new Set(ids)];
        unique.forEach((id, rank) => {
            let position = rank / unique.length;
            let entry = entries.get(id);
            if(entry == null)
                entries.set(id, entry = { id, count: 0, position, seed, seeds: [] });
            entry.count++;
            entry.seeds.push(seed);
            if(position < entry.position)
            {
                entry.position = position;
                entry.seed = seed;
            }
        });
    });

    return [...entries.values()]
        .sort((a, b) => b.count - a.count || a.position - b.position || a.seed - b.seed);
}

// Tags that say little about a work's subject, so sharing them doesn't make two works alike.
// Pixiv's popularity tags ("オリジナル1000users入り") are left out too.
const COMMON_TAGS = new Set([
    "オリジナル", "女の子", "創作", "イラスト", "落書き", "R-18", "R-18G", "AI生成", "AIイラスト",
    "少女", "男の子", "漫画", "マンガ", "pixiv", "ファンアート",
]);
function subjectTags(tags)
{
    return (tags ?? []).filter((tag) => !COMMON_TAGS.has(tag) && !/users入り$/.test(tag));
}

// Whether two bookmarks { userId, tags } are alike: the same artist, or a third or more of
// their subject tags shared.
export function similarWorks(a, b)
{
    if(a.userId != null && a.userId == b.userId)
        return true;
    let tagsA = new Set(subjectTags(a.tags)), tagsB = subjectTags(b.tags);
    let shared = tagsB.filter((tag) => tagsA.has(tag)).length;
    let union = tagsA.size + tagsB.length - shared;
    return union > 0 && shared / union >= 1/3;
}

// Pick count works in order, skipping any alike (similarWorks) to one picked already or to one
// in taken.  If too few differ, fill up with the skipped ones in order.
export function pickDiverse(works, count, { taken=[] }={})
{
    let picked = [];
    for(let work of works)
    {
        if(picked.length == count)
            break;
        if(![...taken, ...picked].some((other) => similarWorks(other, work)))
            picked.push(work);
    }
    for(let work of works)
    {
        if(picked.length >= count)
            break;
        if(!picked.includes(work))
            picked.push(work);
    }
    return picked;
}

// Group seeds that share a subject tag, for 收藏相关's 分组 view.  seeds is [{ id, tags }] in
// seed order.  Repeatedly take the subject tag most unplaced seeds have, if two or more do, and
// group those seeds under it; seeds left over are a group each.  Return [{ tag, seeds }], where
// tag is null for a single seed, groups of several first, then by their first seed.
export function groupSeeds(seeds)
{
    let groups = [], left = [...seeds];
    while(true)
    {
        let counts = new Map();
        for(let seed of left)
            for(let tag of new Set(subjectTags(seed.tags)))
                counts.set(tag, (counts.get(tag) ?? 0) + 1);
        let [tag, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
        if(!(count >= 2))
            break;
        groups.push({ tag, seeds: left.filter((seed) => seed.tags.includes(tag)) });
        left = left.filter((seed) => !seed.tags.includes(tag));
    }
    let index = (seed) => seeds.indexOf(seed);
    groups.sort((a, b) => index(a.seeds[0]) - index(b.seeds[0]));
    return [...groups, ...left.map((seed) => ({ tag: null, seeds: [seed] }))];
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

// Deleted and hidden works stay in the bookmarks list.
function realWorks(works)
{
    return works.filter((work) => !work.isMasked && work.isBookmarkable !== false);
}

// What the 分组 view shows about a seed.  old: drawn from the older bookmarks.
function seedInfo(work, old)
{
    return { title: work.title, userName: work.userName, tags: work.tags ?? [], old };
}

export class SeedFeed extends EventTarget
{
    constructor()
    {
        super();
        this._lastRequest = 0;
        this._building = null;

        // What _put stored since the page loaded, read back only when IndexedDB fails, so a
        // broken store doesn't make every open of the list load everything from Pixiv again.
        this._memory = new Map();

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
        let seedList = !refresh && stored?.info != null && Date.now() - stored.time < SEEDS_FRESH? stored:null;
        if(seedList == null)
        {
            let result = await this._bookmarksPage(0);
            if(result.error)
                return { status: "bookmarks-failed" };

            // The old seeds stay a day, until 重新查找 draws new ones, so they don't bring 5 new
            // seeds' requests every 10 minutes.  They're drawn after the new ones, to differ
            // from them.
            let works = result.body.works;
            let recent = pickDiverse(realWorks(works), RECENT_SEEDS);
            let old = !refresh && stored?.old != null && Date.now() - stored.old.time < OLD_FRESH?
                stored.old:await this._pickOldSeeds(result.body.total ?? 0, recent);

            // With few old bookmarks, more of the newest ones make up the count.
            let more = pickDiverse(realWorks(works).filter((work) => !recent.includes(work)), SEED_COUNT - recent.length - old.seeds.length, { taken: recent });
            let info = {};
            for(let work of [...recent, ...more])
                info[work.id] = seedInfo(work, false);

            // Old seeds kept from yesterday may have moved into the newest page since.
            let newIds = [...recent, ...more].map((work) => String(work.id));
            seedList = {
                time: Date.now(),
                seeds: newIds.concat(old.seeds.filter((id) => !newIds.includes(id))),
                info: { ...info, ...old.info },
                bookmarked: [...works.map((work) => String(work.id)), ...old.bookmarked],
                old,
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

        let listSeeds = seeds.filter((seed, index) => entries[index].works != null);
        let lists = entries.filter((entry) => entry.works != null).map((entry) => entry.works);
        if(lists.length == 0)
            return { status: "related-failed" };

        let works = new Map();
        for(let list of lists)
            for(let work of list)
                works.set(String(work.id), work);

        let bookmarkedHere = Object.keys(await this._get("bookmarked") ?? {});
        let ranked = rankRelatedEntries(lists.map((list) => list.map((work) => String(work.id))));
        return {
            status: "ok",
            seeds,
            used: lists.length,
            usedOld: listSeeds.filter((seed) => seedList.info[seed]?.old).length,
            order: ranked.map((entry) => entry.id),
            // For the 分组 view: each work's seeds, as IDs, and what's known about each seed.
            seedsOf: new Map(ranked.map((entry) => [entry.id, { best: listSeeds[entry.seed], all: entry.seeds.map((index) => listSeeds[index]) }])),
            seedInfo: seedList.info,
            listSeeds,
            works,
            excluded: new Set([...seeds, ...seedList.bookmarked, ...bookmarkedHere]),
        };
    }

    _bookmarksPage(offset)
    {
        return this._request(`/ajax/user/${ppixiv.pixivInfo.userId}/illusts/bookmarks`, {
            tag: "", offset, limit: SEED_PAGE_SIZE, rest: "show",
        });
    }

    // Draw OLD_SEEDS seeds from OLD_PAGES random pages of the bookmarks after the newest page,
    // one page from each part of that range, unlike the new seeds in recent and each other.  A
    // page that fails is skipped.  Return { time, seeds, info, bookmarked }.
    async _pickOldSeeds(total, recent)
    {
        let old = { time: Date.now(), seeds: [], info: {}, bookmarked: [] };
        let range = total - SEED_PAGE_SIZE;
        if(range <= 0)
            return old;

        let candidates = [];
        let pages = Math.min(OLD_PAGES, Math.ceil(range / SEED_PAGE_SIZE));
        for(let page = 0; page < pages; page++)
        {
            let start = SEED_PAGE_SIZE + Math.floor(range * page / pages);
            let size = Math.floor(range / pages);
            let offset = start + Math.floor(Math.random() * Math.max(1, size - SEED_PAGE_SIZE + 1));
            let result = await this._bookmarksPage(offset);
            if(result.error)
                continue;
            old.bookmarked.push(...result.body.works.map((work) => String(work.id)));
            candidates.push(...realWorks(result.body.works));
        }

        // Pages of a short range can overlap.
        candidates = [...new Map(candidates.map((work) => [String(work.id), work])).values()];

        // Shuffle, so the picks aren't the newest of each page.
        for(let i = candidates.length - 1; i > 0; i--)
        {
            let j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        for(let work of pickDiverse(candidates, OLD_SEEDS, { taken: recent }))
        {
            old.seeds.push(String(work.id));
            old.info[work.id] = seedInfo(work, true);
        }
        return old;
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
        // A write that failed, like one past the storage quota, leaves the key missing from
        // IndexedDB, so fall back to what this page stored.
        return request?.result ?? this._memory.get(key) ?? null;
    }

    _put(key, value)
    {
        this._memory.set(key, value);
        return this._dbOp("readwrite", (store) => { store.put(value, key); });
    }

    // Run func(store) in a transaction, and resolve to what it returned once the transaction
    // completes, or to null if IndexedDB is unavailable.  Without IndexedDB the cache lasts only
    // until the page is reloaded (see _memory), and the first open after that loads from Pixiv,
    // still spaced.
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
