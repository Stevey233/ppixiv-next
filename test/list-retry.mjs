import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupPpixiv } from './vview.mjs';

const { helpers } = await import('/vview/misc/helpers.js');
const { default: DataSource } = await import('/vview/sites/data-source.js');
const { Site } = await import('/vview/sites/site.js');
const { default: Following } = await import('/vview/sites/pixiv/data-sources/new-posts-by-following.js');

const url = new URL('https://www.pixiv.net/bookmark_new_illust.php#ppixiv');
const pageData = { mediaIds: ['illust:101-0'] };

class TestDataSource extends DataSource
{
    requests = 0;

    async loadPageInternal()
    {
        this.requests++;
        return this.requestPage();
    }
}

function makeSite(t)
{
    setupPpixiv({ media: { 101: { illustType: 0, pageCount: 1 } } });
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    helpers.getCanonicalUrl = (url) => new helpers.args(url);
    let site = new Site();
    site.getDataSourceForUrl = () => TestDataSource;
    return site;
}

test('refresh stops a retry waiting to send', async (t) => {
    let site = makeSite(t);
    let waiting = Promise.withResolvers(), resume = Promise.withResolvers();
    t.mock.method(helpers.other, 'sleep', (ms) => {
        waiting.resolve(ms);
        return resume.promise;
    });
    let old = site.createDataSourceForUrl(url);
    old.startup();
    old.requestPage = () => {
        if(old.requests == 1)
            throw new Error('Rate limited');
        return pageData;
    };

    let load = old.loadPage(1);
    assert.equal(await waiting.promise, 2000);
    let fresh = site.createDataSourceForUrl(url, { force: true });
    old.shutdown();
    fresh.startup();
    fresh.requestPage = () => pageData;
    resume.resolve();

    assert.equal(await load, false);
    assert.equal(await old.loadPage(1), false);
    assert.equal(old.requests, 1);
    assert.equal(old.anyPageFailed, false);
    assert.equal(await fresh.loadPage(1), true);
    assert.equal(fresh.requests, 1);
});

for(let outcome of ['succeeds', 'fails'])
{
    test(`refresh retires a sent retry that ${outcome}`, async (t) => {
        let site = makeSite(t);
        let sent = Promise.withResolvers(), response = Promise.withResolvers();
        let old = site.createDataSourceForUrl(url);
        old.startup();
        old.requestPage = () => {
            if(old.requests == 1)
                throw new Error('Rate limited');
            if(old.requests == 2)
            {
                sent.resolve();
                return response.promise;
            }
            return pageData;
        };

        let load = old.loadPage(1);
        await sent.promise;
        site.createDataSourceForUrl(url, { force: true });
        old.shutdown();
        if(outcome == 'fails')
            response.reject(new Error('Still rate limited'));
        else
            response.resolve(pageData);

        assert.equal(await load, false);
        assert.equal(old.requests, 2);
        assert.equal(old.idList.anyPagesLoaded, false);
        assert.equal(old.anyPageFailed, false);
    });
}

test('a superseded following response cannot update the visit marker or bookmark data', async (t) => {
    let site = makeSite(t);
    site.getDataSourceForUrl = () => Following;
    let sent = Promise.withResolvers(), response = Promise.withResolvers();
    helpers.pixivRequest = { get() { sent.resolve(); return response.promise; } };
    ppixiv.tagTranslations = { addTranslationsDict() {} };
    let cacheWorks = t.mock.fn();
    ppixiv.mediaCache.addMediaInfosPartial = cacheWorks;
    let old = site.createDataSourceForUrl(url);
    let recordVisit = t.mock.method(old.lastSeen, 'pageLoaded', () => {});
    let load = old.loadPage(1);
    await sent.promise;
    site.createDataSourceForUrl(url, { force: true });
    response.resolve({ body: { thumbnails: { illust: [{ id: '101' }] }, page: { tags: [] } } });

    assert.equal(await load, false);
    assert.equal(recordVisit.mock.callCount(), 0);
    assert.equal(cacheWorks.mock.callCount(), 0);
});

test('a cached list can retry in the background and be reused on return', async (t) => {
    let site = makeSite(t);
    let waiting = Promise.withResolvers(), resume = Promise.withResolvers();
    t.mock.method(helpers.other, 'sleep', () => {
        waiting.resolve();
        return resume.promise;
    });
    let old = site.createDataSourceForUrl(url);
    old.startup();
    old.requestPage = () => {
        if(old.requests == 1)
            throw new Error('Rate limited');
        return pageData;
    };

    let load = old.loadPage(1);
    await waiting.promise;
    let next = site.createDataSourceForUrl(new URL('/discovery#ppixiv', url));
    old.shutdown();
    next.requestPage = () => pageData;
    // The slideshow can load a page before starting up its data source.
    assert.equal(await next.loadPage(1), true);
    next.startup();
    resume.resolve();
    assert.equal(await load, true);
    assert.equal(old.requests, 2);

    assert.equal(site.createDataSourceForUrl(url), old);
    old.startup();
    assert.equal(await old.loadPage(1), true);
    assert.equal(old.requests, 2);
});
