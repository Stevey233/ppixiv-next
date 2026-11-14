// The related tags Pixiv sends with a tag search, as one line of chips in the desktop header.
// A click adds the tag to the search, Shift+click searches it alone, and the − on hover excludes
// it.  The line takes the space left after the filter bar, or a line of its own when too little
// is left, and shows only the chips that fit.  See docs/design.md "搜索".

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { createRefineButtons } from '/vview/next/tag-refine.js';

const MAX_CHIPS = 12;

export default class RelatedTagsRow extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=n-related-tags role=group aria-label="相关标签" hidden></div>
        `});

        this.dataSource = dataSource;
        this.dataSource.addEventListener("updated", () => this.refresh(), this._signal);
        ppixiv.settings.addEventListener("search_related_tags", () => this.refresh(), this._signal);

        this.root.addEventListener("click", (e) => {
            let link = e.target.closest(".n-related-tag");
            if(link == null || !e.shiftKey)
                return;

            e.preventDefault();
            e.stopPropagation();
            helpers.navigate(helpers.getArgsForTagSearch(link.dataset.tag, ppixiv.plocation));
        });

        new ResizeObserver(() => this._fitLine()).observe(this.root);
        this.refresh();
    }

    async refresh()
    {
        let search = (helpers.pixiv.getSearchTagsFromUrl(this.dataSource.url) ?? "").split(/\s+/);
        let tags = (this.dataSource.relatedTags ?? [])
            .filter((tag) => !search.includes(tag) && !search.includes(`-${tag}`))
            .slice(0, MAX_CHIPS);
        if(!ppixiv.settings.get("search_related_tags"))
            tags = [];

        let key = JSON.stringify(tags);
        if(key == this._shownKey)
            return;
        this._shownKey = key;

        let translations = await ppixiv.tagTranslations.getTranslations(tags, "en");
        if(key != this._shownKey)
            return;

        this.root.replaceChildren();
        for(let tag of tags)
        {
            let chip = document.createElement("span");
            chip.className = "n-related-chip";

            let link = document.createElement("a");
            link.className = "n-related-tag";
            link.href = helpers.getArgsForTagRefine(tag, this.dataSource.url);
            link.dataset.tag = tag;
            link.textContent = translations[tag] ?? tag;
            link.title = tag;

            // Only the − here: the chip itself is the +.
            let refine = createRefineButtons(tag);
            refine.querySelector("[data-refine=add]").remove();
            chip.append(link, refine);
            this.root.appendChild(chip);
        }

        this.root.hidden = tags.length == 0;
        this._fitLine();
    }

    // Hide the chips that wrapped past the first line, so the row never takes two lines.
    _fitLine()
    {
        let chips = [...this.root.children];
        for(let chip of chips)
            chip.hidden = false;

        let top = chips[0]?.offsetTop;
        for(let chip of chips)
            chip.hidden = chip.offsetTop > top;
    }
}
