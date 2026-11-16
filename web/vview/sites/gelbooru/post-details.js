// The Gelbooru lines of the viewer's info panel: score, rating, uploader and date, source, and
// the post's parent and children.  The panel's own line above them has the age and the size.
import { helpers } from '/vview/misc/helpers.js';

const RATING_LABELS = {
    general: "全年龄",
    sensitive: "轻微",
    questionable: "擦边",
    explicit: "R-18",
};

// A posts list for a query, without the current list's conditions.
function searchUrl(query)
{
    let args = new helpers.args("/index.php?page=post&s=list#ppixiv");
    args.query.set("tags", query);
    return args.url.toString();
}

// Return the Pixiv artwork ID of a Pixiv page or image URL, or null.
export function pixivArtworkId(url)
{
    let host = url.hostname.replace(/^www\./, "");
    if(host == "pixiv.net")
    {
        let match = /^\/(?:[a-z]{2}\/)?(?:artworks|i)\/(\d+)/.exec(url.pathname);
        if(match)
            return match[1];
        if(url.pathname == "/member_illust.php" && /^\d+$/.test(url.searchParams.get("illust_id") ?? ""))
            return url.searchParams.get("illust_id");
        return null;
    }
    if(host.endsWith("pximg.net"))
        return /\/(\d+)_p\d+/.exec(url.pathname)?.[1] ?? null;
    return null;
}

// Parse a post's source as a URL, or return null when it's plain text.  Sources without a scheme
// ("pixiv.net/artworks/1") are common.
function parseSource(source)
{
    if(/^https?:\/\//i.test(source))
        return URL.parse(source);
    if(/^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(source))
        return URL.parse(`https://${source}`);
    return null;
}

// The source line: a Pixiv artwork as a link to it on pixiv.net, other URLs as they are, and
// anything else as text.
function sourceElement(source)
{
    let url = parseSource(source);
    if(url == null)
    {
        let span = document.createElement("span");
        span.textContent = source;
        return span;
    }

    let a = document.createElement("a");
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    let pixivId = pixivArtworkId(url);
    a.href = pixivId? `https://www.pixiv.net/artworks/${pixivId}`:url.toString();
    a.textContent = pixivId? `pixiv.net/artworks/${pixivId}`:source;
    a.className = "gb-source";
    return a;
}

function link(text, href)
{
    let a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    return a;
}

function formatDate(value)
{
    let date = new Date(value);
    let pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Fill container (a <dl>) with the details of mediaInfo, a Gelbooru post.
export function fillPostDetails(container, mediaInfo)
{
    let rows = [];
    let add = (label, ...values) => {
        let dt = document.createElement("dt");
        dt.textContent = label;
        let dd = document.createElement("dd");
        dd.append(...values);
        rows.push(dt, dd);
    };

    add("分数", String(mediaInfo.score ?? 0));
    add("分级", RATING_LABELS[mediaInfo.rating] ?? mediaInfo.rating ?? "");

    // The uploader links to their uploads (user:<name>).
    let uploaded = [];
    if(mediaInfo.uploader)
        uploaded.push(link(mediaInfo.uploader, searchUrl(`user:${mediaInfo.uploader}`)), " · ");
    uploaded.push(formatDate(mediaInfo.createDate));
    add("上传", ...uploaded);

    if(mediaInfo.source)
        add("来源", sourceElement(mediaInfo.source));

    // A post with a parent lists its parent's family, and a parent its own.
    let parent = mediaInfo.parentId ?? (mediaInfo.hasChildren? mediaInfo.illustId:null);
    if(parent != null)
    {
        let related = link(mediaInfo.parentId? "查看父作品和同组作品":"查看子作品", searchUrl(`parent:${parent}`));
        related.className = "gb-related";
        add("关联作品", related);
    }

    container.replaceChildren(...rows);
}

// The post's own page on Gelbooru.
export function originalPostUrl(illustId)
{
    return `/index.php?page=post&s=view&id=${encodeURIComponent(illustId)}#no-ppixiv`;
}
