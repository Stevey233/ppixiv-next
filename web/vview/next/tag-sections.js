// 常看标签's sections (sites/pixiv/data-sources/tag-feed.js): the header the search view puts
// before each tag's first work, and the list's option row with, on the desktop, one line of the
// tags after the filter bar, where a click scrolls to that tag's section.  See docs/design.md
// "常看标签".

import Widget from '/vview/widgets/widget.js';
import RecommendOptions from '/vview/next/recommend-options.js';
import { fitChipsToLine } from '/vview/next/related-tags-row.js';
import { helpers } from '/vview/misc/helpers.js';

// Return the header for a section { tag, translation, mediaIds }: the tag's translated name, the
// original after it when it differs, the number of works and a link to the tag's search.
export function createTagSectionHeader({ tag, translation, mediaIds, mode })
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
    let searchArgs = helpers.getArgsForTagSearch(tag, ppixiv.plocation);

    // From the R18 list the search opens as R18 too.  A search URL that says its rating wins over
    // the remembered one (misc/result-filters.js); 全年龄 here leaves it to the remembered one.
    if(mode == "r18")
        searchArgs.query.set("mode", "r18");
    search.href = searchArgs;
    search.textContent = "搜索这个标签";

    header.append(count, search);
    return header;
}

// The list's option row.  On the desktop it also adds the line of tags after the filter bar.
export class TagFeedUI extends RecommendOptions
{
    constructor({ dataSource, ...options })
    {
        super({ dataSource, ...options });

        let header = this.root.closest(".thumbnail-ui-box");
        if(!ppixiv.mobile && header)
            new TagJumpRow({ container: header, dataSource, signal: this.shutdownSignal });
    }
}

// The tags as one line, where a click scrolls to that tag's section.  It takes the place and the
// look of the related tags line on tag search (next/related-tags-row.js): after the filter bar
// when there's room, cut to what fits on one line.
class TagJumpRow extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class="n-related-tags n-tag-jump" role=group aria-label="跳到标签" hidden></div>
        `});

        this.dataSource = dataSource;
        this.root.addEventListener("click", (e) => {
            let button = e.target.closest("button[data-index]");
            if(button != null)
                this._scrollTo(this.dataSource.shownSections[button.dataset.index]);
        });
        dataSource.addEventListener("pageadded", () => this.refresh(), this._signal);
        new ResizeObserver(() => fitChipsToLine(this.root)).observe(this.root);
        this.refresh();
    }

    refresh()
    {
        let sections = this.dataSource.shownSections;
        this.root.replaceChildren(...sections.map((section, index) => {
            let chip = document.createElement("span");
            chip.className = "n-related-chip";

            let button = document.createElement("button");
            button.type = "button";
            button.className = "n-related-tag";
            button.dataset.index = index;
            button.textContent = section.translation ?? section.tag;
            button.title = section.tag;
            chip.append(button);
            return chip;
        }));
        this.root.hidden = sections.length < 2;
        fitChipsToLine(this.root);
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
