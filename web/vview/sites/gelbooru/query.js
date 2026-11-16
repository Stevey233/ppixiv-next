// Gelbooru's search query holds both tags and search conditions ("blue_sky score:>=100 sort:score").
// The tags URL parameter is the only state of a posts list, so the search box, the filter bar and
// the rail all read and rewrite it through this module.  See .work/gelbooru/DESIGN.md, "The query
// is the state".
//
// parseQuery(query) returns { tags, conditions }:
//
//   tags        every token that isn't a recognized condition, in query order.  This includes
//               {a ~ b} groups, fav:, parent:, user:, source:, md5: and anything else.
//   conditions  { sort, minScore, ratings, type, minWidth, minHeight, hideAi }, see EMPTY.
//
// buildQuery({ tags, conditions }) turns them back into a query: the tags in order, then the
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
// type tokens, so "-video" alone stays an ordinary tag.
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

export function parseQuery(query)
{
    let tokens = splitQuery(query);
    let conditions = { ...EMPTY };
    let consumed = new Set();

    let excludedRatings = new Set();
    for(let [idx, token] of tokens.entries())
    {
        let lower = token.toLowerCase();
        let match;
        if((match = /^sort:(score|random|updated)(:desc)?$/.exec(lower)))
            conditions.sort = match[1];
        else if((match = /^score:>=(\d+)$/.exec(lower)))
            conditions.minScore = parseInt(match[1]);
        else if((match = /^width:>=(\d+)$/.exec(lower)))
            conditions.minWidth = parseInt(match[1]);
        else if((match = /^height:>=(\d+)$/.exec(lower)))
            conditions.minHeight = parseInt(match[1]);
        else if(lower == "-ai-generated")
            conditions.hideAi = true;
        else if((match = /^rating:(\w+)$/.exec(lower)) && RATINGS.includes(match[1]) && conditions.ratings == null && excludedRatings.size == 0)
            conditions.ratings = [match[1]];
        else if((match = /^-rating:(\w+)$/.exec(lower)) && RATINGS.includes(match[1]) && conditions.ratings == null)
            excludedRatings.add(match[1]);
        else
            continue;
        consumed.add(idx);
    }

    if(excludedRatings.size)
        conditions.ratings = RATINGS.filter((rating) => !excludedRatings.has(rating));

    // The type is a combination of tokens, so it's recognized from the set of them.
    let typeIndexes = [...tokens.keys()].filter((idx) => ALL_TYPE_TOKENS.has(tokens[idx].toLowerCase()));
    let typeTokens = new Set(typeIndexes.map((idx) => tokens[idx].toLowerCase()));
    for(let [type, wanted] of Object.entries(TYPE_TOKENS))
    {
        if(typeTokens.size == wanted.length && wanted.every((token) => typeTokens.has(token)))
        {
            conditions.type = type;
            for(let idx of typeIndexes)
                consumed.add(idx);
        }
    }

    let tags = tokens.filter((token, idx) => !consumed.has(idx));
    return { tags, conditions };
}

// Return the condition tokens for conditions, in a fixed order.
export function conditionTokens(conditions)
{
    let c = { ...EMPTY, ...conditions };
    let tokens = [];
    if(c.sort != null)
        tokens.push(`sort:${c.sort}`);
    if(c.minScore != null)
        tokens.push(`score:>=${c.minScore}`);

    let ratings = c.ratings == null? RATINGS:RATINGS.filter((rating) => c.ratings.includes(rating));
    if(ratings.length == 1)
        tokens.push(`rating:${ratings[0]}`);
    else if(ratings.length < RATINGS.length)
    {
        for(let rating of RATINGS)
            if(!ratings.includes(rating))
                tokens.push(`-rating:${rating}`);
    }

    if(c.type != null)
        tokens.push(...TYPE_TOKENS[c.type]);
    if(c.minWidth != null)
        tokens.push(`width:>=${c.minWidth}`);
    if(c.minHeight != null)
        tokens.push(`height:>=${c.minHeight}`);
    if(c.hideAi)
        tokens.push("-ai-generated");
    return tokens;
}

export function buildQuery({ tags=[], conditions=EMPTY }={})
{
    return [...tags, ...conditionTokens(conditions)].join(" ");
}

// Return query with some conditions changed, keeping its tags and the other conditions.  A
// condition set to null (or false for hideAi) is removed.
export function setConditions(query, changes)
{
    let { tags, conditions } = parseQuery(query);
    return buildQuery({ tags, conditions: { ...conditions, ...changes } });
}

// Return the query for searching newTags (a query typed in the search box or a saved search) from
// the list currentQuery: the new tags, with the conditions of the current list unless the new
// query sets the same kind of condition itself.
export function searchFromList(newTags, currentQuery)
{
    let current = parseQuery(currentQuery);
    let next = parseQuery(newTags);
    let conditions = { ...current.conditions };
    for(let [key, value] of Object.entries(next.conditions))
    {
        if(value != EMPTY[key])
            conditions[key] = value;
    }
    return buildQuery({ tags: next.tags, conditions });
}

// Return the query with tag added at the end, or excluded ("-tag") if exclude is true.  A tag
// already in the query, included or excluded, changes in place instead of being added twice.
export function refineQuery(query, tag, { exclude=false }={})
{
    let { tags, conditions } = parseQuery(query);
    let word = exclude? `-${tag}`:tag;
    let index = tags.findIndex((t) => t == tag || t == `-${tag}`);
    if(index == -1)
        tags.push(word);
    else
        tags[index] = word;
    return buildQuery({ tags, conditions });
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
