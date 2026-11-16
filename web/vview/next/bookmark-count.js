// The minimum bookmark counts offered for searches (Pixiv's blt), in the search page's 收藏数 menu
// and the 新搜索的收藏数 setting.  Pixiv takes any number, so both also have 自定义…, which asks
// for a count in thousands (promptBookmarkCount in widgets/prompts.js).

export const BOOKMARK_COUNTS = [100, 250, 500, 1000, 2500, 5000, 10000, 20000];

export function bookmarkCountLabel(count)
{
    if(count >= 10000 && count % 10000 == 0)
        return `${count / 10000}万+`;
    return `${count}+`;
}

// Parse "3" or "3k" as 3000, "1.5" as 1500, and "2w" or "2万" as 20000.  Return null if text
// isn't a positive count.
export function parseBookmarkCount(text)
{
    let match = text.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(k|w|万)?$/);
    if(match == null)
        return null;

    let count = Math.round(parseFloat(match[1]) * (match[2] == "w" || match[2] == "万"? 10000:1000));
    return count > 0? count:null;
}
