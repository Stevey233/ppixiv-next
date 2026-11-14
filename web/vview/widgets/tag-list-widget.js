// A list of tags, with translations in popups where available.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { createRefineButtons, handleRefineClick } from '/vview/next/tag-refine.js';

export default class TagListWidget extends Widget
{
    constructor({...options})
    {
        super({
            ...options,
            template: `
                <div class="tag-list box-button-row"></div>
            `
        });

        // Shift+click adds a tag to the current tag search, Alt+click excludes it.
        this.root.addEventListener("click", (e) => {
            let link = e.target.closest(".tag-entry[data-refine]");
            if(link)
                handleRefineClick(e, link.dataset.tag);
        });

        // The + and − of a pill hang off its right end, or its left end if the list's edge is
        // too close.
        let placeRefine = (e) => {
            let pill = e.target.closest?.(".n-tag-pill");
            if(pill == null)
                return;
            let room = this.root.getBoundingClientRect().right - pill.getBoundingClientRect().right;
            helpers.html.setClass(pill, "n-refine-left", room < pill.querySelector(".n-tag-refine").offsetWidth);
        };
        this.root.addEventListener("pointerover", placeRefine);
        this.root.addEventListener("focusin", placeRefine);
    };

    formatTagLink(tag)
    {
        return helpers.getArgsForTagSearch(tag, ppixiv.plocation);
    };

    async set(mediaInfo)
    {
        this.mediaInfo = mediaInfo;
        this.refresh();
    }

    async refresh()
    {
        if(this.mediaInfo == null)
            return;

        let tags = [];
        let showR18 = this.mediaInfo == 1;
        let showR18G = this.mediaInfo == 1;
        for(let tag of this.mediaInfo.tagList)
        {
            // If R-18 is in the list, remove it so we can add them in the position we want.
            // This should always match xRestrict, but we check both just to be safe.
            if(tag == "R-18")
                showR18 = true;
            else if(tag == "R-18G")
                showR18G = true;
            else
                tags.push({tag});
        }

        // Add "AI" to the list.
        let showAI = this.mediaInfo.aiType == 2;
        if(showAI)
            tags.splice(0, 0, {ai: true});
        
        if(showR18G)
            tags.splice(0, 0, {tag: "R-18G"});
        else if(showR18)
            tags.splice(0, 0, {tag: "R-18"});

        // The links keep the current search's conditions, so they change with the list too.
        let list = helpers.getCanonicalUrl(ppixiv.plocation).url.toString();

        // Short circuit if the tag list isn't changing, since IndexedDB is really slow.
        if(this._currentTags != null && JSON.stringify(this._currentTags) == JSON.stringify(tags) && this._currentList == list)
            return;

        // Look up tag translations.
        let tagList = tags;
        let translatedTags = await ppixiv.tagTranslations.getTranslations(this.mediaInfo.tagList, "en");
        
        // Stop if the tag list changed while we were reading tag translations.
        if(tagList != tags)
            return;

        this._currentTags = tags;
        this._currentList = list;

        // Remove any old tag list and create a new one.
        helpers.html.removeElements(this.root);

        for(let {tag, ai} of tagList)
        {
            if(ai)
                tag = "AI-generated";

            let translatedTag = tag;
            if(translatedTags[tag])
                translatedTag = translatedTags[tag];

            let link = this.formatTagLink(tag);
            if(ai)
                link = null;

            let a = helpers.createBoxLink({
                label: translatedTag,
                classes: ["tag-entry"],
                link,
                asElement: true,
            });

            a.dataset.tag = tag;

            // On a tag search, a pill also has + and − to add or exclude the tag.  Not for the
            // R-18 and AI pills.
            let refine = ai || tag == "R-18" || tag == "R-18G"? null:createRefineButtons(tag);
            if(refine)
            {
                a.dataset.refine = "";
                let pill = document.createElement("span");
                pill.className = "n-tag-pill";
                pill.append(a, refine);
                this.root.appendChild(pill);
            }
            else
                this.root.appendChild(a);
        }
    }
}
