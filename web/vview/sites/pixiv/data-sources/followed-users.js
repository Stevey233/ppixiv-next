import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';
import { registerUserRow } from '/vview/next/user-rows.js';

export default class DataSource_Follows extends DataSource
{
    get name() { return "following"; }
    get supportsStartPage() { return true;}
    get ui() { return UI; }
    get userRows() { return true; }
    get allowExpandingMangaPages() { return false; }
  
    constructor(args)
    {
        super(args);

        this.followTags = [];
    }

    get viewingUserId()
    {
        if(helpers.strings.getPathPart(this.url, 0) == "users")
        {
            // New URLs (/users/13245/follows)
            return helpers.strings.getPathPart(this.url, 1);
        }
        
        let queryArgs = this.url.searchParams;
        let userId = queryArgs.get("id");
        if(userId == null)
            return ppixiv.pixivInfo.userId;
        
        return userId;
    };

    async loadPageInternal(page)
    {
        // Make sure the user info is loaded.  This should normally be preloaded by globalInitData
        // in main.js, and this won't make a request.
        this.userInfo = await ppixiv.userCache.getUserInfo(this.viewingUserId, { full: true });

        // Update to refresh our page title, which uses userInfo.
        this.callUpdateListeners();

        let queryArgs = this.url.searchParams;
        let rest = queryArgs.get("rest") || "show";
        let acceptingRequests = queryArgs.get("acceptingRequests") || "0";

        let url = "/ajax/user/" + this.viewingUserId + "/following";
        let args = {
            offset: this.estimatedItemsPerPage*(page-1),
            limit: this.estimatedItemsPerPage,
            rest: rest,
            acceptingRequests,
        };
        if(queryArgs.get("tag"))
            args.tag = queryArgs.get("tag");
        let result = await helpers.pixivRequest.get(url, args);

        // Store following tags.
        this.followTags = result.body.followUserTags;
        this.followTags.sort((lhs, rhs) => lhs.toLowerCase().localeCompare(rhs.toLowerCase()));
        this.callUpdateListeners();

        // Each user is one row with their latest works.  See next/user-rows.js.  Users with no
        // works are listed too: they're the likely ones to unfollow.
        let mediaIds = [];
        let illusts = [];
        for(let followedUser of result.body.users)
        {
            if(followedUser == null)
                continue;

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extraCache.addQuickUserData(followedUser, "following");

            // Pixiv masks R-18 works when the account hides them.
            let works = followedUser.illusts.filter((illust) => !illust.isMasked);
            works.sort((lhs, rhs) => rhs.id - lhs.id);

            // These results don't have profileImageUrl and only put it in the enclosing user,
            // so copy it over.
            for(let illust of works)
                illust.profileImageUrl = followedUser.profileImageUrl;
            illusts.push(...works);

            registerUserRow({
                userId: followedUser.userId,
                userName: followedUser.userName,
                profileImageUrl: followedUser.profileImageUrl,
                comment: followedUser.userComment,
                mediaIds: works.map((illust) => helpers.mediaId.fromIllustId(illust.id)),
                hiddenR18: followedUser.illusts.length - works.length,
                isFollowed: followedUser.following,
            });
            mediaIds.push("user:" + followedUser.userId);
        }

        await ppixiv.mediaCache.addMediaInfosPartial(illusts, "normal");

        return { mediaIds };
    }

    get uiInfo()
    {
        return {
            userId: this.viewingSelf? null:this.viewingUserId,
        }
    }

    // A work in a row opens in its artist's list, so the viewer moves through that artist's
    // works and not through the followed users.
    setUrlMediaId(mediaId, args)
    {
        let info = ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false });
        if(info == null)
            return super.setUrlMediaId(mediaId, args);

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
    }

    get viewingSelf()
    {
        return this.viewingUserId == ppixiv.pixivInfo.userId;
    }

    get pageTitle()
    {
        if(!this.viewingSelf)
        {
            if(this.userInfo)
                return this.userInfo.name + "'s Follows";
            return "User's follows";
        }

        let queryArgs = this.url.searchParams;
        let privateFollows = queryArgs.get("rest") == "hide";
        return privateFollows? "Private follows":"Followed users";
    };

    getDisplayingText()
    {
        if(!this.viewingSelf)
        {
            if(this.userInfo)
                return this.userInfo.name + "'s followed users";
            return "User's followed users";
        }

        let queryArgs = this.url.searchParams;
        let privateFollows = queryArgs.get("rest") == "hide";
        return privateFollows? "Private follows":"Followed users";
    };
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=box-button-row>
                    <div class=box-button-row>
                        <vv-container class=follows-public-private style="margin-right: 25px;">
                            ${ helpers.createBoxLink({label: "Public",    popup: "Show publically followed users",   dataType: "public-follows" }) }
                            ${ helpers.createBoxLink({label: "Private",    popup: "Show privately followed users",   dataType: "private-follows" }) }
                        </vv-container>

                        ${ helpers.createBoxLink({ label: "接受约稿", dataType: "accepting-requests" }) }
                    </div>

                    ${ helpers.createBoxLink({label: "All tags",    popup: "Follow tags", icon: "bookmark", classes: ["follow-tags-button", "premium-only"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;

        // The public/private button only makes sense when viewing your own follows.
        let publicPrivateButtonContainer = this.querySelector(".follows-public-private");
        publicPrivateButtonContainer.hidden = !dataSource.viewingSelf;

        dataSource.setItem(this.root, { type: "public-follows", fields: {rest: "show"}, defaults: {rest: "show"} });
        dataSource.setItem(this.root, { type: "private-follows", fields: {rest: "hide"}, defaults: {rest: "show"} });
        dataSource.setItem(this.root, { type: "accepting-requests", toggle: true, fields: {acceptingRequests: "1"}, defaults: {acceptingRequests: "0"}});

        class FollowTabDropdown extends Widget
        {
            constructor()
            {
                super({
                    ...options,
                    template: `<div class="follow-tag-list vertical-list"></div>`,
                });

                dataSource.addEventListener("updated", () => this.refreshFollowingTags(), this._signal);
                this.refreshFollowingTags();
            }

            refreshFollowingTags()
            {
                let tagList = this.root;
                for(let tag of tagList.querySelectorAll(".tag-entry"))
                    tag.remove();

                // Refresh the bookmark tag list.  Remove the page number from these buttons.
                let currentTag = dataSource.url.searchParams.get("tag") || "All tags";

                let addTagLink = (tag) =>
                {
                    // Work around Pixiv always returning a follow tag named "null" for some users.
                    if(tag == "null")
                        return;

                    let a = helpers.createBoxLink({
                        label: tag,
                        classes: ["tag-entry"],
                        link: "#",
                        asElement: true,
                        dataType: "following-tag",
                    });

                    if(tag == "All tags")
                    {
                        tag = null;
                        a.dataset.default = 1;
                    }

                    dataSource.setItem(a, { fields: {"tag": tag} });

                    tagList.appendChild(a);
                };

                addTagLink("All tags");
                for(let tag of dataSource.followTags)
                    addTagLink(tag);

                // If we don't have the tag list yet because we're still loading the page, fill in
                // the current tag, to reduce flicker as the page loads.
                if(dataSource.followTags.length == 0 && currentTag != "All tags")
                    addTagLink(currentTag);
            }
        }
        // Create the follow tag dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".follow-tags-button"),
            createDropdown: ({...options}) => new FollowTabDropdown({dataSource, ...options}),
        });
    }
}
