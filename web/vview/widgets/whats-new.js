import { helpers } from '/vview/misc/helpers.js';
import widget from '/vview/widgets/widget.js';

// This fork's changelog, newest first, shown on the settings page 更新日志.  Upstream's English
// history is about upstream's releases and is replaced by this.  See docs/design.md.
//
// Each entry is one build Stevey installs.  The id is the date it was released, plus ".2", ".3"
// for later builds on the same day, so ids sort as strings.  Add a new entry at the top for each
// release: the newest id is what the "new" marker compares against.
let changelog = [
    {
        id: "2026-11-12.2",
        title: "筛选重做",
        items: [
            "标签搜索、最新和作者页上，插画、漫画、动图筛选交给 Pixiv 服务器来筛，每页都是满的。以前开着\"漫画\"搜标签，一页 60 张只剩 10 张左右。",
            "筛选条新增\"动图\"。\"插画\"仍然包含动图，和 Pixiv 的分法一致。",
            "原版在标签搜索、最新和作者页上的类型按钮和\"隐藏 AI\"按钮去掉了，筛选只在筛选条上选。旧的书签和链接照常能用，会换成对应的筛选。",
            "三个\"隐藏\"（隐藏 AI、隐藏已收藏、隐藏看过的）按列表记住：在推荐里开了隐藏看过的，下次打开推荐还是开着，收藏里不受影响。自己的收藏里不再出现\"隐藏已收藏\"。",
            "修了筛选翻页的三个问题：带筛选的列表从中间一页打开时，往上滚加载不出前面的页；关注的新作和最新在有新作品插进来时会提前到底；一页只剩重复作品时会一直往下翻，不会暂停。",
            "看过的作品很多时启动更快：记录了 5 万件看过的作品时，第一张缩略图出现的时间从约 180 毫秒降到约 90 毫秒。",
            "鼠标停在缩略图上时出现一颗心，点一下就收藏。",
            "下拉菜单和对话框的样式修正。",
            "更新日志改成这份中文记录。有新内容时，左边页边索引的设置按钮上有一个蓝点，打开设置会先显示这一页。",
        ],
    },
    {
        id: "2026-11-12",
        title: "右键菜单重做",
        items: [
            "右键菜单改成带文字的竖排列表，按用途分组：收藏、去处、缩放、全屏。设置的\"看图\"页可以换成图标条或十字两种样式。",
            "菜单总留在窗口里，靠近窗口边缘打开时不会被切掉一块。",
            "在作品列表里右键再左键，光标落在尺寸日期那一行，不会误点收藏。",
            "筛选后点\"继续查找\"找到的作品会显示出来；从 /tags 网址打开的标签页也保留筛选。",
            "离开看图界面时，页码不再残留在列表上。",
        ],
    },
    {
        id: "2026-11-11",
        title: "第一版",
        items: [
            "新界面：左边竖排的页边索引一次点击切换推荐、关注、收藏、排行、最新，其他列表在 ⋯ 菜单里。页头常驻标签搜索框，按 / 聚焦，往下滚时页头收起。支持浅色主题。",
            "每个作品列表都有筛选条：插画、漫画，竖图、横图，单页、多页，隐藏 AI、隐藏已收藏、隐藏看过的。筛选写在网址里，后退和刷新都会保留。",
            "看过的作品缩略图变暗，记录和 ppixiv-zh 共用。",
            "缩略图一直显示完整构图，鼠标停留的和刚看过的那张四角有裁切标记。排行榜标出名次。",
            "看图：作品信息在右边的信息栏里，宽窗口默认展开，按 I 收起或展开。多页作品左下角印着页码，点它打开全部页面。作者名旁边有关注按钮，收藏按钮带文字和收藏数。",
            "右键菜单的收藏标签和点赞换成\"收藏并下载原图\"和\"相似作品\"。",
            "来自 ppixiv-zh：中文界面、标签中文译名、下载文件名模板、高清缩略图、悬停预加载。",
            "修正原版点\"下载全部\"会下载两次 ZIP。",
        ],
    },
];

export default class WhatsNew extends widget
{
    static get _latestId() { return changelog[0].id; }

    // Return true if the changelog has entries the user hasn't seen.
    static hasUnread()
    {
        return ppixiv.settings.get("changelog_last_viewed") < WhatsNew._latestId;
    }

    // Set html[data-whats-new-updated] while the changelog has unread entries.  This marks the
    // settings buttons, and updates when the changelog is viewed, including from another tab.
    static handleLastViewedVersion()
    {
        let refresh = () => {
            helpers.html.setDataSet(document.documentElement.dataset, "whatsNewUpdated", WhatsNew.hasUnread());
        };
        refresh();
        ppixiv.settings.addEventListener("changelog_last_viewed", refresh);
    }

    constructor({...options}={})
    {
        super({...options, template: `
            <div class=whats-new-dialog>
                <div class=contents></div>
                <a class=upstream-changelog href="https://github.com/ppixiv/ppixiv/releases" target=_blank rel=noopener>原版 ppixiv 的更新记录（英文）</a>
            </div>
        `});

        ppixiv.settings.set("changelog_last_viewed", WhatsNew._latestId);

        let contents = this.root.querySelector(".contents");
        for(let { id, title, items } of changelog)
        {
            let entry = this.createTemplate({name: "entry", html: `
                <section class=changelog-entry>
                    <h3><span class=date></span><span class=title></span></h3>
                    <ul></ul>
                </section>
            `});
            entry.querySelector(".date").textContent = id.slice(0, 10);
            entry.querySelector(".title").textContent = title;
            let list = entry.querySelector("ul");
            for(let text of items)
            {
                let item = document.createElement("li");
                item.textContent = text;
                list.appendChild(item);
            }
            contents.appendChild(entry);
        }
    }
}
