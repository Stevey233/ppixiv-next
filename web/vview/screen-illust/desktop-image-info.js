// This handles the desktop overlay UI on the illustration page.

import Widget from '/vview/widgets/widget.js';
import { BookmarkButtonWidget, LikeButtonWidget } from '/vview/widgets/illust-widgets.js';
import { BookmarkTagDropdownOpener } from '/vview/widgets/bookmark-tag-list.js';
import { AvatarWidget } from '/vview/widgets/user-widgets.js';
import { SettingsDialog } from '/vview/widgets/settings-widgets.js';
import Actions from '/vview/misc/actions.js';
import TagListWidget from '/vview/widgets/tag-list-widget.js';
import LocalAPI from '/vview/misc/local-api.js';
import { getUrlForMediaId } from '/vview/misc/media-ids.js'
import { helpers, ClassFlags } from '/vview/misc/helpers.js';
import PointerListener from '/vview/actors/pointer-listener.js';
import FollowButton from '/vview/next/follow-button.js';
import ArtistWorks from '/vview/next/artist-works.js';
import { downloadDate } from '/vview/misc/downloaded-works.js';

export default class DesktopImageInfo extends Widget
{
    constructor({...options})
    {
        super({
            ...options,
            visible: false,
            template: `
<div class=image-ui>
    <div class=hover-sphere>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
            <circle class=hover-circle cx="0.5" cy="0.5" r=".5" fill-opacity="0" />
        </svg>
    </div>

    <div class=ui-box>
        <div class=info-top-row>
            <button type=button class="info-back icon-button popup" data-popup="返回列表 (Esc)">
                ${ helpers.createIcon("mat:arrow_back") }
            </button>
            <div class=info-spacer></div>
            <a class="icon-button disable-ui-button popup pixiv-only" data-popup="在 Pixiv 打开" href="#no-ppixiv">
                ${ helpers.createIcon("ppixiv:pixiv") }
            </a>
            <button type=button class="icon-button preferences-button popup" data-popup="设置">
                ${ helpers.createIcon("mat:settings") }
            </button>
            <button type=button class="info-pin icon-button popup" data-popup="固定或收起信息栏 (I)">
                ${ helpers.createIcon("mat:view_sidebar") }
            </button>
        </div>

        <div class=info-author-row>
            <div class=avatar-popup></div>
            <div class=info-author-text>
                <span class=author-block>
                    <a class="author" data-scroll-to-top></a>
                </span>
                <span class=folder-block>
                    <a class="folder-text"></a>
                </span>
                <a class=edit-post href=#>编辑作品</a>
            </div>
            <vv-container class=follow-button-container></vv-container>
        </div>

        <div class=ui-title-box>
            <h2 class="title-block"><a class="title"></a></h2>
        </div>

        <div class=n-series hidden>
            <a class=n-series-name><span class=n-series-title></span> <span class="n-series-order n-num"></span></a>
            <a class="n-series-prev popup">‹ 上一话</a>
            <a class="n-series-next popup">下一话 ›</a>
        </div>

        <div class=post-info>
            <div class="post-age popup" hidden></div>
            <div class=image-info hidden></div>
            <div class=page-count hidden></div>
            <div class=ugoira-duration hidden></div>
            <div class=ugoira-frames hidden></div>
        </div>

        <div class=info-actions>
            <div class=info-actions-main>
                <vv-container class=bookmark-button-container data-bookmark-type=public></vv-container>
                <vv-container class=bookmark-button-container data-bookmark-type=private></vv-container>
                <div class="n-action n-icon-only button-bookmark-tags popup" data-popup="收藏标签">
                    ${ helpers.createIcon("ppixiv:tag") }
                </div>
            </div>

            <div class=info-actions-more>
                <vv-container class="button-like-container button-container"></vv-container>

                <div class="n-action download-button download-image-button popup pixiv-only" data-download="image" data-popup="下载原图">
                    ${ helpers.createIcon("mat:download") }<span class=n-label>下载</span>
                </div>

                <div class="n-action download-button download-manga-button popup pixiv-only" data-download="ZIP" data-popup="下载全部页面 (ZIP)">
                    ${ helpers.createIcon("mat:folder_zip") }<span class=n-label>下载全部</span>
                </div>

                <div class="n-action download-button download-video-button popup pixiv-only" data-download="MKV" data-popup="下载动图 (MKV)">
                    ${ helpers.createIcon("mat:download") }<span class=n-label>下载 MKV</span>
                </div>

                <div class="n-action view-manga-button popup" data-popup="查看全部页面">
                    ${ helpers.createIcon("ppixiv:thumbnails") }<span class=n-label>全部页面</span>
                </div>
            </div>
        </div>

        <vv-container class=artist-works-container></vv-container>

        <div class="info-links pixiv-only">
            <a class="similar-illusts-button" href=#>相似作品</a>
            <a class="similar-bookmarks-button" href=#>收藏了这张的人还收藏了</a>
            <a class="similar-artists-button" href=#>相似画师</a>
        </div>

        <vv-container class=tag-list-container></vv-container>

        <div class=description></div>
    </div>
</div>
        `});

        // ui-box is the real container.  THe outer div is just so hover-sphere isn't inside
        // the scroller.
        this.ui_box = this.root.querySelector(".ui-box");

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar-popup"),
            dropdownvisibilitychanged: () => {
                this.refreshOverlayUiVisibility();
            },
        });

        this.followButton = new FollowButton({
            container: this.root.querySelector(".follow-button-container"),

            // Clicking "已关注" opens the avatar's follow menu, which has unfollow and the
            // public/private switch, so one stray click doesn't unfollow.
            onFollowedClick: () => this.avatarWidget.followDropdownOpener.visible = true,
        });

        this.artistWorks = new ArtistWorks({
            container: this.root.querySelector(".artist-works-container"),
        });
        ppixiv.settings.addEventListener("info_panel_artist_works", () => this._setPostInfo(), this._signal);

        this.tagListWidget = new TagListWidget({
            container: this.root.querySelector(".tag-list-container")
        });

        ppixiv.mediaCache.addEventListener("mediamodified", this.refresh, { signal: this.shutdownSignal });
        ppixiv.downloadedWorks.addEventListener("changed", () => this._refreshDownloaded(), { signal: this.shutdownSignal });
        ppixiv.settings.addEventListener("mark_downloaded", () => this._refreshDownloaded(), { signal: this.shutdownSignal });
        
        this.likeButton = new LikeButtonWidget({
            container: this.root.querySelector(".button-like-container"),
            template: `
                <div class="n-action button-like enabled popup button-container">
                    ${ helpers.createIcon("mat:thumb_up") }<span class=n-label>点赞</span>
                </div>
            `
        });

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmarkButtons = [];
        for(let a of this.root.querySelectorAll("[data-bookmark-type]"))
            this.bookmarkButtons.push(new BookmarkButtonWidget({
                container: a,
                template: a.dataset.bookmarkType == "public"? `
                    <div class="n-action n-bookmark button-bookmark popup public">
                        ${ helpers.createIcon("mat:favorite") }
                        <span class="n-label n-unset">收藏</span><span class="n-label n-set">已收藏</span>
                    </div>
                `:`
                    <div class="n-action n-bookmark-private button-bookmark popup private">
                        ${ helpers.createIcon("mat:lock") }<span class=n-label>私密</span>
                    </div>
                `,
                bookmarkType: a.dataset.bookmarkType,
            }));

        let bookmarkTagsButton = this.root.querySelector(".button-bookmark-tags");
        this.bookmarkTagsDropdownOpener = new BookmarkTagDropdownOpener({
            parent: this,
            bookmarkTagsButton,
            bookmarkButtons: this.bookmarkButtons,

            // The dropdown affects visibility, so refresh when it closes.
            onvisibilitychanged: () => {
                this.refreshOverlayUiVisibility();
            },
        });

        for(let button of this.root.querySelectorAll(".download-button"))
            button.addEventListener("click", this.clickedDownload);
        this.root.querySelector(".view-manga-button").addEventListener("click", (e) => {
            if(this.mediaId == null)
                return;
    
            let args = getUrlForMediaId(this.mediaId, { manga: true });
            helpers.navigate(args);
        });

        // Don't propagate wheel events if the contents can scroll, so moving the scroller doesn't change the
        // image.  Most of the time the contents will fit, so allow changing the page if there's no need to
        // scroll.
        this.ui_box.addEventListener("wheel", (e) => {
            if(this.ui_box.scrollHeight > this.ui_box.offsetHeight)
                e.stopPropagation();
        }, { passive: false });

        this.root.querySelector(".preferences-button").addEventListener("click", (e) => {
            new SettingsDialog();
        });

        // Show on hover.
        this.ui_box.addEventListener("mouseenter", (e) => { this.hoveringOverBox = true; this.refreshOverlayUiVisibility(); });
        this.ui_box.addEventListener("mouseleave", (e) => { this.hoveringOverBox = false; this.refreshOverlayUiVisibility(); });

        let hoverCircle = this.querySelector(".hover-circle");
        hoverCircle.addEventListener("mouseenter", (e) => { this.hoveringOverSphere = true; this.refreshOverlayUiVisibility(); });
        hoverCircle.addEventListener("mouseleave", (e) => { this.hoveringOverSphere = false; this.refreshOverlayUiVisibility(); });
        ppixiv.settings.addEventListener("image_editing", () => { this.refreshOverlayUiVisibility(); });
        ppixiv.settings.addEventListener("image_editing_mode", () => { this.refreshOverlayUiVisibility(); });
        ClassFlags.get.addEventListener("hide-ui", () => this.refreshOverlayUiVisibility(), this._signal);

        // The panel is pinned open on wide windows, and shown on hover otherwise.  See docs/design.md.
        this._wideQuery = window.matchMedia("(min-width: 1100px)");
        this._wideQuery.addEventListener("change", () => this.refreshOverlayUiVisibility(), this._signal);
        ppixiv.settings.addEventListener("info_panel_pinned", () => this.refreshOverlayUiVisibility(), this._signal);

        this.root.querySelector(".info-pin").addEventListener("click", () => this.togglePinned());
        this.root.querySelector(".info-back").addEventListener("click", () => this.returnToSearch());

        this.refreshOverlayUiVisibility();
    }

    get pinned()
    {
        return ppixiv.settings.get("info_panel_pinned") && this._wideQuery.matches;
    }

    togglePinned()
    {
        ppixiv.settings.set("info_panel_pinned", !ppixiv.settings.get("info_panel_pinned"));
    }

    // Go back to the list, the same as Escape (see ContextMenu).
    returnToSearch()
    {
        ppixiv.phistory.back();
    }

    refreshOverlayUiVisibility()
    {
        // Don't show the hover UI while editing, since it can get in the way of trying to
        // click the image.  A pinned panel is hidden too, and gives its space back to the image.
        let editing = ppixiv.settings.get("image_editing") && ppixiv.settings.get("image_editing_mode") != null;
        let pinned = this.pinned && !editing && !ppixiv.mobile;
        helpers.html.setClass(this.root, "pinned", pinned);
        let visible = pinned || this.hoveringOverBox || this.hoveringOverSphere;
        if(editing)
            visible = false;

        // Stay visible if the bookmark tag dropdown or the follow dropdown are visible.
        if(this.bookmarkTagsDropdownOpener?.visible || this.avatarWidget.followDropdownOpener.visible)
            visible = true;

        // hide-ui is set while dragging the image and while the context menu is open.  A pinned
        // panel stays, since hiding it would resize the image under the mouse.
        if(ClassFlags.get.get("hide-ui") && !pinned)
            visible = false;
        
        // Tell the image UI when it's visible.
        this.visible = visible;

        // Hide the UI's container too when we're editing, so the hover boxes don't get in
        // the way.
        this.root.hidden = editing || ppixiv.mobile;
    }

    applyVisibility()
    {
        helpers.html.setClass(this.root.querySelector(".ui-box"), "ui-hidden", !this._visible);
    }

    visibilityChanged()
    {
        super.visibilityChanged();

        this.refresh();
    }

    set dataSource(dataSource)
    {
        if(this._dataSource == dataSource)
            return;

        this._dataSource = dataSource;
        this.refresh();
    }
    
    get mediaId()
    {
        return this._mediaId;
    }

    set mediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;
        this._mediaId = mediaId;

        this.refresh();
    }

    get displayedPage()
    {
        return helpers.mediaId.parse(this._mediaId).page;
    }

    async handleKeydown(e)
    {
        if(e.code == "KeyI" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey)
        {
            e.preventDefault();
            e.stopPropagation();
            if(this._wideQuery.matches)
                this.togglePinned();
            else
            {
                // On narrow windows, I shows and hides the panel instead.
                this.hoveringOverBox = !this.visible;
                this.refreshOverlayUiVisibility();
            }
            return;
        }

        if(!this.visible)
            return;

        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._mediaId, { full: false, safe: false });
        if(mediaInfo == null)
            return;

        // If no text is selected and the title or description are hovered, copy the
        // hovered text to the clipboard.
        if(e.code == "KeyC" && helpers.isCtrlPressed(e))
        {
            // If any text is selected, stop and let regular text selection happen.
            let selection = window.getSelection();
            if(selection.rangeCount > 0 && selection.toString() != "")
                return;

            // Get the element under the mouse cursor.
            let nodeUnderCursor = document.elementFromPoint(PointerListener.latestMouseClientPosition[0], PointerListener.latestMouseClientPosition[1]);
            console.log(nodeUnderCursor);

            let text = null;

            let hoveringDescription = nodeUnderCursor.closest(".description") != null;
            if(hoveringDescription)
                text = mediaInfo.illustComment;

            let hoveringTitle = nodeUnderCursor.closest(".title") != null;
            if(hoveringTitle)
                text = mediaInfo.illustTitle;

            if(text == null)
                return;

            e.preventDefault();
            e.stopPropagation();

            navigator.clipboard.writeText(text);
        }
    }

    refresh = async() =>
    {
        helpers.html.setClass(this.root, "disabled", !this.visible);

        // Don't do anything if we're not visible.  The artist's other works load only while
        // the panel is visible.
        if(!this.visible)
        {
            this.artistWorks.set({ mediaInfo: null });
            return;
        }

        // Update widget illust IDs.
        this.likeButton.setMediaId(this._mediaId);
        for(let button of this.bookmarkButtons)
            button.setMediaId(this._mediaId);
        this.bookmarkTagsDropdownOpener.setMediaId(this._mediaId);

        if(this._mediaId == null)
            return;

        // Try to fill in as much of the UI as we can without waiting for the info to load.
        this._setPostInfo();

        // We need image info to update.
        let mediaId = this._mediaId;
        let mediaInfo = await ppixiv.mediaCache.getMediaInfo(this._mediaId);

        // Check if anything changed while we were loading.
        if(mediaInfo == null || mediaId != this._mediaId || !this.visible)
            return;

        // Fill in the post info text.
        this._setPostInfo();
    }

    // Set all fields that we can from partial media info.  This lets us refresh most of the UI
    // without waiting for the full info to finish loading.
    _setPostInfo()
    {
        // Get all data that we've loaded so far.  This can return full or partial info, so we need
        // to check mediaInfo.full in each place we're accessing full data fields.
        let mediaInfo = ppixiv.mediaCache.getMediaInfoSync(this._mediaId, { full: false, safe: false });
        if(mediaInfo == null)
            return;

        let [illustId] = helpers.mediaId.toIllustIdAndPage(this._mediaId);
        let userId = mediaInfo.userId;

        // Show the author if it's someone else's post, or the edit link if it's ours.
        let ourPost = ppixiv.pixivInfo?.userId == userId;
        this.querySelector(".author-block").hidden = ourPost;
        this.querySelector(".edit-post").hidden = !ourPost;
        this.querySelector(".edit-post").href = "/member_illust_mod.php?mode=mod&illust_id=" + illustId;

        // Update the disable UI button to point at the current image's illustration page.
        let disableButton = this.querySelector(".disable-ui-button");
        disableButton.href = `/artworks/${illustId}#no-ppixiv`;

        this.avatarWidget.setUserId(userId);
        this.followButton.setUserId(userId);
        this.avatarWidget.visible = userId != null;
        this.tagListWidget.set(mediaInfo);

        let elementTitle = this.root.querySelector(".title");
        elementTitle.textContent = mediaInfo.illustTitle;
        elementTitle.href = getUrlForMediaId(this._mediaId).url;

        this._setSeries(mediaInfo);
        this.artistWorks.set({ mediaInfo: this.visible? mediaInfo:null });

        // Show the folder if we're viewing a local image.
        let folderTextElement = this.root.querySelector(".folder-text");
        let showFolder = helpers.mediaId.isLocal(this._mediaId);
        if(showFolder)
        {
            let {id} = helpers.mediaId.parse(this.mediaId);
            folderTextElement.innerText = helpers.strings.getPathSuffix(id, 2, 1); // last two parent directories

            let parentFolderId = LocalAPI.getParentFolder(id);
            let args = new helpers.args("/", ppixiv.plocation);
            LocalAPI.getArgsForId(parentFolderId, args);
            folderTextElement.href = args.url;
        }

        // If the author name or folder are empty, hide it instead of leaving it empty.
        this.root.querySelector(".author-block").hidden = ourPost || mediaInfo.userName == "";
        this.root.querySelector(".folder-block").hidden = !showFolder;

        let elementAuthor = this.root.querySelector(".author");
        elementAuthor.href = `/users/${userId}#ppixiv`;
        if(mediaInfo.userName != "")
            elementAuthor.textContent = mediaInfo.userName;
        
        this.root.querySelector(".similar-illusts-button").href = "/bookmark_detail.php?illust_id=" + illustId + "#ppixiv?recommendations=1";
        this.root.querySelector(".similar-artists-button").href = "/discovery/users#ppixiv?user_id=" + userId;
        this.root.querySelector(".similar-bookmarks-button").href = "/bookmark_detail.php?illust_id=" + illustId + "#ppixiv";

        // Pixiv image descriptions can contain HTML, which we don't need to check.  Don't
        // display local image descriptions as HTML, since they come directly from image
        // files and we don't do any verification of their contents.
        let elementComment = this.root.querySelector(".description");
        elementComment.hidden = !mediaInfo.full || mediaInfo.illustComment == "";
        if(ppixiv.native)
            elementComment.innerText = mediaInfo.full? mediaInfo.illustComment:"";
        else
            elementComment.innerHTML = mediaInfo.full? mediaInfo.illustComment:"";

        helpers.pixiv.fixPixivLinks(elementComment);
        if(!ppixiv.native)
            helpers.pixiv.makePixivLinksInternal(elementComment);

        // Set the download button popup text.
        let downloadImageButton = this.root.querySelector(".download-image-button");
        downloadImageButton.hidden = !Actions.isDownloadTypeAvailable("image", mediaInfo);

        let downloadMangaButton = this.root.querySelector(".download-manga-button");
        downloadMangaButton.hidden = !Actions.isDownloadTypeAvailable("ZIP", mediaInfo);

        let downloadVideoButton = this.root.querySelector(".download-video-button");
        downloadVideoButton.hidden = !Actions.isDownloadTypeAvailable("MKV", mediaInfo);
        this._refreshDownloaded();

        let postInfoContainer = this.root.querySelector(".post-info");

        let setInfo = (query, text) =>
        {
            let node = postInfoContainer.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };

        let seconds_old = (new Date() - new Date(mediaInfo.createDate)) / 1000;
        setInfo(".post-age", helpers.strings.ageToString(seconds_old));
        postInfoContainer.querySelector(".post-age").dataset.popup = helpers.strings.dateToString(mediaInfo.createDate);

        let info = "";

        // Add the resolution and file type if available.
        if(this.displayedPage != null && mediaInfo.full)
        {
            let pageInfo = mediaInfo.mangaPages[this.displayedPage];
            info += pageInfo.width + "x" + pageInfo.height;

            // For illusts, add the image type.  Don't do this for animations.
            if(mediaInfo.illustType != 2)
            {
                let url = new URL(pageInfo.urls?.original);
                let ext = helpers.strings.getExtension(url.pathname).toUpperCase();
                if(ext)
                    info += " " + ext;
            }
        }

        setInfo(".image-info", info);

        let duration = "";
        if(mediaInfo.full && mediaInfo.ugoiraMetadata)
        {
            let seconds = 0;
            for(let frame of mediaInfo.ugoiraMetadata.frames)
                seconds += frame.delay / 1000;

            duration = seconds.toFixed(duration >= 10? 0:1);
            duration += " 秒";
        }
        setInfo(".ugoira-duration", duration);
        setInfo(".ugoira-frames", (mediaInfo.full && mediaInfo.ugoiraMetadata)? (mediaInfo.ugoiraMetadata.frames.length + " 帧"):"");

        // Add the page count for manga.
        let pageText = "";
        if(mediaInfo.pageCount > 1 && this.displayedPage != null)
            pageText = `第 ${this.displayedPage+1} / ${mediaInfo.pageCount} 页`;
        setInfo(".page-count", pageText);
    }

    // The series line under the title: the series name and the work's number in it, linking to the
    // series list, and the previous and next episodes.  An end of the series has no link there.
    _setSeries(mediaInfo)
    {
        let series = mediaInfo.full? mediaInfo.seriesNavData:null;
        let line = this.root.querySelector(".n-series");
        line.hidden = series == null;
        if(series == null)
            return;

        let name = line.querySelector(".n-series-name");
        name.href = `/user/${mediaInfo.userId}/series/${series.seriesId}#ppixiv`;
        name.querySelector(".n-series-title").textContent = series.title;
        name.querySelector(".n-series-order").textContent = `#${series.order}`;

        for(let [selector, episode] of [[".n-series-prev", series.prev], [".n-series-next", series.next]])
        {
            let link = line.querySelector(selector);
            link.hidden = episode == null;
            if(episode == null)
            {
                link.removeAttribute("href");
                continue;
            }
            link.href = getUrlForMediaId(helpers.mediaId.fromIllustId(episode.id)).url;
            link.dataset.popup = `#${episode.order} ${episode.title}`;
        }
    }

    // Show on the download buttons when this script downloaded the work before: the label says
    // "下载过", the icon turns into the check mark of the thumbnail marker, and the tooltip gives
    // the date (misc/downloaded-works.js).  The buttons still download again.  The record only
    // says a download was started, so the wording is "下载过", not "已保存".
    _refreshDownloaded()
    {
        let labels = { image: "下载过", ZIP: "全部下载过", MKV: "MKV 下载过" };
        for(let button of this.root.querySelectorAll(".download-button"))
        {
            let label = button.querySelector(".n-label"), icon = button.querySelector(".font-icon");
            button.dataset.label ??= label.textContent;
            button.dataset.icon ??= icon.textContent;
            button.dataset.defaultPopup ??= button.dataset.popup;

            let downloadType = button.dataset.download;
            let time = this._mediaId != null && ppixiv.downloadedWorks.marking?
                ppixiv.downloadedWorks.downloadedTime(this._mediaId, downloadType):null;
            helpers.html.setClass(button, "n-downloaded", time != null);
            label.textContent = time != null? labels[downloadType]:button.dataset.label;
            icon.textContent = time != null? "download_done":button.dataset.icon;
            button.dataset.popup = time != null? `${downloadDate(time)} 下载过，点击再下载一次`:button.dataset.defaultPopup;
        }
    }

    clickedDownload = (e) =>
    {
        if(this._mediaId == null)
            return;

        let clickedButton = e.target.closest(".download-button");
        if(clickedButton == null)
            return;

        e.preventDefault();
        e.stopPropagation();

        let downloadType = clickedButton.dataset.download;
        Actions.downloadIllust(this._mediaId, downloadType, this.displayedPage);
    }
 }

