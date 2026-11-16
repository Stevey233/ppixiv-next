// The Gelbooru tag library (sites/gelbooru/tag-library.js): loading a pack, lookups, search
// ranking, normalization, category filtering and paging.  IndexedDB doesn't exist in Node, so the
// cache isn't exercised: KeyStorage fails to open it and every load() downloads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import './vview.mjs';

// KeyStorage logs that it can't open IndexedDB.
let log = console.log;
console.log = (...args) => String(args[0]).startsWith("Couldn't open database")? null:log(...args);

let { default: TagLibrary, PACK_VERSION, DEFAULT_PACK_URL, normalizeTagText } = await import('/vview/sites/gelbooru/tag-library.js');

const HEADER = '#ppixiv-gelbooru-tags 1\ttag\tcategory\tcount\tzh\taliases\tnotes';
const QUOTED = `"hello,_world"_(o'neil)`;

// tag, category, count, zh, aliases, notes; most used first, as the build writes them.
const ROWS = [
    ['1girl', 0, 9000000, '一个女孩', '1girls|girl|女孩', '画面中有且仅有一名女性'],
    ['cat_ears', 0, 900000, '猫耳', '', ''],
    ['nekomimi', 0, 600000, '', '', ''],
    ['cat', 0, 500000, '猫', 'neko', ''],
    ['black_cat', 0, 300000, '黑猫', '', ''],
    ['catgirl', 0, 200000, '', '', ''],
    ['hatsune_miku', 4, 144723, '初音未来', 'miku_hatsune|初音|初音ミク', '虚拟歌姬'],
    ['scathach_(fate)', 4, 80000, '斯卡哈', '', ''],
    ['vocaloid', 3, 70000, '', '', ''],
    ['hatsune_miku_(append)', 4, 5000, '', '', ''],
    ['bobcat', 0, 1000, '', '', ''],
    [QUOTED, 5, 120, '', "o'neil", ''],
    ['cat_(artist)', 1, 50, '', '', ''],
];

function packText(rows=ROWS, header=HEADER)
{
    return header + '\n' + rows.map((row) => row.join('\t') + '\n').join('');
}

// Serve url -> gzipped text (or a status code) through realFetch, and count requests.
let served = {}, requests = [];
globalThis.realFetch = async (url) => {
    requests.push(url);
    let body = served[url];
    if(typeof body == 'number')
        return new Response('', { status: body });
    return new Response(zlib.gzipSync(Buffer.from(body)));
};
let settings = {};
globalThis.ppixiv = { settings: { get: (key) => settings[key] } };

// The module asks for the pack the build made.
{
    let manifest = JSON.parse(fs.readFileSync(new URL('../data/gelbooru-tags.json', import.meta.url)));
    assert.equal(PACK_VERSION, manifest.version, 'PACK_VERSION matches data/gelbooru-tags.json');
    let file = manifest.files[0];
    assert.equal(fs.statSync(new URL('../data/' + file.name, import.meta.url)).size, file.bytes);
    assert.ok(DEFAULT_PACK_URL.endsWith('/stevey/data/' + file.name));
}

// Normalization.
assert.equal(normalizeTagText('ＨＡＴＳＵＮＥ＿ＭＩＫＵ'), 'hatsune miku');
assert.equal(normalizeTagText('  Hatsune__Miku　'), 'hatsune miku');
assert.equal(normalizeTagText('ﾐｸ'), 'ミク');

// A failed download rejects once and leaves the library empty; load() then tries again, and the
// setting overrides the URL.
let library = new TagLibrary();
{
    let changes = 0;
    library.addEventListener('change', () => changes++);
    assert.equal(library.get('cat'), null, 'nothing before loading');
    assert.deepEqual(library.search('cat'), { total: 0, results: [] });

    served[DEFAULT_PACK_URL] = 503;
    await assert.rejects(library.load(), /503/);
    assert.equal(library.loaded, false);
    assert.equal(library.loading, false);
    assert.match(library.error.message, /503/);

    settings.gelbooru_tag_pack_url = 'http://127.0.0.1:8899/pack.tsv.gz';
    served[settings.gelbooru_tag_pack_url] = packText();
    let promise = library.load();
    assert.equal(library.loading, true);
    assert.equal(library.load(), promise, 'the same load while running');
    await promise;
    assert.equal(library.loaded, true);
    assert.equal(library.error, null);
    assert.equal(library.size, ROWS.length);
    await library.load();
    assert.deepEqual(requests, [DEFAULT_PACK_URL, settings.gelbooru_tag_pack_url], 'no request once loaded');
    assert.equal(changes, 4, 'start and failure, start and finish');
}

// A pack in another format is refused.
{
    served['http://x/old.gz'] = packText(ROWS, '#ppixiv-gelbooru-tags 0\ttag');
    settings.gelbooru_tag_pack_url = 'http://x/old.gz';
    await assert.rejects(new TagLibrary().load(), /unknown format/);
}

// Lookups: the whole entry, with the name as Gelbooru writes it or as typed.
assert.deepEqual(library.get('hatsune_miku'), {
    tag: 'hatsune_miku', category: 'character', count: 144723, zh: '初音未来',
    aliases: ['miku_hatsune', '初音', '初音ミク'], notes: '虚拟歌姬',
});
assert.deepEqual(library.get('catgirl'), { tag: 'catgirl', category: 'general', count: 200000, zh: null, aliases: [], notes: null });
assert.equal(library.get('Hatsune Miku').tag, 'hatsune_miku');
assert.deepEqual(library.get('cat_(artist)'), { tag: 'cat_(artist)', category: 'artist', count: 50, zh: null, aliases: [], notes: null }, 'the last row');
assert.equal(library.get('vocaloid').category, 'copyright');
assert.equal(library.get('nope'), null);

// A name with commas, quotes and an apostrophe survives parsing and is found.
assert.deepEqual(library.get(QUOTED), { tag: QUOTED, category: 'metadata', count: 120, zh: null, aliases: ["o'neil"], notes: null });
assert.equal(library.search('hello, world')
    .results[0].tag, QUOTED);
assert.equal(library.search("O'NEIL").results[0].tag, QUOTED, 'the alias equals it');

let tags = (result) => result.results.map((entry) => entry.tag);

// Ranking: equal, then starts with, then a word starts with, then contains; most used first in each.
{
    let result = library.search('cat');
    assert.deepEqual(tags(result), ['cat', 'cat_ears', 'catgirl', 'cat_(artist)', 'black_cat', 'scathach_(fate)', 'bobcat']);
    assert.equal(result.total, 7);
    assert.deepEqual(tags(library.search('cat', { sort: 'count' })), ['cat_ears', 'cat', 'black_cat', 'catgirl', 'scathach_(fate)', 'bobcat', 'cat_(artist)']);
}

// Every spelling of hatsune_miku finds it first: spaces, case, "_", its Chinese name, an alias,
// full-width letters, half-width kana.
for(let text of ['hatsune miku', 'HATSUNE_MIKU', '初音', '初音未来', 'miku hatsune', 'ｈａｔｓｕｎｅ', 'ﾐｸ'])
    assert.equal(library.search(text).results[0].tag, 'hatsune_miku', text);
assert.deepEqual(tags(library.search('ｈａｔｓｕｎｅ')), ['hatsune_miku', 'hatsune_miku_(append)']);
assert.deepEqual(tags(library.search('猫')), ['cat', 'cat_ears', 'black_cat'], 'Chinese names: equal, starts with, contains');
assert.deepEqual(tags(library.search('neko')), ['nekomimi', 'cat'], "an alias equal to it ranks with the tags starting with it");
assert.deepEqual(tags(library.search('girl')), ['1girl', 'catgirl'], "1girl's alias is girl");
assert.equal(library.search('zzz').total, 0);

// Categories: with text, and listing a whole category by count when there's none.
assert.deepEqual(tags(library.search('cat', { category: 'artist' })), ['cat_(artist)']);
assert.deepEqual(tags(library.search('', { category: 'character' })), ['hatsune_miku', 'scathach_(fate)', 'hatsune_miku_(append)']);
assert.equal(library.search('').total, ROWS.length);
assert.throws(() => library.search('', { category: 'tags' }), /Unknown tag category/);

// Paging runs across ranks; total counts every match.
assert.deepEqual(tags(library.search('cat', { limit: 2, offset: 1 })), ['cat_ears', 'catgirl']);
assert.deepEqual(tags(library.search('cat', { limit: 3, offset: 3 })), ['cat_(artist)', 'black_cat', 'scathach_(fate)']);
assert.deepEqual(library.search('cat', { limit: 3, offset: 6 }), { total: 7, results: [library.get('bobcat')] });
assert.deepEqual(tags(library.search('cat', { offset: 7 })), []);
assert.deepEqual(tags(library.search('', { category: 'general', limit: 2, offset: 2 })), ['nekomimi', 'cat']);

console.log('tag-library: ok');
