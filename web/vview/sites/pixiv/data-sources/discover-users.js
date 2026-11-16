
// Artist suggestions take a random sample of followed users, and query suggestions from them.
// The followed user list normally comes from /discovery/users.
//
// This can also be used to view recommendations based on a specific user.  Note that if we're
// doing this, we don't show things like the artist's avatar in the corner, so it doesn't look
// like the images we're showing are by that user.

import DataSource from '/vview/sites/data-source.js';
import { helpers } from '/vview/misc/helpers.js';
import { registerUserRow, openWorkInArtistList } from '/vview/next/user-rows.js';
import { subjectTags } from '/vview/misc/seed-feed.js';

// The most frequent subject tags of an artist's works shown under the name, and how many works
// a row shows: all Pixiv sends (5), as many as fit.
const FREQUENT_TAGS = 3;
const WORKS_PER_ROW = 5;

// The count tags of works most common first, ties in order of appearance, without the tags that
// say little (seed-feed.js's subjectTags) and without ones on a single work when the artist has
// more than one work.
function frequentTags(works)
{
    let counts = new Map();
    for(let work of works)
        for(let tag of new Set(subjectTags(work.tagList)))
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
    let min = works.length > 1? 2:1;
    return [...counts].filter(([, count]) => count >= min).sort((a, b) => b[1] - a[1]).slice(0, FREQUENT_TAGS).map(([tag]) => tag);
}

export default class DataSource_DiscoverUsers extends DataSource
{
    get name() { return "discovery_users"; }
    get userRows() { return true; }

    setUrlMediaId(mediaId, args)
    {
        if(!openWorkInArtistList(mediaId, args))
            super.setUrlMediaId(mediaId, args);
    }
    get allowExpandingMangaPages() { return false; }

    constructor(options)
    {
        super(options);

        let args = new helpers.args(this.url);
        let userId = args.hash.get("user_id");
        if(userId != null)
            this.showingUserId = userId;

        this.seenUserIds = {};
    }

    get usersPerPage() { return 20; }
    get estimatedItemsPerPage()
    {
        let illustsPerUser = this.showingUserId != null? 3:5;
        return this.usersPerPage + (usersPerPage * illustsPerUser);
    }
    
    async loadPageInternal(page)
    {
        // If we're showing similar users, only show one page, since the API returns the
        // same thing every time.
        if(this.showingUserId && page > 1)
            return;

        if(this.showingUserId != null)
        {
            // Make sure the user info is loaded.
            this.userInfo = await ppixiv.userCache.getUserInfo(this.showingUserId, { full: true });

            // Update to refresh our page title, which uses user_info.
            this.callUpdateListeners();
        }
 
        // Get suggestions.  Each entry is a user, and contains info about a small selection of
        // images.
        let result;
        if(this.showingUserId != null)
        {
            result = await helpers.pixivRequest.get(`/ajax/user/${this.showingUserId}/recommends`, {
                userNum: this.usersPerPage,
                workNum: 8,
                isR18: true,
                lang: "en"
            });
        } else {
            result = await helpers.pixivRequest.get("/ajax/discovery/users", {
                limit: this.usersPerPage,
                lang: "en",
            });

            // This one includes tag translations.
            await ppixiv.tagTranslations.addTranslationsDict(result.body.tagTranslation);
        }

        if(result.error)
            throw "Error reading suggestions: " + result.message;

        await ppixiv.mediaCache.addMediaInfosPartial(result.body.thumbnails.illust, "normal");

        let users = new Map();
        for(let user of result.body.users)
        {
            users.set(user.userId, user);
            ppixiv.userCache.addUserData(user);

            // Register this as quick user data, for use in thumbnails.
            ppixiv.extraCache.addQuickUserData(user, "recommendations");
        }

        // Pixiv's motto: "never do the same thing the same way twice"
        // ajax/user/#/recommends is body.recommendUsers and user.illustIds.
        // discovery/users is body.recommendedUsers and user.recentIllustIds.
        let recommendedUsers = result.body.recommendUsers || result.body.recommendedUsers;

        // Each artist's frequent tags.  The response's tagTranslation covers most of them, so
        // these ask Pixiv for no translations.
        let worksOf = (user) => (user.illustIds || user.recentIllustIds)
            .map((illustId) => ppixiv.mediaCache.getMediaInfoSync(helpers.mediaId.fromIllustId(illustId), { full: false }))
            .filter((info) => info != null);
        let tagsOf = new Map(recommendedUsers.map((user) => [user.userId, frequentTags(worksOf(user))]));
        let translations = await ppixiv.tagTranslations.getTranslations([...new Set([...tagsOf.values()].flat())], "en", { lookups: 0 });

        let mediaIds = [];
        for(let user of recommendedUsers)
        {
            // Each time we load a "page", we're actually just getting a new randomized set of recommendations
            // for our seed, so we'll often get duplicate results.  Ignore users that we've seen already.  IllustIdList
            // will remove dupes, but we might get different sample illustrations for a duplicated artist, and
            // those wouldn't be removed.
            if(this.seenUserIds[user.userId])
                continue;
            this.seenUserIds[user.userId] = true;

            // Each user is one row with their latest works.  See next/user-rows.js.
            let illustIds = user.illustIds || user.recentIllustIds;
            let userData = users.get(user.userId);
            registerUserRow({
                userId: user.userId,
                userName: userData?.name,
                profileImageUrl: userData?.imageBig ?? userData?.image,
                comment: userData?.comment,
                mediaIds: illustIds.map((illustId) => helpers.mediaId.fromIllustId(illustId))
                    .filter((mediaId) => ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }) != null),
                maxWorks: WORKS_PER_ROW,
                tags: tagsOf.get(user.userId).map((tag) => ({ tag, label: translations[tag] ?? tag })),
                similar: true,
            });
            mediaIds.push("user:" + user.userId);
        }

        return { mediaIds };
    }

    get estimatedItemsPerPage() { return 30; }
    get pageTitle()
    {
        if(this.showingUserId == null)
            return "Recommended Users";

        if(this.userInfo)
            return this.userInfo.name;
        else
            return "Loading...";
    }
    
    getDisplayingText()
    {
        if(this.showingUserId == null)
            return "Recommended Users";

        if(this.userInfo)
            return "Similar artists to " + this.userInfo.name;
        else
            return "Illustrations";
    };
};
