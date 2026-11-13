// One-click bookmarking from the thumbnail grid on desktop.
//
// Hovering a work that isn't bookmarked shows an outlined heart in the bottom-left corner, where
// the filled heart of a bookmarked work is.  Clicking it bookmarks the work with the default
// privacy (Alt+click: private), like 收藏 in the context menu.  Clicking the filled heart removes
// the bookmark, with 撤销 in the message (Actions.bookmarkRemove).  Shift+click bookmarks and
// downloads; on the filled heart it only downloads.  See docs/design.md (缩略图).
//
// The search view sets .n-unbookmarked on thumbnails whose work has no bookmark, which is what
// shows the button.  While a request is in flight the thumbnail has .n-bookmarking, which shows
// the heart filled, or .n-unbookmarking, which shows it outlined.

import Actions from '/vview/misc/actions.js';
import { helpers } from '/vview/misc/helpers.js';

// Works with a request from here in flight, by the media ID of the first page.  The thumbnail
// can't hold this: expanded manga shows one thumbnail per page of the same work, and the list can
// recreate a thumbnail while its request runs.
let inFlight = new Set();

export function setupQuickBookmark({
    // The element containing the thumbnails.
    container,

    // Refresh the bookmark icons of a thumbnail from its media info.
    refresh,
    signal,
})
{
    // Clicking the button would focus it, and the focused thumbnail keeps its crop marks after
    // the mouse leaves.  Keyboard focus still works.
    container.addEventListener("mousedown", (e) => {
        if(e.target.closest(".n-quick-bookmark, .bottom-left-icon .heart"))
            e.preventDefault();
    }, { signal });

    container.addEventListener("click", (e) => {
        let button = e.target.closest(".n-quick-bookmark, .bottom-left-icon .heart");
        if(button == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        let thumb = button.closest(".thumbnail-box");
        let mediaId = helpers.mediaId.getMediaIdFirstPage(thumb.dataset.id);
        let bookmarked = button.classList.contains("heart");

        // Shift never removes: on a bookmarked work it only downloads.
        if(bookmarked && e.shiftKey)
        {
            Actions.downloadWork(mediaId);
            return;
        }

        // Phones have no hover to show what a tap on the heart would do.
        if(bookmarked && ppixiv.mobile)
            return;

        if(inFlight.has(mediaId))
            return;

        run(thumb, button, mediaId, {
            remove: bookmarked,
            private: e.altKey? true:null,
            download: e.shiftKey,
            refresh,
        });
    }, { signal });
}

async function run(thumb, button, mediaId, { remove, private: isPrivate, download, refresh })
{
    let hadFocus = document.activeElement == button;
    let stateClass = remove? "n-unbookmarking":"n-bookmarking";

    inFlight.add(mediaId);
    thumb.classList.add(stateClass);
    try {
        // bookmarkRemove reports its own failure and leaves the bookmark in place.
        if(remove)
            await Actions.bookmarkRemove(mediaId);
        else if(download)
            await Actions.bookmarkAndDownload(mediaId, { private: isPrivate });
        else
            await Actions.bookmarkAdd(mediaId, { private: isPrivate });
    } catch(e) {
        // Adding doesn't report failed Pixiv requests itself.  They throw, either from a missing
        // response body or a missing bookmark ID.
        console.error(`Quick bookmark of ${mediaId} failed:`, e);
        ppixiv.message.show("收藏失败，请重试");
    } finally {
        inFlight.delete(mediaId);

        // Refresh before clearing the state class, so the other heart doesn't show for a frame
        // between the two.
        refresh(thumb);
        thumb.classList.remove(stateClass);
    }

    // The clicked heart is hidden now.  Keep keyboard focus on the work.
    if(hadFocus && button.offsetParent == null)
        thumb.querySelector("a.thumbnail-link")?.focus();
}
