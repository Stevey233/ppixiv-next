// Chinese names for Gelbooru tags, from the tag library (tag-library.js), wherever tags are shown:
// the viewer's tag pills, the related tags row, the search box's dropdown and the list's title.
//
// The shared code shows tag names through ppixiv.tagTranslations, which asks the site's
// tagNames hook (SiteGelbooru.tagNames) before anything Pixiv-specific, so most places get these
// names without knowing about Gelbooru.  Names are only shown, never searched: links, the search
// box and saved tags keep the original tag.
//
// Nothing waits for the library.  Until it has loaded, or if it failed, or with the setting
// gelbooru_tag_chinese_names off, there are no names and tags show as they are.  When either
// changes, "tag-translations-changed" on window tells the tag lists to redraw.

// The Chinese name of tag, or null.  A leading - (exclude) isn't part of the tag.
export function chineseName(tag)
{
    if(!ppixiv.settings.get("gelbooru_tag_chinese_names"))
        return null;
    return ppixiv.site.tagLibrary?.get(tag)?.zh ?? null;
}

// Return { tag: name } for the tags in tags that have a Chinese name.
export function chineseNames(tags)
{
    let result = {};
    for(let tag of tags)
    {
        let name = chineseName(tag);
        if(name != null)
            result[tag] = name;
    }
    return result;
}

// How a query token is shown: its Chinese name if it's a tag with one, keeping a leading -.
export function tokenLabel(token)
{
    let [, prefix, tag] = /^(-?)(.*)$/.exec(token);
    let name = chineseName(tag);
    return name == null? token:prefix + name;
}

// Tell tag lists to redraw when the library loads or the setting changes.
export function watchTagNames(tagLibrary)
{
    let changed = () => window.dispatchEvent(new Event("tag-translations-changed"));
    tagLibrary.addEventListener("change", () => {
        if(tagLibrary.loaded)
            changed();
    });
    ppixiv.settings.addEventListener("gelbooru_tag_chinese_names", changed);
}
