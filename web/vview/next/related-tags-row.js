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
        let search = (helpers.pixiv.getSearchTagsFromUrl(this.dataSource.url) ?? "").split(/\s+/)
            .map((tag) => tag.replace(/^-/, "")).filter((tag) => tag != "");
        let candidates = (this.dataSource.relatedTags ?? []).filter((tag) => !search.includes(tag));
        if(!ppixiv.settings.get("search_related_tags"))
            candidates = [];

        let key = JSON.stringify(candidates);
        if(key == this._shownKey)
            return;
        this._shownKey = key;

        let translations = await ppixiv.tagTranslations.getTranslations([...candidates, ...search], "en");
        if(key != this._shownKey)
            return;

        // Different tags can share a translated name, and Pixiv lists other spellings of the
        // searched tag first.  Show each name once, and none that the search already has.
        let nameOf = (tag) => (translations[tag] ?? tag).toLowerCase();
        let names = new Set(search.flatMap((tag) => [tag.toLowerCase(), nameOf(tag)]));
        let tags = [];
        for(let tag of candidates)
        {
            if(names.has(nameOf(tag)))
                continue;
            names.add(nameOf(tag));
            tags.push(tag);
            if(tags.length == MAX_CHIPS)
                break;
        }

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
