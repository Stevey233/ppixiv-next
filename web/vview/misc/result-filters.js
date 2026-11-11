// Filters for search results, applied as pages load.
//
// Pixiv's APIs can't filter most lists by work type, shape or page count, so results are
// filtered here.  The filters are part of the URL, in the "filter" hash argument, as a
// comma-separated list:
//
//   type:  illust (illustrations and animations), manga
//   shape: portrait, landscape
//   pages: single, multi
//   hide:  hide-ai, hide-bookmarked, hide-seen
//
// Being part of the URL means each set of filters gets its own data source, so a list never
// mixes results loaded with different filters, and history, refresh and links keep them.
//
// A page whose results are all filtered out is added empty, and the next page is loaded.  After
// MAX_EMPTY_PAGES in a row, loading stops until the user asks for more.

import { helpers } from '/vview/misc/helpers.js';

export const MAX_EMPTY_PAGES = 4;

// Groups of filters where only one can be on.  Turning one on turns the others in its group off.
export const FILTER_GROUPS = [
    { key: "type", label: "类型", options: [["illust", "插画"], ["manga", "漫画"]] },
    { key: "shape", label: "形状", options: [["portrait", "竖图"], ["landscape", "横图"]] },
    { key: "pages", label: "页数", options: [["single", "单页"], ["multi", "多页"]] },
];

// Filters that can be turned on together.
export const HIDE_FILTERS = [
    ["hide-ai", "隐藏 AI"],
    ["hide-bookmarked", "隐藏已收藏"],
    ["hide-seen", "隐藏看过的"],
];

const ALL_FILTERS = new Set([
    ...FILTER_GROUPS.flatMap((group) => group.options.map(([value]) => value)),
    ...HIDE_FILTERS.map(([value]) => value),
]);

// Data sources that list works, where filters make sense.
const FILTERABLE_DATA_SOURCES = new Set([
    "discovery", "search", "rankings", "bookmarks", "artist", "new_illust", "new_works_by_following",
    "series", "related-illusts", "edited", "completed-requests", "illust-bookmarks",
]);

export function dataSourceSupportsFilters(dataSource)
{
    return dataSource != null && FILTERABLE_DATA_SOURCES.has(dataSource.name);
}

// Return the set of filters in args (a helpers.args).
export function getFilters(args)
{
    let value = args.hash.get("filter") ?? "";
    return new Set(value.split(",").filter((item) => ALL_FILTERS.has(item)));
}

// Store filters in args.
export function setFilters(args, filters)
{
    // Keep a stable order, so the same filters always give the same URL and data source.
    let ordered = [...ALL_FILTERS].filter((item) => filters.has(item));
    if(ordered.length)
        args.hash.set("filter", ordered.join(","));
    else
        args.hash.delete("filter");
}

// Return filters with value turned on or off, turning off the others in its group.
export function toggleFilter(filters, value, enable)
{
    let result = new Set(filters);
    if(enable)
    {
        let group = FILTER_GROUPS.find((group) => group.options.some(([option]) => option == value));
        for(let [option] of group?.options ?? [])
            result.delete(option);
        result.add(value);
    }
    else
        result.delete(value);
    return result;
}

// Return a function that says whether to keep a media ID, or null if nothing is filtered.
export function makeFilter(filters)
{
    if(filters.size == 0)
        return null;

    return (mediaId) => {
        // Only works are filtered.  Users and local files pass through.
        if(helpers.mediaId.parse(mediaId).type != "illust")
            return true;

        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(info == null)
            return true;

        let type = info.illustType;
        if(filters.has("illust") && type == 1)
            return false;
        if(filters.has("manga") && type != 1)
            return false;

        let { width, height } = info;
        if(filters.has("portrait") && !(height > width))
            return false;
        if(filters.has("landscape") && !(width > height))
            return false;

        let pages = info.pageCount ?? 1;
        if(filters.has("single") && pages != 1)
            return false;
        if(filters.has("multi") && pages <= 1)
            return false;

        if(filters.has("hide-ai") && info.aiType == 2)
            return false;
        if(filters.has("hide-bookmarked") && info.bookmarkData != null)
            return false;
        if(filters.has("hide-seen") && ppixiv.seenWorks.hasSeen(mediaId))
            return false;
        return true;
    };
}

// Return a short description of filters, like "竖图、隐藏 AI", or "" if there are none.
export function describeFilters(filters)
{
    let labels = [];
    for(let group of FILTER_GROUPS)
        for(let [value, label] of group.options)
            if(filters.has(value))
                labels.push(label);
    for(let [value, label] of HIDE_FILTERS)
        if(filters.has(value))
            labels.push(label);
    return labels.join("、");
}
