// Paging through a list with the result filters on (misc/result-filters.js and its hooks in
// DataSource._loadPageAsync).
import assert from 'node:assert/strict';
import { setupPpixiv } from './vview.mjs';

// The data source logs every page load.
let log = console.log;
console.log = console.warn = console.error = () => {};

// Make a list from a string per page: "i" is an illustration, "m" is manga.  Work IDs are
// page*100+index.
function makeList(pageTypes)
{
    let media = {}, pages = {};
    pageTypes.forEach((types, idx) => {
        let page = idx + 1;
        pages[page] = [...types].map((type, i) => {
            let id = String(page*100 + i);
            media[id] = { illustType: type == "m"? 1:0, width: 1, height: 2, pageCount: 1 };
            return `illust:${id}-0`;
        });
    });
    return { media, pages };
}

setupPpixiv();
let { default: DataSource } = await import('/vview/sites/data-source.js');

async function makeDataSource(pageTypes, { query='', filter='illust', loadPageInternal }={})
{
    let { media, pages } = makeList(pageTypes);
    let url = `https://www.pixiv.net/bookmark_new_illust.php${query}#ppixiv?filter=${filter}`;
    setupPpixiv({ url, media });
    class TestDataSource extends DataSource
    {
        get name() { return "new_works_by_following"; }
        get supportsStartPage() { return true; }
        async loadPageInternal(page)
        {
            this.requested.push(page);
            if(loadPageInternal)
                return loadPageInternal(page, pages);
            return { mediaIds: pages[page] ?? [] };
        }
    }
    let dataSource = new TestDataSource({ url });
    dataSource.requested = [];
    await dataSource.init();
    return dataSource;
}

// Opened at ?p=5, loading backwards past pages the filters emptied.
{
    let dataSource = await makeDataSource(["ii", "ii", "mm", "mm", "ii", "ii"], { query: '?p=5' });
    await dataSource.loadPage(5);
    await dataSource.loadPage(4);
    assert.deepEqual(dataSource.requested, [5, 4, 3, 2], 'an emptied page continues backwards');
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:500-0', false), 'illust:201-0');
    log('ok   Loading backwards skips pages the filters emptied');
}

// The viewer goes back from page 5 to page 4 itself.
{
    let dataSource = await makeDataSource(["ii", "ii", "mm", "mm", "ii"], { query: '?p=5' });
    await dataSource.loadPage(5);
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:500-0', false), 'illust:201-0');
    log('ok   The viewer goes back across emptied pages');
}

// Opened at ?p=3, which the filters empty, so loading continues forwards.  Going back from the
// first work skips page 3.
{
    let dataSource = await makeDataSource(["ii", "ii", "mm", "ii"], { query: '?p=3' });
    await dataSource.loadPage(3);
    assert.deepEqual(dataSource.requested, [3, 4]);
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:400-0', false), 'illust:201-0');
    log('ok   The viewer goes back past an emptied first page');
}

// Loading stops after MAX_EMPTY_PAGES emptied pages and "继续查找" continues.
{
    let dataSource = await makeDataSource(["ii", "mm", "mm", "mm", "mm", "mm", "mi"]);
    await dataSource.loadPage(1);
    await dataSource.loadPage(2);
    assert.deepEqual(dataSource.requested, [1, 2, 3, 4, 5]);
    assert.equal(dataSource.filteredStopPage, 5);
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:101-0', true), null, 'the viewer stops too');
    await dataSource.loadMoreFiltered();
    assert.deepEqual(dataSource.requested, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(dataSource.filteredStopPage, null);
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:101-0', true), 'illust:701-0');
    log('ok   Loading stops after 4 emptied pages until asked to continue');
}

// The viewer goes forwards while loading is still walking past an emptied page: it waits for
// the running load instead of stopping at the emptied page.
{
    let releasePage3;
    let page3 = new Promise((resolve) => releasePage3 = resolve);
    let dataSource = await makeDataSource(["ii", "mm", "ii"], {
        loadPageInternal: async (page, pages) => {
            if(page == 3)
                await page3;
            return { mediaIds: pages[page] ?? [] };
        },
    });
    await dataSource.loadPage(1);
    let chain = dataSource.loadPage(2);
    while(!dataSource.requested.includes(3))
        await new Promise((resolve) => setImmediate(resolve));
    let next = dataSource.getOrLoadNeighboringMediaId('illust:101-0', true);
    releasePage3();
    assert.equal(await next, 'illust:300-0');
    await chain;
    assert.deepEqual(dataSource.requested, [1, 2, 3]);
    log('ok   The viewer waits for loading past an emptied page');
}

// An API that returns its last page again for every page past the end.  With a filter on, the
// repeats aren't emptied pages: the list ends instead of pausing and continuing forever.
{
    let dataSource = await makeDataSource(["mi", "ii"], { filter: "manga",
        loadPageInternal: (page, pages) => ({ mediaIds: pages[Math.min(page, 2)] }),
    });
    await dataSource.loadPage(1);
    await dataSource.loadPage(2);
    assert.deepEqual(dataSource.requested, [1, 2, 3]);
    assert.equal(dataSource.filteredStopPage ?? null, null);
    assert.equal(dataSource.loadedAllPages, true);
    log('ok   A page that only repeats earlier pages ends the list');
}

// The last page is emptied by the filters.
{
    let dataSource = await makeDataSource(["ii", "mm"]);
    await dataSource.loadPage(1);
    await dataSource.loadPage(2);
    assert.deepEqual(dataSource.requested, [1, 2, 3]);
    assert.equal(dataSource.loadedAllPages, true);
    assert.equal(dataSource.canLoadPage(4), false);
    log('ok   An emptied last page ends the list');
}

// New works push the last work of page 1 onto page 2 while browsing a fast list.  When that
// duplicate is all the filters leave on page 2, the list goes on instead of ending.
{
    let dataSource = await makeDataSource(["iim", "iii", "mii"], {
        filter: 'manga',
        loadPageInternal: (page, pages) => ({ mediaIds: page == 2? ['illust:102-0', ...pages[2]]:pages[page] ?? [] }),
    });
    await dataSource.loadPage(1);
    await dataSource.loadPage(2);
    assert.equal(dataSource.loadedAllPages, false);
    assert.deepEqual(dataSource.requested, [1, 2, 3]);
    assert.equal(await dataSource.getOrLoadNeighboringMediaId('illust:102-0', true), 'illust:300-0');
    log('ok   A page left with only a duplicate continues');
}

// Server-side filtering, upstream's type options in old URLs, and remembered filters.
{
    let filters = await import('/vview/misc/result-filters.js');
    let set = (...values) => new Set(values);
    let fakeSettings = () => {
        let values = {};
        return { get: (key) => values[key], set: (key, value) => { values[key] = value; } };
    };

    assert.deepEqual(filters.searchApiArgs(set()), { searchType: 'artworks', type: null, ai_type: null });
    assert.deepEqual(filters.searchApiArgs(set('illust', 'hide-ai')), { searchType: 'illustrations', type: 'illust_and_ugoira', ai_type: '1' });
    assert.deepEqual(filters.searchApiArgs(set('manga')), { searchType: 'manga', type: 'manga', ai_type: null });
    assert.deepEqual(filters.searchApiArgs(set('ugoira')), { searchType: 'illustrations', type: 'ugoira', ai_type: null });
    assert.equal(filters.newWorksApiType(set()), 'illust');
    assert.equal(filters.newWorksApiType(set('manga')), 'manga');
    assert.equal(filters.newWorksApiType(set('ugoira')), 'illust');
    assert.deepEqual(filters.artistWorkKinds(set()), ['illusts', 'manga']);
    assert.deepEqual(filters.artistWorkKinds(set('ugoira', 'portrait')), ['illusts']);
    assert.deepEqual(filters.artistWorkKinds(set('manga')), ['manga']);
    log('ok   The type and hide-ai filters map to the search, new works and artist APIs');

    // The type filters on lists filtered locally: 插画 keeps illustrations and animations, 漫画
    // keeps manga, 动图 keeps animations.
    setupPpixiv({ media: { 1: { illustType: 0 }, 2: { illustType: 1 }, 3: { illustType: 2 } } });
    let keptBy = (value) => ['illust:1-0', 'illust:2-0', 'illust:3-0'].filter(filters.makeFilter(set(value)));
    assert.deepEqual(keptBy('illust'), ['illust:1-0', 'illust:3-0']);
    assert.deepEqual(keptBy('manga'), ['illust:2-0']);
    assert.deepEqual(keptBy('ugoira'), ['illust:3-0']);
    log('ok   The type filters keep their types on lists filtered locally');

    // A hidden work is counted under the first reason that hides it: the type, shape and page
    // filters, then AI, bookmarked, seen.
    setupPpixiv({
        media: { 1: { illustType: 1, aiType: 2 }, 2: { illustType: 0, aiType: 2, bookmarkData: {} }, 3: { illustType: 0, bookmarkData: {} }, 4: { illustType: 0 }, 5: { illustType: 0 } },
        seen: new Set(['illust:3-0', 'illust:4-0']),
    });
    let reason = filters.hideReason(set('illust', 'hide-ai', 'hide-bookmarked', 'hide-seen'));
    assert.deepEqual([1, 2, 3, 4, 5].map((id) => reason(`illust:${id}-0`)), ['other', 'ai', 'bookmarked', 'seen', null]);
    assert.equal(filters.hideReason(set()), null);
    log('ok   Hidden works get the first reason that hides them');

    let { default: Args } = await import('/vview/util/args.js');
    let apply = (url, name) => {
        let args = new Args(url);
        let changed = filters.applyFilterDefaults(args, name);
        return changed? decodeURIComponent(args.url.toString().replace('https://www.pixiv.net', '')):null;
    };

    setupPpixiv();
    ppixiv.settings = fakeSettings();
    ppixiv.pixivInfo = { userId: '77' };
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag&type=manga&ai_type=1&mode=all#ppixiv', 'search'),
        '/search?q=a&s_mode=tag&type=artwork&mode=all#ppixiv?filter=manga,hide-ai');
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag&type=illust_ugoira&mode=all#ppixiv?filter=ugoira', 'search'),
        '/search?q=a&s_mode=tag&type=artwork&mode=all#ppixiv?filter=ugoira', 'an explicit filter wins');
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag&type=artwork&mode=all#ppixiv', 'search'), null);
    assert.equal(apply('https://www.pixiv.net/new_illust.php?type=manga#ppixiv', 'new_illust'), '/new_illust.php#ppixiv?filter=manga');
    assert.equal(apply('https://www.pixiv.net/new_illust.php?type=illust#ppixiv', 'new_illust'), '/new_illust.php#ppixiv');
    assert.equal(apply('https://www.pixiv.net/users/5/illustrations/%E5%A5%B3#ppixiv', 'artist'), '/users/5/artworks/女#ppixiv?filter=illust');
    assert.equal(apply('https://www.pixiv.net/en/users/5/manga#ppixiv', 'artist'), '/en/users/5/artworks#ppixiv?filter=manga');
    log('ok   Upstream type options in old URLs become filters');

    // A tag search without mode gets the remembered age rating, all by default.  mode in the URL wins.
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag#ppixiv', 'search'), '/search?q=a&s_mode=tag&mode=all#ppixiv');
    filters.rememberAgeMode('r18');
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag#ppixiv', 'search'), '/search?q=a&s_mode=tag&mode=r18#ppixiv');
    assert.equal(apply('https://www.pixiv.net/search?q=a&s_mode=tag&mode=safe#ppixiv', 'search'), null);
    assert.equal(apply('https://www.pixiv.net/discovery#ppixiv', 'discovery'), null, 'only tag search');
    filters.rememberAgeMode('all');
    log('ok   A tag search without mode gets the remembered age rating');

    // Remembered per list: only the hide filters, not on other lists, and turning them off is
    // remembered too.
    filters.rememberFilters('discovery', set('manga', 'hide-ai', 'hide-seen'));
    assert.equal(apply('https://www.pixiv.net/discovery#ppixiv', 'discovery'), '/discovery#ppixiv?filter=hide-ai,hide-seen');
    assert.equal(apply('https://www.pixiv.net/discovery#ppixiv?filter=portrait', 'discovery'), null, 'filters in the URL win');
    assert.equal(apply('https://www.pixiv.net/ranking.php#ppixiv', 'rankings'), null);
    assert.equal(apply('https://www.pixiv.net/discovery/users#ppixiv', 'discovery_users'), null);
    filters.rememberFilters('discovery', set('manga'));
    assert.equal(apply('https://www.pixiv.net/discovery#ppixiv', 'discovery'), null);
    log('ok   The hide filters are remembered per list');

    // The user's own bookmarks are a separate list without 隐藏已收藏.
    assert.equal(filters.filterListKey('bookmarks', 'https://www.pixiv.net/users/77/bookmarks/artworks#ppixiv'), 'bookmarks-own');
    assert.equal(filters.filterListKey('bookmarks', 'https://www.pixiv.net/users/5/bookmarks/artworks#ppixiv'), 'bookmarks');
    filters.rememberFilters('bookmarks-own', set('hide-bookmarked', 'hide-ai'));
    assert.equal(apply('https://www.pixiv.net/users/77/bookmarks/artworks#ppixiv', 'bookmarks'), '/users/77/bookmarks/artworks#ppixiv?filter=hide-ai');
    assert.equal(apply('https://www.pixiv.net/users/5/bookmarks/artworks#ppixiv', 'bookmarks'), null);
    log('ok   The own bookmarks list has its own remembered filters, without 隐藏已收藏');

    // Rankings don't offer 隐藏 AI, and a remembered one doesn't apply.
    assert.equal(filters.filterAvailable('rankings', 'hide-ai'), false);
    assert.equal(filters.filterAvailable('rankings', 'hide-seen'), true);
    filters.rememberFilters('rankings', set('hide-ai'));
    assert.equal(apply('https://www.pixiv.net/ranking.php#ppixiv', 'rankings'), null);
    filters.rememberFilters('rankings', set('hide-ai', 'hide-seen'));
    assert.equal(apply('https://www.pixiv.net/ranking.php#ppixiv', 'rankings'), '/ranking.php#ppixiv?filter=hide-seen');
    log('ok   Rankings have no 隐藏 AI');
}

// A list that keeps returning the same works next to new ones the filters remove: the pages left
// with only duplicates count as emptied pages, so loading stops.
{
    let dataSource = await makeDataSource(["ii", "mm", "mm", "mm", "mm", "mm", "mm", "mm"], {
        loadPageInternal: (page, pages) => ({ mediaIds: page == 1? pages[1]:page <= 8? [...pages[1], ...pages[page]]:[] }),
    });
    await dataSource.loadPage(1);
    await dataSource.loadPage(2);
    assert.deepEqual(dataSource.requested, [1, 2, 3, 4, 5]);
    assert.equal(dataSource.filteredStopPage, 5);
    log('ok   Pages with only duplicates count towards the pause');
}
