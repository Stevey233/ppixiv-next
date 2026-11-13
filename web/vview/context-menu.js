// A global right-click popup menu.
//
// This is only active when right clicking over items with the context-menu-target
// class.
//
// Not all items are available all the time.  This is a singleton class, so it's easy
// for different parts of the UI to tell us when they're active.
//
// This also handles mousewheel zooming.

import Widget from '/vview/widgets/widget.js';
import { stepThumbnailPage } from '/vview/next/thumb-pages.js';
import { BookmarkButtonWidget } from '/vview/widgets/illust-widgets.js';
import { HideMouseCursorOnIdle } from '/vview/misc/hide-mouse-cursor-on-idle.js';
import { AvatarWidget, GetUserIdFromMediaId } from '/vview/widgets/user-widgets.js';
import MoreOptionsDropdown from '/vview/widgets/more-options-dropdown.js';
import FixChromeClicks from '/vview/misc/fix-chrome-clicks.js';
import { ViewInExplorerWidget } from '/vview/widgets/local-widgets.js';
import { IllustWidget } from '/vview/widgets/illust-widgets.js';
import PointerListener from '/vview/actors/pointer-listener.js';
import ClickOutsideListener from '/vview/widgets/click-outside-listener.js';
import DialogWidget from '/vview/widgets/dialog.js';
import Actions from '/vview/misc/actions.js';
import { getUrlForMediaId } from '/vview/misc/media-ids.js'
import LocalAPI from '/vview/misc/local-api.js';
import { GetMediaInfo } from '/vview/widgets/illust-widgets.js';
import { helpers, ClassFlags, KeyListener, OpenWidgets } from '/vview/misc/helpers.js';

export default class ContextMenu extends Widget
{
    // Names for buttons, for storing in this._buttonsDown.
    buttons = ["lmb", "rmb", "mmb"];

    constructor({...options})
    {
        super({...options, template: `
            <div class=popup-context-menu>
                <!-- One set of buttons, grouped by what they do.  The look comes from the
                     "context_menu_style" setting: a labeled list, an icon strip, or a cross around
                     the cursor.  Each style is only CSS (_next.scss), so they share this markup.
                     See docs/design.md. -->
                <div class="cm-group cm-user">
                    <vv-container class="cm-cell avatar-widget-container"></vv-container>
                    <div class="cm-cell button button-parent-folder enabled" data-popup="Parent folder" hidden>
                        ${ helpers.createIcon("folder") }
                        <span class=cm-label>上级文件夹</span>
                    </div>
                    <div class="cm-cell view-in-explorer" hidden></div>
                    <div class="cm-meta context-menu-image-info-container"></div>
                </div>

                <div class="cm-group cm-collect">
                    <vv-container class="cm-cell button-bookmark-container" data-bookmark-type=public></vv-container>
                    <vv-container class="cm-cell button-bookmark-container private-bookmark-button" data-bookmark-type=private></vv-container>
                    <!-- Upstream has bookmark tags and like here.  They're replaced with the two
                         actions used most after opening a work, and both stay in the info panel. -->
                    <div class="cm-cell button button-bookmark-download enabled" data-popup="收藏并下载原图">
                        ${ helpers.createIcon("mat:download") }
                        <span class=cm-label>收藏并下载</span>
                    </div>
                </div>

                <div class="cm-group cm-go">
                    <a href=# class="cm-cell button button-similar enabled" data-popup="相似作品">
                        ${ helpers.createIcon("mat:photo_library") }
                        <span class=cm-label>相似作品</span>
                    </a>
                    <a href=# class="cm-cell button button-view-manga" data-popup="全部页面">
                        ${ helpers.createIcon("mat:grid_view") }
                        <span class=cm-label>全部页面</span>
                    </a>
                    <!-- Upstream turned 全部页面 into 系列 for works in a series, which left no way to
                         open a multi-page work's pages from the menu.  Both show when both apply. -->
                    <a href=# class="cm-cell button button-view-series enabled" data-popup="系列" hidden>
                        ${ helpers.createIcon("mat:menu_book") }
                        <span class=cm-label>系列</span>
                    </a>
                    <div class="cm-cell button button-browser-back enabled" data-popup="返回">
                        ${ helpers.createIcon("mat:arrow_back") }
                        <span class=cm-label>返回</span>
                    </div>
                </div>

                <div class="cm-group cm-zoom">
                    <div class="cm-cell button requires-zoom button-zoom" data-popup="缩放">
                        ${ helpers.createIcon("mat:zoom_in") }
                        <span class=cm-label>缩放</span>
                    </div>
                    <div class="cm-cell button requires-zoom button-zoom-level" data-level="cover" data-popup="铺满">
                        ${ helpers.createIcon("mat:fit_screen") }
                        <span class=cm-label>铺满</span>
                    </div>
                    <div class="cm-cell button requires-zoom button-zoom-level" data-level="actual" data-popup="原始大小">
                        <span class=cm-glyph>1:1</span>
                        <span class=cm-label>原始大小</span>
                    </div>
                </div>

                <div class="cm-group cm-window">
                    <div class="cm-cell button button-fullscreen enabled" data-popup="全屏">
                        ${ helpers.createIcon("mat:fullscreen") }
                        <span class=cm-label>全屏</span>
                    </div>
                    <div class="cm-cell button button-more enabled" data-popup="更多">
                        ${ helpers.createIcon("mat:more_horiz") }
                        <span class=cm-label>更多</span>
                        ${ helpers.createIcon("mat:expand_more", { classes: ["cm-chevron"] }) }
                    </div>
                </div>

                <!-- 更多 expands here, inside the menu, instead of opening a dropdown on top of it. -->
                <div class="cm-group cm-more" hidden></div>

                <div class=tooltip-display>
                    <div class=tooltip-display-text></div>
                </div>
            </div>
        `});

        this.visible = false;
        this.hide = this.hide.bind(this);
        this._currentViewer = null;
        this._mediaId = null;

        // Whether the left and right mouse buttons are pressed:
        this._buttonsDown = {};

        // This UI isn't used on mobile, but we're still created so other code doesn't need
        // to check if we exist.
        if(ppixiv.mobile)
            return;

        this._applyStyle();
        ppixiv.settings.addEventListener("context_menu_style", this._applyStyle, this._signal);
            
        this.getUserIdFromMediaId = new GetUserIdFromMediaId({
            parent: this,
            onrefresh: ({userId}) => {
                this._cachedUserId = userId;
                this.refresh();
            }
        });

        this.root.ontransitionend = () => this.callVisibilityChanged();

        this.pointerListener = new PointerListener({
            element: window,
            buttonMask: 0b11,
            callback: this.pointerevent,
        });
        
        window.addEventListener("keydown", this._onKeyEvent);
        window.addEventListener("keyup", this._onKeyEvent);

        // Use KeyListener to watch for ctrl being held.
        new KeyListener("Control", this._ctrlWasPressed);

        // Work around glitchiness in Chrome's click behavior (if we're in Chrome).
        new FixChromeClicks(this.root);

        this.root.addEventListener("mouseover", this.onmouseover, true);
        this.root.addEventListener("mouseout", this.onmouseout, true);

        // If the page is navigated while the popup menu is open, clear the ID the
        // user clicked on, so we refresh and show the default.
        window.addEventListener("pp:popstate", (e) => {
            if(this._clickedMediaId == null)
                return;

            this._setTemporaryIllust(null);
        });

        this._buttonViewManga = this.root.querySelector(".button-view-manga");
        this._buttonViewSeries = this.root.querySelector(".button-view-series");

        this._buttonFullscreen = this.root.querySelector(".button-fullscreen");
        this._buttonFullscreen.addEventListener("click", this._clickedFullscreen);

        this.root.querySelector(".button-zoom").addEventListener("click", this._clickedToggleZoom);
        this.root.querySelector(".button-browser-back").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            ppixiv.phistory.back();
        });

        this.root.addEventListener("click", this._handleLinkClick);
        this.root.querySelector(".button-parent-folder").addEventListener("click", this.clicked_go_to_parent);

        for(let button of this.root.querySelectorAll(".button-zoom-level"))
            button.addEventListener("click", this._clickedZoomLevel);

        this.avatarWidget = new AvatarWidget({
            container: this.root.querySelector(".avatar-widget-container"),
            mode: "overlay",
        });

        // 更多 expands its rows inline, in the .cm-more group under it.  See docs/design.md.
        this._moreGroup = this.root.querySelector(".cm-more");
        this._buttonMore = this.root.querySelector(".button-more");
        this._moreOptions = new MoreOptionsDropdown({
            container: this._moreGroup,
            parent: this,
            inline: true,
            visible: false,
            onrefreshed: () => this._layoutMore(),
        });

        this._buttonMore.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Alt-click shows the rarely-used options too.
            this._moreOptions.showExtra = e.altKey;
            this._setMoreOpen(!this._moreOpen || e.altKey);
        });

        // Load full media info when the context menu is open, so we can find out if the post
        // is in a series.
        this.getMediaInfo = new GetMediaInfo({
            parent: this,
            neededData: "full",
            onrefresh: async({mediaInfo}) => {
                let seriesId = mediaInfo?.seriesNavData?.seriesId;

                let manga = mediaInfo?.pageCount > 1;
                helpers.html.setClass(this._buttonViewManga, "enabled", manga);
                this._buttonViewManga.style.pointerEvents = manga? "":"none";
                if(manga)
                    this._buttonViewManga.href = getUrlForMediaId(mediaInfo.mediaId, { manga: true }).url.toString();

                this._buttonViewSeries.hidden = seriesId == null;
                if(seriesId != null)
                {
                    let args = new helpers.args("/", ppixiv.plocation);
                    args.path  = `/user/${mediaInfo.userId}/series/${seriesId}`;
                    this._buttonViewSeries.href = args.url.toString();
                }
            },
        });

        this.illustWidgets = [
            this.avatarWidget,
            new ImageInfoWidget({
                container: this.root.querySelector(".context-menu-image-info-container"),
            }),
            this._moreOptions,
        ];

        if(ppixiv.native)
        {
            let viewInExplorer = this.root.querySelector(".view-in-explorer");
            viewInExplorer.hidden = false;
            this.illustWidgets.push(new ViewInExplorerWidget({
                container: viewInExplorer,
            }));
        }

        // The bookmark buttons, and clicks in the tag dropdown:
        this.bookmarkButtons = [];
        for(let a of this.root.querySelectorAll("[data-bookmark-type]"))
        {
            // The bookmark buttons, and clicks in the tag dropdown:
            let bookmarkWidget = new BookmarkButtonWidget({
                container: a,
                // position: relative positions the bookmark count.
                template: a.dataset.bookmarkType == "public"? `
                    <div class="button button-bookmark public">
                        ${ helpers.createIcon("mat:favorite") }
                        <span class="cm-label n-unset">收藏</span>
                        <span class="cm-label n-set">已收藏</span>
                    </div>
                `:`
                    <div class="button button-bookmark private">
                        ${ helpers.createIcon("mat:lock") }
                        <span class=cm-label>私密收藏</span>
                    </div>
                `,
                bookmarkType: a.dataset.bookmarkType,
            });

            this.bookmarkButtons.push(bookmarkWidget);
            this.illustWidgets.push(bookmarkWidget);
        }

        this.root.querySelector(".button-bookmark-download").addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this._bookmarkAndDownload(this._effectiveMediaId);
        });
        this._buttonSimilar = this.root.querySelector(".button-similar");

        this.refresh();
    }

    // "list", "strip" or "cross".  See the template.
    get menuStyle()
    {
        return ppixiv.settings.get("context_menu_style");
    }

    _applyStyle = () =>
    {
        this.root.dataset.cmStyle = this.menuStyle;
    }

    _contextMenuEnabledForElement(element)
    {
        let target = element.closest("[data-context-menu-target]");
        if(target == null || target.dataset.contextMenuTarget == "off")
            return false;
        else
            return true;
    }

    pointerevent = (e) =>
    {
        if(e.pressed)
        {
            if(!this.visible && !this._contextMenuEnabledForElement(e.target))
                return;
            
            if(!this.visible && e.mouseButton != 1)
                return;

            let buttonName = this.buttons[e.mouseButton];
            if(buttonName != null)
                this._buttonsDown[buttonName] = true;
            if(e.mouseButton != 1)
                return;

            // If invert-popup-hotkey is true, hold shift to open the popup menu.  Otherwise,
            // hold shift to suppress the popup menu so the browser context menu will open.
            //
            // Firefox doesn't cancel the context menu if shift is pressed.  This seems like a
            // well-intentioned but deeply confused attempt to let people override pages that
            // block the context menu, making it impossible for us to let you choose context
            // menu behavior and probably making it impossible for games to have sane keyboard
            // behavior at all.
            this.shiftWasPressed = e.shiftKey;
            if(navigator.userAgent.indexOf("Firefox/") == -1 && ppixiv.settings.get("invert-popup-hotkey"))
                this.shiftWasPressed = !this.shiftWasPressed;
            if(this.shiftWasPressed)
                return;

            e.preventDefault();
            e.stopPropagation();

            if(this.toggleMode && this.visible)
                this.hide();
            else
                this.show({x: e.clientX, y: e.clientY, target: e.target});
        } else {
            // Releasing the left or right mouse button hides the menu if both the left
            // and right buttons are released.  Pressing right, then left, then releasing
            // right won't close the menu until left is also released.  This prevents lost
            // inputs when quickly right-left clicking.
            if(!this.visible)
                return;

            let buttonName = this.buttons[e.mouseButton];
            if(buttonName != null)
                this._buttonsDown[buttonName] = false;

            this._hideIfAllButtonsReleased();
        }
    }

    // If true, RMB toggles the menu instead of displaying while held, and we'll also hide the
    // menu if the mouse moves too far away.
    get toggleMode()
    {
        return ppixiv.settings.get("touchpad-mode", false);
    }

    // The subclass can override this to handle key events.  This is called whether the menu
    // is open or not.
    _handleKeyEvent(e) { return false; }

    _onKeyEvent = (e) =>
    {
        if(e.repeat)
            return;

        // Don't eat inputs if we're inside an input.
        if(e.target.closest("input, textarea, [contenteditable]"))
            return;

        // With a dialog open, hotkeys would act on the work behind it.  The app skips its own
        // hotkeys then too.
        if(DialogWidget.activeDialogs.length > 0)
            return;

        // Let the subclass handle events.
        if(this._handleKeyEvent(e))
        {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
    }

    _getHoveredElement()
    {
        let x = PointerListener.latestMouseClientPosition[0];
        let y = PointerListener.latestMouseClientPosition[1];
        return document.elementFromPoint(x, y);
    }

    _ctrlWasPressed = (down) =>
    {
        if(!ppixiv.settings.get("ctrl_opens_popup"))
            return;

        this._buttonsDown["Control"] = down;

        if(down)
        {
            let x = PointerListener.latestMouseClientPosition[0];
            let y = PointerListener.latestMouseClientPosition[1];
            let node = this._getHoveredElement();
            this.show({x, y, target: node});
        } else {
            this._hideIfAllButtonsReleased();
        }
    }

    // This is called on mouseup, and when keyboard shortcuts are released.  Hide the menu if all buttons
    // that can open the menu have been released.
    _hideIfAllButtonsReleased()
    {
        if(this.toggleMode)
            return;

        if(!this._buttonsDown["lmb"] && !this._buttonsDown["rmb"] && !this._buttonsDown["Control"])
            this.hide();
    }

    _windowBlur = (e) =>
    {
        this.hide();
    }

    // Return the element that should be under the cursor when the menu is opened.
    get elementToCenter()
    {
        return null;
    }

    show({x, y, target})
    {
        // See if the click is inside a ViewerImages.
        let widget = Widget.fromNode(target, { allowNone: true });
        this._currentViewer = null;
        if(widget)
        {
            // To avoid importing ViewerImages here, just look for a widget in the tree
            // with zoomToggle.
            for(let parent of widget.ancestors({includeSelf: true}))
            {
                if(parent.zoomToggle != null)
                {
                    this._currentViewer = parent;
                    break;
                }
            }
        }


        // If RMB is pressed while dragging LMB, stop dragging the window when we
        // show the popup.
        if(this._currentViewer != null)
            this._currentViewer.stopDragging();

        // See if an element representing a user and/or an illust was under the cursor.
        if(target != null)
        {
            let { mediaId } = ppixiv.app.getMediaIdAtElement(target);
            this._setTemporaryIllust(mediaId);
        }

        if(this.visible)
            return;

        this.pointerListener.checkMissedClicks();

        // 更多 starts closed each time the menu opens.
        this._setMoreOpen(false);

        this.displayedMenu = this.root;
        this.visible = true;
        this.applyVisibility();
        OpenWidgets.singleton.set(this, true);

        // Disable popup UI while a context menu is open.
        ClassFlags.get.set("hide-ui", true);
        
        window.addEventListener("blur", this._windowBlur);

        // Disable all dragging while the context menu is open, since drags cause browsers to
        // forget to send mouseup events, which throws things out of whack.  We don't use
        // drag and drop and there's no real reason to use it while the context menu is open.
        window.addEventListener("dragstart", this.cancelEvent, true);

        // In toggle mode, close the popup if anything outside is clicked.
        if(this.toggleMode && this.clickOutsideListener == null)
        {
            this.clickOutsideListener = new ClickOutsideListener([this.root], () => {
                this.hide();
            });
        }

        let centeredElement = this.elementToCenter;
        if(centeredElement == null)
            centeredElement = this.displayedMenu;

        // The center of the centered element, relative to the menu.  Shift the center
        // down a bit in the button.
        let pos = helpers.html.getRelativePosition(centeredElement, this.displayedMenu);
        pos[0] += centeredElement.offsetWidth / 2;
        pos[1] += centeredElement.offsetHeight * 3 / 4;
        x -= pos[0];
        y -= pos[1];

        this.popupPosition = { x, y };
        this.setCurrentPosition();

        // Adjust the fade-in so it's centered around the centered element.
        this.displayedMenu.style.transformOrigin = (pos[0]) + "px " + (pos[1]) + "px";

        HideMouseCursorOnIdle.disableAll("contextMenu");

        // Make sure we're up to date if we deferred an update while hidden.
        this.refresh();
    }

    setCurrentPosition()
    {
        let { x, y } = this.popupPosition;

        // Keep the menu on screen.  Upstream skipped this in the viewer to keep the zoom
        // button under the cursor, which cut the menu off near the window edges.  The zoom
        // button still lands under the cursor everywhere else.
        let margin = 8;
        let maxX = window.innerWidth - margin - this.displayedMenu.offsetWidth;
        let maxY = window.innerHeight - margin - this.displayedMenu.offsetHeight;
        x = helpers.math.clamp(x, margin, Math.max(margin, maxX));
        y = helpers.math.clamp(y, margin, Math.max(margin, maxY));

        this.displayedMenu.style.left = `${x}px`;
        this.displayedMenu.style.top = `${y}px`;
    }

    _setMoreOpen(open)
    {
        this._moreOpen = open;
        this._moreGroup.hidden = !open;
        helpers.html.setClass(this._buttonMore, "selected", open);
        this._moreOptions.visible = open;
        this._layoutMore();
    }

    // Fit the open 更多 rows in the window.  In the list and strip styles they grow the menu
    // downward from the 更多 row, so nothing above it moves.  If they don't fit, the group scrolls
    // inside, and only if even three rows don't fit does the whole menu move up.  The cross style
    // can't grow, so the rows are a panel beside it, which moves up instead of the menu.
    _layoutMore()
    {
        let group = this._moreGroup;
        group.style.maxHeight = "";
        group.style.top = "";
        if(!this.visible)
            return;

        if(this._moreOpen)
        {
            let margin = 8;
            let rows = [...group.querySelectorAll(".box-link")].filter((row) => !row.hidden);
            let rowHeight = rows[0]?.offsetHeight ?? 0;
            let padding = group.offsetHeight - group.clientHeight + parseFloat(getComputedStyle(group).paddingTop) * 2;
            let minHeight = Math.min(group.offsetHeight, (this.menuStyle == "strip"? 1:3) * rowHeight + padding);
            let menuTop = parseFloat(this.root.style.top);

            if(this.menuStyle == "cross")
            {
                let menuRight = parseFloat(this.root.style.left) + this.root.offsetWidth;
                this.root.dataset.moreSide = window.innerWidth - menuRight < 228? "left":"right";

                let top = this._buttonMore.offsetTop;
                let available = window.innerHeight - margin - menuTop - top;
                if(group.offsetHeight > available)
                {
                    group.style.maxHeight = `${Math.max(available, minHeight)}px`;
                    top -= Math.max(0, minHeight - available);
                }
                group.style.top = `${top}px`;
                return;
            }

            let available = window.innerHeight - margin - menuTop - (this.root.offsetHeight - group.offsetHeight);
            if(group.offsetHeight > available)
                group.style.maxHeight = `${Math.max(available, minHeight)}px`;
        }

        this.setCurrentPosition();
    }

    // If element is within a button that has a tooltip set, show it.
    _showTooltipForElement(element)
    {
        if(element != null)
            element = element.closest("[data-popup]");
        
        if(this._tooltipElement == element)
            return;

        this._tooltipElement = element;
        this._refreshTooltip();

        if(this._tooltipObserver)
        {
            this._tooltipObserver.disconnect();
            this._tooltipObserver = null;
        }

        if(this._tooltipElement == null)
            return;

        // Refresh the tooltip if the popup attribute changes while it's visible.
        this._tooltipObserver = new MutationObserver((mutations) => {
            for(let mutation of mutations) {
                if(mutation.type == "attributes")
                {
                    if(mutation.attributeName == "data-popup")
                        this._refreshTooltip();
                }
            }
        });
        
        this._tooltipObserver.observe(this._tooltipElement, { attributes: true });
    }

    _refreshTooltip()
    {
        let element = this._tooltipElement;
        if(element != null)
            element = element.closest("[data-popup]");
        this.root.querySelector(".tooltip-display").hidden = element == null;
        if(element != null)
            this.root.querySelector(".tooltip-display-text").dataset.popup = element.dataset.popup;
    }

    onmouseover = (e) =>
    {
        this._showTooltipForElement(e.target);
    }

    onmouseout = (e) =>
    {
        this._showTooltipForElement(e.relatedTarget);
    }

    get hideTemporarily()
    {
        return this._hiddenTemporarily;
    }

    set hideTemporarily(value)
    {
        this._hiddenTemporarily = value;
        this.callVisibilityChanged();
    }

    // True if the widget is active (eg. RMB is pressed) and we're not hidden
    // by a zoom.
    get actuallyVisible()
    {
        if(this.visible)
            return true;

        // We're still visible if we're becoming hidden but we still have animations running.
        if(this.root.getAnimations().length > 0)
            return true;

        return false;
    }

    visibilityChanged()
    {
        super.visibilityChanged();
        OpenWidgets.singleton.set(this, this.visible);
    }

    applyVisibility()
    {
        let visible = this.visible && !this._hiddenTemporarily;
        helpers.html.setClass(this.root, "hidden-widget", !visible);
        helpers.html.setClass(this.root, "visible", visible);
    }

    hide()
    {
        // For debugging, this can be set to temporarily force the context menu to stay open.
        if(window.keepContextMenuOpen)
            return;

        if(!this.visible)
            return;

        this.visible = false;
        this._hiddenTemporarily = false;
        this.applyVisibility();
        OpenWidgets.singleton.set(this, false);

        this.displayedMenu = null;
        HideMouseCursorOnIdle.enableAll("contextMenu");
        this._buttonsDown = {};
        ClassFlags.get.set("hide-ui", false);
        window.removeEventListener("blur", this._windowBlur);
        window.removeEventListener("dragstart", this.cancelEvent, true);

        if(this.clickOutsideListener)
        {
            this.clickOutsideListener.shutdown();
            this.clickOutsideListener = null;
        }
    }

    cancelEvent = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();
    }

    // Override ctrl-clicks inside the context menu.
    //
    // This is a bit annoying.  Ctrl-clicking a link opens it in a tab, but we allow opening the
    // context menu by holding ctrl, which means all clicks are ctrl-clicks if you use the popup
    // that way.  We work around this by preventing ctrl-click from opening links in a tab and just
    // navigate normally.  This is annoying since some people might like opening tabs that way, but
    // there's no other obvious solution other than changing the popup menu hotkey.  That's not a
    // great solution since it needs to be on Ctrl or Alt, and Alt causes other problems, like showing
    // the popup menu every time you press alt-left.
    //
    // This only affects links inside the context menu, which is currently only the author link, and
    // most people probably use middle-click anyway, so this will have to do.
    _handleLinkClick = (e) =>
    {
        // Do nothing if opening the popup while holding ctrl is disabled.
        if(!ppixiv.settings.get("ctrl_opens_popup"))
            return;

        let a = e.target.closest("A");
        if(a == null)
            return;

        // If a previous event handler called preventDefault on this click, ignore it.
        if(e.defaultPrevented)
            return;

        // Only change ctrl-clicks.
        if(e.altKey || e.shiftKey || !helpers.isCtrlPressed(e))
            return;

        e.preventDefault();
        e.stopPropagation();

        let url = new URL(a.href, ppixiv.plocation);
        helpers.navigate(url);
    }

    visibilityChanged(value)
    {
        super.visibilityChanged(value);

        if(this.visible)
            window.addEventListener("wheel", this.onwheel, {
                capture: true,

                // Work around Chrome intentionally breaking event listeners.  Remember when browsers
                // actually made an effort to not break things?
                passive: false,
            });
        else
            window.removeEventListener("wheel", this.onwheel, true);
    }

    // Return the media ID active in the context menu, or null if none.
    //
    // If we're opened by right clicking on an illust, we'll show that image's
    // info.  Otherwise, we'll show the info for the illust we're on, if any.
    get _effectiveMediaId()
    {
        let mediaId = this._clickedMediaId ?? this._mediaId;
        if(mediaId == null)
            return null;

        // Don't return users this way.  They'll be returned by _effectiveUserId.
        let { type } = helpers.mediaId.parse(mediaId);
        if(type == "user")
            return null;

        return mediaId;
    }

    get _effectiveUserId()
    {
        // See if getUserIdFromMediaId has loaded the user ID.
        return this.getUserIdFromMediaId.info.userId;
    }

    setMediaId(mediaId)
    {
        if(this._mediaId == mediaId)
            return;

        this._mediaId = mediaId;
        this.getUserIdFromMediaId.id = this._clickedMediaId ?? this._mediaId;
        this.refresh();
    }

    // Put the zoom toggle button under the cursor, so right-left click is a quick way
    // to toggle zoom lock.
    //
    // The list style leaves the zoom row out where there's nothing to zoom.  Put the cursor on
    // the size and date line then, which does nothing when clicked.
    get elementToCenter()
    {
        let zoom = this.displayedMenu.querySelector(".button-zoom");
        if(zoom.offsetParent != null)
            return zoom;
        return this.displayedMenu.querySelector(".context-menu-image-info-container");
    }
        
    get _isZoomUiEnabled()
    {
        return this._currentViewer != null && this._currentViewer.slideshowMode == null;
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;

        for(let widget of this.illustWidgets)
        {
            if(widget.setDataSource)
                widget.setDataSource(dataSource);
        }

        this.refresh();
    }

    // Handle key events.  This is called whether the context menu is open or closed, and handles
    // global hotkeys.  This is handled here because it has a lot of overlapping functionality with
    // the context menu.
    //
    // The actual actions may happen async, but this always returns synchronously since the keydown/keyup
    // event needs to be defaultPrevented synchronously.
    //
    // We always return true for handled hotkeys even if we aren't able to perform them currently, so
    // keys don't randomly revert to default actions.
    _handleKeyEventForImage(e)
    {
        // These hotkeys require an image, which we have if we're viewing an image or if the user
        // was hovering over an image in search results.  We might not have the illust info yet,
        // but we at least need an illust ID.
        let mediaId = this._effectiveMediaId;
        let screenName = ppixiv.app.getDisplayedScreen()

        // If there's no effective media ID, the user is pressing a key while the context menu isn't
        // open.  If the cursor is over a search thumbnail, use its media ID if any, to allow hovering
        // over a thumbnail and using bookmark, etc. hotkeys.  This isn't needed when ctrl_opens_popup
        // is open since we'll already have _effectiveMediaId.
        if(mediaId == null)
        {
            let node = this._getHoveredElement();
            mediaId = ppixiv.app.getMediaIdAtElement(node).mediaId;
        }

        // Escape when on the illust view backs out to the search.  With a dialog open, the dialog
        // closes and the viewer stays.
        if(e.code == "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && screenName == "illust" &&
           DialogWidget.activeDialogs.length == 0)
        {
            ppixiv.phistory.back();
            return true;
        }

        // Handle VVbrowser-specific hotkeys.
        if(LocalAPI.isVVbrowser())
        {
            // Handle alt-left and alt-right for navigation.  This isn't done by VVBrowser itself.
            // Don't use phistory here.  It doesn't handle forwards navigation, and we know
            // we're not in phistory permanent mode since VVbrowser isn't used on mobile.           
            if(e.altKey && e.key == "ArrowLeft")
            {
                navigation.back();
                e.preventDefault();
            }
            else if(e.altKey && e.key == "ArrowRight")
            {
                navigation.forward();
                e.preventDefault();
            }
        }

        // All of these hotkeys require Ctrl.
        if(!helpers.isCtrlPressed(e))
            return;

        if(e.key.toUpperCase() == "V")
        {
            if(mediaId == null)
                return;

            Actions.likeImage(mediaId);

            return true;
        }

        if(e.key.toUpperCase() == "B")
        {
            (async() => {
                if(mediaId == null)
                    return;

                let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });

                // Ctrl-Shift-Alt-B: add a bookmark tag
                if(e.altKey && e.shiftKey)
                {
                    Actions.addNewBookmarkTag(mediaId);
                    return;
                }

                // Ctrl-Shift-B: unbookmark
                if(e.shiftKey)
                {
                    if(mediaInfo.bookmarkData == null)
                    {
                        ppixiv.message.show("Image isn't bookmarked");
                        return;
                    }

                    Actions.bookmarkRemove(mediaId);
                    return;
                }

                // Ctrl-B: bookmark with default privacy
                // Ctrl-Alt-B: bookmark privately
                let bookmarkPrivately = null;
                if(e.altKey)
                    bookmarkPrivately = true;

                if(mediaInfo.bookmarkData != null)
                {
                    ppixiv.message.show("Already bookmarked (^B to remove bookmark)");
                    return;
                }

                Actions.bookmarkAdd(mediaId, {
                    private: bookmarkPrivately
                });
            })();
            
            return true;
        }

        if(e.key.toUpperCase() == "P")
        {
            let enable = !ppixiv.settings.get("auto_pan", false);
            ppixiv.settings.set("auto_pan", enable);

            ppixiv.message.show(`Image panning ${enable? "enabled":"disabled"}`);
            return true;
        }

        if(e.key.toUpperCase() == "S")
        {
            // Go async to get media info if it's not already available.
            (async() => {
                if(mediaId == null)
                    return;

                // Download the image or video by default.  If alt is pressed and the image has
                // multiple pages, download a ZIP instead.
                let mediaInfo = await ppixiv.mediaCache.getMediaInfo(mediaId, { full: false });
                let downloadType = "image";
                if(Actions.isDownloadTypeAvailable("image", mediaInfo))
                    downloadType = "image";
                else if(Actions.isDownloadTypeAvailable("MKV", mediaInfo))
                    downloadType = "MKV";

                if(e.altKey && Actions.isDownloadTypeAvailable("ZIP", mediaInfo))
                    downloadType = "ZIP";
    
                Actions.downloadIllust(mediaId, downloadType);
            })();

            return true;
        }

        return false;
    }

    _handleKeyEventForUser(e)
    {
        // These hotkeys require a user, which we have if we're viewing an image, if the user
        // was hovering over an image in search results, or if we're viewing a user's posts.
        // We might not have the user info yet, but we at least need a user ID.
        let userId = this._effectiveUserId;

        // All of these hotkeys require Ctrl.
        if(!helpers.isCtrlPressed(e))
            return;

        if(e.key.toUpperCase() == "F")
        {
            (async() => {
                if(userId == null)
                    return;

                let userInfo = await ppixiv.userCache.getUserInfo(userId, { full: true });
                if(userInfo == null)
                    return;

                // Ctrl-Shift-F: unfollow
                if(e.shiftKey)
                {
                    if(!userInfo.isFollowed)
                    {
                        ppixiv.message.show("Not following this user");
                        return;
                    }

                    await Actions.unfollow(userId);
                    return;
                }
            
                // Ctrl-F: follow with default privacy
                // Ctrl-Alt-F: follow privately
                //
                // It would be better to check if we're following publically or privately to match the hotkey, but
                // Pixiv doesn't include that information.
                let followPrivately = null;
                if(e.altKey)
                    followPrivately = true;

                if(userInfo.isFollowed)
                {
                    ppixiv.message.show("Already following this user");
                    return;
                }
            
                await Actions.follow(userId, followPrivately);
            })();

            return true;
        }

        return false;
    }

    _handleKeyEvent(e)
    {
        if(e.type != "keydown")
            return false;

        if(e.altKey && e.key == "Enter")
        {
            helpers.toggleFullscreen();
            return true;
        }

        if(this._isZoomUiEnabled)
        {
            // Ctrl-0 toggles zoom, similar to the browser Ctrl-0 reset zoom hotkey.
            if(e.code == "Digit0" && e.ctrlKey)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._currentViewer.zoomToggle();
                return;
            }

            let zoom = helpers.isZoomHotkey(e);
            if(zoom != null)
            {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._handleZoomEvent(e, zoom < 0);
                return true;
            }
        }

        // Check image and user hotkeys.
        if(this._handleKeyEventForImage(e))
            return true;

        if(this._handleKeyEventForUser(e))
            return true;
        
        return false;
    }

    onwheel = (e) =>
    {
        // RMB-wheel zooming is confusing in toggle mode.
        if(this.toggleMode)
            return;

        // In a list, the wheel over a multi-page work shows its other pages in the thumbnail.
        // See docs/design.md.
        if(this._wheelScrollsMore(e))
            return;

        if(this.visible && !this._isZoomUiEnabled && this._clickedMediaId != null &&
           this.avatarWidget.userDropdownWidget == null && !e.target.closest(".popup-bookmark-tag-dropdown"))
        {
            if(ppixiv.settings.get("debounce_wheel") && e.timeDelta != -1 && e.timeDelta < 50)
                return;

            if(stepThumbnailPage(this._clickedMediaId, e.deltaY > 0? 1:-1))
            {
                e.preventDefault();
                e.stopImmediatePropagation();

                // Hide the menu so the thumbnail shows, the same as zooming in the viewer.
                this.hideTemporarily = true;
                return;
            }
        }

        // Stop if zooming isn't enabled.
        if(!this._isZoomUiEnabled)
            return;

        // Stop if the user dropdown is open.
        let userDropdown = this.avatarWidget.userDropdownWidget;
        if(userDropdown)
        {
            // If the input isn't inside the dropdown, prevent the input so we don't navigate
            // while the dropdown is open.  Otherwise, leave it alone to allow scrolling the
            // dropdown.  This includes submenus (the bookmark tag dropdown).
            let targetWidget = Widget.fromNode(e.target);
            if(targetWidget)
            {
                if(!userDropdown.isAncestorOf(targetWidget))
                {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
                
            }
            return;
        }

        // Only mousewheel zoom if the popup menu is visible.
        if(!this.visible)
            return;

        // We want to override almost all mousewheel events while the popup menu is open, but
        // don't override scrolling the popup menu's tag list.
        if(e.target.closest(".popup-bookmark-tag-dropdown"))
            return;

        e.preventDefault();
        e.stopImmediatePropagation();
        
        let down = e.deltaY > 0;
        this._handleZoomEvent(e, down);
    }
    
    // The open 更多 rows scroll when they're cut short near the window's bottom edge.
    _wheelScrollsMore(e)
    {
        let group = this._moreGroup;
        return this.visible && group.contains(e.target) && group.scrollHeight > group.clientHeight;
    }

    // Handle both mousewheel and control-+/- zooming.
    _handleZoomEvent(e, down)
    {
        e.preventDefault();
        e.stopImmediatePropagation();

        if(!this.hideTemporarily)
        {
            // Hide the popup menu.  It remains open, so hide() will still be called when
            // the right mouse button is released and the overall flow remains unchanged, but
            // the popup itself will be hidden.
            this.hideTemporarily = true;
        }

        // If e is a keyboard event, use null to use the center of the screen.
        let keyboard = e instanceof KeyboardEvent;
        let x = keyboard? null:e.clientX;
        let y = keyboard? null:e.clientY;

        this._currentViewer.zoomAdjust(down, {x, y});
        
        this.refresh();
    }

    // Set an alternative illust ID to show.  This is effective until the context menu is hidden.
    // This is used to remember what the cursor was over when the context menu was opened when in
    // the search view.
    _setTemporaryIllust(mediaId)
    {
        if(this._clickedMediaId == mediaId)
            return;

        this._clickedMediaId = mediaId;
        this.getUserIdFromMediaId.id = this._clickedMediaId ?? this._mediaId;
        this.refresh();
    }

    // Update selection highlight for the context menu.
    // Bookmark a work with the default privacy, if it isn't bookmarked yet, and download it: the
    // original image, a ZIP of every page for multi-page works, or an MKV for animations.
    async _bookmarkAndDownload(mediaId)
    {
        await Actions.bookmarkAndDownload(mediaId);
    }

    refresh()
    {
        let mediaId = this._effectiveMediaId;

        // Point the similar works button at the work under the menu.
        let similarId = mediaId != null && helpers.mediaId.parse(mediaId).type == "illust"?
            helpers.mediaId.toIllustIdAndPage(mediaId)[0]:null;
        this._buttonSimilar.href = similarId? `/bookmark_detail.php?illust_id=${similarId}#ppixiv?recommendations=1`:"#";
        helpers.html.setClass(this._buttonSimilar, "enabled", similarId != null);
        if(this.visible)
            this.getMediaInfo.id = mediaId;

        // If we're not visible, don't refresh an illust until we are, so we don't trigger
        // data loads.  Do refresh even if we're hidden if we have no illust to clear
        // the previous illust's display even if we're not visible, so it's not visible the
        // next time we're displayed.
        if(!this.visible && mediaId != null)
            return;

        let userId = this._effectiveUserId;
        helpers.html.setClass(this._buttonFullscreen, "selected", helpers.isFullscreen());

        this._refreshTooltip();

        // Enable the zoom buttons if we're in the image view and we have an ViewerImages.
        for(let element of this.root.querySelectorAll(".button.requires-zoom"))
            helpers.html.setClass(element, "enabled", this._isZoomUiEnabled);

        // If we're visible, tell widgets what we're viewing.  Don't do this if we're not visible, so
        // they don't load data unnecessarily.  Don't set these back to null if we're hidden, so they
        // don't blank themselves while we're still fading out.
        if(this.visible)
        {
            for(let widget of this.illustWidgets)
            {
                if(widget.setMediaId)
                    widget.setMediaId(mediaId);
                if(widget.setUserId)
                    widget.setUserId(userId);

                // If _clickedMediaId is set, we're open for a search result image the user right-clicked
                // on.  Otherwise, we're open for the image actually being viewed.  Tell ImageInfoWidget
                // to show the current manga page if we're on a viewed image, but not if we're on a search
                // result.
                let showingViewedImage = (this._clickedMediaId == null);
                widget.showPageNumber = showingViewedImage;
            }

            // If we're on a local ID, show the parent folder button.  Otherwise, show the
            // author button.  We only show one or the other of these.
            //
            // If we don't have an illust ID, see if the data source has a folder ID, so this
            // works when right-clicking outside thumbs on search pages.
            let folderButton = this.root.querySelector(".button-parent-folder");
            let authorButton = this.root.querySelector(".avatar-widget-container");

            let isLocal = helpers.mediaId.isLocal(this._folderIdForParent);
            folderButton.hidden = !isLocal;
            authorButton.hidden = isLocal;
            helpers.html.setClass(folderButton, "enabled", this._parentFolderId != null);
            this.querySelector(".private-bookmark-button").hidden = isLocal;
        }

        if(this._isZoomUiEnabled)
        {
            helpers.html.setClass(this.root.querySelector(".button-zoom"), "selected", this._currentViewer.getLockedZoom());

            let zoomLevel = this._currentViewer.getZoomLevel();
            for(let button of this.root.querySelectorAll(".button-zoom-level"))
                helpers.html.setClass(button, "selected", this._currentViewer.getLockedZoom() && button.dataset.level == zoomLevel);
        }
    }

    _clickedFullscreen = async (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        await helpers.toggleFullscreen();
        this.refresh();
    }

    // "Zoom lock", zoom as if we're holding the button constantly
    _clickedToggleZoom = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._isZoomUiEnabled)
            return;
        
        this._currentViewer.zoomToggle({x: e.clientX, y: e.clientY})
        this.refresh();
    }

    _clickedZoomLevel = (e) =>
    {
        e.preventDefault();
        e.stopPropagation();

        if(!this._isZoomUiEnabled)
            return;

        this._currentViewer.zoomSetLevel(e.currentTarget.dataset.level, {x: e.clientX, y: e.clientY});
        this.refresh();
    }

    // Return the illust ID whose parent the parent button will go to.
    get _folderIdForParent()
    {
        if(this._effectiveMediaId != null)
            return this._effectiveMediaId;

        let dataSourceMediaId = this.dataSource?.uiInfo.mediaId;
        if(helpers.mediaId.isLocal(dataSourceMediaId))
            return dataSourceMediaId;

        return null;
    }

    // Return the folder ID that the parent button goes to.
    get _parentFolderId()
    {
        let folderId = this._folderIdForParent;
        let isLocal = helpers.mediaId.isLocal(folderId);
        if(!isLocal)
            return null;

        // Go to the parent of the item that was clicked on. 
        let parentFolderId = LocalAPI.getParentFolder(folderId);

        // If the user right-clicked a thumbnail and its parent is the folder we're
        // already displaying, go to the parent of the folder instead (otherwise we're
        // linking to the page we're already on).  This makes the parent button make
        // sense whether you're clicking on an image in a search result (go to the
        // location of the image), while viewing an image (also go to the location of
        // the image), or in a folder view (go to the folder's parent).
        let currentlyDisplayingId = LocalAPI.getLocalIdFromArgs(helpers.args.location);
        if(parentFolderId == currentlyDisplayingId)
            parentFolderId = LocalAPI.getParentFolder(parentFolderId);

        return parentFolderId;
    }

    clicked_go_to_parent = (e) =>
    {
        e.preventDefault();
            
        let parentFolderId = this._parentFolderId;
        if(parentFolderId == null)
            return;

        let args = new helpers.args("/", ppixiv.plocation);
        LocalAPI.getArgsForId(parentFolderId, args);
        helpers.navigate(args.url);
    }
}

class ImageInfoWidget extends IllustWidget
{
    constructor({
        showTitle=false,
        ...options})
    {
        super({ ...options, template: `
            <div class=context-menu-image-info>
                <div class=title-text-block>
                    <span class=folder-block hidden>
                        <span class=folder-text></span>
                        <span class=slash">/</span>
                    </span>
                    <span class=title hidden></span>
                </div>
                <div class=page-count hidden></div>
                <div class=image-info hidden></div>
                <div class="post-age popup" hidden></div>
            </div>
        `});

        this.showTitle = showTitle;
    }

    get neededData()
    {
        // We need illust info if we're viewing a manga page beyond page 1, since
        // early info doesn't have that.  Most of the time, we only need early info.
        let mangaPage = this.mangaPage;
        if(mangaPage == null || mangaPage == 0)
            return "partial";
        else
            return "full";
    }

    set showPageNumber(value)
    {
        this._showPageNumber = value;
        this.refresh();
    }

    refreshInternal({ mediaId, mediaInfo })
    {
        this.root.hidden = mediaInfo == null;
        if(this.root.hidden)
            return;

        let setInfo = (query, text) =>
        {
            let node = this.root.querySelector(query);
            node.innerText = text;
            node.hidden = text == "";
        };
        
        // Add the page count for manga.  If the data source is dataSource.vview, show
        // the index of the current file if it's loaded all results.
        let pageCount = mediaInfo.pageCount;
        let pageText = this.dataSource.getPageTextForMediaId(mediaId);
        if(pageText == null && pageCount > 1)
        {
            let currentPage = this.mangaPage;
            if(this._showPageNumber || currentPage > 0)
                pageText = `Page ${currentPage+1}/${pageCount}`;
            else
                pageText = `${pageCount} pages`;
        }
        setInfo(".page-count", pageText ?? "");

        if(this.showTitle)
        {
            setInfo(".title", mediaInfo.illustTitle);
        
            let showFolder = helpers.mediaId.isLocal(this._mediaId);
            this.root.querySelector(".folder-block").hidden = !showFolder;
            if(showFolder)
            {
                let {id} = helpers.mediaId.parse(this._mediaId);
                this.root.querySelector(".folder-text").innerText = helpers.strings.getPathSuffix(id, 1, 1); // parent directory
            }
        }

        // If we're on the first page then we only requested early info, and we can use the dimensions
        // on it.  Otherwise, get dimensions from mangaPages from illust data.  If we're displaying a
        // manga post and we don't have illust data yet, we don't have dimensions, so hide it until
        // it's loaded.
        let info = "";
        let { width, height } = ppixiv.mediaCache.getImageDimensions(mediaInfo, this._mediaId);
        if(width != null && height != null)
            info += width + "x" + height;
        setInfo(".image-info", info);

        let secondsOld = (new Date() - new Date(mediaInfo.createDate)) / 1000;
        let age = helpers.strings.ageToString(secondsOld);
        this.root.querySelector(".post-age").dataset.popup = helpers.strings.dateToString(mediaInfo.createDate);
        setInfo(".post-age", age);
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource = dataSource;
        this.refresh();
    }
}
