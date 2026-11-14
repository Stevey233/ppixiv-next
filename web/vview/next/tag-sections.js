// 常看标签's sections (sites/pixiv/data-sources/tag-feed.js): the header the search view puts
// before each tag's first work, and the list's option row with one line of the tags after it,
// where a click scrolls to that tag's section.  See docs/design.md "常看标签".

import RecommendOptions from '/vview/next/recommend-options.js';
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

export class TagFeedUI extends RecommendOptions
{
    constructor({ dataSource, ...options })
    {
        super({ dataSource, ...options });

        this.dataSource = dataSource;
        this.jump = document.createElement("div");
        this.jump.className = "n-tag-jump";
        this.jump.setAttribute("role", "group");
        this.jump.setAttribute("aria-label", "跳到标签");
        this.root.append(this.jump);

        this.jump.addEventListener("click", (e) => {
            let button = e.target.closest("button[data-index]");
            if(button != null)
                this._scrollTo(this.dataSource.shownSections[button.dataset.index]);
        });
        dataSource.addEventListener("pageadded", () => this.refresh(), this._signal);
        this.refresh();
    }

    refresh()
    {
        this.jump.replaceChildren(...this.dataSource.shownSections.map((section, index) => {
            let button = document.createElement("button");
            button.type = "button";
            button.dataset.index = index;
            button.textContent = section.translation ?? section.tag;
            button.title = section.tag;
            return button;
        }));
        this.jump.hidden = this.jump.childElementCount < 2;
    }

    // Scroll so the section's header is at the top.
    _scrollTo(section)
    {
        let searchView = ppixiv.app._screenSearch?.searchView;
        let mediaId = section?.mediaIds[0];
        if(searchView == null || mediaId == null)
            return;

        searchView.scrollToMediaId(mediaId);
        let header = searchView.getThumbnailForMediaId(mediaId)?.sectionHeader;
        if(header != null)
            searchView.scrollContainer.scrollTop = header.offsetTop - 8;
    }
}
