// The artist's other works in the viewer's info panel: a strip of the newest works below the
// action rows, and a link to all of them.  See docs/design.md "看图".
//
// The work's full info already lists the artist's work IDs (MediaCache keeps the newest ones), but
// without thumbnails.  The thumbnails come from one batch request per artist, kept for the session,
// so moving through one artist's works costs nothing more.  The request waits until the panel is
// visible and the viewer's main image has loaded, so it never competes with the original and never
// runs from hover preloading in the list.

import Widget from '/vview/widgets/widget.js';
import { getUrlForMediaId } from '/vview/misc/media-ids.js';
import { helpers } from '/vview/misc/helpers.js';

const SHOWN = 5;

// userId -> promise of the artist's newest work IDs that can be shown (R-18 works the account
// hides are left out, as in the user rows).
const loads = new Map();

// userId -> those IDs, once the request has finished.  The next work of the artist shows them at
// once, without waiting for its original: the wait only keeps the first request from competing
// with the original, and there is no request left.
const resolved = new Map();

function loadArtistWorks(userId, illustIds)
{
    let load = loads.get(userId);
    if(load)
        return load;

    load = (async() => {
        let result = await helpers.pixivRequest.get(`/ajax/user/${userId}/profile/illusts`, {
            "ids[]": illustIds,
            work_category: "illustManga",
            is_first_page: "0",
        });
        if(result.error)
        {
            // Let the next work of this artist try again.
            loads.delete(userId);
            return [];
        }

        let works = Object.values(result.body.works).filter((work) => !work.isMasked);
        await ppixiv.mediaCache.addMediaInfosPartial(works, "normal");
        let ids = works.map((work) => work.id).sort((lhs, rhs) => rhs - lhs);
        resolved.set(userId, ids);
        return ids;
    })();
    loads.set(userId, load);
    return load;
}

// Resolve when the viewer's main image at url has loaded, or failed to.
function mainImageLoaded(url, signal)
{
    let loaded = () => [...document.querySelectorAll("img.main-image")].some((img) => img.src == url && img.complete);
    if(loaded())
        return Promise.resolve();

    return new Promise((resolve) => {
        let done = (e) => {
            if(e.target.src != url)
                return;
            controller.abort();
            resolve();
        };
        let controller = new AbortController();
        signal.addEventListener("abort", () => controller.abort());
        document.addEventListener("load", done, { capture: true, signal: controller.signal });
        document.addEventListener("error", done, { capture: true, signal: controller.signal });
    });
}

export default class ArtistWorks extends Widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
                <div class=n-artist-works hidden>
                    <div class=n-artist-works-head>
                        <span class=n-artist-works-label>其他作品</span>
                        <a class=n-artist-works-all></a>
                    </div>
                    <div class=n-artist-works-strip></div>
                </div>
            `,
        });

        this._mediaId = null;
        this._abort = null;
        this._strip = this.root.querySelector(".n-artist-works-strip");
    }

    // Show the strip for mediaInfo (the work in the viewer), or hide it if mediaInfo is null.  page
    // is the page shown, whose image the request waits for.  Call again whenever the info changes:
    // nothing reloads for the same work.
    set({ mediaInfo, page=0 })
    {
        // Moving to another work of the same artist gives partial info first.  Keep the strip
        // until the full info arrives, instead of hiding it for a moment.
        if(mediaInfo != null && !mediaInfo.full && mediaInfo.userId == this._userId && !this.root.hidden)
            return;

        let mediaId = mediaInfo?.mediaId;
        let count = mediaInfo?.full? mediaInfo.userIllustCount:null;
        let show = count > 1 && ppixiv.settings.get("info_panel_artist_works") && !ppixiv.muting.isUserIdMuted(mediaInfo.userId);
        if(!show)
        {
            this._stop();
            this.root.hidden = true;
            return;
        }

        if(mediaId == this._mediaId)
            return;

        this._stop();
        this._mediaId = mediaId;
        this._userId = mediaInfo.userId;
        this._abort = new AbortController();

        this.root.hidden = false;
        let all = this.root.querySelector(".n-artist-works-all");
        all.href = `/users/${mediaInfo.userId}/artworks#ppixiv`;
        all.innerHTML = `全部作品 <span class=n-num>${count}</span>`;

        let ids = resolved.get(mediaInfo.userId);
        if(ids)
        {
            this._render(mediaInfo, ids);
            return;
        }

        // Reserve the strip's height now, so the panel doesn't move when the thumbnails arrive.
        let placeholders = Array.from({ length: Math.min(count - 1, SHOWN) }, () => {
            let placeholder = document.createElement("span");
            placeholder.className = "n-artist-work";
            return placeholder;
        });
        this._strip.replaceChildren(...placeholders);

        this._load(mediaInfo, page, this._abort.signal);
    }

    _stop()
    {
        this._abort?.abort();
        this._abort = null;
        this._mediaId = null;
        this._userId = null;
    }

    async _load(mediaInfo, page, signal)
    {
        // Ugoira don't show their main image, and the zip loads separately.
        if(mediaInfo.illustType != 2)
            await mainImageLoaded(mediaInfo.getMainImageUrl(page).url, signal);
        if(signal.aborted)
            return;

        let ids = await loadArtistWorks(mediaInfo.userId, mediaInfo.userIllustIds);
        if(signal.aborted)
            return;

        this._render(mediaInfo, ids);
    }

    _render(mediaInfo, ids)
    {
        let shown = ids.filter((id) => id != mediaInfo.illustId).slice(0, SHOWN);
        if(shown.length == 0)
        {
            let note = document.createElement("span");
            note.className = "n-artist-works-note";
            note.textContent = "其他作品都被隐藏（R-18）";
            this._strip.replaceChildren(note);
            return;
        }

        this._strip.replaceChildren(...shown.map((illustId) => this._createThumb(helpers.mediaId.fromIllustId(illustId))));
    }

    _createThumb(mediaId)
    {
        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        let link = document.createElement("a");
        link.className = "n-artist-work";
        link.href = getUrlForMediaId(mediaId).url;

        // Works with a muted tag are placeholders, as in the lists that don't hide them.
        let mutedTag = info && ppixiv.muting.anyTagMuted(info.tagList);
        if(info == null || mutedTag)
        {
            link.classList.add("muted");
            link.innerHTML = helpers.createIcon("mat:block");
            if(mutedTag)
                link.setAttribute("aria-label", `已屏蔽：${mutedTag}`);
            return link;
        }

        link.title = info.illustTitle;
        let img = document.createElement("img");
        img.alt = info.illustTitle;
        img.src = info.previewUrls[0];
        link.append(img);

        if(info.pageCount > 1)
        {
            let pages = document.createElement("span");
            pages.className = "n-artist-work-pages";
            pages.textContent = info.pageCount + "P";
            link.append(pages);
        }
        return link;
    }
}
