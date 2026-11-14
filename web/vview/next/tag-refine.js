// Adding a tag to the current tag search, or excluding it, from the viewer's tag pills, the
// related tags dropdown and the related tags row.  See docs/design.md "搜索".

import { helpers } from '/vview/misc/helpers.js';

// Return the + and − links that add tag to the current tag search or exclude it, or null when
// the current list isn't a tag search.
export function createRefineButtons(tag)
{
    let addUrl = helpers.getArgsForTagRefine(tag, ppixiv.plocation);
    if(addUrl == null)
        return null;

    let buttons = document.createElement("span");
    buttons.className = "n-tag-refine";
    for(let [exclude, icon, title] of [[false, "mat:add", "加到当前搜索"], [true, "mat:remove", "从当前搜索排除"]])
    {
        let a = document.createElement("a");
        a.className = "n-tag-refine-button";
        a.href = exclude? helpers.getArgsForTagRefine(tag, ppixiv.plocation, { exclude }):addUrl;
        a.title = title;
        a.setAttribute("aria-label", `${title}：${tag}`);
        a.dataset.refine = exclude? "exclude":"add";
        a.innerHTML = helpers.createIcon(icon);

        // The app's link handler skips Alt clicks and the browser downloads an Alt-clicked link,
        // so do here what a plain click does.
        a.addEventListener("click", (e) => {
            if(e.button != 0 || !e.altKey)
                return;
            e.preventDefault();
            e.stopPropagation();
            helpers.navigate(helpers.getArgsForTagRefine(tag, ppixiv.plocation, { exclude }));
        });
        buttons.appendChild(a);
    }
    return buttons;
}

// Handle a click on a tag link with a modifier: Shift adds the tag to the current search, Alt
// excludes it.  Return true if the click was handled.  Alt clicks reach no other handler, since
// the app's link handler skips them and the browser would download the link.
export function handleRefineClick(e, tag)
{
    if(!e.shiftKey && !e.altKey)
        return false;

    let args = helpers.getArgsForTagRefine(tag, ppixiv.plocation, { exclude: e.altKey });
    if(args == null)
        return false;

    e.preventDefault();
    e.stopPropagation();
    helpers.navigate(args);
    return true;
}
