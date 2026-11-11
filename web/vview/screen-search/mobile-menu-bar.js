import Widget from '/vview/widgets/widget.js';
import CreateSearchMenu from '/vview/screen-search/search-menu.js';
import { SettingsDialog } from '/vview/widgets/settings-widgets.js';
import { DataSource_BookmarksBase } from '/vview/sites/pixiv/data-sources/bookmarks.js';
import DialogWidget from '/vview/widgets/dialog.js';
import { mainDestinations, otherDestinations } from '/vview/next/nav.js';
import { helpers } from '/vview/misc/helpers.js';

// The bottom tab bar for mobile: the main lists, search, and a "more" sheet with everything
// else.  Upstream's bar had back, refresh, a search menu, slideshow and settings, so changing
// lists took a dialog and a scroll.  See docs/design.md.
export default class MobileSearchUI extends Widget
{
    constructor(options)
    {
        super({
            ...options,
            template: `
            <div class=mobile-navigation-bar>
                <nav class="header-contents tab-bar" aria-label="列表"></nav>
            </div>
        `});

        let bar = this.root.querySelector(".tab-bar");
        let main = mainDestinations();
        let tabs = [
            main.find((d) => d.key == "discovery"),
            main.find((d) => d.key == "following"),
            { key: "search", label: "搜索", icon: "mat:search", url: "/search?s_mode=tag&type=artwork#ppixiv",
              matches: (ds) => ds?.name == "search" },
            main.find((d) => d.key == "bookmarks"),
        ];

        this._tabs = [];
        for(let tab of tabs)
        {
            let link = document.createElement("a");
            link.className = "tab";
            link.href = tab.url;
            link.innerHTML = `${ helpers.createIcon(tab.icon) }<span class=tab-label></span>`;
            link.querySelector(".tab-label").textContent = tab.label;
            bar.appendChild(link);
            this._tabs.push({ link, tab });
        }

        let more = document.createElement("button");
        more.type = "button";
        more.className = "tab tab-more";
        more.innerHTML = `${ helpers.createIcon("mat:menu") }<span class=tab-label>更多</span>`;
        more.addEventListener("click", () => new MobileMoreSheet({ searchUi: this.parent }));
        bar.appendChild(more);
    }

    applyVisibility()
    {
        helpers.html.setClass(this.root, "shown", this._visible);
    }

    refreshUi()
    {
        let dataSource = this.parent.dataSource;
        for(let { link, tab } of this._tabs)
        {
            let current = tab.matches(dataSource);
            helpers.html.setClass(link, "selected", current);
            if(current)
                link.setAttribute("aria-current", "page");
            else
                link.removeAttribute("aria-current");
        }
    }
}

// The "more" sheet: the other lists, and the actions that used to be on the bar.
class MobileMoreSheet extends DialogWidget
{
    constructor({ searchUi, ...options }={})
    {
        super({...options,
            dialogClass: "edit-search-dialog",
            classes: "more-sheet",
            header: "更多",
            template: `<div class="vertical-list more-sheet-list"></div>`,
        });

        let list = this.root.querySelector(".more-sheet-list");
        let addLink = ({ label, icon, url }) => {
            let link = document.createElement("a");
            link.className = "box-link more-sheet-row";
            link.href = url;
            link.innerHTML = `${ helpers.createIcon(icon) }<span class=label></span>`;
            link.querySelector(".label").textContent = label;
            list.appendChild(link);
            return link;
        };
        let addAction = (label, icon, action) => {
            let row = addLink({ label, icon, url: "#" });
            row.addEventListener("click", (e) => {
                e.preventDefault();
                this.visible = false;
                action();
            });
        };

        let main = mainDestinations();
        for(let destination of main.filter((d) => d.key == "rankings" || d.key == "new"))
            addLink(destination);
        for(let destination of otherDestinations())
            if(destination.url.indexOf("/search?") == -1)
                addLink(destination);
        addAction("全部列表", "mat:list", () => new MobileEditSearchDialog());

        list.appendChild(Object.assign(document.createElement("div"), { className: "more-sheet-rule" }));

        addAction("刷新", "refresh", () => searchUi.refreshSearch());
        addAction("幻灯片", "wallpaper", () => helpers.navigate(ppixiv.app.slideshowURL));
        addAction("设置", "settings", () => new SettingsDialog());
        addLink({ label: "回到 Pixiv 原页面", icon: "ppixiv:pixiv", url: "#no-ppixiv" });

        // Close after following a link.
        list.addEventListener("click", (e) => {
            if(e.target.closest("a[href]:not([href='#'])"))
                this.visible = false;
        });
    }
}

// This dialog shows the search filters that are in the header box on desktop.
class MobileEditSearchDialog extends DialogWidget
{
    constructor({...options}={})
    {
        super({...options,
            dialogClass: "edit-search-dialog",
            header: "Search",
            template: `
                <div class="search-selection vertical-list">
                </div>
            `
        });

        // Create the menu items.  This is the same as the dropdown list for desktop.
        let optionBox = this.root.querySelector(".search-selection");
        CreateSearchMenu(optionBox);

        this.root.addEventListener("click", (e) => {
            let a = e.target.closest("A");
            if(a == null)
                return;

            // Hide the dialog when any of the menu links are clicked.
            this.visible = false;

            // Don't actually navigate for clicks on rows with the disable-clicks class, since they
            // don't go anywhere.  They just refer to the search we're already on.
            if(a.classList.contains("disable-clicks"))
                e.preventDefault();
        });

        this.searchUrl = helpers.args.location;

        this.refresh();
    }

    get activeRow()
    {
        // The active row is the one who would load a data source of the same class as the current one.
        let currentDataSource = this.dataSource;

        for(let button of this.root.querySelectorAll(".navigation-button"))
        {
            let url = new URL(button.href);
            let dataSourceClass = ppixiv.site.getDataSourceForUrl(url);

            if(currentDataSource instanceof dataSourceClass)
                return button;

            // Hack: the bookmarks row corresponds to multiple subclasses.  All of them should
            // map back to the bookmarks row.
            if(currentDataSource instanceof DataSource_BookmarksBase &&
               dataSourceClass.prototype instanceof DataSource_BookmarksBase)
               return button;
        }

        throw new Error("Couldn't match data source for", currentDataSource.__proto__);
    }

    refresh()
    {
        let activeRow = this.activeRow;
        for(let button of this.root.querySelectorAll(".navigation-button"))
            helpers.html.setClass(button, "selected", button == activeRow);

        // Show this row if it's hidden.  Some rows are only displayed while they're in use.
        activeRow.widget.visible = true;

        // If this is the artist row, set the title based on the artist name.
        if(activeRow.classList.contains("artist-row"))
        {
            let title = this.dataSource.uiInfo.mobileTitle;
            if(title)
                activeRow.querySelector(".label").innerText = title;
        }
        this._recreateUi();
    }

    // We always show the primary data source.
    get dataSource()
    {
        return ppixiv.app.currentDataSource;
    }

    _recreateUi()
    {
        // Create the UI.
        let position = this.activeRow;
        let row = position.closest(".box-link-row");
        if(row)
            position = row;
    }

    // Tell DialogWidget not to close us on popstate.  It'll still close us if the screen changes.
    get _close_on_popstate() { return false; }
}
