// File names for downloads.
//
// Upstream names downloads "<user> - <id> - <title>.<ext>", with " #<page>" after the ID when one
// page of a multi-page work is saved.  The download_filename setting replaces that with a template:
//
//   {author} {author_id} {id} {title} {page} {pages} {date}
//
// {page} starts at 1 and is empty for ZIPs and animations.  A part in <angle brackets> is left out
// when a field inside it is empty, so "{id}<_p{page}> {title}" gives "123_p1 标题.png" for an image
// and "123 标题.zip" for a ZIP.

export const FILENAME_FIELDS = [
    ["author", "作者名"],
    ["author_id", "作者 ID"],
    ["id", "作品 ID"],
    ["title", "标题"],
    ["page", "页码，从 1 开始，ZIP 和动图为空"],
    ["pages", "总页数"],
    ["date", "投稿日期"],
];

export const FILENAME_MAX_LENGTH = 180;

// Return the file name for template and fields, or null if the template gives an empty name.
// fields has the keys of FILENAME_FIELDS and ext.
export function renderFilename(template, fields)
{
    let value = (key) => Object.hasOwn(fields, key)? fields[key]:null;
    let expand = (text) => text.replace(/\{(\w+)\}/g, (m, key) => value(key) ?? m);
    let name = template.replace(/<([^<>]*)>|\{(\w+)\}/g, (m, inner, key) => {
        if(inner == null)
            return value(key) ?? m;
        return [...inner.matchAll(/\{(\w+)\}/g)].some(([, key]) => value(key) === "")? "":expand(inner);
    });

    // Characters Windows doesn't allow, and control characters.
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_").replace(/\s+/g, " ");

    // Cut at FILENAME_MAX_LENGTH characters, and keep the whole name within the 255 bytes and
    // 255 UTF-16 units file systems allow.  Cut between graphemes so emoji stay whole.
    let suffix = `.${fields.ext}`;
    let encoder = new TextEncoder();
    let bytes = encoder.encode(suffix).length, units = suffix.length, points = 0;
    let cut = "";
    let segments = typeof Intl.Segmenter == "function"?
        new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name):name;
    for(let entry of segments)
    {
        let char = typeof entry == "string"? entry:entry.segment;
        let size = encoder.encode(char).length;
        let length = [...char].length;
        if(points + length > FILENAME_MAX_LENGTH || bytes + size > 255 || units + char.length > 255)
            break;
        cut += char;
        bytes += size;
        units += char.length;
        points += length;
    }

    // Leading dots hide files, and trailing dots and spaces are dropped by Windows.
    name = cut.replace(/^[\s.]+/, "").replace(/[\s.]+$/, "");
    return name? `${name}.${fields.ext}`:null;
}

function formatDate(value)
{
    let date = new Date(value);
    if(isNaN(date))
        return "";
    let pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Return the name to save a download as.
//
// mediaInfo is the work's info.  page is the 0-based page for a single page, or null for a ZIP or
// an animation.  singlePageOfMany is true when one page of a multi-page work is saved.
export function downloadFilename({ mediaInfo, userName, page=null, singlePageOfMany=false, ext })
{
    let template = ppixiv.settings.get("download_filename")?.trim();
    if(template)
    {
        let name = renderFilename(template, {
            author: userName ?? mediaInfo.userName ?? "",
            author_id: String(mediaInfo.userId ?? ""),
            id: String(mediaInfo.illustId),
            title: mediaInfo.illustTitle ?? "",
            page: page == null? "":String(page + 1),
            pages: String(mediaInfo.pageCount ?? mediaInfo.mangaPages?.length ?? ""),
            date: formatDate(mediaInfo.createDate),
            ext,
        });
        if(name)
            return name;
    }

    let filename = `${userName} - ${mediaInfo.illustId}`;
    if(singlePageOfMany && page != null)
        filename += ` #${page + 1}`;
    return `${filename} - ${mediaInfo.illustTitle}.${ext}`;
}
