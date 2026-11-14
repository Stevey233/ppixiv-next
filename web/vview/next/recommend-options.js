// The option row shared by the three recommendation lists, 推荐作品, 收藏相关 and 常看标签: the
// group that switches between them, then the age modes.  推荐作品 keeps the mode in the query
// (Pixiv's own ?mode=), the other two in the hash, since they live under the top page's hash.
//
// 推荐作品 and 收藏相关 have 全部 / 全年龄 / R18.  常看标签 has only 全年龄 / R18, since Pixiv
// answers the two with separate lists (see data-sources/tag-feed.js).  Switching keeps the mode
// where it means something: R18 stays R18, 全部 and 全年龄 both open 常看标签's 全年龄, and its
// 全年龄 opens the others' 全年龄.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';

const SOURCES = [
    ["discovery", "Pixiv 推荐", "Pixiv 自己的推荐", (query) => `/discovery${query}#ppixiv`],
    ["from-bookmarks", "收藏相关", "按最近 10 件收藏找相关作品，几件收藏都指向的排在前面", (query) => `/#ppixiv/from-bookmarks${query}`],
    ["tag-feed", "常看标签", "Pixiv 首页按你常看的标签推荐的作品，按标签分组", (query) => `/#ppixiv/tag-feed${query}`],
];

// Return "all", "safe" or "r18" for dataSource.
function currentMode(dataSource)
{
    if(dataSource.name == "discovery")
        return dataSource.url.searchParams.get("mode") || "all";
    let mode = dataSource.args.hash.get("mode");
    if(dataSource.name == "tag-feed")
        return mode == "r18"? "r18":"safe";
    return mode || "all";
}

// Return the query that opens the list name in mode.
function modeQuery(name, mode)
{
    if(name == "tag-feed")
        return mode == "r18"? "?mode=r18":"";
    return mode != "all"? `?mode=${mode}`:"";
}

export default class RecommendOptions extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    ${ helpers.createBoxLink({label: "All",      popup: "Show all works",    dataType: "all" }) }
                    ${ helpers.createBoxLink({label: "All ages", popup: "All ages",          dataType: "safe" }) }
                    ${ helpers.createBoxLink({label: "R18",      popup: "R18",               dataType: "r18", classes: ["r18"] }) }
                </div>
            </div>
        `});

        let mode = currentMode(dataSource);
        let links = SOURCES.map(([name, label, popup, url]) => {
            let link = helpers.createBoxLink({ label, popup, link: url(modeQuery(name, mode)), asElement: true });
            link.classList.add("n-source-switch");
            helpers.html.setClass(link, "selected", name == dataSource.name);
            return link;
        });
        this.root.querySelector(".box-button-row").prepend(...links);

        let key = dataSource.name == "discovery"? "mode":"#mode";
        let defaultMode = dataSource.name == "tag-feed"? "safe":"all";
        if(dataSource.name == "tag-feed")
            this.root.querySelector("[data-type='all']").remove();
        for(let type of dataSource.name == "tag-feed"? ["safe", "r18"]:["all", "safe", "r18"])
            dataSource.setItem(this.root, { type, fields: {[key]: type}, defaults: {[key]: defaultMode} });
    }
}
