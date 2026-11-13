// Turning pages inside a multi-page work, for the page number's arrows and right button + wheel.
// Unlike the arrow keys and the plain wheel, this stays inside the work: at the first or last
// page it does nothing.

import { helpers } from '/vview/misc/helpers.js';

// Return the number of pages of the work mediaId, or 1 if it isn't a Pixiv work or isn't loaded.
export function workPageCount(mediaId)
{
    if(mediaId == null || helpers.mediaId.parse(mediaId).type != "illust")
        return 1;
    return ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false })?.pageCount ?? 1;
}

// Show the page step pages from mediaId in the same work.  Return the media ID shown, or null if
// that page doesn't exist.
export function showPageRelative(mediaId, step)
{
    let page = (helpers.mediaId.parse(mediaId).page ?? 0) + step;
    if(page < 0 || page >= workPageCount(mediaId))
        return null;

    let target = helpers.mediaId.getMediaIdForPage(mediaId, page);
    ppixiv.app.showMediaId(target);
    return target;
}
