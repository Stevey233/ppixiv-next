// Gelbooru's search query holds both tags and search conditions ("blue_sky score:>=100 sort:score").
// The tags URL parameter is the only state of a posts list, so the search box, the filter bar and
// the rail all read and rewrite it through this module.  See .work/gelbooru/DESIGN.md, "The query
// is the state".
//
// parseQuery(query) returns { tags, conditions, raw }:
//
//   tags        every token that isn't a condition, in query order.  This includes {a ~ b}
//               groups, fav:, parent:, user:, source:, md5: and anything else.
//   conditions  { sort, minScore, ratings, type, minWidth, minHeight, hideAi }, see EMPTY.
//   raw         { kind: [tokens] } for each kind of condition (see KINDS) written in a way the
//               menus can't express, like score:>5 or width:1920, kept as written.
//
// buildQuery({ tags, conditions, raw }) turns them back into a query: the tags in order, then the
// conditions in a fixed order.  setConditions(query, changes) does both, changing some conditions
// and keeping the rest of the query.
//
// This module has no imports, so test/gelbooru-query.mjs loads it directly.

export const RATINGS = ["general", "sensitive", "questionable", "explicit"];
export const SORTS = ["score", "random", "updated"];
export const TYPES = ["image", "animated", "video"];

// No conditions: newest first, any score, every rating, every type, any size, AI shown.
export const EMPTY = Object.freeze({
    sort: null,         // null (newest), or one of SORTS
    minScore: null,     // number, from score:>=N
    ratings: null,      // null (all), or the selected RATINGS in RATINGS order
    type: null,         // null (all), or one of TYPES
    minWidth: null,     // number, from width:>=N
    minHeight: null,    // number, from height:>=N
    hideAi: false,      // -ai-generated
});

// The tokens each type writes.  A type is recognized only when the query has exactly these
// type tokens.  Others, like "-video" alone, are a type written by hand (see raw).
const TYPE_TOKENS = {
    image: ["-video", "-animated"],
    animated: ["animated", "-video"],
    video: ["video"],
};
const ALL_TYPE_TOKENS = new Set(["video", "-video", "animated", "-animated"]);

// Split a query into tokens on whitespace.  An {a ~ b} group is one token, with its spacing
// normalized to "{a ~ b}".
export function splitQuery(query)
{
    let tokens = [];
    let text = (query ?? "").trim();
    let i = 0;
    while(i < text.length)
    {
        if(/\s/.test(text[i]))
        {
            i++;
            continue;
        }

        if(text[i] == "{")
        {
            let end = text.indexOf("}", i);
            if(end == -1)
                end = text.length-1;
            let inner = text.slice(i+1, end).trim().split(/\s+/).filter((w) => w);
            tokens.push(`{${inner.join(" ")}}`);
            i = end + 1;
            continue;
        }

        let end = i;
        while(end < text.length && !/\s/.test(text[end]))
            end++;
        tokens.push(text.slice(i, end));
        i = end;
    }
    return tokens;
}

// The kinds of condition, in the order buildQuery writes them, with the keys of conditions each
// one sets.  A menu changes one kind at a time.
export const KINDS = {
    sort: ["sort"],
    score: ["minScore"],
    rating: ["ratings"],
    type: ["type"],
    size: ["minWidth", "minHeight"],
    ai: ["hideAi"],
};

// The kind of condition a token (lowercased) belongs to, or null for an ordinary tag.
function tokenKind(token)
{
    if(token.startsWith("sort:"))
        return "sort";
    if(token.startsWith("score:"))
        return "score";
    if(/^-?rating:/.test(token))
        return "rating";
    if(/^(width|height):/.test(token))
        return "size";
    if(ALL_TYPE_TOKENS.has(token))
        return "type";
    if(token == "-ai-generated")
        return "ai";
    return null;
}

// Read the tokens (lowercased) of one kind into conditions, or return null if the menus can't
// express them.
const KIND_PARSERS = {
    sort(tokens)
    {
        let match = tokens.length == 1 && /^sort:(score|random|updated)(:desc)?$/.exec(tokens[0]);
        return match? { sort: match[1] }:null;
    },

    score(tokens)
    {
        let match = tokens.length == 1 && /^score:>=(\d+)$/.exec(tokens[0]);
        return match? { minScore: parseInt(match[1]) }:null;
    },

    // One rating:<r>, or one to four distinct -rating:<r>.
    rating(tokens)
    {
        let match = tokens.length == 1 && /^rating:(\w+)$/.exec(tokens[0]);
        if(match)
            return RATINGS.includes(match[1])? { ratings: [match[1]] }:null;

        let excluded = tokens.map((token) => /^-rating:(\w+)$/.exec(token)?.[1]);
        if(!excluded.every((rating) => RATINGS.includes(rating)) || new Set(excluded).size != excluded.length)
            return null;
        return { ratings: RATINGS.filter((rating) => !excluded.includes(rating)) };
    },

    // Exactly the tokens of one of TYPE_TOKENS.
    type(tokens)
    {
        for(let [type, wanted] of Object.entries(TYPE_TOKENS))
        {
            if(tokens.length == wanted.length && wanted.every((token) => tokens.includes(token)))
                return { type };
        }
        return null;
    },

    // At most one width:>=N and one height:>=N.
    size(tokens)
    {
        let result = {};
        for(let token of tokens)
        {
            let match = /^(width|height):>=(\d+)$/.exec(token);
            let key = match?.[1] == "width"? "minWidth":"minHeight";
            if(match == null || key in result)
                return null;
            result[key] = parseInt(match[2]);
        }
        return result;
    },

    ai() { return { hideAi: true }; },
};

// Parse a query into { tags, conditions, raw }.  A kind whose tokens the menus can't express, like
// score:>5, sort:score:asc or two rating: tokens, is left out of conditions and kept as written in
// raw[kind], so it stays in the query untouched until that kind is changed.
export function parseQuery(query)
{
    let tokens = splitQuery(query);
    let conditions = { ...EMPTY };
    let raw = {};

    let byKind = {};
    let tags = [];
    for(let token of tokens)
    {
        let kind = tokenKind(token.toLowerCase());
        if(kind == null)
            tags.push(token);
        else
            (byKind[kind] ??= []).push(token);
    }

    for(let [kind, kindTokens] of Object.entries(byKind))
    {
        let parsed = KIND_PARSERS[kind](kindTokens.map((token) => token.toLowerCase()));
        if(parsed)
            Object.assign(conditions, parsed);
        else
            raw[kind] = kindTokens;
    }

    return { tags, conditions, raw };
}

// The tokens conditions write for one kind.
function kindTokens(kind, c)
{
    switch(kind)
    {
    case "sort": return c.sort != null? [`sort:${c.sort}`]:[];
    case "score": return c.minScore != null? [`score:>=${c.minScore}`]:[];
    case "rating":
    {
        let ratings = c.ratings == null? RATINGS:RATINGS.filter((rating) => c.ratings.includes(rating));
        if(ratings.length == 1)
            return [`rating:${ratings[0]}`];
        return RATINGS.filter((rating) => !ratings.includes(rating)).map((rating) => `-rating:${rating}`);
    }
    case "type": return c.type != null? TYPE_TOKENS[c.type]:[];
    case "size":
    {
        let tokens = [];
        if(c.minWidth != null)
            tokens.push(`width:>=${c.minWidth}`);
        if(c.minHeight != null)
            tokens.push(`height:>=${c.minHeight}`);
        return tokens;
    }
    case "ai": return c.hideAi? ["-ai-generated"]:[];
    }
}

// Return the condition tokens for conditions, in a fixed order.
export function conditionTokens(conditions)
{
    let c = { ...EMPTY, ...conditions };
    return Object.keys(KINDS).flatMap((kind) => kindTokens(kind, c));
}

// Build a query from tags, conditions and raw condition tokens: the tags in order, then each kind
// of condition in KINDS order.
export function buildQuery({ tags=[], conditions=EMPTY, raw={} }={})
{
    let c = { ...EMPTY, ...conditions };
    let tokens = [...tags];
    for(let kind of Object.keys(KINDS))
        tokens.push(...kindTokens(kind, c), ...(raw[kind] ?? []));
    return tokens.join(" ");
}

// Return whether a parsed query sets a kind of condition, from a menu or written by hand.
export function hasKind({ conditions, raw }, kind)
{
    return raw[kind] != null || KINDS[kind].some((key) => conditions[key] != EMPTY[key]);
}

// Return whether a query has any condition.
export function hasConditions(query)
{
    let parsed = parseQuery(query);
    return Object.keys(KINDS).some((kind) => hasKind(parsed, kind));
}

// Return query with some conditions changed, keeping its tags and the other conditions.  A
// condition set to null (or false for hideAi) is removed.  Changing a kind replaces any tokens of
// that kind written by hand.
export function setConditions(query, changes)
{
    let { tags, conditions, raw } = parseQuery(query);
    raw = { ...raw };
    for(let [kind, keys] of Object.entries(KINDS))
    {
        if(keys.some((key) => key in changes))
            delete raw[kind];
    }
    return buildQuery({ tags, conditions: { ...conditions, ...changes }, raw });
}

// Return query without any condition.
export function clearConditions(query)
{
    return buildQuery({ tags: parseQuery(query).tags });
}

// Return the query for searching newTags (a query typed in the search box or a saved search) from
// the list currentQuery: the new tags, with the conditions of the current list for each kind the
// new query doesn't set itself.  The tags of currentQuery are dropped.  This also applies default
// conditions: searchFromList(query, defaultsQuery).
export function searchFromList(newTags, currentQuery)
{
    let current = parseQuery(currentQuery);
    let next = parseQuery(newTags);
    let conditions = { ...next.conditions };
    let raw = { ...next.raw };
    for(let [kind, keys] of Object.entries(KINDS))
    {
        if(hasKind(next, kind))
            continue;
        for(let key of keys)
            conditions[key] = current.conditions[key];
        if(current.raw[kind])
            raw[kind] = current.raw[kind];
    }
    return buildQuery({ tags: next.tags, conditions, raw });
}

// Return the query with tag added at the end, or excluded ("-tag") if exclude is true.  A tag
// already in the query, included or excluded, changes in place instead of being added twice.
export function refineQuery(query, tag, { exclude=false }={})
{
    let { tags, conditions, raw } = parseQuery(query);
    let word = exclude? `-${tag}`:tag;
    let index = tags.findIndex((t) => t == tag || t == `-${tag}`);
    if(index == -1)
        tags.push(word);
    else
        tags[index] = word;
    return buildQuery({ tags, conditions, raw });
}

// Return the user ID of a fav:<id> token in the query, or null.
export function favoritesUserId(query)
{
    for(let token of splitQuery(query))
    {
        let match = /^fav:(\d+)$/i.exec(token);
        if(match)
            return match[1];
    }
    return null;
}
