// Tag categories (artist, character, copyright, general, metadata) for a post's tags.
//
// The post API doesn't include them.  Until the category cache exists (DESIGN.md, "Requests":
// tagCategories(names) from IndexedDB and the tag API), the mapper registers tagCategories as
// null, which the UI reads as "not known yet".  categoriesForTags is the one place the mapper asks.
export function categoriesForTags(tags)
{
    return null;
}

// Remember the categories autocomplete answers carry.  entries are [{ tag, category }] with
// Gelbooru's autocomplete category names.
export function rememberCategories(entries)
{
}
