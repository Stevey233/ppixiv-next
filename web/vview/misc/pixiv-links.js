// Work and user links typed or pasted into the search box.  Pixiv has no tag that is a URL, so a
// search for one always came back empty; the search box opens what the link names instead.
import { helpers } from '/vview/misc/helpers.js';

// Return { type: "illust" | "user", id } for a Pixiv work or user URL, or null.
//
// Work: /artworks/N, /i/N, member_illust.php?illust_id=N.  User: /users/N (any trailing path),
// member.php?id=N.  The scheme, www., the /en/ prefix, the query and the hash are optional.
export function parsePixivLink(text)
{
    text = text.trim();
    if(!/^(https?:\/\/)?([\w-]+\.)?pixiv\.net\/\S*$/i.test(text))
        return null;

    let url = new URL(/^https?:/i.test(text)? text:`https://${text}`);
    let path = url.pathname.replace(/^\/en(?=\/)/, "");

    let match = /^\/(?:artworks|i)\/(\d+)/.exec(path);
    if(match)
        return { type: "illust", id: match[1] };

    match = /^\/users\/(\d+)(\/|$)/.exec(path);
    if(match)
        return { type: "user", id: match[1] };

    let id = url.searchParams.get("illust_id");
    if(path == "/member_illust.php" && /^\d+$/.test(id ?? ""))
        return { type: "illust", id };

    id = url.searchParams.get("id");
    if(path == "/member.php" && /^\d+$/.test(id ?? ""))
        return { type: "user", id };

    return null;
}

// A bare number long enough to be a work or user ID.  It may also be a tag, so it's only offered.
export function looksLikePixivId(text)
{
    return /^\d{5,}$/.test(text.trim());
}

// The page a link opens: the work in the viewer, or the artist's works.
export function getArgsForPixivLink({ type, id })
{
    if(type == "illust")
        return new helpers.args(`/artworks/${id}#ppixiv`);
    else
        return new helpers.args(`/users/${id}/artworks#ppixiv`);
}

// The canonical URL for a link, which the search box shows when one is picked from its dropdown.
export function getPixivLinkUrl({ type, id })
{
    return type == "illust"? `https://www.pixiv.net/artworks/${id}`:`https://www.pixiv.net/users/${id}`;
}
