// The option row shared by the three recommendation lists, 推荐作品, 收藏相关 and 常看标签: the
// group that switches between them, then 全部 / 全年龄 / R18.  Switching keeps the mode.
// 推荐作品 keeps the mode in the query (Pixiv's own ?mode=), the other two in the hash, since they
// live under the top page's hash.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';

const SOURCES = [
    ["discovery", "Pixiv 推荐", "Pixiv 自己的推荐", (query) => `/discovery${query}#ppixiv`],
    ["from-bookmarks", "收藏相关", "按最近 10 件收藏找相关作品，几件收藏都指向的排在前面", (query) => `/#ppixiv/from-bookmarks${query}`],
    ["tag-feed", "常看标签", "Pixiv 首页按你常看的标签推荐的作品，按标签分组", (query) => `/#ppixiv/tag-feed${query}`],
];

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

        let key = dataSource.name == "discovery"? "mode":"#mode";
        let mode = (key == "mode"? dataSource.url.searchParams.get("mode"):dataSource.args.hash.get("mode")) || "all";
        let query = mode != "all"? `?mode=${mode}`:"";
        let links = SOURCES.map(([name, label, popup, url]) => {
            let link = helpers.createBoxLink({ label, popup, link: url(query), asElement: true });
            link.classList.add("n-source-switch");
            helpers.html.setClass(link, "selected", name == dataSource.name);
            return link;
        });
        this.root.querySelector(".box-button-row").prepend(...links);

        for(let type of ["all", "safe", "r18"])
            dataSource.setItem(this.root, { type, fields: {[key]: type}, defaults: {[key]: "all"} });
    }
}
