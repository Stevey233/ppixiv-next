// The result filters as a row of toggles, shown on every list of works.  The filters live in the
// URL (see misc/result-filters.js), so each toggle is a link to the same list with that filter
// turned on or off.  Clicking one also remembers the list's hide filters.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import { SettingsDialog } from '/vview/widgets/settings-widgets.js';
import {
    FILTER_GROUPS, HIDE_FILTERS, dataSourceSupportsFilters, getFilters, setFilters, toggleFilter,
    defaultTypeFilter, typeFilter, filterAvailable, rememberFilters, filterLabel,
} from '/vview/misc/result-filters.js';

// The reasons in the hidden count, in display order, with the hide filter each one turns off.
// "other" is the type, shape and page count filters together.
const HIDDEN_REASONS = [
    ["seen", "看过", "hide-seen"],
    ["bookmarked", "已收藏", "hide-bookmarked"],
    ["ai", "AI", "hide-ai"],
    ["muted", "屏蔽标签", null],
    ["other", "其他筛选", null],
];

export default class FilterBar extends Widget
{
    // If followCurrentDataSource is true, the bar switches to the app's current data source when
    // the URL changes.  The mobile filter sheet uses this, since it stays open while filters
    // change and each set of filters has its own data source.
    constructor({ followCurrentDataSource=false, ...options }={})
    {
        super({
            ...options,
            template: `
                <div class=filter-bar role=group aria-label="筛选">
                    <div class=filter-groups></div>
                    <div class=filter-stopped hidden>
                        <span class=filter-stopped-text></span>
                        <button type=button class=filter-continue>继续查找</button>
                    </div>
                    <div class=filter-hidden hidden></div>
                </div>
            `,
        });

        let groups = this.querySelector(".filter-groups");
        let addGroup = (key, options) => {
            let group = document.createElement("div");
            group.className = "filter-group";
            group.dataset.group = key;
            for(let [value, label] of options)
            {
                let link = document.createElement("a");
                link.className = "filter-toggle";
                link.dataset.filter = value;
                link.textContent = label;
                link.setAttribute("role", "button");
                group.appendChild(link);
            }
            groups.appendChild(group);
        };

        for(let group of FILTER_GROUPS)
            addGroup(group.key, group.options);
        addGroup("hide", HIDE_FILTERS);

        // Replace the history entry rather than adding one for each toggle, so Back leaves the list
        // instead of stepping through filter changes.
        this.root.addEventListener("click", (e) => {
            let link = e.target.closest(".filter-toggle, .filter-hidden-link");
            if(link == null)
                return;
            e.preventDefault();
            e.stopPropagation();
            let args = new helpers.args(link.href);
            if(this.dataSource)
                rememberFilters(this.dataSource.filterListKey, getFilters(args));
            helpers.navigate(args, { addToHistory: false, scrollToTop: true });
        });

        this.querySelector(".filter-continue").addEventListener("click", () => this.dataSource?.loadMoreFiltered());
        this.querySelector(".filter-hidden").addEventListener("click", (e) => {
            if(e.target.closest(".filter-hidden-muted"))
                new SettingsDialog({ showPage: "tagMuting" });
        });
        window.addEventListener("pp:statechange", () => {
            this.refresh();

            // The app switches data sources in its own statechange handler, so look after it.
            if(followCurrentDataSource)
                setTimeout(() => this.setDataSource(ppixiv.app.currentDataSource), 0);
        }, this._signal);
    }

    shutdown()
    {
        this.dataSource?.removeEventListener("updated", this.refresh);
        this.dataSource?.removeEventListener("pageadded", this._refreshHidden);
        super.shutdown();
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource?.removeEventListener("updated", this.refresh);
        this.dataSource?.removeEventListener("pageadded", this._refreshHidden);
        this.dataSource = dataSource;
        this.dataSource?.addEventListener("updated", this.refresh);
        this.dataSource?.addEventListener("pageadded", this._refreshHidden);
        this.refresh();
    }

    refresh = () =>
    {
        let supported = dataSourceSupportsFilters(this.dataSource);
        this.root.hidden = !supported;
        if(!supported)
            return;

        // A list whose API can't show every type at once shows its default type as selected.  Turning
        // it off leaves the list as it is, and it's left out of URLs, so the list has one data source.
        //
        // Read the filters from the URL and not the data source: the phone sheet refreshes before
        // the app has switched to the new URL's data source.
        let listKey = this.dataSource.filterListKey;
        let filters = new Set([...getFilters(helpers.args.location)].filter((value) => filterAvailable(listKey, value)));
        let defaultType = defaultTypeFilter(this.dataSource.name);
        if(defaultType != null && typeFilter(filters) == null)
            filters.add(defaultType);

        for(let link of this.root.querySelectorAll(".filter-toggle"))
        {
            let value = link.dataset.filter;
            link.hidden = !filterAvailable(listKey, value);
            let on = filters.has(value);
            let args = helpers.args.location;
            let result = toggleFilter(filters, value, !on);
            result.delete(defaultType);
            setFilters(args, result);
            args.query.delete("p");
            link.href = args.url;
            helpers.html.setClass(link, "selected", on);
            link.setAttribute("aria-pressed", String(on));
        }

        let stopped = this.dataSource.loadStoppedText;
        this.querySelector(".filter-stopped").hidden = stopped == null;
        this.querySelector(".filter-stopped-text").textContent = stopped ?? "";
        this._refreshHidden();
    }

    // "已隐藏 48：看过 30 · 已收藏 12 · 屏蔽标签 6" or "已隐藏 375：已收藏", for what the filters hid on this list.  A reason
    // with a hide toggle links to the list with that toggle off, 屏蔽标签 opens the muted tags, and
    // 其他筛选 links to the list without the type, shape or page filter if only one is on.
    _refreshHidden = () =>
    {
        let node = this.querySelector(".filter-hidden");
        let counts = this.dataSource?.hiddenCounts ?? {};
        let total = HIDDEN_REASONS.reduce((sum, [reason]) => sum + (counts[reason] ?? 0), 0);
        node.hidden = total == 0;
        if(total == 0)
            return;

        let toggleFor = (value) => this.root.querySelector(`.filter-toggle[data-filter="${value}"]`);
        let urlFilters = getFilters(helpers.args.location);
        let others = [...this.querySelectorAll(".filter-group:not([data-group=hide]) .filter-toggle")]
            .filter((link) => urlFilters.has(link.dataset.filter));

        // With one reason the total is its count, so name the reason without repeating the number:
        // "已隐藏 375：已收藏".
        let single = HIDDEN_REASONS.filter(([reason]) => counts[reason]).length == 1;
        let parts = [];
        for(let [reason, label, filter] of HIDDEN_REASONS)
        {
            let count = counts[reason];
            if(!count)
                continue;

            let text = single? label:`${label} ${count}`;
            let item;
            let link = filter != null && urlFilters.has(filter)? toggleFor(filter):reason == "other" && others.length == 1? others[0]:null;
            if(link != null)
            {
                item = document.createElement("a");
                item.className = "filter-hidden-link";
                item.href = link.href;
                item.title = `关掉${filterLabel(link.dataset.filter)}`;
            }
            else if(reason == "muted")
            {
                item = document.createElement("button");
                item.type = "button";
                item.className = "filter-hidden-muted";
                item.title = "编辑屏蔽标签";
            }
            else
                item = document.createElement("span");
            item.textContent = text;
            if(parts.length)
                parts.push(" · ");
            parts.push(item);
        }
        node.replaceChildren(`已隐藏 ${total}：`, ...parts);
    }
}
