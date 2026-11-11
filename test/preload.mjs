// Exercise preloading through its public entry points without network requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';

let source = fs.readFileSync(new URL('../web/vview/misc/preload.js', import.meta.url), 'utf8');
let instance = 0;
let tick = () => new Promise((resolve) => setImmediate(resolve));

async function runtime({ enabled=true, saveData=false, mode='all', muted=false }={})
{
    let now = 0, nextTimer = 0;
    let timers = new Map(), images = [], requests = [];
    let settings = { hover_preload: enabled, preload_manga: mode };
    let navigator = { connection: { saveData } };
    let info = (id) => ({
        illustType: 0, mangaPages: Array(10), previewUrls: [`preview:${id}`],
        getMainImageUrl: (page) => ({ url: `original:${id}:${page}` }),
    });
    let cache = {
        _nonexistantMediaIds: {},
        getMediaInfoSync: (id) => info(id),
        async getMediaInfo(id) { requests.push(id); return info(id); },
    };
    let window = {
        ppixiv: {
            settings: { get: (key) => settings[key] }, mediaCache: cache,
            muting: { anyTagMuted: () => muted },
        },
        realSetTimeout(callback, delay) { assert.equal(delay, 300); timers.set(++nextTimer, callback); return nextTimer; },
        realClearTimeout(id) { timers.delete(id); },
    };
    let document = {
        addEventListener() {},
        createElement()
        {
            let image = { src: '' };
            images.push(image);
            return image;
        },
    };
    globalThis.preloadEnvironment = { window, document, navigator, performance: { now: () => now } };
    let module = await import('data:text/javascript,' + encodeURIComponent(`
        let { window, document, navigator, performance } = globalThis.preloadEnvironment;
        ${source}
        // instance ${instance++}
    `));
    let event = (id, pointerType='mouse') => {
        let thumb = { dataset: { id }, classList: { contains: () => muted } };
        thumb.closest = () => thumb;
        return { target: thumb, pointerType };
    };
    return {
        ...module, images, requests, settings, navigator, cache,
        over: (id) => module.thumbnailPointerOver(event(id)),
        async move(id, pointerType)
        {
            module.thumbnailPointerMove(event(id, pointerType));
            for(let [key, callback] of timers)
            {
                timers.delete(key);
                callback();
            }
            await tick();
        },
        advance(ms) { now += ms; },
    };
}

let rate = await runtime();
rate.over('illust:1-0');
await tick();
assert.equal(rate.requests.length, 0, 'pointerover only cancels');
for(let id = 0; id < 31; ++id)
    await rate.move(`illust:${id}-0`);
assert.equal(rate.requests.length, 30);
assert.equal(rate.images.filter((image) => image.src != '').length, 3, 'at most three image requests remain active');
rate.advance(60001);
await rate.move('illust:32-0');
assert.equal(rate.requests.length, 31);
console.log('ok   Hover requires movement, allows 30 requests per minute, and cancels oldest downloads');

for(let options of [{ enabled: false }, { saveData: true }, { muted: true }])
{
    let disabled = await runtime(options);
    await disabled.move('illust:1-0');
    assert.equal(disabled.requests.length, 0);
    assert.equal(disabled.images.length, 0);
}
let touch = await runtime();
await touch.move('illust:1-0', 'touch');
assert.equal(touch.requests.length, 0);
console.log('ok   Disabled, save-data, muted, and touch hovers do not preload');

let cached = await runtime();
await cached.move('illust:1-0');
for(let image of cached.images)
    image.onload();
await cached.move('illust:2-0');
await cached.move('illust:1-0');
assert.equal(cached.requests.length, 2, 'already downloaded work is skipped');
console.log('ok   A completed hover does not fetch or use the limit again');

for(let [mode, ahead] of [['all', 2], ['partial', 1], ['thumbnails', 0]])
{
    let manga = await runtime({ mode });
    manga.preloadMangaPages('illust:1-0');
    await tick();
    assert.equal(manga.images.length, ahead == 0 ? 0 : 1);
    if(ahead == 0)
        continue;
    manga.images[0].onload();
    await tick();
    assert.equal(manga.images.length, ahead + 1);
}
let cancelled = await runtime();
cancelled.preloadMangaPages('illust:1-0');
await tick();
let old = cancelled.images[0];
cancelled.preloadMangaPages(null);
old.onload();
await tick();
assert.equal(cancelled.images.length, 1);
console.log('ok   Manga follows settings, waits for the current page, and cancels navigation waits');

for(let [message, retained] of [['Invalid response', false], ['429 Too Many Requests', false], ['Deleted work', true]])
{
    let failed = await runtime();
    failed.cache.getMediaInfo = async (id) => {
        failed.cache._nonexistantMediaIds[id] = message;
        return null;
    };
    await failed.move('illust:1-0');
    assert.equal('illust:1-0' in failed.cache._nonexistantMediaIds, retained);
}
console.log('ok   Transient info failures are forgotten while Pixiv errors are retained');

let unknown = await runtime();
unknown.cache.getMediaInfoSync = () => null;
await unknown.move('illust:1-0');
assert(unknown.images.some((image) => image.src == 'preview:illust:1-0'));
let animation = await runtime();
let originalInfo = animation.cache.getMediaInfoSync;
animation.cache.getMediaInfoSync = (id) => ({ ...originalInfo(id), illustType: 2 });
animation.cache.getMediaInfo = async (id) => animation.cache.getMediaInfoSync(id);
await animation.move('illust:1-0');
assert.equal(animation.images.length, 1);
assert.equal(animation.images[0].src, 'preview:illust:1-0');
console.log('ok   Missing cached info still fetches the preview and animations skip originals');

let savingManga = await runtime({ saveData: true });
savingManga.preloadMangaPages('illust:1-0');
await tick();
assert.equal(savingManga.requests.length, 0);
let hoverOffManga = await runtime({ enabled: false });
hoverOffManga.preloadMangaPages('illust:1-0');
await tick();
assert.equal(hoverOffManga.images.length, 1);
hoverOffManga.images[0].onload();
await tick();
assert.equal(hoverOffManga.images.length, 3);
console.log('ok   Manga respects save-data independently of the hover setting');
