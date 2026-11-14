// Ranking for 收藏相关 (misc/seed-feed.js).
import assert from 'node:assert/strict';
import './vview.mjs';

let { rankRelated } = await import('/vview/misc/seed-feed.js');

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

console.log('seed-feed: ok');
