// User lists (关注的用户, 推荐用户, 搜索用户) as one row per user: avatar, name, follow button,
// and the user's latest works.  See docs/design.md "用户列表".
//
// A data source with userRows returns user:<id> media IDs and registers each user's row here.
// SearchView gives each user a grid row of its own with a fixed size and builds it with
// createUserRow.  The works in a row are the grid's own thumbnail boxes, made by
// SearchView.createThumb, so everything that finds thumbnails with .thumbnail-box[data-id] (the
// quick heart, right button + wheel paging, seen dimming, hover preloading, the context menu)
// works on them unchanged.  The row itself is not a .thumbnail-box.

import FollowButton from '/vview/next/follow-button.js';
import { FollowWidget } from '/vview/widgets/user-widgets.js';
import { DropdownBoxOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';

const WORKS_PER_ROW = 3;
const rows = new Map();

// Register a user's row.  mediaIds are the user's works, with their media info already
// registered.  hiddenR18 counts works Pixiv masked for the account's R-18 setting.
// isFollowed, if known, seeds the user cache, so the follow buttons need no request per row.
export function registerUserRow({ userId, userName, profileImageUrl, comment="", mediaIds=[], hiddenR18=0, isFollowed=null })
{
    userId = String(userId);
    mediaIds = [...mediaIds].sort((lhs, rhs) => helpers.mediaId.parse(rhs).id - helpers.mediaId.parse(lhs).id);
    rows.set(userId, { userId, userName, profileImageUrl, comment, mediaIds, hiddenR18 });

    if(isFollowed != null && ppixiv.userCache.getUserInfoSync(userId) == null)
    {
        ppixiv.userCache.addUserData({
            userId, name: userName, imageBig: profileImageUrl, isFollowed: Boolean(isFollowed), partial: 0,
        });
    }
}

// A work in a row opens in its artist's list, so the viewer moves through that artist's works
// and not through the users.  This is the data sources' setUrlMediaId.  Return false if the work
// has no media info, to leave it to the default.
export function openWorkInArtistList(mediaId, args)
{
    let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
    if(info == null)
        return false;

    let [illustId, page] = helpers.mediaId.toIllustIdAndPage(mediaId);
    let view = args.hash.get("view");
    args.path = `/users/${info.userId}/artworks`;
    args.query = new URLSearchParams();
    args.hash = new URLSearchParams();
    args.state = {};
    if(view != null)
        args.hash.set("view", view);
    args.hash.set("illust_id", illustId);
    if(page != 0)
        args.hash.set("page", page + 1);
    return true;
}

// The height of the works strip, and of a whole row (16px above and below, and the 1px rule).
export function userRowStripHeight()
{
    return window.innerWidth < 1400? 160:200;
}

export function userRowHeight()
{
    return userRowStripHeight() + 33;
}

// "11/12" this year, "2024/3/5" before.
function formatDate(date)
{
    let d = new Date(date);
    if(isNaN(d))
        return null;
    let day = `${d.getMonth()+1}/${d.getDate()}`;
    return d.getFullYear() == new Date().getFullYear()? day:`${d.getFullYear()}/${day}`;
}

// Build the row for userId.  createWork(mediaId) returns a set up thumbnail box.  The result has
// userRow: { works: Map of media ID to thumbnail box, shutdown() }.
export function createUserRow({ userId, parent, createWork })
{
    let data = rows.get(userId);
    if(data == null)
        throw new Error(`Missing user row data for user ${userId}`);

    let stripHeight = userRowStripHeight();
    let userUrl = `/users/${userId}/artworks#ppixiv`;
    let row = document.createElement("div");
    row.className = "n-user-row";
    row.style.setProperty("--n-strip-height", `${stripHeight}px`);
    row.innerHTML = `
        <div class=n-user-row-info>
            <a class=n-user-row-avatar><img alt="" loading=lazy></a>
            <div class=n-user-row-text>
                <div class=n-user-row-head>
                    <a class=n-user-row-name></a>
                </div>
                <div class=n-user-row-comment></div>
                <div class=n-user-row-date></div>
            </div>
        </div>
        <div class=n-user-row-works></div>
    `;

    for(let a of row.querySelectorAll("a"))
    {
        a.href = userUrl;
        a.dataset.userId = userId;
    }
    row.querySelector(".n-user-row-avatar img").src = data.profileImageUrl ?? helpers.other.blankImage;
    row.querySelector(".n-user-row-name").textContent = data.userName ?? "";
    row.querySelector(".n-user-row-comment").textContent = data.comment ?? "";

    // The follow button, with the same rule as the artist header and the info panel: "已关注"
    // opens the follow menu and never unfollows in one click.
    let followButton = new FollowButton({
        container: row.querySelector(".n-user-row-head"),
        parent,
        onFollowedClick: () => menuOpener.visible = !menuOpener.visible,
    });
    let menuOpener = new DropdownBoxOpener({
        button: followButton.root,
        parent: followButton,
        createDropdown: ({...options}) => new FollowWidget({
            ...options,
            userId,
            close: () => menuOpener.visible = false,
        }),
    });
    followButton.setUserId(userId);

    let strip = row.querySelector(".n-user-row-works");
    let works = new Map();
    let note = (text, { empty=false, icon=null }={}) => {
        let div = document.createElement("div");
        div.className = "n-user-row-note";
        div.classList.toggle("empty", empty);
        if(icon)
            div.append(helpers.createIcon(icon, { asElement: true }));
        div.append(text);
        strip.append(div);
    };

    if(ppixiv.muting.isUserIdMuted(userId))
        note("已屏蔽的用户", { empty: true, icon: "mat:block" });
    else if(data.mediaIds.length == 0)
        note(data.hiddenR18? "作品都被隐藏（R-18）":"还没有公开作品", { empty: true });
    else
    {
        for(let mediaId of data.mediaIds.slice(0, WORKS_PER_ROW))
        {
            let box = createWork(mediaId);
            let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
            let aspectRatio = info?.width? info.width / info.height:1;
            aspectRatio = helpers.math.clamp(aspectRatio, 1/3, 3);
            box.style.setProperty("--thumb-width", `${Math.round(stripHeight * aspectRatio)}px`);
            box.style.setProperty("--thumb-height", `${stripHeight}px`);
            strip.append(box);
            works.set(mediaId, box);
        }

        if(data.mediaIds.length == 1)
            note("还没有其他作品");

        let newest = ppixiv.mediaCache.getMediaInfoSync(data.mediaIds[0], { full: false });
        let date = newest?.createDate? formatDate(newest.createDate):null;
        if(date)
            row.querySelector(".n-user-row-date").textContent = `最新 ${date}`;
    }

    row.userRow = {
        works,
        shutdown: () => followButton.shutdown(),
    };
    return row;
}
