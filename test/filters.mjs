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
