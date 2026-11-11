// A text button that follows a user, shown next to the author's name.
//
// Upstream only offers following inside the avatar's dropdown, and marks a followed user with a
// small eye on the avatar.  See docs/design.md.

import Widget from '/vview/widgets/widget.js';
import Actions from '/vview/misc/actions.js';

export default class FollowButton extends Widget
{
    constructor({
        // Called when the button is clicked while the user is already followed.
        onFollowedClick=null,
        ...options
    }={})
    {
        super({
            ...options,
            template: `<button type=button class=n-follow hidden></button>`,
        });

        this._onFollowedClick = onFollowedClick;
        this._userId = null;
        this.root.addEventListener("click", this._clicked);

        ppixiv.userCache.addEventListener("usermodified", (e) => {
            if(e.userId == this._userId)
                this._refresh();
        }, this._signal);
    }

    setUserId(userId)
    {
        if(userId == this._userId)
            return;

        this._userId = userId;
        this._refresh();
    }

    async _refresh()
    {
        let userId = this._userId;
        let ours = userId != null && userId == ppixiv.pixivInfo?.userId;
        if(userId == null || ours || ppixiv.native)
        {
            this.root.hidden = true;
            return;
        }

        let userInfo = ppixiv.userCache.getUserInfoSync(userId);
        if(userInfo == null)
        {
            this.root.hidden = true;
            userInfo = await ppixiv.userCache.getUserInfo(userId);
            if(userId != this._userId)
                return;
        }

        let followed = Boolean(userInfo?.isFollowed);
        this.root.hidden = userInfo == null;
        this.root.classList.toggle("followed", followed);
        this.root.textContent = followed? "已关注":"关注";
    }

    _clicked = async(e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        let userInfo = ppixiv.userCache.getUserInfoSync(this._userId);
        if(userInfo?.isFollowed)
        {
            this._onFollowedClick?.();
            return;
        }

        this.root.disabled = true;
        try {
            await Actions.follow(this._userId, null);
        } finally {
            this.root.disabled = false;
        }
    }
}
