// bookmark_detail.php#recommendations=1 - Similar Illustrations
//
// We use this as an anchor page for viewing recommended illusts for an image, since
// there's no dedicated page for this.
//
// 相似作品 reads Pixiv's related-works endpoint, the one under a work on Pixiv's own page.  Asked
// for 180, it returns the whole related set, 150 to 175 works, in one request, in Pixiv's order.
// If it leaves some for later (nextIds), each further page loads 18 of them.  See docs/design.md.

import DataSource from '/vview/sites/data-source.js';
import { listHidesMutedTags, hasMutedTag } from '/vview/misc/muted-works.js';
import { helpers } from '/vview/misc/helpers.js';

// IDs per /ajax/illust/recommend/illusts request.
const NEXT_IDS_PER_PAGE = 18;

export default class DataSource_SimilarIllusts extends DataSource
{
    get name() { return "related-illusts"; }
    get pageTitle() { return "相似作品"; }

    getDisplayingText()
    {
        return this.workCount == null? "相似作品":`相似作品 ${this.workCount}`;
    }

    get estimatedItemsPerPage() { return 180; }

    async loadPageInternal(page)
    {
        // Get info about the source illustration too, so we can show it in the UI.  The first
        // page waits for it, since whether muted works are hidden depends on its tags (see
        // misc/muted-works.js).
        let illustId = this.url.searchParams.get("illust_id");
        this._sourceInfo ??= ppixiv.mediaCache.getMediaInfo(helpers.mediaId.fromIllustId(illustId)).then((mediaInfo) => {
            this.mediaInfo = mediaInfo;
            this.callUpdateListeners();
        }).catch((e) => {
            console.error(e);
        });

        // Page 1 is the whole set the first request returns.  Later pages are the IDs it left for
        // later, which was none in every set seen so far.
        let illusts;
        if(page == 1)
        {
            let result = await helpers.pixivRequest.get(`/ajax/illust/${illustId}/recommend/init`, {
                limit: this.estimatedItemsPerPage,
                lang: "en",
            });
            this._nextIds = result.body.nextIds ?? [];
            illusts = result.body.illusts;
        }
        else
        {
            let ids = this._nextIds?.slice((page-2)*NEXT_IDS_PER_PAGE, (page-1)*NEXT_IDS_PER_PAGE) ?? [];
            if(ids.length == 0)
                return;
            let result = await helpers.pixivRequest.get("/ajax/illust/recommend/illusts", {
                "illust_ids[]": ids,
            });
            illusts = result.body.illusts;
        }

        // Pixiv masks works it won't show this account.  They have no title or image.
        illusts = illusts.filter((illust) => !illust.isMasked);
        await ppixiv.mediaCache.addMediaInfosPartial(illusts, "normal");
        await this._sourceInfo;

        let mediaIds = illusts.map((illust) => helpers.mediaId.fromIllustId(illust.id));

        // The header counts the works the list shows, before the filter bar.
        let hideMuted = listHidesMutedTags(this);
        this.workCount = (this.workCount ?? 0) + mediaIds.filter((mediaId) => !hideMuted || !hasMutedTag(mediaId)).length;
        this.callUpdateListeners();

        return { mediaIds };
    };

    get uiInfo()
    {
        let imageUrl = null;
        let imageLinkUrl = null;
        if(this.mediaInfo)
        {
            imageLinkUrl = `/artworks/${this.mediaInfo.illustId}#ppixiv`;
            imageUrl = this.mediaInfo.previewUrls[0];
        }

        return { imageUrl, imageLinkUrl };
    }
}
