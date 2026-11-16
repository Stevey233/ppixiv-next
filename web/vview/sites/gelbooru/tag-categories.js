// Tag categories (artist, character, copyright, general, metadata) for posts' tags.
//
// The post API doesn't include them.  A tag's category comes from, in order:
//
// - what this page already learned (memory)
// - the tag library (tag-library.js, ppixiv.site.tagLibrary), once it has loaded; it never waits
//   for it, and a library that fails to load changes nothing
// - an IndexedDB cache of earlier answers
// - the tag API, 100 names per request, through api.js and its request spacing
//
// Lookups run when a post is opened in the viewer (loadPostCategories) and when a caller asks
// (categoriesForTags), never per thumbnail.  Autocomplete answers fill the cache too.  The general
// category is "general" everywhere (autocomplete calls it "tag").
import KeyStorage from '/vview/misc/key-storage.js';
import * as api from '/vview/sites/gelbooru/api.js';

export const CATEGORIES = ["artist", "character", "copyright", "general", "metadata"];

// Gelbooru's category IDs.  2 and 6 (deprecated) count as general.
const CATEGORY_NAMES = { 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "metadata" };

const TAG_API_BATCH = 100;

let known = new Map(); // tag -> category
let pending = new Map(); // tag -> promise of its category, while a lookup runs
let storage = new KeyStorage("ppixiv-gelbooru-tag-categories");

function normalizeCategory(category)
{
    if(category == "tag")
        return "general";
    return CATEGORIES.includes(category)? category:"general";
}

// The category of tag from memory or the tag library, or null.
function knownCategory(tag)
{
    let category = known.get(tag);
    if(category != null)
        return category;

    let entry = ppixiv.site.tagLibrary?.get(tag);
    if(entry == null)
        return null;
    known.set(tag, entry.category);
    return entry.category;
}

// Return { tag: category } for tags if every one of them is known without a lookup, or null.
// The post mapper uses this, so posts registered after their tags were seen get categories at
// once.
export function knownCategories(tags)
{
    let result = {};
    for(let tag of tags)
    {
        let category = knownCategory(tag);
        if(category == null)
            return null;
        result[tag] = category;
    }
    return result;
}

function remember(entries)
{
    let stored = {};
    for(let [tag, category] of entries)
    {
        known.set(tag, category);
        stored[tag] = category;
    }
    if(entries.length)
        storage.multiSet(stored);
}

// Look up tags that aren't in memory or the library: IndexedDB first, then the tag API.
async function lookUp(tags)
{
    let stored = await storage.multiGet(tags);
    let missing = [];
    tags.forEach((tag, idx) => {
        if(stored[idx] != null)
            known.set(tag, stored[idx]);
        else
            missing.push(tag);
    });

    for(let start = 0; start < missing.length; start += TAG_API_BATCH)
    {
        let names = missing.slice(start, start + TAG_API_BATCH);
        let results = await api.getTags(names);
        let found = new Map(results.map((entry) => [entry.name, CATEGORY_NAMES[entry.type] ?? "general"]));

        // A name the API doesn't return (a misspelled or removed tag) is general, and is stored as
        // such so it isn't asked for again.
        remember(names.map((name) => [name, found.get(name) ?? "general"]));
    }
}

// Return a promise of { tag: category } for tags, looking up the ones that aren't known yet.
export async function categoriesForTags(tags)
{
    let wanted = [];
    let waits = [];
    for(let tag of new Set(tags))
    {
        if(knownCategory(tag) != null)
            continue;
        if(pending.has(tag))
            waits.push(pending.get(tag));
        else
            wanted.push(tag);
    }

    if(wanted.length)
    {
        let lookup = lookUp(wanted);
        for(let tag of wanted)
            pending.set(tag, lookup);
        lookup.finally(() => {
            for(let tag of wanted)
                if(pending.get(tag) == lookup)
                    pending.delete(tag);
        });
        waits.push(lookup);
    }

    await Promise.all(waits);
    return knownCategories(tags) ?? Object.fromEntries(tags.map((tag) => [tag, known.get(tag) ?? "general"]));
}

// Remember the categories autocomplete answers carry.  entries are [{ tag, category }] with
// Gelbooru's autocomplete category names.
export function rememberCategories(entries)
{
    remember(entries.filter(({ tag }) => !known.has(tag)).map(({ tag, category }) => [tag, normalizeCategory(category)]));
}
