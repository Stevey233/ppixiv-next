import Widget from '/vview/widgets/widget.js';
import { AvatarWidget } from '/vview/widgets/user-widgets.js';
import DialogWidget from '/vview/widgets/dialog.js';
import FilterBar from '/vview/next/filter-bar.js';
import { dataSourceSupportsFilters, filterLabel, MAX_EMPTY_PAGES } from '/vview/misc/result-filters.js';
import { helpers } from '/vview/misc/helpers.js';

export default class SearchUIMobile extends Widget
{
    constructor({...options}={})
    {
        super({
            ...options,
            template: `
                <div class=search-ui-mobile>
                    <div class=mobile-title-row>
                        <button type=button class=mobile-back hidden aria-label="返回">
                            ${ helpers.createIcon("mat:arrow_back_ios_new") }
                        </button>
                        <div class=search-title></div>
                        <button type=button class=filter-sheet-button>
                            ${ helpers.createIcon("mat:filter_list") }
                            <span class=filter-label>筛选</span>
                            <span class=filter-count hidden></span>
                        </button>
                        <div class=avatar-container></div>
                    </div>
                    <div class=data-source-ui></div>
                    <div class=mobile-filter-stopped hidden>
                        <span>连续 ${MAX_EMPTY_PAGES} 页没有符合筛选的作品，已暂停加载。</span>
                        <button type=button class=n-text-button>继续查找</button>
                    </div>
                </div>
            `
        });

        this.avatarWidget = new AvatarWidget({
            container: this.querySelector(".avatar-container"),

            // Disable the avatar widget unless the data source enables it.
            visible: false,
        });

        this.querySelector(".filter-sheet-button").addEventListener("click", () => {
            new FilterSheet({ dataSource: this.dataSource });
        });
        window.addEventListener("pp:statechange", () => this._refreshFilterButton(), this._signal);

        // Mobile history replaces entries instead of adding them (VirtualHistory "permanent"
        // mode), so the browser's Back leaves the site.  This goes back within ppixiv.
        this.querySelector(".mobile-back").addEventListener("click", () => ppixiv.phistory.back());

        this.querySelector(".mobile-filter-stopped button").addEventListener("click", () => this.dataSource?.loadMoreFiltered());
    }

    shutdown()
    {
        this.dataSource?.removeEventListener("updated", this._refreshFilterStopped);
        super.shutdown();
    }

    _refreshFilterStopped = () =>
    {
        this.querySelector(".mobile-filter-stopped").hidden = this.dataSource?.filteredStopPage == null;
    }

    _refreshFilterButton()
    {
        let button = this.querySelector(".filter-sheet-button");
        button.hidden = !dataSourceSupportsFilters(this.dataSource);
        // Name the first filter that's on, so the button says what's filtered ("竖图 +1"), not
        // just how many.
        let filters = [...(this.dataSource?.resultFilters ?? [])];
        let count = filters.length;
        this.querySelector(".filter-label").textContent = count? filterLabel(filters[0]):"筛选";
        let countNode = this.querySelector(".filter-count");
        countNode.hidden = count < 2;
        countNode.textContent = `+${count-1}`;
        helpers.html.setClass(button, "active", count > 0);
    }

    setDataSource(dataSource)
    {
        if(this._currentDataSourceUi)
        {
            this._currentDataSourceUi.shutdown();
            this._currentDataSourceUi = null;
        }

        this.dataSource?.removeEventListener("updated", this._refreshFilterStopped);
        this.dataSource = dataSource;
        this.dataSource?.addEventListener("updated", this._refreshFilterStopped);
        this._refreshFilterStopped();
        this.avatarWidget.setUserId(null);
        this.avatarWidget.visible = false;

        if(dataSource == null)
            return;

        // Create the new data source's UI.
        if(this.dataSource?.ui)
        {
            this._currentDataSourceUi = new this.dataSource.ui({
                dataSource: this.dataSource,
                container: this.querySelector(".data-source-ui"),
            });
        }
    }

    refreshUi()
    {
        if(this.dataSource)
        {
            let { userId } = this.dataSource.uiInfo;

            this.avatarWidget.visible = userId != null;
            this.avatarWidget.setUserId(userId);
        }

        let elementTitle = this.querySelector(".search-title");
        elementTitle.hidden = this.dataSource?.getDisplayingText == null;
        if(this.dataSource?.getDisplayingText != null)
        {
            let text = this.dataSource?.getDisplayingText();
            elementTitle.replaceChildren(text);
        }

        this._refreshFilterButton();
        this.querySelector(".mobile-back").hidden = !(ppixiv.phistory.permanent && ppixiv.phistory.length > 1);
    }

    applyVisibility()
    {
        helpers.html.setClass(this.root, "shown", this._visible);
    }
}

// The filters in a sheet from the bottom of the screen, so they don't take room above the results.
class FilterSheet extends DialogWidget
{
    constructor({ dataSource, ...options })
    {
        super({...options,
            dialogClass: "edit-search-dialog",
            classes: "filter-sheet",
            header: "筛选",
            template: `
                <vv-container class=filter-sheet-bar></vv-container>
                <button type=button class="n-text-button filter-sheet-done">完成</button>
            `,
        });

        let filterBar = new FilterBar({ container: this.querySelector(".filter-sheet-bar"), followCurrentDataSource: true });
        filterBar.setDataSource(dataSource);
        this.querySelector(".filter-sheet-done").addEventListener("click", () => this.visible = false);
    }

    // Filter changes replace the history entry.  Stay open so several can be changed at once.
    get _close_on_popstate() { return false; }
}
