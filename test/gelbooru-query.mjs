// The Gelbooru query parser and builder (web/vview/sites/gelbooru/query.js): every row of the
// condition table in .work/gelbooru/DESIGN.md round-trips, and tokens it doesn't know stay as tags.
import assert from 'node:assert/strict';
import { parseQuery, buildQuery, setConditions, searchFromList, refineQuery, splitQuery, favoritesUserId, EMPTY } from '../web/vview/sites/gelbooru/query.js';

let log = console.log;
let check = (name, func) => { func(); log(`ok   ${name}`); };

// Parse query, compare its conditions with expected, and build it back to the same query.
function roundTrip(query, expected, { tags=[], built=query }={})
{
    let parsed = parseQuery(query);
    assert.deepEqual(parsed.conditions, { ...EMPTY, ...expected }, query);
    assert.deepEqual(parsed.tags, tags, query);
    assert.equal(buildQuery(parsed), built, query);
}

check('sort round-trips', () => {
    roundTrip('', {});
    roundTrip('sort:score', { sort: 'score' });
    roundTrip('sort:random', { sort: 'random' });
    roundTrip('sort:updated', { sort: 'updated' });
    roundTrip('sort:score:desc', { sort: 'score' }, { built: 'sort:score' });
    roundTrip('sort:updated:desc', { sort: 'updated' }, { built: 'sort:updated' });
});

check('score round-trips', () => {
    for(let n of [10, 50, 100, 200, 500, 1000, 37])
        roundTrip(`score:>=${n}`, { minScore: n });
});

check('rating round-trips', () => {
    roundTrip('rating:general', { ratings: ['general'] });
    roundTrip('rating:explicit', { ratings: ['explicit'] });
    roundTrip('-rating:explicit', { ratings: ['general', 'sensitive', 'questionable'] });
    roundTrip('-rating:questionable -rating:explicit', { ratings: ['general', 'sensitive'] });
    // Built in the table's order, whatever order the query had.
    roundTrip('-rating:explicit -rating:general', { ratings: ['sensitive', 'questionable'] }, { built: '-rating:general -rating:explicit' });
    // Three excluded is one selected.
    roundTrip('-rating:sensitive -rating:questionable -rating:explicit', { ratings: ['general'] }, { built: 'rating:general' });
    assert.equal(buildQuery({ conditions: { ratings: [...['general', 'sensitive', 'questionable', 'explicit']] } }), '');
});

check('type round-trips', () => {
    roundTrip('-video -animated', { type: 'image' });
    roundTrip('-animated -video', { type: 'image' }, { built: '-video -animated' });
    roundTrip('animated -video', { type: 'animated' });
    roundTrip('video', { type: 'video' });
    // A lone exclusion isn't one of the menu's types, so it stays a tag.
    roundTrip('-video', {}, { tags: ['-video'] });
    roundTrip('animated', {}, { tags: ['animated'] });
});

check('size round-trips', () => {
    roundTrip('width:>=1920', { minWidth: 1920 });
    roundTrip('width:>=3840', { minWidth: 3840 });
    roundTrip('height:>=2560', { minHeight: 2560 });
    roundTrip('width:>=1920 height:>=1080', { minWidth: 1920, minHeight: 1080 });
});

check('AI round-trips', () => {
    roundTrip('-ai-generated', { hideAi: true });
    roundTrip('ai-generated', {}, { tags: ['ai-generated'] });
});

check('every condition together, after the tags', () => {
    let query = 'blue_sky sort:score score:>=100 -rating:explicit -video -animated width:>=1920 -ai-generated';
    roundTrip(query, { sort: 'score', minScore: 100, ratings: ['general', 'sensitive', 'questionable'], type: 'image', minWidth: 1920, hideAi: true }, { tags: ['blue_sky'] });
});

check('unknown tokens stay in place', () => {
    let query = 'fixture_artist score:>=50 {blue_sky ~ red_sky} fav:1 -tag_x parent:12 user:someone source:*pixiv* md5:abc date:>=2026-01-01';
    let { tags, conditions } = parseQuery(query);
    assert.deepEqual(tags, ['fixture_artist', '{blue_sky ~ red_sky}', 'fav:1', '-tag_x', 'parent:12', 'user:someone', 'source:*pixiv*', 'md5:abc', 'date:>=2026-01-01']);
    assert.equal(conditions.minScore, 50);
    assert.equal(buildQuery({ tags, conditions }), 'fixture_artist {blue_sky ~ red_sky} fav:1 -tag_x parent:12 user:someone source:*pixiv* md5:abc date:>=2026-01-01 score:>=50');
});

check('an {a ~ b} group is one token', () => {
    assert.deepEqual(splitQuery('  a  {b ~   c}   d '), ['a', '{b ~ c}', 'd']);
    roundTrip('{blue_sky ~ red_sky}', {}, { tags: ['{blue_sky ~ red_sky}'] });
});

check('fav: user ID', () => {
    assert.equal(favoritesUserId('fav:1'), '1');
    assert.equal(favoritesUserId('blue_sky fav:4242 sort:score'), '4242');
    assert.equal(favoritesUserId('blue_sky'), null);
    roundTrip('fav:1', {}, { tags: ['fav:1'] });
});

check('a -tag is kept', () => {
    roundTrip('-tag_x', {}, { tags: ['-tag_x'] });
    roundTrip('blue_sky -tag_x', {}, { tags: ['blue_sky', '-tag_x'] });
});

check('setConditions changes some conditions and keeps the rest', () => {
    assert.equal(setConditions('blue_sky sort:score score:>=10', { minScore: 500 }), 'blue_sky sort:score score:>=500');
    assert.equal(setConditions('blue_sky sort:score score:>=10', { sort: null, minScore: null }), 'blue_sky');
    assert.equal(setConditions('blue_sky', { ratings: ['general'], type: 'video' }), 'blue_sky rating:general video');
});

check('a new search keeps the list\'s conditions', () => {
    assert.equal(searchFromList('red_sky', 'blue_sky sort:score score:>=100'), 'red_sky sort:score score:>=100');
    assert.equal(searchFromList('red_sky sort:random', 'blue_sky sort:score'), 'red_sky sort:random');
    assert.equal(searchFromList('red_sky -tag_x', ''), 'red_sky -tag_x');
});

check('refine adds, excludes and flips a tag in place', () => {
    assert.equal(refineQuery('blue_sky sort:score', 'red_sky'), 'blue_sky red_sky sort:score');
    assert.equal(refineQuery('blue_sky sort:score', 'red_sky', { exclude: true }), 'blue_sky -red_sky sort:score');
    assert.equal(refineQuery('blue_sky -red_sky', 'red_sky'), 'blue_sky red_sky');
});
