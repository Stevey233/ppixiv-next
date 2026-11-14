// 常看标签's sections (sites/pixiv/data-sources/tag-feed.js): the header the search view puts
// before each tag's first work.  See docs/design.md "常看标签".

import { helpers } from '/vview/misc/helpers.js';

// Return the header for a section { tag, translation, mediaIds }: the tag's translated name, the
// original after it when it differs, the number of works and a link to the tag's search.
export function createTagSectionHeader({ tag, translation, mediaIds })
{
    let header = document.createElement("div");
    header.className = "n-tag-section";

    let name = document.createElement("h2");
    name.className = "n-tag-section-name";
    name.textContent = translation ?? tag;
    header.append(name);

    if(translation != null && translation != tag)
    {
        let original = document.createElement("span");
        original.className = "n-tag-section-original";
        original.textContent = tag;
        header.append(original);
    }

    let count = document.createElement("span");
    count.className = "n-tag-section-count";
    count.textContent = `${mediaIds.length} 件`;

    let search = document.createElement("a");
    search.className = "n-tag-section-search";
    search.href = helpers.getArgsForTagSearch(tag, ppixiv.plocation);
    search.textContent = "搜索这个标签";

    header.append(count, search);
    return header;
}
