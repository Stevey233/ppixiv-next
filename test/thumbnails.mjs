// Run the thumbnail hooks against image and observer stubs, without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';

let src = fs.readFileSync(new URL('../web/vview/misc/hd-thumbnails.js', import.meta.url), 'utf8');
let instance = 0;

let tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// zoom: ppixiv zooms square thumbnails.  dataSource: the name of ppixiv's current data source.
// saveData: the browser's "save data" mode.  settings: ppixiv's settings, if given.
async function runtime({ zoom = false, dpr = 1, dataSource = 'search', saveData = false, settings = null } = {})
{
    let requests = [], loaders = [], microtasks = [], events = new Map(), registered = [], probes = [];
    let navigator = { onLine: true, connection: { saveData } };
    let storage = new Map();
    class Image
    {
        constructor(box = null)
        {
            this.box = box;
            this.isConnected = true;
            this.listeners = [];
            this.classList = { contains: (name) => box != null && name == 'thumb' };
        }
        closest() { return this.box; }
        get src() { return this.url; }
        set src(url) { this.url = url; requests.push({ image: this, url }); }
        get currentSrc() { return this.url; }
        async decode() {}
        addEventListener(name, callback) { this.listeners.push({ name, callback }); }
        getBoundingClientRect() { return this.rect; }
    }
    let observers = [];
    class Observer
    {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        unobserve() {}
    }
    let document = {
        body: { classList: { contains: () => false } },
        createElement() { let img = new Image(); loaders.push(img); return img; },
        addEventListener(name, callback) { events.set(name, callback); },
        querySelectorAll() { return []; },
    };
    let window = {
        devicePixelRatio: dpr,
        matchMedia: () => ({ matches: zoom, addEventListener() {} }),
        ppixiv: {
            app: { currentDataSource: { name: dataSource } },
            settings: { get: (key) => key == "hd_thumbnails" ? storage.get("ppx-zh-thumb-quality") : settings?.[key] },
            mediaCache: { getMediaInfoSync: () => ({ width: 2000, height: 1000 }), getImageDimensions: (info) => info },
            extraCache: { registerLoadingThumbnail: (mediaId, img) => { registered.push({ mediaId, src: img.src }); return Promise.resolve(); } },
        },
        // The connection check after a failure.
        realFetch: (url) => new Promise((resolve, reject) => probes.push({ url, resolve, reject })),
    };
    globalThis.thumbnailEnvironment = { window, document, navigator,
        ResizeObserver: Observer, IntersectionObserver: Observer, PerformanceObserver: Observer,
        queueMicrotask: (callback) => microtasks.push(callback) };
    let module = await import('data:text/javascript,' + encodeURIComponent(`
        let { window, document, navigator, ResizeObserver, IntersectionObserver,
            PerformanceObserver, queueMicrotask } = globalThis.thumbnailEnvironment;
        ${src}
        export { thumbsEnabled, thumbFailures };
        // instance ${instance++}
    `));
    let hooks = {
        resize: observers[0].callback, visibility: observers[2].callback,
        timing: observers[1].callback,
        enabled: module.thumbsEnabled, get failures() { return module.thumbFailures; },
    };

    return {
        ...hooks, forget: module.forgetThumb, get failures() { return hooks.failures; }, requests, loaders, storage, registered, probes, navigator,
        // Answer the connection checks started so far: up means a request got through.  They
        // start a microtask after the failure, and the retry a microtask after the answer.
        async probe(up)
        {
            await tick();
            for(let p of probes.splice(0))
                up ? p.resolve({}) : p.reject(new TypeError('Failed to fetch'));
            await tick();
        },
        create(id, { width = 100, currentWidth } = {})
        {
            let box = { dataset: { id: `illust:${id}-0` }, origWidth: width, origHeight: width / 2,
                currentWidth, currentHeight: currentWidth == null ? undefined : currentWidth / 2 };
            let img = new Image(box);
            module.setThumbnail(img, `https://i.pximg.net/c/540x540_70/img-master/${id}_master1200.jpg`, box.dataset.id, box);
            return img;
        },
        fail(img) { module.thumbnailFailed(img); },
        // The browser finished loading img's current URL.
        loaded(img) { module.thumbnailLoaded(img); },
        // Fire the load listeners ppixiv-zh added to img.
        load(img) { for(let { name, callback } of img.listeners.splice(0)) if(name == 'load') callback(); },
        // Finish the detached loads that are running now.
        settle(ok, filter = () => true)
        {
            for(let loader of loaders.filter((l) => !l.settled && filter(l.url)))
            {
                loader.settled = true;
                ok ? loader.onload() : loader.onerror();
            }
        },
        resize(img, width = 900) { hooks.resize([{ target: img, contentRect: { width, height: width / 2 } }]); },
        enter(img, width = 900) { hooks.visibility([{ target: img, isIntersecting: true,
            boundingClientRect: { width, height: width / 2 } }]); },
        flush() { while(microtasks.length) microtasks.shift()(); },
    };
}

// ppixiv rebuilds thumbnails when the size slider or manga expansion changes.
let repeated = await runtime();
let first = repeated.create(123);
assert.match(first.src, /600x1200_90_webp/);
repeated.fail(first);
assert.match(first.src, /540x540_70/);
for(let i = 0; i < 5; ++i)
{
    let rebuilt = repeated.create(123);
    assert.match(rebuilt.src, /540x540_70/, 'a failed URL stays on the original thumbnail');
    repeated.resize(rebuilt);
    repeated.enter(rebuilt);
}
await repeated.probe(true);
repeated.settle(false);
assert.equal(repeated.failures, 1);
assert.equal(repeated.loaders.length, 1, 'one retry, and no upgrades');
assert.equal(repeated.enabled(), true);
console.log('ok   Rebuilt thumbnails retain failures without increasing the failure count');

// A failure counts once a request for the 540 gets through and the same URL fails again.
let distinct = await runtime();
let existing = distinct.create(999);
for(let id = 0; id < 5; ++id)
    distinct.fail(distinct.create(id));
assert.equal(distinct.failures, 0, 'failures count only after the retry');
await tick();
assert.match(distinct.probes[0].url, /540x540_70/);
await distinct.probe(true);
distinct.settle(false);
assert.equal(distinct.failures, 5);
assert.equal(distinct.enabled(), false);
let requestsBefore = distinct.requests.length;
distinct.resize(existing);
distinct.enter(existing);
distinct.flush();
assert.equal(distinct.requests.length, requestsBefore, 'disabled hooks must not start upgrades');
assert.match(distinct.create(1000).src, /540x540_70/);
console.log('ok   Five distinct failures stop upgrades for existing and new thumbnails');

// When the request for the 540 doesn't get through, the connection is down: nothing counts,
// and the work is forgotten.
let offline = await runtime();
offline.fail(offline.create(1));
await offline.probe(false);
assert.equal(offline.failures, 0);
assert.equal(offline.loaders.length, 0, 'no retry while the connection is down');
assert.match(offline.create(1).src, /600x1200_90_webp/);
assert.equal(offline.enabled(), true);
// The check can pass while the browser goes offline before the retry.
let dropped = await runtime();
dropped.fail(dropped.create(1));
await dropped.probe(true);
dropped.navigator.onLine = false;
dropped.settle(false);
assert.equal(dropped.failures, 0);
console.log('ok   Failures while the connection is down do not count and are forgotten');

// A URL that loads when tried again was a transient failure.
let transient = await runtime();
let flaky = transient.create(1);
transient.fail(flaky);
let rebuiltMeanwhile = transient.create(1);
assert.match(rebuiltMeanwhile.src, /540x540_70/, 'rebuilt while the failure is being checked');
await transient.probe(true);
transient.settle(true);
assert.equal(transient.failures, 0);
assert.match(transient.create(1).src, /600x1200_90_webp/, 'rebuilt thumbnails use WebP again');
transient.enter(flaky);
transient.enter(rebuiltMeanwhile);
assert.equal(transient.loaders.length, 3);
assert.match(transient.loaders[1].url, /_webp\/img-master\/1_master1200/, 'the thumbnail that fell back is upgraded again');
assert.match(transient.loaders[2].url, /_webp\/img-master\/1_master1200/, 'so is one rebuilt during the check');
console.log('ok   A failure that does not repeat does not count');

// An upgrade that finishes after disablement must not replace the displayed image.
let pending = await runtime();
let target = pending.create(999);
pending.resize(target);
assert.equal(pending.loaders.length, 1);
let upgrade = pending.loaders[0];
let original = target.src;
for(let id = 0; id < 5; ++id)
    pending.fail(pending.create(id));
await pending.probe(true);
pending.settle(false, (url) => !url.includes('/999_'));
assert.equal(pending.enabled(), false);
await upgrade.onload();
assert.equal(target.src, original);
console.log('ok   An in-flight upgrade cannot replace an image after disablement');

let deferred = await runtime();
let queued = deferred.create(1, { currentWidth: 900 });
let initial = queued.src;
deferred.storage.set('ppx-zh-thumb-quality', 'off');
deferred.flush();
deferred.resize(queued);
assert.equal(queued.src, initial);
assert.equal(deferred.loaders.length, 0);
console.log('ok   Turning quality off also stops deferred layout and observer upgrades');

// ppixiv records aspect ratio 0 for the failed image.  Measure again once the 540 has loaded,
// not while the error is still being dispatched.
let measure = await runtime();
let broken = measure.create(5);
measure.fail(broken);
assert.equal(measure.registered.length, 0, 'not measured during the error event');
measure.load(broken);
assert.deepEqual(measure.registered, [{ mediaId: 'illust:5-0', src: broken.src }]);
assert.match(broken.src, /540x540_70/);
console.log('ok   The fallback is measured again after it loads');

// The redesign never zooms thumbnails, so a hover-capable screen picks the same file.
let zoomed = await runtime({ zoom: true });
assert.match(zoomed.create(7, { width: 600 }).src, /600x1200_90_webp/, 'no zoom with hover either');
console.log('ok   Thumbnails are never zoomed');

// In the manga view ppixiv already downloaded the 540s, so they stay until an upgrade loads.
let manga = await runtime({ dataSource: 'manga' });
let page = manga.create(8, { currentWidth: 900 });
manga.flush();
assert.match(page.src, /540x540_70/);
manga.resize(page);
assert.equal(manga.loaders.length, 1, 'upgraded in the background');
await manga.loaders[0].onload();
assert.match(page.src, /_webp/);
console.log('ok   Manga view keeps the downloaded 540 until the upgrade loads');

// ppixiv rebuilds thumbnails when their size changes.  A rebuilt thumbnail starts from a size
// that already loaded, and the wanted size loads in the background.
let rebuilds = await runtime();
let small = rebuilds.create(9, { width: 300 });
assert.match(small.src, /600x1200_90_webp/);
rebuilds.loaded(small);
let grown = rebuilds.create(9, { width: 900, currentWidth: 900 });
assert.match(grown.src, /600x1200_90_webp/, 'the loaded size is shown at once');
rebuilds.flush();
assert.equal(rebuilds.loaders.length, 1);
assert.match(rebuilds.loaders[0].url, /1200x1200_90_webp/, 'the wanted size loads in the background');
await rebuilds.loaders[0].onload();
assert.match(grown.src, /1200x1200_90_webp/);
let larger = await runtime();
larger.loaded(larger.create(10, { width: 900 }));
let shrunk = larger.create(10, { width: 300, currentWidth: 300 });
larger.flush();
assert.match(shrunk.src, /1200x1200_90_webp/, 'a larger size that loaded is kept when shrinking');
assert.equal(larger.loaders.length, 0);
console.log('ok   Rebuilt thumbnails start from a size that already loaded');

// Save data keeps ppixiv's own 540, which is the smallest file.
let saving = await runtime({ saveData: true });
let kept = saving.create(11, { width: 900, currentWidth: 900 });
saving.flush();
saving.resize(kept);
saving.enter(kept);
assert.match(kept.src, /540x540_70/);
assert.equal(saving.loaders.length, 0);
console.log('ok   Save data keeps ppixiv\'s thumbnails');

let tiers = await runtime();
tiers.timing({ getEntries: () => [{ name: 'https://i.pximg.net/c/1200x1200_90_webp/x', startTime: 0, duration: 600 }] });
assert.match(tiers.create(12, { width: 900 }).src, /1200x1200_80_webp/);
let slow = await runtime();
slow.timing({ getEntries: () => [{ name: 'https://i.pximg.net/c/1200x1200_90_webp/x', startTime: 0, duration: 1500 }] });
assert.match(slow.create(12, { width: 900 }).src, /600x1200_90_webp/);
console.log('ok   Download speed limits the allowed tiers');

let retina = await runtime({ dpr: 2 });
assert.match(retina.create(13, { width: 600 }).src, /1200x1200_90_webp/);
let removed = await runtime();
let discarded = removed.create(14);
removed.resize(discarded);
let beforeRemoval = discarded.src;
removed.forget(discarded);
await removed.loaders[0].onload();
assert.equal(discarded.src, beforeRemoval);
console.log('ok   Device pixels affect selection and forgotten thumbnails ignore pending upgrades');

let changedSaving = await runtime();
let changing = changedSaving.create(15);
changedSaving.resize(changing);
let beforeSaving = changing.src;
changedSaving.navigator.connection.saveData = true;
await changedSaving.loaders[0].onload();
assert.equal(changing.src, beforeSaving);
console.log('ok   Enabling save-data prevents an in-flight upgrade from replacing the image');
