// Filters for search results, applied as pages load.
//
// Pixiv's APIs can't filter most lists by work type, shape or page count, so results are
// filtered here.  The filters are part of the URL, in the "filter" hash argument, as a
// comma-separated list:
//
//   type:  illust (illustrations and animations), manga, ugoira (animations)
//   shape: portrait, landscape
//   pages: single, multi
//   hide:  hide-ai, hide-bookmarked, hide-seen
//
// Being part of the URL means each set of filters gets its own data source, so a list never
// mixes results loaded with different filters, and history, refresh and links keep them.
//
// A page whose results are all filtered out is added empty, and the next page is loaded.  After
// MAX_EMPTY_PAGES in a row, loading stops until the user asks for more.
//
// Where a list's API can filter with the same meaning, the data source asks the API instead, so
// pages come back full: the type on tag search, new works and artists, and hide-ai on tag search.
// The local filter still runs on those lists and removes nothing.
//
// The hide filters are remembered per list.  Opening a list with no filters in its URL adds the
// ones last chosen there, see applyFilterDefaults.

import { helpers } from '/vview/misc/helpers.js';

export const MAX_EMPTY_PAGES = 4;

// Groups of filters where only one can be on.  Turning one on turns the others in its group off.
export const FILTER_GROUPS = [
    { key: "type", label: "类型", options: [["illust", "插画"], ["manga", "漫画"], ["ugoira", "动图"]] },
    { key: "shape", label: "形状", options: [["portrait", "竖图"], ["landscape", "横图"]] },
    { key: "pages", label: "页数", options: [["single", "单页"], ["multi", "多页"]] },
];

// Filters that can be turned on together.
export const HIDE_FILTERS = [
    ["hide-ai", "隐藏 AI"],
    ["hide-bookmarked", "隐藏已收藏"],
    ["hide-seen", "隐藏看过的"],
];

const HIDE_VALUES = HIDE_FILTERS.map(([value]) => value);
const TYPE_VALUES = FILTER_GROUPS[0].options.map(([value]) => value);

const ALL_FILTERS = new Set([
    ...FILTER_GROUPS.flatMap((group) => group.options.map(([value]) => value)),
    ...HIDE_FILTERS.map(([value]) => value),
]);

// The label shown for one filter value, like "竖图".
export function filterLabel(value)
{
    for(let group of FILTER_GROUPS)
        for(let [option, label] of group.options)
            if(option == value)
                return label;
    return HIDE_FILTERS.find(([option]) => option == value)?.[1] ?? value;
}

// Data sources that list works, where filters make sense.  "illust-bookmarks" (收藏了这张的人还收藏了)
// lists users, so it isn't one.
const FILTERABLE_DATA_SOURCES = new Set([
    "discovery", "search", "rankings", "bookmarks", "artist", "new_illust", "new_works_by_following",
    "series", "related-illusts", "edited", "completed-requests",
]);

export function dataSourceSupportsFilters(dataSource)
{
    return dataSource != null && FILTERABLE_DATA_SOURCES.has(dataSource.name);
}

// The key a list's filters are remembered under: the data source name, with the user's own
// bookmarks separate from other people's, since 隐藏已收藏 means nothing on your own.
export function filterListKey(name, url)
{
    if(name == "bookmarks" && isOwnBookmarks(url))
        return "bookmarks-own";
    return name;
}

function isOwnBookmarks(url)
{
    let userId = /\/users\/(\d+)\/bookmarks/.exec(new URL(url).pathname)?.[1];
    return userId != null && userId == ppixiv.pixivInfo?.userId;
}

// Return whether a filter is offered on a list.
export function filterAvailable(listKey, value)
{
    // Measured on pixiv.net on 2026-11-12: 1 of 400 new works was an animation, so 动图 on the new
    // works list would pause after four empty pages nearly every time.
    if(listKey == "new_illust" && value == "ugoira")
        return false;
    return !(listKey == "bookmarks-own" && value == "hide-bookmarked");
}

// The type a list shows when no type filter is on, if its API can't list every type at once.
// Pixiv's new works API returns one type per request and defaults to illustrations.
export function defaultTypeFilter(name)
{
    return name == "new_illust"? "illust":null;
}

// Return the type filter in filters, or null.
export function typeFilter(filters)
{
    return TYPE_VALUES.find((value) => filters.has(value)) ?? null;
}

// The arguments for Pixiv's tag search API: the path segment after /ajax/search/, and the type
// and ai_type query arguments, or null to leave them out.  "illustrations" with illust_and_ugoira
// is 插画 and 动图, the same as the local "illust" filter.
export function searchApiArgs(filters)
{
    let ai_type = filters.has("hide-ai")? "1":null;
    switch(typeFilter(filters))
    {
    case "illust": return { searchType: "illustrations", type: "illust_and_ugoira", ai_type };
    case "manga": return { searchType: "manga", type: "manga", ai_type };
    case "ugoira": return { searchType: "illustrations", type: "ugoira", ai_type };
    default: return { searchType: "artworks", type: null, ai_type };
    }
}

// The type argument for the new works API.  It has no animations-only mode, so 动图 asks for
// illustrations and the local filter keeps the animations.
export function newWorksApiType(filters)
{
    return typeFilter(filters) == "manga"? "manga":"illust";
}

// Which of an artist's work lists to load: "illusts" (illustrations and animations), "manga",
// or both.
export function artistWorkKinds(filters)
{
    switch(typeFilter(filters))
    {
    case "illust": case "ugoira": return ["illusts"];
    case "manga": return ["manga"];
    default: return ["illusts", "manga"];
    }
}

// Convert upstream's own type options in args to result filters, so old links and bookmarks
// show the same works with the filter bar's type selected.  Return true if args changed.
//
//   /search?type=illust_ugoira|illust|manga|ugoira, and ai_type=1
//   /new_illust.php?type=manga
//   /users/1/illustrations, /users/1/manga
function convertUpstreamTypes(args, name)
{
    let filters = getFilters(args);
    let changed = false;

    // An explicit type filter in the URL wins over the old type.
    let addType = (type) => {
        changed = true;
        if(type != null && typeFilter(filters) == null)
            filters.add(type);
    };

    if(name == "search")
    {
        let old = args.query.get("type");
        if(old != null && old != "artwork")
        {
            args.query.set("type", "artwork");
            addType({ illust_ugoira: "illust", illust: "illust", manga: "manga", ugoira: "ugoira" }[old]);
        }
        if(args.query.has("ai_type"))
        {
            if(args.query.get("ai_type") == "1")
                filters.add("hide-ai");
            args.query.delete("ai_type");
            changed = true;
        }
    }
    else if(name == "new_illust")
    {
        let old = args.query.get("type");
        if(old != null)
        {
            args.query.delete("type");
            addType(old == "manga"? "manga":null);
        }
    }
    else if(name == "artist")
    {
        let parts = args.path.split("/");
        let index = parts.indexOf("users") + 2;
        let type = { illustrations: "illust", manga: "manga" }[parts[index]];
        if(type != null)
        {
            parts[index] = "artworks";
            args.path = parts.join("/");
            addType(type);
        }
    }

    if(changed)
        setFilters(args, filters);
    return changed;
}

// The hide filters remembered for a list.
export function rememberedFilters(listKey)
{
    let saved = ppixiv.settings.get("result_filters_remembered") ?? {};
    return new Set((saved[listKey] ?? []).filter((value) => HIDE_VALUES.includes(value) && filterAvailable(listKey, value)));
}

// Remember the hide filters in filters for a list.  The filter bar calls this when the user
// changes filters, so turning the last one off is remembered too.
export function rememberFilters(listKey, filters)
{
    let saved = { ...(ppixiv.settings.get("result_filters_remembered") ?? {}) };
    let hide = HIDE_VALUES.filter((value) => filters.has(value));
    if(hide.length)
        saved[listKey] = hide;
    else
        delete saved[listKey];
    ppixiv.settings.set("result_filters_remembered", saved);
}

// Before a list opens, convert upstream's type options in args to filters, and if args has no
// filters, add the hide filters remembered for the list.  name is the data source name for the
// URL.  Return true if args changed.
export function applyFilterDefaults(args, name)
{
    if(!FILTERABLE_DATA_SOURCES.has(name))
        return false;

    let changed = convertUpstreamTypes(args, name);
    if(args.hash.has("filter"))
        return changed;

    let remembered = rememberedFilters(filterListKey(name, args.url));
    if(remembered.size == 0)
        return changed;

    setFilters(args, remembered);
    return true;
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
        if(filters.has("ugoira") && type != 2)
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
