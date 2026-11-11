// Prefetch originals through the HTTP cache used by the viewer.

let HOVER_DELAY_MS = 300;
let HOVER_PREFETCH_LIMIT = 30;
let MAX_PREFETCHES = 3;
let MANGA_PAGES_AHEAD = 2;

let prefetched = new Set(); // URLs that finished downloading, see notePrefetched
let PREFETCHED_LIMIT = 2000;
let prefetching = new Map(); // url -> img
let hoverPrefetchTimes = [];
let hoverTimer = null;
let hoveredMediaId = null;
let lastMangaMediaId = null;

let saveData = () => navigator.connection?.saveData == true;
let hoverPrefetchEnabled = () => window.ppixiv.settings.get("hover_preload");

// Return true and record the hover if another hover prefetch fits in the last minute.
function takeHoverPrefetch()
{
    let now = performance.now();
    while(hoverPrefetchTimes.length > 0 && now - hoverPrefetchTimes[0] > 60000)
        hoverPrefetchTimes.shift();
    if(hoverPrefetchTimes.length >= HOVER_PREFETCH_LIMIT)
        return false;
    hoverPrefetchTimes.push(now);
    return true;
}

// Forgetting an old URL only means a hover on that work may count towards the limit again.
function notePrefetched(url)
{
    prefetched.add(url);
    while(prefetched.size > PREFETCHED_LIMIT)
        prefetched.delete(prefetched.values().next().value);
}

// ppixiv disables setTimeout in the page and keeps the real one as realSetTimeout.
let later = (callback, ms) => (window.realSetTimeout ?? window.setTimeout)(callback, ms);
let cancelLater = (id) => (window.realClearTimeout ?? window.clearTimeout)(id);

function prefetchUrl(url)
{
    if(saveData() || !url || prefetched.has(url) || prefetching.has(url))
        return;

    // Drop the oldest unfinished prefetch to keep bandwidth for the newest.
    if(prefetching.size >= MAX_PREFETCHES)
    {
        let [oldUrl, oldImg] = prefetching.entries().next().value;
        oldImg.src = "";
        prefetching.delete(oldUrl);
    }

    let img = document.createElement("img");
    let done = (ok) => {
        if(prefetching.get(url) != img)
            return;
        prefetching.delete(url);
        if(ok)
            notePrefetched(url);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.decoding = "async";
    prefetching.set(url, img);
    img.src = url;
}

function parseMediaId(mediaId)
{
    let match = /^illust:(\d+)(?:-(\d+))?$/.exec(mediaId ?? "");
    return match ? { page: Number(match[2] ?? 0) } : null;
}

// mediaCache.getMediaInfo, except that a failed request isn't remembered.  ppixiv records
// failures in _nonexistantMediaIds and never retries them, not even when the work is opened,
// so a dropped connection during a prefetch would make the work unopenable until a reload.
// Errors Pixiv itself returns, like a deleted work, are kept as ppixiv keeps them.
async function getMediaInfoForPrefetch(mediaCache, mediaId)
{
    let failures = mediaCache._nonexistantMediaIds;
    let key = mediaId.replace(/^illust:(\d+).*$/, "illust:$1-0"); // ppixiv's getMediaIdFirstPage
    let failedBefore = failures != null && key in failures;
    let info = await mediaCache.getMediaInfo(mediaId);
    if(info == null && failures != null && !failedBefore)
    {
        // "Invalid response" means the request failed.  A message like "429 Too Many Requests"
        // means Pixiv answered with an error page instead of JSON.
        let message = String(failures[key] ?? "");
        if(message == "Invalid response" || /^\d{3}\b/.test(message))
            delete failures[key];
    }
    return info;
}

// If shownPage is given, it's the page on screen, and the other pages wait until it has
// loaded so they don't share the connection with it.
async function prefetchPages(mediaId, pages, shownPage = null)
{
    let ppixiv = window.ppixiv;
    if(parseMediaId(mediaId) == null || ppixiv?.mediaCache == null)
        return;

    // Loading full info here also means the viewer won't wait for it when the work is opened.
    let info = await getMediaInfoForPrefetch(ppixiv.mediaCache, mediaId);
    if(saveData() || (shownPage == null && !hoverPrefetchEnabled()) || info == null)
        return;

    // Another work or page may have been shown while the info loaded.
    if(shownPage != null && mediaId != lastMangaMediaId)
        return;
    if(ppixiv.muting?.anyTagMuted?.(info.tagList) || ppixiv.muting?.isUserIdMuted?.(info.userId))
        return;
    // Full info can arrive after a hover that had no cached preview URL.
    if(shownPage == null)
        prefetchUrl(info.previewUrls?.[pages[0]]);
    if(info.illustType == 2)
        return;
    if(shownPage != null && !await waitForShownPage(info.getMainImageUrl(shownPage).url))
        return;

    if(saveData() || (shownPage != null && mediaId != lastMangaMediaId))
        return;

    for(let page of pages)
        if(page < info.mangaPages.length)
            prefetchUrl(info.getMainImageUrl(page).url);
}

// An image outside the page that loads the page on screen.  It shares the viewer's request for
// the same URL, so it costs nothing.  It's dropped when another page is shown, which ends the
// wait.
let shownPageLoader = null;
let cancelShownPage = null;

// Resolve to true once url has loaded, or false if it failed or another page was shown first.
function waitForShownPage(url)
{
    if(!url || prefetched.has(url))
        return Promise.resolve(true);
    let loader = document.createElement("img");
    shownPageLoader = loader;
    return new Promise((resolve) => {
        cancelShownPage = () => resolve(false);
        loader.onload = () => resolve(shownPageLoader == loader);
        loader.onerror = () => resolve(false);
        loader.src = url;
    });
}

// Return true if hovering a work would request anything: its full info isn't loaded yet, or
// its original or 540 preview isn't downloaded or downloading.
function hoverWouldFetch(mediaId, page)
{
    let mediaCache = window.ppixiv?.mediaCache;
    try {
        let info = mediaCache?.getMediaInfoSync(mediaId);
        if(info == null)
            return true;
        // Animations' originals aren't prefetched, see below.
        let have = (url) => url == null || prefetched.has(url) || prefetching.has(url);
        return (info.illustType != 2 && !have(info.getMainImageUrl(page).url)) ||
            !have(mediaCache.getMediaInfoSync(mediaId, { full: false })?.previewUrls?.[page]);
    } catch(e) {
        return true;
    }
}

// ppixiv's viewer loads the same originals and 540 previews.  Count those as downloaded too, so
// hovering a work that was already viewed doesn't use up the limit.
document.addEventListener("load", (e) => {
    let url = e.target.currentSrc;
    if(e.target.tagName == "IMG" && url?.startsWith("https://i.pximg.net/") && !url.includes("_webp/"))
        notePrefetched(url);
}, true);

export function cancelHoverPreload()
{
    hoveredMediaId = null;
    if(hoverTimer != null)
        cancelLater(hoverTimer);
    hoverTimer = null;
}

// Scrolling under a still mouse fires pointerover for whatever ends up under it, but not
// pointermove.  So pointerover only cancels a pending hover, and the hover starts when the mouse
// moves onto a thumbnail.
export function thumbnailPointerOver(e)
{
    if(e.pointerType != "mouse")
        return;
    let mediaId = e.target.closest?.(".thumbnail-box")?.dataset.id ?? null;
    if(mediaId == hoveredMediaId)
        return;

    hoveredMediaId = null;
    if(hoverTimer != null)
        cancelLater(hoverTimer);
    hoverTimer = null;
}

export function thumbnailPointerMove(e)
{
    if(e.pointerType != "mouse")
        return;
    let thumb = e.target.closest?.(".thumbnail-box");
    let mediaId = thumb?.dataset.id ?? null;
    if(mediaId == hoveredMediaId)
        return;

    hoveredMediaId = mediaId;
    if(hoverTimer != null)
        cancelLater(hoverTimer);
    hoverTimer = null;

    let parsed = parseMediaId(mediaId);
    if(parsed == null || !hoverPrefetchEnabled())
        return;
    hoverTimer = later(() => {
        hoverTimer = null;
        if(hoveredMediaId != mediaId || saveData() || !hoverPrefetchEnabled())
            return;

        // Muted works show a placeholder.  Don't download what the user chose not to see.
        // Hovers that would request nothing don't count towards the limit.
        if(thumb.closest(".thumbnail-box")?.classList.contains("muted") || !hoverWouldFetch(mediaId, parsed.page) ||
            !takeHoverPrefetch())
            return;

        let partialInfo = null;
        try {
            partialInfo = window.ppixiv?.mediaCache?.getMediaInfoSync(mediaId, { full: false });
        } catch(e) {
        }

        // ppixiv can often guess the original's URL from the thumbnail without waiting for
        // the info request (it needs a few earlier works by the same artist to know the file
        // type).  Start that right away, and fetch the info in parallel.  Animations play from
        // a ZIP, and the "original" guessUrl returns for one is its first frame, which the
        // viewer doesn't use.
        if(partialInfo != null && partialInfo.illustType != 2)
        {
            window.ppixiv?.guessImageUrl?.guessUrl(mediaId).then((url) => {
                if(url && hoveredMediaId == mediaId && hoverPrefetchEnabled())
                    prefetchUrl(url);
            }).catch(() => {});
        }
        prefetchPages(mediaId, [parsed.page]).catch(() => {});

        // The viewer shows ppixiv's 540 thumbnail while the original loads.  Search results
        // now load larger thumbnails instead (see "sharper thumbnails"), so fetch it too.
        prefetchUrl(partialInfo?.previewUrls?.[parsed.page]);
    }, HOVER_DELAY_MS);
}

export function preloadMangaPages(mediaId)
{
    if(mediaId == lastMangaMediaId)
        return;
    lastMangaMediaId = mediaId;

    // Stop waiting for the page that was shown before.
    if(shownPageLoader != null)
    {
        cancelShownPage?.();
        cancelShownPage = null;
        shownPageLoader.src = "";
        shownPageLoader = null;
    }

    let parsed = parseMediaId(mediaId);
    if(parsed == null || saveData())
        return;

    // Follow ppixiv's "Preload manga" setting.  "Thumbnails only" preloads no other pages, and
    // "Nearby pages" only preloads the next one.  ppixiv defaults to thumbnails only on mobile.
    let mode = window.ppixiv?.settings?.get?.("preload_manga");
    if(mode == "thumbnails")
        return;
    let pages = [];
    for(let i = 1; i <= (mode == "partial" ? 1 : MANGA_PAGES_AHEAD); ++i)
        pages.push(parsed.page + i);
    prefetchPages(mediaId, pages, parsed.page).catch(() => {});
}

