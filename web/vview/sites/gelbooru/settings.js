// The Gelbooru page of the settings dialog: the account the API key belongs to, reading the key
// again, and voting with favorites.  The key itself is never shown.
import { MenuOptionButton, MenuOptionToggleSetting } from '/vview/widgets/menu-option.js';
import * as api from '/vview/sites/gelbooru/api.js';

function accountText()
{
    let userId = api.userId();
    return userId? `用户 ID ${userId}，已保存 API key。`:"没有保存 API key。";
}

export function fillSettingsPage(globalOptions)
{
    let account = new MenuOptionButton({
        ...globalOptions,
        label: "重新读取 API key",
        explanationEnabled: () => `${accountText()}换了账号或在 Gelbooru 重置了 key 时，点这里从账号设置页重新读取。`,
        onclick: async () => {
            let credentials = await api.readCredentials().catch(() => null);
            ppixiv.message.show(credentials? "已重新读取 API key":"没有读到 API key，请先登录 Gelbooru");
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
}
