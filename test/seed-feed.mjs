// Ranking and artist spreading for 收藏相关 (misc/seed-feed.js).
import assert from 'node:assert/strict';
import './vview.mjs';

let { rankRelated, spreadArtists } = await import('/vview/misc/seed-feed.js');

// Works more seeds point at come first.  Within a count, every seed's first matches come before
// any seed's tail, and the newer seed wins a tie.  Each work appears once.
{
    let newest = ['a', 'b', 'c', 'd', 'x'];
    let older = ['e', 'x', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'y'];
    let oldest = ['m', 'y', 'x'];
    let order = rankRelated([newest, older, oldest]);
    assert.deepEqual(order.slice(0, 2), ['x', 'y'], 'three seeds before two');
    assert.equal(new Set(order).size, order.length, 'one entry per work');
    assert.equal(order.length, 15);
    // x: 3 seeds.  y: 2 seeds.  Then by rank / length: a, e, m at 0 (newest seed first), then
    // f at 0.2 and b at 0.2 (newest first), ...
    assert.deepEqual(order.slice(2, 5), ['a', 'e', 'm'], 'first matches of every seed, newest seed first');
    assert.deepEqual(order.slice(5, 7), ['b', 'f'], 'ties go to the newer seed');
    assert.ok(order.indexOf('d') < order.indexOf('l'), "a short list's tail doesn't sink below a long list's tail");
    assert.equal(order.at(-1), 'l');
}

// A repeat within one seed's list doesn't count as a second seed.
{
    let order = rankRelated([['a', 'a', 'b'], ['b']]);
    assert.deepEqual(order, ['b', 'a']);
}

// No more than 3 works by one artist among any 30 in a row; the rest move down, none is dropped.
{
    let ids = [], artist = {};
    for(let i = 0; i < 10; i++) { ids.push('A' + i); artist['A' + i] = 'A'; }
    for(let i = 0; i < 100; i++) { ids.push('o' + i); artist['o' + i] = 'u' + i; }
    let result = spreadArtists(ids, (id) => artist[id]);
    assert.equal(result.length, ids.length);
    assert.deepEqual([...result].sort(), [...ids].sort());
    for(let start = 0; start + 30 <= result.length; start++)
    {
        let window = result.slice(start, start + 30);
        assert.ok(window.filter((id) => artist[id] == 'A').length <= 3, `window at ${start}`);
    }
    assert.deepEqual(result.slice(0, 3), ['A0', 'A1', 'A2'], 'the first three stay on top');
    assert.equal(result[3], 'o0', 'other works fill in after them');
    assert.equal(result[30], 'A3', 'the fourth comes back as soon as it fits');

    // When nothing else is left, the waiting works go at the end in order.
    let only = spreadArtists(['A0', 'A1', 'A2', 'A3', 'A4'], () => 'A');
    assert.deepEqual(only, ['A0', 'A1', 'A2', 'A3', 'A4']);
}

console.log('seed-feed: ok');
