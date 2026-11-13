// "Since last time" on 关注的新作.  See docs/design.md, "### 页头".
//
// The feed remembers the newest work it showed on the previous visit, separately for the all and
// R-18 modes, in the following_last_seen setting: { all: { mark, pending, visitTime }, r18: ... }.
// pending is the highest illust ID loaded during the current visit, and mark is the previous
// visit's pending.  A list that loads its first page more than VISIT_GAP after the last page load
// starts a new visit, which moves pending to mark.  A reload or a trip into the viewer and back
// stays inside the visit, so it doesn't move the boundary to the top.
//
// The header counts the works above the boundary in the list as it's shown, so with filters on,
// the count follows the filtered list.  The boundary itself comes from the unfiltered pages.

import { helpers } from '/vview/misc/helpers.js';

const VISIT_GAP = 2*60*60*1000;

export default class FollowingLastSeen
{
    constructor(dataSource, mode)
    {
        this.dataSource = dataSource;
        this.mode = mode;

        // The boundary for this list: undefined until the first page loads, then null on the
        // first visit or the remembered illust ID.
        this.mark = undefined;

        // Refresh the header when a page changes the count.  The page isn't in the list until
        // after loadPageInternal returns, so this waits for pageadded.
        this._title = null;
        dataSource.addEventListener("pageadded", () => {
            let title = this._statusText();
            if(title != this._title)
                dataSource.callUpdateListeners();
        });
    }

    get enabled() { return ppixiv.settings.get("following_last_seen_marker"); }

    // Record a page as the API returned it, before the result filters.
    pageLoaded(illustIds)
    {
        if(illustIds.length == 0)
            return;

        let stored = ppixiv.settings.get("following_last_seen") ?? {};
        let entry = stored[this.mode];
        let now = Date.now();

        // The first page this list loads decides whether this is a new visit.
        if(this.mark === undefined)
        {
            if(entry != null && now - entry.visitTime > VISIT_GAP)
                entry = { ...entry, mark: entry.pending };
            this.mark = entry?.mark ?? null;
        }

        let top = Math.max(...illustIds.map(Number));
        ppixiv.settings.set("following_last_seen", {
            ...stored,
            [this.mode]: {
                mark: entry?.mark ?? null,
                pending: Math.max(entry?.pending ?? 0, top),
                visitTime: now,
            },
        });
    }

    // Return { count, boundary, more } for the list as shown, or null if there's nothing to show.
    // boundary is the media ID of the first work at or below the mark, or null if it isn't loaded
    // yet.  more is true if the boundary may still be on a page that isn't loaded.
    status()
    {
        if(!this.enabled || this.mark == null)
            return null;

        // Count only from the top of the feed, not from a list opened at ?p=5.
        let { idList } = this.dataSource;
        if(!idList.mediaIdsByPage.has(1))
            return null;

        let pages = [...idList.mediaIdsByPage.keys()].sort((a, b) => a - b);
        let count = 0;
        for(let page of pages)
        {
            for(let mediaId of idList.mediaIdsByPage.get(page))
            {
                let [illustId] = helpers.mediaId.toIllustIdAndPage(mediaId);
                if(Number(illustId) <= this.mark)
                    return { count, boundary: mediaId, more: false };
                count++;
            }
        }

        return { count, boundary: null, more: !this.dataSource.loadedAllPages };
    }

    // Return true if mediaId is the work that carries the "上次看到这里" plate.  There's no plate
    // when nothing is new, since the header already says so and the plate would sit on the first
    // thumbnail.
    isBoundary(mediaId)
    {
        let status = this.status();
        return status != null && status.count > 0 && status.boundary == helpers.mediaId.getMediaIdFirstPage(mediaId);
    }

    _statusText()
    {
        let status = this.status();
        if(status == null)
            return null;
        if(status.count == 0 && status.boundary != null)
            return "上次之后没有新作";
        return `上次之后 ${status.count}${status.more? "+":""} 件`;
    }

    // Return the header title: the list name, followed by the count when there is one.
    title(name)
    {
        let text = this._title = this._statusText();
        if(text == null)
            return name;

        let fragment = document.createDocumentFragment();
        fragment.append(name);

        let status = this.status();
        let count;
        if(status.boundary != null && status.count > 0)
        {
            count = document.createElement("button");
            count.type = "button";
            count.title = "跳到上次看到的位置";
            count.addEventListener("click", () => {
                // The search view is the only thing that can create the thumbnail if it's
                // offscreen and scroll to it.
                ppixiv.app._screenSearch?.searchView?.scrollToMediaId(status.boundary);
            });
        }
        else
            count = document.createElement("span");

        count.className = "n-last-seen-count";
        count.textContent = text;
        fragment.append(count);
        return fragment;
    }
}
