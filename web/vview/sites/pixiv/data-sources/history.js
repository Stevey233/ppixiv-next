// https://www.pixiv.net/#ppixiv/history
//
// 最近看过: the works opened in the viewer, the most recently opened first.  This reads the record
// misc/seen-works.js keeps, so it needs nothing from Pixiv but the thumbnail data.  The URL is under
// the top page's hash, like upstream's #ppixiv/edits, so ppixiv doesn't take over Pixiv's own
// /history.php.
import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';

export default class DataSources_History extends DataSource
{
    get name() { return "history"; }
    get pageTitle() { return "最近看过"; }
    get ui() { return UI; }

    getDisplayingText()
    {
        return this.illustIds == null? "最近看过":`最近看过 ${this.illustIds.length}`;
    }

    // The sentence UI shows in place of "no results" says why the list is empty.
    get hasNoResults() { return super.hasNoResults && this.illustIds?.length != 0; }

    async loadPageInternal(page)
    {
        // Read the record once.  Opening a work from this list moves it to the top only after a
        // reload, so the list doesn't reorder under the user.
        if(this.illustIds == null)
        {
            this.illustIds = await ppixiv.seenWorks.readByTime() ?? [];
            this.callUpdateListeners();
        }

        let perPage = this.estimatedItemsPerPage;
        let illustIds = this.illustIds.slice((page-1)*perPage, page*perPage);
        if(illustIds.length == 0)
            return;

        // Any user ID works here, and this API includes the AI flag and bookmark data, unlike the
        // fallback without one.  Works deleted since they were seen are left out of the response.
        let mediaIds = illustIds.map((illustId) => helpers.mediaId.fromIllustId(illustId));
        await ppixiv.mediaCache.batchGetMediaInfoPartial(mediaIds, { userId: ppixiv.pixivInfo.userId });
        mediaIds = mediaIds.filter((mediaId) => ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }) != null);

        // If every work on the page was deleted, add the page empty, so the list continues instead
        // of ending here.
        return { mediaIds, allowEmpty: true };
    }
}

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div class=history-note hidden></div>
        `});

        this.dataSource = dataSource;
        dataSource.addEventListener("updated", () => this.refresh(), this._signal);
        ppixiv.settings.addEventListener("seen_works", () => this.refresh(), this._signal);
        this.refresh();
    }

    refresh()
    {
        let empty = this.dataSource.illustIds?.length == 0;
        let off = ppixiv.seenWorks.mode == "off";
        let text =
            off? "已在设置里停止记录看过的作品，新打开的作品不会加进这里。":
            empty? "还没有看过的作品。在看图界面打开的作品会按时间列在这里，最近的在前。":
            null;
        this.root.hidden = text == null;
        this.root.textContent = text ?? "";
    }
}
