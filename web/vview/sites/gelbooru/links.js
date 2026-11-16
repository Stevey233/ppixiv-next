// Gelbooru links typed or pasted into the search box, the counterpart of misc/pixiv-links.js.  A
// post link opens the post, a list or favorites link opens that search with its conditions.
import { helpers } from '/vview/misc/helpers.js';

// Return { type: "illust", id } for a post URL, { type: "search", tags } for a list or
// favorites URL, or null.  The scheme, www., the pid and the hash are optional.
export function parseLink(text)
{
    text = text.trim();
    if(!/^(https?:\/\/)?(www\.)?gelbooru\.com\/\S*$/i.test(text))
        return null;

    let url = new URL(/^https?:/i.test(text)? text:`https://${text}`);
    let page = url.searchParams.get("page"), s = url.searchParams.get("s"), id = url.searchParams.get("id");
    if(url.pathname != "/index.php")
        return null;
    if(page == "post" && s == "view" && /^\d+$/.test(id ?? ""))
        return { type: "illust", id };
    if(page == "post" && s == "list")
        return { type: "search", tags: (url.searchParams.get("tags") ?? "").trim() };
    if(page == "favorites" && s == "view" && /^\d+$/.test(id ?? ""))
        return { type: "search", tags: `fav:${id}` };
    return null;
}

// A bare number may be a post ID, but it may also be a tag, so it's only offered.
export function idOffers(text)
{
    text = text.trim();
    return /^\d{3,}$/.test(text)? [{ type: "illust", id: text }]:[];
}

export function getArgsForLink(link)
{
    if(link.type == "illust")
        return new helpers.args(`/index.php?page=post&s=view&id=${link.id}#ppixiv`);

    let args = new helpers.args("/index.php?page=post&s=list#ppixiv");
    if(link.tags && link.tags != "all")
        args.query.set("tags", link.tags);
    return args;
}

// The canonical URL, which the search box shows when a link is picked from its dropdown.
export function getLinkUrl(link)
{
    let url = new URL(getArgsForLink(link).url);
    url.hash = "";
    return url.toString();
}

export function linkLabel(link)
{
    return link.type == "illust"? `打开帖子 ${link.id}`:`打开搜索 ${link.tags || "全部"}`;
}
