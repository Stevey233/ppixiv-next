// The Gelbooru tag library: every tag in use on Gelbooru with its category, post count, Chinese
// name, aliases and notes, searchable locally.
//
// The data is the pack built by tools/build-gelbooru-tags.py into data/ (see data/README.md): one
// gzipped TSV of about 140,000 tags, most used first.  It's downloaded once from the fork's
// repository and kept gzipped in IndexedDB under the URL it came from.  The default URL names the
// pack's version, so a script that wants a newer pack downloads it again.
//
// Nothing else in the app may wait for this: load() is started by whatever UI wants it, and until
// it has finished get() returns null and search() returns nothing.
//
// Memory: the decompressed text is kept as one string and a row's fields are split out only when
// it's returned.  Searching runs over a second string holding every row's normalized name, Chinese
// name and aliases, with row boundaries in a Uint32Array.

import KeyStorage from '/vview/misc/key-storage.js';

// PACK_VERSION must equal "version" in data/gelbooru-tags.json; test/tag-library.mjs checks it.
export const PACK_VERSION = "d267998bbed6";
export const DEFAULT_PACK_URL = `https://raw.githubusercontent.com/Stevey233/ppixiv-next/stevey/data/gelbooru-tags.${PACK_VERSION}.tsv.gz`;

const PACK_HEADER = "#ppixiv-gelbooru-tags 1\ttag\tcategory\tcount\tzh\taliases\tnotes";
const CACHE_KEY = "pack";

// Gelbooru's category IDs.  2 (invalid) and 6 (deprecated) aren't in the pack.
const CATEGORY_NAMES = { 0: "general", 1: "artist", 3: "copyright", 4: "character", 5: "metadata" };
const CATEGORY_IDS = Object.fromEntries(Object.entries(CATEGORY_NAMES).map(([id, name]) => [name, Number(id)]));

// In the search string, each row starts with ROW, each of its names is preceded and followed by
// NAME, and its aliases come after ALIAS:
// ROW NAME tag NAME zh NAME ALIAS NAME alias NAME alias NAME ROW NAME ...
const NAME = "\u0001";
const ROW = "\u0002";
const ALIAS = "\u0003";

// Rows parsed between yields to the browser, under 10 ms of work on a desktop.
const PARSE_CHUNK_ROWS = 8000;

// Match ranks for relevance order.
const EXACT = 0, PREFIX = 1, WORD_PREFIX = 2, SUBSTRING = 3, NO_MATCH = 4;

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Normalize text for matching: NFKC (full-width letters become ASCII, half-width kana become
 * full-width), lower case, "_" as a space, runs of whitespace as one space, trimmed.
 * "ＨＡＴＳＵＮＥ＿ＭＩＫＵ" and "hatsune  miku" both become "hatsune miku".
 * @param {string} text
 * @returns {string}
 */
export function normalizeTagText(text)
{
    return normalizeSearchText(text.replace(/[\u0000-\u001f]/g, " ")).trim();
}

// normalizeTagText for the search string: NAME, ROW and ALIAS are kept, and names are trimmed.
function normalizeSearchText(text)
{
    return text.normalize("NFKC").toLowerCase().replace(/[_\s]+/g, " ").replace(/ ?([\u0001-\u0003]) ?/g, "$1");
}

/**
 * @typedef {"general"|"artist"|"copyright"|"character"|"metadata"} TagCategory
 *
 * @typedef {Object} TagEntry
 * @property {string} tag           The tag as Gelbooru writes it, like "hatsune_miku".
 * @property {TagCategory} category Gelbooru's category for it.
 * @property {number} count         Gelbooru posts with the tag as of the pack's date (2026-06-11).
 * @property {string|null} zh       The Chinese name, or null if there is none.
 * @property {string[]} aliases     Other names, in any language ("初音", "miku_hatsune"); may be empty.
 * @property {string|null} notes    A short Chinese description, or null.
 */

/**
 * Fires "change" (a plain Event) when loading starts, finishes or fails.
 */
export default class TagLibrary extends EventTarget
{
    constructor()
    {
        super();

        /** True once load() has finished: get() and search() answer from then on. */
        this.loaded = false;

        /** True while load() is running. */
        this.loading = false;

        /** The error of the last failed load(), or null.  Calling load() again retries. */
        this.error = null;

        this._loadPromise = null;
        this._storage = new KeyStorage("ppixiv-gelbooru-tags");

        this._text = "";            // the pack's text
        this._lineStart = null;     // Uint32Array: row -> offset of its line in _text, plus the end
        this._categories = null;    // Uint8Array: row -> Gelbooru category ID
        this._rowsByTag = null;     // Map: tag -> row
        this._search = "";          // the search string, see NAME, ROW and ALIAS
        this._searchStart = null;   // Uint32Array: row -> offset of its ROW in _search, plus the end
    }

    /** The URL the pack is downloaded from: the setting gelbooru_tag_pack_url, or the fork's repository. */
    get url()
    {
        return ppixiv.settings.get("gelbooru_tag_pack_url") || DEFAULT_PACK_URL;
    }

    /** The number of tags, 0 until loaded. */
    get size()
    {
        return this.loaded? this._categories.length:0;
    }

    /**
     * Load the library: from IndexedDB if this URL's pack is stored there, otherwise download and
     * store it.  Calling it again while it runs or after it's done returns the same promise.  If
     * it fails, the promise rejects (once) and the next call tries again.
     * @returns {Promise<void>}
     */
    load()
    {
        if(this._loadPromise)
            return this._loadPromise;

        this.loading = true;
        this.error = null;
        this._changed();

        this._loadPromise = this._load().then(() => {
            this.loading = false;
            this.loaded = true;
            this._changed();
        }, (error) => {
            this.loading = false;
            this.error = error;
            this._loadPromise = null;
            this._changed();
            throw error;
        });
        return this._loadPromise;
    }

    async _load()
    {
        let url = this.url;
        let cached = await this._storage.get(CACHE_KEY);
        let blob = cached?.url == url? cached.blob:null;
        let downloaded = blob == null;
        if(downloaded)
        {
            let response = await (globalThis.realFetch ?? globalThis.fetch)(url, { credentials: "omit" });
            if(!response.ok)
                throw new Error(`Couldn't download the tag library (${response.status}): ${url}`);
            blob = await response.blob();
        }

        let stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
        let text = await new Response(stream).text();
        await this._parse(text);

        // Store it only once it has parsed.  If storing fails (no IndexedDB, no space), the next
        // page load downloads it again.
        if(downloaded)
            await this._storage.set(CACHE_KEY, { url, blob });
    }

    // Parse the pack's text, yielding to the browser between chunks.
    async _parse(text)
    {
        let headerEnd = text.indexOf("\n");
        if(text.slice(0, headerEnd) != PACK_HEADER)
            throw new Error("The tag library has an unknown format");

        let lineStart = [];
        let categories = [];
        let rowsByTag = new Map();
        let searchChunks = [], searchStart = [], searchLength = 0;
        let pos = headerEnd + 1;
        while(pos < text.length)
        {
            let parts = [];
            for(let n = 0; n < PARSE_CHUNK_ROWS && pos < text.length; n++)
            {
                let end = text.indexOf("\n", pos);
                if(end == -1)
                    end = text.length;

                // tag, category, count, zh, aliases (notes aren't needed here)
                let fields = text.slice(pos, end).split("\t", 5);
                rowsByTag.set(fields[0], lineStart.length);
                lineStart.push(pos);
                categories.push(Number(fields[1]));

                parts.push(ROW, NAME, fields[0], NAME);
                if(fields[3])
                    parts.push(fields[3], NAME);
                if(fields[4])
                    parts.push(ALIAS, NAME, fields[4].replaceAll("|", NAME), NAME);
                pos = end + 1;
            }

            // Normalize the chunk in one go, then find where its rows start.
            let chunk = normalizeSearchText(parts.join(""));
            for(let at = chunk.indexOf(ROW); at != -1; at = chunk.indexOf(ROW, at + 1))
                searchStart.push(searchLength + at);
            searchChunks.push(chunk);
            searchLength += chunk.length;
            await yieldToBrowser();
        }
        lineStart.push(pos);
        searchStart.push(searchLength);

        this._text = text;
        this._lineStart = Uint32Array.from(lineStart);
        this._categories = Uint8Array.from(categories);
        this._rowsByTag = rowsByTag;
        this._search = searchChunks.join("");
        this._searchStart = Uint32Array.from(searchStart);
    }

    /**
     * Look up a tag.  Gelbooru's own spelling is looked up first, then the lower-case one with
     * spaces as "_".
     * @param {string} tag
     * @returns {TagEntry|null} null if the tag isn't in the library or it isn't loaded yet.
     */
    get(tag)
    {
        if(!this.loaded)
            return null;
        let row = this._rowsByTag.get(tag) ?? this._rowsByTag.get(tag.toLowerCase().replace(/ /g, "_"));
        return row == null? null:this._entry(row);
    }

    /**
     * Search tags by name, Chinese name and aliases.  Text and names are compared after
     * normalizeTagText, so "hatsune miku", "HATSUNE_MIKU", "初音" (an alias) and
     * "ｈａｔｓｕｎｅ" all find hatsune_miku.
     *
     * With sort "relevance", tags where one of the names equals the text come first, then names
     * starting with it, then names with a word starting with it ("miku" in "hatsune miku"), then
     * names containing it; most used first within each.  With sort "count", every match is most
     * used first.  Empty text lists every tag (of the category, if given) most used first.
     *
     * @param {string} text
     * @param {Object} [options]
     * @param {TagCategory|null} [options.category] Only tags of this category.
     * @param {number} [options.limit=50]
     * @param {number} [options.offset=0]
     * @param {"relevance"|"count"} [options.sort="relevance"]
     * @returns {{ total: number, results: TagEntry[] }} total counts every match; results are
     *     the ones from offset to offset + limit.  Nothing before load() has finished.
     */
    search(text, { category=null, limit=50, offset=0, sort="relevance" }={})
    {
        if(!this.loaded)
            return { total: 0, results: [] };

        let categoryId = category == null? null:CATEGORY_IDS[category];
        if(categoryId === undefined)
            throw new Error(`Unknown tag category: ${category}`);

        let query = normalizeTagText(text);
        let ranked = query == ""? [this._allRows(categoryId)]:this._match(query, categoryId, sort == "relevance");

        let total = 0;
        for(let rows of ranked)
            total += rows.length;

        let results = [];
        let skip = offset;
        for(let rows of ranked)
        {
            if(skip >= rows.length)
            {
                skip -= rows.length;
                continue;
            }
            for(let i = skip; i < rows.length && results.length < limit; i++)
                results.push(this._entry(rows[i]));
            skip = 0;
            if(results.length >= limit)
                break;
        }
        return { total, results };
    }

    // Return every row of a category, or every row if categoryId is null.
    _allRows(categoryId)
    {
        let rows = [];
        let categories = this._categories;
        for(let row = 0; row < categories.length; row++)
        {
            if(categoryId == null || categories[row] == categoryId)
                rows.push(row);
        }
        return rows;
    }

    // Return the rows matching query.  With rank, return them in one list per match rank (EXACT
    // to SUBSTRING), otherwise in one list.  Rows are in pack order, so each list is most used
    // first.
    _match(query, categoryId, rank)
    {
        let lists = rank? [[], [], [], []]:[[]];
        let search = this._search, starts = this._searchStart, categories = this._categories;
        let rowCount = categories.length;
        let row = 0;
        let pos = search.indexOf(query);
        while(pos != -1)
        {
            // Find the row containing pos.  Hits come in order, so search from the last row.
            row = findRow(starts, pos, row, rowCount);
            let rowEnd = starts[row + 1];
            if(categoryId == null || categories[row] == categoryId)
                lists[rank? rowRank(search.slice(starts[row], rowEnd), query):0].push(row);
            pos = search.indexOf(query, rowEnd);
        }
        return lists;
    }

    _entry(row)
    {
        let line = this._text.slice(this._lineStart[row], this._lineStart[row + 1] - 1);
        let [tag, category, count, zh, aliases, notes] = line.split("\t");
        return {
            tag,
            category: CATEGORY_NAMES[category],
            count: Number(count),
            zh: zh || null,
            aliases: aliases? aliases.split("|"):[],
            notes: notes || null,
        };
    }

    _changed()
    {
        this.dispatchEvent(new Event("change"));
    }
}

// Return the row whose span in the search string holds pos, searching forward from row.
function findRow(starts, pos, row, rowCount)
{
    // Binary search between row and the end.
    let lo = row, hi = rowCount - 1;
    while(lo < hi)
    {
        let mid = (lo + hi + 1) >> 1;
        if(starts[mid] <= pos)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}

// Rank how query matches a row's span of the search string.  Matching an alias ranks one step
// lower than the same match on the tag or its Chinese name: aliases include artists' social media
// handles like "a" and "hai", which shouldn't come before hair_ornament for "hai".
function rowRank(span, query)
{
    let aliases = span.indexOf(ALIAS);
    if(aliases == -1)
        return matchRank(span, query);
    let rank = matchRank(span.slice(0, aliases), query);
    return rank == EXACT? rank:Math.min(rank, matchRank(span.slice(aliases), query) + 1, SUBSTRING);
}

// Rank how query matches NAME a NAME b NAME ..., or NO_MATCH.
function matchRank(span, query)
{
    if(span.includes(NAME + query + NAME))
        return EXACT;
    if(span.includes(NAME + query))
        return PREFIX;
    let pos = span.indexOf(query);
    if(pos == -1)
        return NO_MATCH;
    for(; pos != -1; pos = span.indexOf(query, pos + 1))
    {
        if(!WORD_CHAR.test(span[pos - 1]))
            return WORD_PREFIX;
    }
    return SUBSTRING;
}

// Let the browser run between chunks of work.  A message isn't throttled in a hidden tab the way
// setTimeout is.
function yieldToBrowser()
{
    if(globalThis.scheduler?.yield)
        return globalThis.scheduler.yield();
    return new Promise((resolve) => {
        let channel = new MessageChannel();
        channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}
