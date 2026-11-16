// The related tags Pixiv sends with a tag search, as one line of chips in the desktop header.
// A click adds the tag to the search, Shift+click searches it alone, and the − on hover excludes
// it.  Right-click saves the tag as a saved search, or unsaves it, and saved tags are drawn as
// filled pills.  A data source can give each tag a class with relatedTagClass(tag), like the
// Gelbooru posts list's tag categories.  The line takes the space left after the filter bar, or a line of its own when too little
// is left, and shows only the chips that fit.  See docs/design.md "搜索".

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { createRefineButtons } from '/vview/next/tag-refine.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';

const MAX_CHIPS = 12;

export default class RelatedTagsRow extends Widget
{
    constructor({ dataSource, maxChips=MAX_CHIPS, ...options })
    {
        super({ ...options, template: `
            <div class=n-related-tags role=group aria-label="相关标签" hidden></div>
        `});

        this.dataSource = dataSource;
        this.maxChips = maxChips;
        this.dataSource.addEventListener("updated", () => this.refresh(), this._signal);
        ppixiv.settings.addEventListener("search_related_tags", () => this.refresh(), this._signal);
        window.addEventListener("tag-translations-changed", () => { this._shownKey = null; this.refresh(); }, this._signal);
        window.addEventListener("recent-tag-searches-changed", () => this._markSaved(), this._signal);

        // Right-click toggles the tag as a saved search, like the search box's pin.  The header
        // has ppixiv's own menu off, so this only replaces the browser's menu.
        this.root.addEventListener("contextmenu", (e) => {
            let link = e.target.closest(".n-related-tag");
            if(link == null)
                return;

            e.preventDefault();
            let tag = link.dataset.tag;
            if(SavedSearchTags.groupNameForTag(tag) != null)
            {
                SavedSearchTags.remove(tag);
                ppixiv.message.show(`已取消保存「${link.textContent}」`);
            }
            else
            {
                let group = SavedSearchTags.save(tag);
                ppixiv.message.show(`已保存「${link.textContent}」到「${group == "Saved tags"? "已保存的标签":group}」`);
            }
        });

        this.root.addEventListener("click", (e) => {
            let link = e.target.closest(".n-related-tag");
            if(link == null || (!e.shiftKey && !e.altKey))
                return;

            // Shift searches the tag alone.  Alt excludes it, as on the viewer's tags; left to
            // the browser, an Alt click would download the link.
            e.preventDefault();
            e.stopPropagation();
            helpers.navigate(e.altKey?
                helpers.getArgsForTagRefine(link.dataset.tag, ppixiv.plocation, { exclude: true }):
                helpers.getArgsForTagSearch(link.dataset.tag, ppixiv.plocation));
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

        let classes = candidates.map((tag) => this.dataSource.relatedTagClass?.(tag) ?? null);
        let key = JSON.stringify([candidates, classes]);
        if(key == this._shownKey)
            return;
        this._shownKey = key;

        let translations = await ppixiv.tagTranslations.getTranslations([...candidates, ...search], "en", { lookups: this.maxChips });
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
            if(tags.length == this.maxChips)
                break;
        }

        this.root.replaceChildren();
        for(let tag of tags)
        {
            let chip = document.createElement("span");
            chip.className = "n-related-chip";

            let link = document.createElement("a");
            link.className = "n-related-tag";
            let tagClass = classes[candidates.indexOf(tag)];
            if(tagClass)
                link.classList.add(tagClass);
            link.href = helpers.getArgsForTagRefine(tag, this.dataSource.url);
            link.dataset.tag = tag;
            link.textContent = translations[tag] ?? tag;

            // Only the − here: the chip itself is the +.
            let refine = createRefineButtons(tag);
            refine.querySelector("[data-refine=add]").remove();
            chip.append(link, refine);
            this.root.appendChild(chip);
        }

        this.root.hidden = tags.length == 0;
        this._markSaved();
    }

    _markSaved()
    {
        for(let link of this.root.querySelectorAll(".n-related-tag"))
        {
            let saved = SavedSearchTags.groupNameForTag(link.dataset.tag) != null;
            link.classList.toggle("saved", saved);
            link.title = `${link.dataset.tag}\n右键${saved? "取消保存":"保存"}`;
        }
        this._fitLine();
    }

    _fitLine() { fitChipsToLine(this.root); }
}

// Hide the chips of a line like this one that wrapped past its first line, so it never takes
// two lines.  next/tag-sections.js uses it too.
export function fitChipsToLine(root)
{
    let chips = [...root.children];
    for(let chip of chips)
        chip.hidden = false;

    let top = chips[0]?.offsetTop;
    for(let chip of chips)
        chip.hidden = chip.offsetTop > top;
}
