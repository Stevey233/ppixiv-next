// Choose thumbnail sizes before loading, then upgrade them as the layout changes.

let saveData = () => navigator.connection?.saveData == true;
let THUMB_TIERS = [
    { spec: "600x1200_90_webp", box: [600, 1200] },
    { spec: "1200x1200_80_webp", box: [1200, 1200] },
    { spec: "1200x1200_90_webp", box: [1200, 1200] },
];
let THUMB_BASE = -1; // ppixiv's own 540x540_70 URL
let THUMB_URL_RE = /^(.*\/c\/)540x540_70(\/img-master\/.*_master1200\.jpg)$/;

// Download time per thumbnail, as if it had the connection to itself (see thumbLoadMs).  For a
// 100-140 KB thumbnail, 400 ms is about 2 Mbps and 1000 ms about 1 Mbps.
let THUMB_SLOW_MS = 400;
let THUMB_VERY_SLOW_MS = 1000;
let THUMB_TIMING_SAMPLES = 40;

// Stop changing thumbnails after this many different images fail, in case Pixiv stopped serving
// these sizes.
let THUMB_MAX_FAILURES = 5;

let thumbStates = new WeakMap(); // img -> { base, prefix, path, mediaId, tier, upgrading, failed }
let thumbTimings = []; // { start, end } of recent thumbnail downloads
let failedThumbUrls = new Set(); // Keep failures when ppixiv rebuilds thumbnail elements.
let loadedThumbTiers = new Map(); // base URL -> Set of tiers that finished loading
let LOADED_THUMBS_LIMIT = 5000; // the oldest are forgotten, and load again from the browser's cache
let thumbLoadMs = null;
let thumbFailures = 0;

function thumbsEnabled()
{
    return !saveData() && window.ppixiv.settings.get("hd_thumbnails") != "off" && thumbFailures < THUMB_MAX_FAILURES;
}

// Tiers that may be used now, from smallest to largest.  Empty means keep ppixiv's 540.
function allowedThumbTiers()
{
    if(saveData())
        return [];
    if(thumbLoadMs == null || thumbLoadMs < THUMB_SLOW_MS)
        return [0, 2];
    if(thumbLoadMs < THUMB_VERY_SLOW_MS)
        return [0, 1];
    return [0];
}

function thumbUrl(state, tier)
{
    return tier == THUMB_BASE ? state.base : state.prefix + THUMB_TIERS[tier].spec + state.path;
}

// Return the best tier for showing mediaId in a cssWidth x cssHeight box.
function pickThumbTier(mediaId, cssWidth, cssHeight)
{
    let allowed = allowedThumbTiers();
    if(allowed.length == 0)
        return THUMB_BASE;
    if(!(cssWidth > 0 && cssHeight > 0))
        return allowed[0];

    let mediaCache = window.ppixiv?.mediaCache;
    let width = 1, height = 1;
    try {
        let info = mediaCache?.getMediaInfoSync(mediaId, { full: false });
        if(info != null)
            ({ width, height } = mediaCache.getImageDimensions(info, mediaId));
    } catch(e) {
        // Unknown dimensions are treated as square.
    }
    if(!(width > 0 && height > 0))
        width = height = 1;

    // Thumbnails are object-fit: cover, so the image is scaled to fill the box and cropped.
    let dpr = window.devicePixelRatio || 1;
    let scale = Math.max(cssWidth * dpr / width, cssHeight * dpr / height);
    let neededWidth = width * scale;

    // Pixiv scales the image down to fit the box, and the source is at most 1200 on its long
    // side.  Allow 10% upscaling before reaching for a bigger file.
    let best = allowed[0], bestWidth = 0;
    for(let tier of allowed)
    {
        let [boxWidth, boxHeight] = THUMB_TIERS[tier].box;
        let fit = Math.min(1, boxWidth / width, boxHeight / height, 1200 / Math.max(width, height));
        let delivered = width * fit;
        if(delivered >= neededWidth * 0.9)
            return tier;
        if(delivered > bestWidth + 1)
        {
            best = tier;
            bestWidth = delivered;
        }
    }
    return best;
}

let setImgSrc = (img, url) => { img.src = url; };

// Upstream zooms thumbnails 1.25x until hovered.  The redesign shows the whole thumbnail instead
// (see _next.scss), so thumbnails are never shown larger than their box.
function thumbZoom()
{
    return 1;
}

function thumbTierLoaded(state, tier)
{
    return loadedThumbTiers.get(state.base)?.has(tier) == true;
}

function markThumbTierLoaded(state, tier)
{
    let tiers = loadedThumbTiers.get(state.base);
    if(tiers == null)
    {
        loadedThumbTiers.set(state.base, tiers = new Set());
        while(loadedThumbTiers.size > LOADED_THUMBS_LIMIT)
            loadedThumbTiers.delete(loadedThumbTiers.keys().next().value);
    }
    tiers.add(tier);
}

// The tier to show at once for a thumbnail that wants `wanted`.  ppixiv rebuilds thumbnails
// when their size changes, and the new elements would stay blank while a new size downloads.
// If another tier of the work has already loaded, show that instead: a larger one as it is, or a
// smaller one until the wanted tier has loaded in the background.
function shownThumbTier(state, wanted)
{
    let tiers = loadedThumbTiers.get(state.base);
    if(tiers == null || tiers.has(wanted))
        return wanted;
    return Math.max(...tiers);
}

// In the manga view, ppixiv loads each page's 540 thumbnail to learn its aspect ratio before it
// creates the thumbnails, so those URLs are already downloaded.  Swapping them would leave the
// thumbnails blank until a different file downloads, so keep them and upgrade in the background.
let inMangaView = () => window.ppixiv?.app?.currentDataSource?.name == "manga";

let thumbResizeObserver = new ResizeObserver((entries) => {
    let zoom = thumbZoom();
    for(let entry of entries)
        maybeUpgradeThumb(entry.target, entry.contentRect.width * zoom, entry.contentRect.height * zoom);
});

function trackThumb(img, url, mediaId)
{
    let match = THUMB_URL_RE.exec(url);
    if(match == null || mediaId == null)
    {
        thumbStates.delete(img);
        return null;
    }

    let state = { base: url, prefix: match[1], path: match[2], mediaId, tier: THUMB_BASE, upgrading: null, failed: failedThumbUrls.has(url) };
    thumbStates.set(img, state);
    watchThumb(img);
    return state;
}

function watchThumb(img)
{
    thumbResizeObserver.observe(img);
    thumbVisibilityObserver.observe(img);
}

// The observers keep what they watch alive, so stop watching thumbnails ppixiv has thrown away.
// Row layout can move nodes temporarily, so only callers removing a thumbnail permanently
// should forget it.
export function forgetThumb(img)
{
    thumbResizeObserver.unobserve(img);
    thumbVisibilityObserver.unobserve(img);
    visibleThumbs.delete(img);
    thumbStates.delete(img);
}

// Set the first URL before callers wait for the thumbnail to load.
export function setThumbnail(img, url, mediaId, box)
{
    forgetThumb(img);
    let state = thumbsEnabled() ? trackThumb(img, url, mediaId) : null;
    if(state == null || state.failed || inMangaView())
    {
        img.src = url;
        return;
    }

    let zoom = thumbZoom();
    state.tier = shownThumbTier(state, pickThumbTier(mediaId, box.origWidth * zoom, box.origHeight * zoom));
    img.src = thumbUrl(state, state.tier);
    // Row stretching happens later in the same task, before the request starts.
    queueMicrotask(() => {
        if(thumbStates.get(img) != state || state.failed || !thumbsEnabled() || box.currentWidth == null)
            return;
        let width = box.currentWidth * zoom, height = box.currentHeight * zoom;
        if(thumbTierLoaded(state, state.tier))
        {
            maybeUpgradeThumb(img, width, height);
            return;
        }
        let tier = pickThumbTier(mediaId, width, height);
        if(tier > state.tier)
        {
            state.tier = tier;
            img.src = thumbUrl(state, tier);
        }
    });
}

function upgradeThumb(img, state, tier)
{
    state.upgrading = tier;
    let url = thumbUrl(state, tier);
    let loader = document.createElement("img");
    loader.decoding = "async";
    loader.onload = async () => {
        markThumbTierLoaded(state, tier);
        await loader.decode().catch(() => {});
        if(thumbStates.get(img) != state || state.upgrading != tier)
            return;
        state.upgrading = null;
        if(state.failed || !thumbsEnabled())
            return;
        state.tier = tier;
        setImgSrc(img, url);
    };
    loader.onerror = () => {
        if(state.upgrading == tier)
            state.upgrading = null;
        thumbFailed(state, url);
    };
    setImgSrc(loader, url);
}

// Load url in an image outside the page, and call done(true) if it loads or done(false).
function loadDetached(url, done)
{
    let loader = document.createElement("img");
    loader.onload = () => done(true);
    loader.onerror = () => done(false);
    setImgSrc(loader, url);
}

// Stop trying larger sizes for an image once one fails, so scrolling it back into view doesn't
// try again.  The failure only counts towards turning the feature off if the connection isn't
// to blame: a request for ppixiv's 540 has to get through, and then url has to fail a second
// time.  An error event
// can't tell a refused size from a dropped connection, and one connection reset can fail a
// whole page of thumbnails at once.  When the connection was to blame, the image is forgotten,
// and gets larger sizes again once the observers see it or ppixiv rebuilds it.
function thumbFailed(state, url)
{
    if(state.failed)
        return;
    state.failed = true;
    if(failedThumbUrls.has(state.base))
        return;
    failedThumbUrls.add(state.base);

    let forget = () => {
        failedThumbUrls.delete(state.base);
        state.failed = false;
    };

    // Ask the network whether it's up.  Loading the 540 in an image isn't enough, since it can
    // come from the cache while offline.  A no-cors fetch resolves for any HTTP response and
    // rejects only when the request didn't get through.  ppixiv replaces fetch and keeps the
    // original as realFetch.
    Promise.resolve()
        .then(() => (window.realFetch ?? window.fetch)(state.base, { mode: "no-cors", cache: "no-store", credentials: "omit" }))
        .then(() => loadDetached(url, (ok) => ok || navigator.onLine === false ? forget() : thumbFailures++), forget);
}

// Remember which tiers have loaded, for shownThumbTier.
export function thumbnailLoaded(img)
{
    let state = thumbStates.get(img);
    if(state != null && img.currentSrc == thumbUrl(state, state.tier))
        markThumbTierLoaded(state, state.tier);
}

// If Pixiv refuses one of these sizes for some image, go back to ppixiv's URL.
export function thumbnailFailed(img)
{
    let state = thumbStates.get(img);
    if(state == null || state.tier == THUMB_BASE || img.currentSrc != thumbUrl(state, state.tier))
        return;
    thumbFailed(state, img.currentSrc);
    state.tier = THUMB_BASE;
    state.upgrading = null;
    setImgSrc(img, state.base);

    // ppixiv learns aspect ratios from thumbnails as they load, and recorded 0 for the failed
    // one.  The manga view and the image viewer lay pages out with it, so measure again once
    // ppixiv's own thumbnail has loaded.  Measuring now doesn't work: ppixiv's listeners would
    // see the error that is still being dispatched and record 0 again.
    img.addEventListener("load", () => {
        if(thumbStates.get(img) == state && img.currentSrc == state.base)
            window.ppixiv?.extraCache?.registerLoadingThumbnail?.(state.mediaId, img)?.catch?.(() => {});
    }, { once: true });
}

// Estimate how long one thumbnail takes to download with the connection to itself.  A
// request's duration alone isn't enough: a page of results loads dozens of thumbnails at once,
// and they share the connection, so each one takes much longer than it would alone.  Divide
// each duration by the average number of thumbnail downloads running during it, and use the
// median of recent downloads.  Cross-origin timing hides sizes, but times are available.
function updateThumbLoadMs()
{
    let adjusted = [];
    for(let a of thumbTimings)
    {
        let duration = a.end - a.start;
        if(duration <= 0)
            continue;
        let overlap = 0;
        for(let b of thumbTimings)
            overlap += Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
        adjusted.push(duration * duration / overlap);
    }
    if(adjusted.length == 0)
        return;
    adjusted.sort((a, b) => a - b);
    thumbLoadMs = adjusted[Math.floor(adjusted.length / 2)];
}

new PerformanceObserver((list) => {
    let maxBefore = Math.max(THUMB_BASE, ...allowedThumbTiers());
    let changed = false;
    for(let entry of list.getEntries())
    {
        if(!entry.name.includes("i.pximg.net/c/") || !entry.name.includes("_webp/"))
            continue;

        // Disk cache hits take a few milliseconds and say nothing about the connection.
        if(entry.duration < 10)
            continue;
        thumbTimings.push({ start: entry.startTime, end: entry.responseEnd || entry.startTime + entry.duration });
        if(thumbTimings.length > THUMB_TIMING_SAMPLES)
            thumbTimings.shift();
        changed = true;
    }
    if(changed)
        updateThumbLoadMs();

    // When the connection gets faster, thumbnails loaded while it was slow are still smaller or
    // lower quality.
    if(Math.max(THUMB_BASE, ...allowedThumbTiers()) > maxBefore)
        upgradeVisibleThumbs();
}).observe({ type: "resource" });

function maybeUpgradeThumb(img, width, height)
{
    let state = thumbStates.get(img);

    // A thumbnail ppixiv rebuilt while a failure was being confirmed copied the failure, and the
    // confirmation may have cleared it since.
    if(state?.failed && !failedThumbUrls.has(state.base))
        state.failed = false;
    if(state == null || state.failed || !img.isConnected || !thumbsEnabled())
        return;
    let tier = pickThumbTier(state.mediaId, width, height);
    if(tier > state.tier && tier != state.upgrading)
        upgradeThumb(img, state, tier);
}

// Thumbnails that were off screen when the connection got faster are checked when they scroll
// into view.
let visibleThumbs = new Set();
let thumbVisibilityObserver = new IntersectionObserver((entries) => {
    for(let entry of entries)
    {
        if(!entry.isIntersecting)
        {
            visibleThumbs.delete(entry.target);
            continue;
        }
        visibleThumbs.add(entry.target);
        maybeUpgradeThumb(entry.target, entry.boundingClientRect.width, entry.boundingClientRect.height);
    }
});

function upgradeVisibleThumbs()
{
    for(let img of visibleThumbs)
    {
        if(!img.isConnected)
        {
            visibleThumbs.delete(img);
            continue;
        }
        let rect = img.getBoundingClientRect();
        maybeUpgradeThumb(img, rect.width, rect.height);
    }
}

// Moving the window to a screen with a different scale changes devicePixelRatio without
// changing any CSS size, so neither observer notices.
function watchPixelRatio()
{
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener("change", () => {
        watchPixelRatio();
        upgradeVisibleThumbs();
    }, { once: true });
}
watchPixelRatio();

