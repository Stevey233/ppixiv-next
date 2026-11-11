import Widget from '/vview/widgets/widget.js';
import { AvatarWidget } from '/vview/widgets/user-widgets.js';
import DialogWidget from '/vview/widgets/dialog.js';
import FilterBar from '/vview/next/filter-bar.js';
import { dataSourceSupportsFilters, getFilters } from '/vview/misc/result-filters.js';
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
                        <div class=search-title></div>
                        <button type=button class=filter-sheet-button>
                            ${ helpers.createIcon("mat:filter_list") }
                            <span>筛选</span>
                            <span class=filter-count hidden></span>
                        </button>
                        <div class=avatar-container></div>
                    </div>
                    <div class=data-source-ui></div>
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
    }

    _refreshFilterButton()
    {
        let button = this.querySelector(".filter-sheet-button");
        button.hidden = !dataSourceSupportsFilters(this.dataSource);
        let count = getFilters(helpers.args.location).size;
        let countNode = this.querySelector(".filter-count");
        countNode.hidden = count == 0;
        countNode.textContent = String(count);
        helpers.html.setClass(button, "active", count > 0);
    }

    setDataSource(dataSource)
    {
        if(this._currentDataSourceUi)
        {
            this._currentDataSourceUi.shutdown();
            this._currentDataSourceUi = null;
        }

        this.dataSource = dataSource;    
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

        let filterBar = new FilterBar({ container: this.querySelector(".filter-sheet-bar") });
        filterBar.setDataSource(dataSource);
        this.querySelector(".filter-sheet-done").addEventListener("click", () => this.visible = false);
    }

    // Filter changes replace the history entry.  Stay open so several can be changed at once.
    get _close_on_popstate() { return false; }
}
