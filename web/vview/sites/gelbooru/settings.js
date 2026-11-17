// The Gelbooru page of the settings dialog: the account the API key belongs to, reading the key
// again, voting with favorites, and Chinese tag names.  The key itself is never shown.
import { MenuOptionButton, MenuOptionToggleSetting } from '/vview/widgets/menu-option.js';
import * as api from '/vview/sites/gelbooru/api.js';

function accountText()
{
    let userId = api.userId();
    return userId? `用户 ID ${userId}，已保存 API key。`:"没有保存 API key。";
}

export function fillSettingsPage(globalOptions)
{
    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "显示图片注释",
        setting: "gelbooru_show_notes",
        explanationEnabled: "显示翻译注释的框，悬停或轻点查看内容。看图时按 N 切换。",
        explanationDisabled: "隐藏图片上的注释框。看图时按 N 切换。",
    });

    let account = new MenuOptionButton({
        ...globalOptions,
        label: "重新读取 API key",
        explanationEnabled: () => `${accountText()}换了账号或在 Gelbooru 重置了 key 时，点这里从账号设置页重新读取。`,
        onclick: async () => {
            let credentials = await api.readCredentials().catch(() => undefined);
            ppixiv.message.show(credentials? "已重新读取 API key":
                credentials === undefined? "连不上 Gelbooru 的账号设置页，稍后再试":"没有读到 API key，请先登录 Gelbooru");
            account.refresh();
        },
    });

    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "收藏时同时点赞",
        setting: "gelbooru_upvote_on_favorite",
        explanationEnabled: "收藏时也给作品点赞（分数加 1），和 Gelbooru 自己的收藏按钮一样。取消收藏不会撤销点赞。",
        explanationDisabled: "只收藏，不点赞。",
    });

    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "最新排序的搜索标出上次看到的位置",
        setting: "following_last_seen_marker",
        explanationEnabled: "页头显示同一搜索上次之后的新作件数，并标出“上次看到这里”。两次访问相隔超过两小时才移动分界。",
        explanationDisabled: "不显示件数和标记，访问记录照常更新。",
    });

    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "标签显示中文名",
        setting: "gelbooru_tag_chinese_names",
        explanationEnabled: "标签库里有中文名的标签显示中文，鼠标停在上面能看到原标签。搜索和链接仍用原标签。",
        explanationDisabled: "标签按 Gelbooru 的原样显示。",
    });
}
