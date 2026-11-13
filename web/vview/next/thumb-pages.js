// Right button + wheel over a multi-page work in a list shows the work's other pages in its
// thumbnail, without opening it.  The context menu calls stepThumbnailPage from its wheel
// handler.  See docs/design.md.
//
// The page shown lives in the thumbnail link's data-media-id, which is what a click opens, so
// clicking a thumbnail turned to page 3 opens page 3.  The search view sets the link back to the
// first page whenever it sets the thumbnail up again.

import { helpers } from '/vview/misc/helpers.js';
import { setThumbnail } from '/vview/misc/hd-thumbnails.js';
import { getUrlForMediaId } from '/vview/misc/media-ids.js';

// Return the thumbnail of the work mediaId if it can show other pages: a multi-page work that
// isn't expanded into one thumbnail per page and isn't muted.
function pageableThumbnail(mediaId)
{
    if(mediaId == null || helpers.mediaId.parse(mediaId).type != "illust")
        return null;

    let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
    let firstPage = helpers.mediaId.fromIllustId(illustId, 0);
    let box = document.querySelector(`.search-view .thumbnail-box[data-id="${firstPage}"]`);
    if(box == null || box.classList.contains("expanded-thumb") || box.classList.contains("muted"))
        return null;

    let info = ppixiv.mediaCache.getMediaInfoSync(firstPage, { full: false });
    if(info == null || info.pageCount < 2 || info.previewUrls == null)
        return null;

    return { box, info };
}

// Show the page step pages away from the one the thumbnail of mediaId shows.  Return true if
// that thumbnail can show pages, even if it's already at the first or last page, so the wheel
// does nothing else.  Return false to leave the wheel alone.
export function stepThumbnailPage(mediaId, step)
{
    let thumbnail = pageableThumbnail(mediaId);
    if(thumbnail == null)
        return false;

    let { box, info } = thumbnail;
    let link = box.querySelector("a.thumbnail-link");
    let page = (helpers.mediaId.parse(link.dataset.mediaId).page ?? 0) + step;
    if(page >= 0 && page < info.pageCount)
        showThumbnailPage(box, link, info, page);
    return true;
}

function showThumbnailPage(box, link, info, page)
{
    let pageMediaId = helpers.mediaId.getMediaIdForPage(box.dataset.id, page);
    link.dataset.mediaId = pageMediaId;
    link.href = getUrlForMediaId(pageMediaId).url;
    setThumbnail(box.querySelector(".thumb"), info.previewUrls[page], pageMediaId, box);

    // The page count in the corner turns into "2/5" while another page shows.
    let count = box.querySelector(".manga-info-box .page-count");
    if(count != null)
        count.textContent = page == 0? info.pageCount:`${page+1}/${info.pageCount}`;
}
