// 常看标签: the works Pixiv's home page recommends under each of the tags the user looks at most.
// One request to /ajax/top/illust returns them in body.page.recommendByTag: 10 tags of 11 to 24
// work IDs each, about 190 to 210 works (measured 2026-11-14), with the works' thumbnail data in
// body.thumbnails.illust.  A few IDs can come without thumbnail data; they're skipped.
//
// Pixiv answers mode=all and mode=r18 with separate lists: mode=all held no R-18 work in its
// recommendByTag, and mode=r18 only R-18 works, sharing no work with it.  So the list's 全年龄
// and R18 each send their own request.
//
// Each mode's result is kept in memory for the page session and reused for 10 minutes, so
// reopening the list, switching modes, toggling filters and coming back from the viewer send
// nothing.  Two requests two minutes apart shared 3 of 10 tags and 34 of 206 works, so a request
// on every open would replace the list each time.  A failed request isn't kept or retried by
// itself; opening the list again or the list's refresh retries.

import { helpers } from '/vview/misc/helpers.js';

const FRESH = 10*60*1000;

// By mode, "all" or "r18".
let cached = new Map();
let pending = new Map();

// Return true while a request for mode is running.
export function tagFeedLoading(mode) { return pending.has(mode); }

// Return { status: "ok", sections: [{ tag, ids }], works: Map(id => thumbnail data), tagTranslation },
// or { status: "failed" }.  IDs are strings.  refresh ignores the kept result.
export async function loadTagFeed({ mode, refresh=false })
{
    let kept = cached.get(mode);
    if(!refresh && kept != null && Date.now() - kept.time < FRESH)
        return kept;

    if(!pending.has(mode))
        pending.set(mode, fetchTagFeed(mode).finally(() => pending.delete(mode)));
    return await pending.get(mode);
}

async function fetchTagFeed(mode)
{
    let result = await helpers.pixivRequest.get("/ajax/top/illust", { mode, lang: "en" });
    if(result.error)
        return { status: "failed" };

    let works = new Map();
    for(let work of result.body.thumbnails?.illust ?? [])
        works.set(String(work.id), work);

    // IDs may come as numbers or strings.  An ID without thumbnail data can't be shown.
    let sections = (result.body.page?.recommendByTag ?? []).map(({ tag, ids }) => ({
        tag,
        ids: (ids ?? []).map(String).filter((id) => works.has(id)),
    }));

    let feed = { status: "ok", time: Date.now(), sections, works, tagTranslation: result.body.tagTranslation ?? {} };
    cached.set(mode, feed);
    return feed;
}
