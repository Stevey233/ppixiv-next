// The settings page 快捷键: every desktop keyboard and mouse shortcut, which nothing else in the
// interface lists.  Each row names the handler it comes from, so the list can be checked against
// the code.  See docs/design.md.

import Widget from '/vview/widgets/widget.js';

// Groups of [keys, what it does].  Keys are separated by spaces, alternatives by " / ".
const SHORTCUTS = [
    {
        title: "通用",
        rows: [
            ["?", "打开这一页"],                                   // next/nav-rail.js
            ["Alt+Enter", "全屏或退出全屏"],                        // context-menu.js _handleKeyEvent
        ],
    },
    {
        title: "列表",
        rows: [
            ["/", "聚焦搜索框"],                                    // screen-search.js handleKeydown
            ["Ctrl+滚轮", "调整缩略图大小"],                        // screen-search.js wheel
            ["按住右键+滚轮", "在多页作品的缩略图上翻页，这时点开的就是显示的那一页"],  // context-menu.js onwheel, next/thumb-pages.js
        ],
    },
    {
        title: "看图",
        rows: [
            ["← / ↑ / PageUp / 滚轮向上", "上一张，多页作品先往前翻页"],   // screen-illust.js handleKeydown, onwheel
            ["→ / ↓ / PageDown / 滚轮向下", "下一张，多页作品先往后翻页"],
            ["Shift+方向键 / Shift+滚轮", "跳过多页作品剩下的页，直接到上一件或下一件作品"],
            ["Home / End", "多页作品的第一页 / 最后一页"],            // viewer-images.js onkeydown
            ["I", "收起或展开信息栏"],                               // desktop-image-info.js handleKeydown
            ["Esc", "返回列表；开着对话框或下拉菜单时只关掉最上面那个"],   // context-menu.js _handleKeyEventForImage, dialog.js, dropdown.js
            ["按住左键", "在按下的位置放大，拖动查看细节，松开恢复"],     // desktop-viewer-images.js _pointerevent
            // These act on the viewer the right-click menu last opened over (context-menu.js show).
            ["Ctrl+= / Ctrl+-", "放大 / 缩小，在画上右键过一次之后才有效"],  // context-menu.js _handleKeyEvent
            ["Ctrl+0", "切换缩放，同上"],
            ["Ctrl+P", "打开或关闭自动平移"],                         // context-menu.js _handleKeyEventForImage
            ["Ctrl+C", "鼠标停在标题或说明上时，复制这段文字"],        // desktop-image-info.js handleKeydown
            ["双击", "全屏，要先在\"看图\"页打开\"双击全屏\""],         // screen-illust.js dblclick
        ],
    },
    {
        title: "动图",
        rows: [                                                     // viewer-ugoira.js onkeydown
            ["空格", "暂停或播放"],
            ["Q / W", "上一帧 / 下一帧"],
            ["Home / End", "回到开头 / 跳到最后一帧"],
            ["1 – 9", "播放速度：5 是正常速度，1 最慢（0.1 倍），9 最快（2 倍）"],
        ],
    },
    {
        title: "收藏、下载和关注",
        note: "收藏、点赞和下载在看图时作用于正在看的作品，在列表里作用于鼠标所在的缩略图。关注只在看图时有效，关注的是作品的作者。",
        rows: [                                                     // context-menu.js _handleKeyEventForImage, _handleKeyEventForUser
            ["Ctrl+B", "收藏，公开还是非公开按设置里的默认值"],
            ["Ctrl+Alt+B", "非公开收藏"],
            ["Ctrl+Shift+B", "取消收藏"],
            ["Ctrl+Alt+Shift+B", "给收藏加一个新标签"],
            ["Ctrl+V", "点赞"],
            ["Ctrl+S", "下载：单页作品下载原图，动图下载 MKV"],
            ["Ctrl+Alt+S", "多页作品下载 ZIP"],
            ["Ctrl+F", "关注作者，公开还是非公开按设置里的默认值"],
            ["Ctrl+Alt+F", "非公开关注"],
            ["Ctrl+Shift+F", "取消关注"],
        ],
    },
    {
        title: "右键菜单",
        rows: [                                                     // context-menu.js
            ["按住右键", "打开菜单，松开关闭"],
            ["Shift+右键", "浏览器自己的右键菜单"],
            ["按住右键+滚轮", "看图时缩放"],
        ],
    },
];

export class ShortcutsPage extends Widget
{
    constructor({...options}={})
    {
        super({...options, template: `<div class=shortcuts-page></div>`});

        for(let { title, note, rows } of SHORTCUTS)
        {
            let section = document.createElement("section");
            let heading = section.appendChild(document.createElement("h3"));
            heading.textContent = title;
            if(note)
            {
                let p = section.appendChild(document.createElement("p"));
                p.className = "note";
                p.textContent = note;
            }

            let list = section.appendChild(document.createElement("dl"));
            for(let [keys, text] of rows)
            {
                let dt = list.appendChild(document.createElement("dt"));
                for(let [idx, alternative] of keys.split(" / ").entries())
                {
                    if(idx > 0)
                        dt.append(" / ");
                    for(let [partIdx, part] of alternative.split("+").entries())
                    {
                        if(partIdx > 0)
                            dt.append("+");
                        let kbd = dt.appendChild(document.createElement("kbd"));
                        kbd.textContent = part;
                    }
                }

                let dd = list.appendChild(document.createElement("dd"));
                dd.textContent = text;
            }
            this.root.appendChild(section);
        }
    }
}
