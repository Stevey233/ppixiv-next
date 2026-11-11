// The result filters as a row of toggles, shown on every list of works.  The filters live in the
// URL (see misc/result-filters.js), so each toggle is a link to the same list with that filter
// turned on or off.

import Widget from '/vview/widgets/widget.js';
import { helpers } from '/vview/misc/helpers.js';
import {
    FILTER_GROUPS, HIDE_FILTERS, dataSourceSupportsFilters, getFilters, setFilters, toggleFilter, MAX_EMPTY_PAGES,
} from '/vview/misc/result-filters.js';

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
            let link = e.target.closest(".filter-toggle");
            if(link == null)
                return;
            e.preventDefault();
            e.stopPropagation();
            helpers.navigate(new URL(link.href), { addToHistory: false, scrollToTop: true });
        });

        this.querySelector(".filter-continue").addEventListener("click", () => this.dataSource?.loadMoreFiltered());
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
        super.shutdown();
    }

    setDataSource(dataSource)
    {
        if(this.dataSource == dataSource)
            return;

        this.dataSource?.removeEventListener("updated", this.refresh);
        this.dataSource = dataSource;
        this.dataSource?.addEventListener("updated", this.refresh);
        this.refresh();
    }

    refresh = () =>
    {
        let supported = dataSourceSupportsFilters(this.dataSource);
        this.root.hidden = !supported;
        if(!supported)
            return;

        let filters = getFilters(helpers.args.location);
        for(let link of this.root.querySelectorAll(".filter-toggle"))
        {
            let value = link.dataset.filter;
            let on = filters.has(value);
            let args = helpers.args.location;
            setFilters(args, toggleFilter(filters, value, !on));
            args.query.delete("p");
            link.href = args.url;
            helpers.html.setClass(link, "selected", on);
            link.setAttribute("aria-pressed", String(on));
        }

        let stopped = this.dataSource.filteredStopPage != null;
        this.querySelector(".filter-stopped").hidden = !stopped;
        if(stopped)
            this.querySelector(".filter-stopped-text").textContent = `连续 ${MAX_EMPTY_PAGES} 页没有符合筛选的作品，已暂停加载。`;
    }
}
