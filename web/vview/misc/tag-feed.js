// 常看标签: the works Pixiv's home page recommends under each of the tags the user looks at most.
// One request to /ajax/top/illust returns them in body.page.recommendByTag, 10 tags of 13 to 24
// work IDs each, with the works' thumbnail data in body.thumbnails.illust.
//
// The result is kept in memory for the page session and reused for 10 minutes, so reopening the
// list, switching modes, toggling filters and coming back from the viewer send nothing.  A failed
// request isn't kept or retried by itself; opening the list again or the list's refresh retries.

import { helpers } from '/vview/misc/helpers.js';

const FRESH = 10*60*1000;

let cached = null;
let pending = null;

// Return true while a request is running.
export function tagFeedLoading() { return pending != null; }

// Return { status: "ok", sections: [{ tag, ids }], works: Map(id => thumbnail data), tagTranslation },
// or { status: "failed" }.  IDs are strings.  refresh ignores the kept result.
export async function loadTagFeed({ refresh=false }={})
{
    if(!refresh && cached != null && Date.now() - cached.time < FRESH)
        return cached;

    pending ??= fetchTagFeed().finally(() => pending = null);
    return await pending;
}

async function fetchTagFeed()
{
    let result = await helpers.pixivRequest.get("/ajax/top/illust", { mode: "all", lang: "en" });
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

    cached = { status: "ok", time: Date.now(), sections, works, tagTranslation: result.body.tagTranslation ?? {} };
    return cached;
}
