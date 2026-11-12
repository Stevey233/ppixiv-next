// One-click bookmarking from the thumbnail grid on desktop.
//
// Hovering a work that isn't bookmarked shows an outlined heart in the bottom-left corner, where
// the filled heart of a bookmarked work is.  Clicking it bookmarks the work with the default
// privacy (Alt+click: private), like 收藏 in the context menu.  Clicking the filled heart of a
// bookmarked work doesn't remove the bookmark.  See docs/design.md (缩略图).
//
// The search view sets .n-unbookmarked on thumbnails whose work has no bookmark, which is what
// shows the button.  While a request is in flight the thumbnail has .n-bookmarking, which shows
// the heart filled.

import Actions from '/vview/misc/actions.js';

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
        if(e.target.closest(".n-quick-bookmark"))
            e.preventDefault();
    }, { signal });

    container.addEventListener("click", (e) => {
        let button = e.target.closest(".n-quick-bookmark, .bottom-left-icon .heart");
        if(button == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        let thumb = button.closest(".thumbnail-box");
        if(button.classList.contains("heart"))
        {
            ppixiv.message.show("已经收藏过了（取消收藏用右键菜单或看图界面）");
            return;
        }

        if(thumb.classList.contains("n-bookmarking"))
            return;

        bookmark(thumb, button, { private: e.altKey? true:null, refresh });
    }, { signal });
}

async function bookmark(thumb, button, { private: isPrivate, refresh })
{
    let mediaId = thumb.dataset.id;
    let hadFocus = document.activeElement == button;

    thumb.classList.add("n-bookmarking");
    try {
        await Actions.bookmarkAdd(mediaId, { private: isPrivate });
    } catch(e) {
        // Actions doesn't report failed Pixiv requests itself.  They throw, either from a missing
        // response body or a missing bookmark ID.
        console.error(`Quick bookmark of ${mediaId} failed:`, e);
        ppixiv.message.show("收藏失败，请重试");
    } finally {
        // Refresh before clearing .n-bookmarking, so the outline doesn't show for a frame between
        // the two.
        refresh(thumb);
        thumb.classList.remove("n-bookmarking");
    }

    // The button is hidden now that the work is bookmarked.  Keep keyboard focus on the work.
    if(hadFocus && button.offsetParent == null)
        thumb.querySelector("a.thumbnail-link")?.focus();
}
