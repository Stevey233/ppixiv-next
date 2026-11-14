// How each list treats works with a muted tag.
//
// Upstream shows a work with a muted tag or by a muted user as a "muted" placeholder in every
// list.  This fork changes that for muted tags only:
//
// - Tag search, recommendations (discovery) and similar works leave these works out.  The data
//   source drops them as pages load, through the same paging as the result filters, so a page they
//   empty loads the next one.
// - The user's own bookmarks show them as normal works, in the list and in the viewer, since the
//   user bookmarked them on purpose.
// - Every other list keeps upstream's placeholder.
//
// A search for a muted tag keeps the placeholder too, since hiding would empty every page.  So do
// the similar works of a work with a muted tag, which mostly carry the same tag.
// Muted users keep the placeholder in every list.

import { filterListKey } from '/vview/misc/result-filters.js';
import { helpers } from '/vview/misc/helpers.js';

const LISTS_HIDING_MUTED_TAGS = new Set(["search", "discovery", "related-illusts"]);

// Return true if dataSource leaves out works with a muted tag.
export function listHidesMutedTags(dataSource)
{
    if(dataSource == null || !LISTS_HIDING_MUTED_TAGS.has(dataSource.name))
        return false;

    if(dataSource.name == "search")
    {
        let query = helpers.pixiv.getSearchTagsFromUrl(dataSource.url) ?? "";
        if(ppixiv.muting.anyTagMuted(query.split(" ").filter((tag) => tag)))
            return false;
    }
    if(dataSource.name == "related-illusts" && dataSource.mediaInfo != null &&
       ppixiv.muting.anyTagMuted(dataSource.mediaInfo.tagList))
        return false;
    return true;
}

// Return true if dataSource shows works with a muted tag as normal works.
export function listShowsMutedTags(dataSource)
{
    return dataSource != null && filterListKey(dataSource.name, dataSource.url) == "bookmarks-own";
}

// Return the muted tag that mutes info (media info) in dataSource, or null.
export function mutedTagInList(info, dataSource)
{
    if(listShowsMutedTags(dataSource))
        return null;
    return ppixiv.muting.anyTagMuted(info.tagList);
}

// Return true if mediaId is a work with a muted tag.  A work with no media info yet is kept.
export function hasMutedTag(mediaId)
{
    if(helpers.mediaId.parse(mediaId).type != "illust")
        return false;
    let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
    return info != null && ppixiv.muting.anyTagMuted(info.tagList) != null;
}
