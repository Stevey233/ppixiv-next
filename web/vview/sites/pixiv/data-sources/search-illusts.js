// /tags
//
// The new tag search UI is a bewildering mess:
// 
// - Searching for a tag goes to "/tags/TAG/artworks".  This searches all posts with the
// tag.  The API query is "/ajax/search/artworks/TAG".  The "top" tab is highlighted, but
// it's not actually on that tab and no tab button goes back here.  "Illustrations, Manga,
// Ugoira" in search options also goes here.
// 
// - The "Illustrations" tab goes to "/tags/TAG/illustrations".  The API is
// "/ajax/search/illustrations/TAG?type=illust_and_ugoira".  This is almost identical to
// "artworks", but excludes posts marked as manga.  "Illustrations, Ugoira"  in search
// options also goes here.
// 
// - Clicking "manga" goes to "/tags/TAG/manga".  The API is "/ajax/search/manga" and also
// sets type=manga.  This is "Manga" in the search options.  This page is also useless.
//
// The "manga only" and "exclude manga" pages are useless, since Pixiv doesn't make any
// useful distinction between "manga" and "illustrations with more than one page".  We
// only include them for completeness.
// 
// - You can search for just animations, but there's no button for it in the UI.  You
// have to pick it from the dropdown in search options.  This one is "illustrations?type=ugoira".
// Why did they keep using type just for one search mode?  Saying "type=manga" or any
// other type fails, so it really is just used for this.
// 
// - Clicking "Top" goes to "/tags/TAG" with no type.  This is a completely different
// page and API, "/ajax/search/top/TAG".  It doesn't actually seem to be a rankings
// page and just shows the same thing as the others with a different layout, so we
// ignore this and treat it like "artworks".
import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import { TagSearchBoxWidget } from '/vview/widgets/tag-search-dropdown.js';
import { DropdownBoxOpener, DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';
import { searchApiArgs, rememberAgeMode } from '/vview/misc/result-filters.js';
import RelatedTagsRow from '/vview/next/related-tags-row.js';

export default class DataSource_Search extends DataSource
{
    get name() { return "search"; }
    get ui() { return UI; }

    constructor(args)
    {
        super(args);

        // Add the search tags to tag history.  We only do this at the start when the
        // data source is created, not every time we navigate back to the search.
        let tag = this._searchTags;
        if(tag)
            SavedSearchTags.add(tag);

        this.cacheSearchTitle();
    }

    get supportsStartPage() { return true; }

    get hasNoResults()
    {
        // Don't display "No Results" while we're still waiting for the user to enter a tag.
        if(!this._searchTags)
            return false;

        return super.hasNoResults;
    }

    get _searchTags()
    {
        return helpers.pixiv.getSearchTagsFromUrl(this.url);
    }

    startup()
    {
        super.startup();

        // Refresh our title when translations are toggled.
        ppixiv.settings.addEventListener("disable-translations", this.cacheSearchTitle);
    }

    shutdown()
    {
        super.shutdown();
        ppixiv.settings.removeEventListener("disable-translations", this.cacheSearchTitle);
    }

    cacheSearchTitle = async() =>
    {
        this.title = "Search: ";
        let tags = this._searchTags;
        if(tags)
        {
            tags = await ppixiv.tagTranslations.translateTagList(tags, "en");
            let tagList = document.createElement("vv-container");
            for(let tag of tags)
            {
                // Force "or" lowercase.
                if(tag.toLowerCase() == "or")
                    tag = "or";
                
                let span = document.createElement("span");
                span.innerText = tag;
                span.classList.add("word");
                if(tag == "or")
                    span.classList.add("or");
                else if(tag == "(" || tag == ")")
                    span.classList.add("paren");
                else
                    span.classList.add("tag");
                
                tagList.appendChild(span);
            }

            this.title += tags.join(" ");
            this.displayingTags = tagList;
        }
        
        // Update our page title.
        this.callUpdateListeners();
    }

    async loadPageInternal(page)
    {
        let args = { };
        this.url.searchParams.forEach((value, key) => { args[key] = value; });

        args.p = page;

        // The filter bar's type and 隐藏 AI pick the API and its type and ai_type arguments, see
        // searchApiArgs.  Upstream's own type option in the URL is converted to a filter before
        // the data source is created.
        let { searchType: apiSearchType, type, ai_type } = searchApiArgs(this.resultFilters);
        if(type != null)
            args.type = type;
        if(ai_type != null)
            args.ai_type = ai_type;

        let tag = this._searchTags;

        // If we have no tags, we're probably on the "/tags" page, which is just a list of tags.  Don't
        // run a search with no tags.
        if(!tag)
        {
            console.log("No search tags");
            return;
        }

        let searchMode = this.url.searchParams.get("s_mode");
        if(searchMode == "tag")
            args.s_mode = "s_tag";
        else if(searchMode == "tag_full")
            args.s_mode = "s_tag_full";
        else if(searchMode == "tc")
            args.s_mode = "s_tc";
        else if(searchMode == "tag_tc")
            args.s_mode = "s_tag_tc";
        else
        {
            console.error("Invalid search mode:", searchMode);
            args.s_mode = "s_tag";
        }

        let url = "/ajax/search/" + apiSearchType + "/" + encodeURIComponent(tag);

        let result = await helpers.pixivRequest.get(url, args);
        let body = result.body;

        // Add translations.  This comes first, so the related tags row reads them.
        let translations = [];
        for(let tag of Object.keys(body.tagTranslation))
        {
            translations.push({
                tag: tag,
                translation: body.tagTranslation[tag],
            });
        }
        ppixiv.tagTranslations.addTranslations(translations);

        // Store related tags.  Only do this the first time and don't change it when we read
        // future pages, so the tags don't keep changing as you scroll around.
        if(this.relatedTags == null)
        {
            this.relatedTags = body.relatedTags;
            this.callUpdateListeners();
        }

        // /ajax/search/illustrations returns results in body.illust.
        // /ajax/search/artworks returns results in body.illustManga.
        // /ajax/search/manga returns results in body.manga.
        let illusts = body.illust || body.illustManga || body.manga;
        illusts = illusts.data;

        // Populate thumbnail data with this data.
        let mediaIds = await ppixiv.mediaCache.addMediaInfosPartial(illusts, "normal");
        return { mediaIds };
    }

    get pageTitle()
    {
        return this.displayingTags? this.title:"Search works";
    }

    getDisplayingText()
    {
        return this.displayingTags ?? "Search works";
    };

    // Return URL with the search mode set to mode.
    setUrlSearchMode(url, mode)
    {
        url = new URL(url);
        url = helpers.pixiv.getUrlWithoutLanguage(url);

        // Only "ugoira" searches use type in the query.  It causes an error in other modes, so remove it.
        if(mode == "illust")
            url.searchParams.set("type", "illust");
        else if(mode == "ugoira")
            url.searchParams.set("type", "ugoira");
        else
            url.searchParams.delete("type");

        let searchType = "artwork";
        if(mode == "manga")
            searchType = "manga";
        else if(mode == "ugoira" || mode == "illust")
            searchType = "illustrations";

        // Set the type in the URL.
        let parts = url.pathname.split("/");
        parts[3] = searchType;
        url.pathname = parts.join("/");
        return url;
    }
}

// The age rating: three links always shown at the start of the row, like 推荐作品.  Pixiv filters
// with mode.
const AGES = [
    { label: "全部", mode: "all" },
    { label: "全年龄", mode: "safe" },
    { label: "R18", mode: "r18", classes: ["r18"] },
];

// The search conditions, as items for DataSource.setupDropdown.

const SORT = [{
    createOptions: { label: "最新",              dataset: { default: true } },
    setupOptions: { fields: {order: null}, defaults: {order: "date_d"} }
}, {
    createOptions: { label: "最早" },
    setupOptions: { fields: {order: "date"} }
}, {
    createOptions: { label: "热门度",            classes: ["premium-only"] },
    setupOptions: { fields: {order: "popular_d"} }
}, {
    createOptions: { label: "受男性欢迎",        classes: ["premium-only"] },
    setupOptions: { fields: {order: "popular_male_d"} }
}, {
    createOptions: { label: "受女性欢迎",        classes: ["premium-only"] },
    setupOptions:  { fields: {order: "popular_female_d"} }
}];

// The fields in the URL ("tc") and the fields in the API ("s_tc") don't match
// up (they used to).  We'll adjust the API parameters in loadPageInternal.
const SEARCH_MODE = [{
    createOptions: { label: "标签",               dataset: { default: true } },
    setupOptions: { fields: {s_mode: "tag"} },
}, {
    // On Pixiv's page, this mode goes to a legacy path-based URL scheme.  We
    // don't do that.  This will cause this particular search mode to not match
    // up with the underlying page's URLs, but this one's too obscure and annoying
    // to bother with.
    createOptions: { label: "标签完全一致" },
    setupOptions:  { fields: {s_mode: "tag_full"} },
}, {
    createOptions: { label: "标题、说明" },
    setupOptions:  { fields: {s_mode: "tc"} },
}, {
    createOptions: { label: "标签、标题、说明" },
    setupOptions:  { fields: {s_mode: "tag_tc"} },
}];

const IMAGE_SIZE = [{
    createOptions: { label: "全部",               dataset: { default: true } },
    setupOptions: { fields: {wlt: null, hlt: null, wgt: null, hgt: null} },
}, {
    createOptions: { label: "高分辨率" },
    setupOptions: { fields: {wlt: 3000, hlt: 3000, wgt: null, hgt: null} },
}, {
    createOptions: { label: "中分辨率" },
    setupOptions: { fields: {wlt: 1000, hlt: 1000, wgt: 2999, hgt: 2999} },
}, {
    createOptions: { label: "低分辨率" },
    setupOptions: { fields: {wlt: null, hlt: null, wgt: 999, hgt: 999} },
}];

const ASPECT = [{
    createOptions: {label: "全部",               icon: "", dataset: { default: true } },
    setupOptions: { fields: {ratio: null} },
}, {
    createOptions: {label: "长横图",             icon: "panorama" },
    setupOptions: { fields: {ratio: "0.5"} },
}, {
    createOptions: {label: "长竖图",             icon: "portrait" },
    setupOptions: { fields: {ratio: "-0.5"} },
}, {
    createOptions: {label: "正方形",             icon: "crop_square" },
    setupOptions: { fields: {ratio: "0"} },
}];

// The Pixiv search form shows 300-499, 500-999 and 1000-.  That's not
// really useful and the query parameters let us filter differently, so we
// replace it with a more useful "minimum bookmarks" filter.
const BOOKMARK_COUNT = [{
    createOptions: { label: "全部",               dataset: { default: true } },
    setupOptions: { fields: {blt: null, bgt: null} },
}, ...[100, 250, 500, 1000, 2500, 5000].map((count) => ({
    createOptions: { label: `${count}+` },
    setupOptions: { fields: {blt: count, bgt: null} },
}))];

const BOOKMARKED = [{
    createOptions: { label: "全部",               dataset: { default: true } },
    setupOptions: { fields: {wib: null} },
}, {
    createOptions: { label: "全部收藏" },
    setupOptions: { fields: {wib: 1} },
}, {
    createOptions: { label: "公开收藏" },
    setupOptions: { fields: {wib: 2} },
}, {
    createOptions: { label: "非公开收藏" },
    setupOptions: { fields: {wib: 3} },
}];

// The time ranges: 全部, 本周, 本月, 今年, then 1 to 7 years ago.
//
// The time filter is a range, but I'm not sure what time zone it filters in
// (presumably either JST or UTC).  There's also only a date and not a time,
// which means you can't actually filter "today", since there's no way to specify
// which "today" you mean.  So, we offer filtering starting at "this week",
// and you can just use the default date sort if you want to see new posts.
// For "this week", we set the end date a day in the future to make sure we
// don't filter out posts today.
function timeItems()
{
    let formatDate = (date) =>
    {
        return (date.getYear() + 1900).toFixed().padStart(2, "0") + "-" +
                (date.getMonth() + 1).toFixed().padStart(2, "0") + "-" +
                date.getDate().toFixed().padStart(2, "0");
    };

    let range = (createOptions, start, end) => ({
        createOptions,
        setupOptions: { fields: {scd: formatDate(start), ecd: formatDate(end)} },
    });

    let tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    let lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
    let lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
    let lastYear = new Date(); lastYear.setFullYear(lastYear.getFullYear() - 1);
    let items = [
        { createOptions: { label: "全部", dataset: { default: true } }, setupOptions: { fields: {scd: null, ecd: null} } },
        range({ label: "本周" }, lastWeek, tomorrow),
        range({ label: "本月" }, lastMonth, tomorrow),
        range({ label: "今年" }, lastYear, tomorrow),
    ];
    for(let yearsAgo = 1; yearsAgo <= 7; ++yearsAgo)
    {
        let startYear = new Date(); startYear.setFullYear(startYear.getFullYear() - yearsAgo - 1);
        let endYear = new Date(); endYear.setFullYear(endYear.getFullYear() - yearsAgo);
        items.push(range({ label: String(yearsAgo), dataset: { shortLabel: `${yearsAgo} 年前` } }, startYear, endYear));
    }
    return items;
}

// After an option in the 更多条件 panel is picked, the URL changes and a new UI is created for
// the new data source.  This tells the new UI to open the panel again, so several conditions can
// be set in a row.  { until, focusIndex }
let reopenMoreConditions = null;

class UI extends Widget
{
    constructor({ dataSource, ...options })
    {
        super({ ...options, template: `
            <div>
                <div class=tag-search-with-related-tags>
                    <vv-container class=tag-search-box-container></vv-container>
                </div>

                <div class=box-button-row>
                    ${ AGES.map(({label, mode, classes=[]}) => helpers.createBoxLink({label, dataType: `age-${mode}`, classes: ["n-age", ...classes] })).join("") }
                    <span class=n-age-end></span>
                    ${ helpers.createBoxLink({label: "排序",    classes: ["sort-button"] }) }
                    ${ helpers.createBoxLink({label: "搜索方式",    classes: ["search-mode-button"] }) }
                    ${ helpers.createBoxLink({label: "图片尺寸",    classes: ["image-size-button"] }) }
                    ${ helpers.createBoxLink({label: "比例",    classes: ["aspect-ratio-button"] }) }
                    ${ helpers.createBoxLink({label: "收藏数",    classes: ["bookmark-count-button", "premium-only"] }) }
                    ${ helpers.createBoxLink({label: "已收藏",    classes: ["bookmarked-by-user", "premium-only"] }) }
                    ${ helpers.createBoxLink({label: "时间",    classes: ["time-ago-button"] }) }
                    ${ helpers.createBoxLink({label: "更多条件",    classes: ["more-conditions-button", "n-dropdown"] }) }
                    <vv-container class=n-cond-chips></vv-container>
                    ${ helpers.createBoxLink({label: "重置", popup: "清除所有搜索条件", classes: ["reset-search"] }) }
                </div>
            </div>
        `});

        this.dataSource = dataSource;
        this.dataSource.addEventListener("updated", () => this.refresh(), this._signal);

        let time = timeItems();

        // The options that stay in the row.  On desktop, the rarely changed ones are folded into
        // the 更多条件 panel (see docs/design.md).  Mobile shows every option in its sheet.
        let outside = [
            { button: ".sort-button", items: SORT },
            { button: ".bookmark-count-button", items: BOOKMARK_COUNT },
        ];
        let folded = [
            // 标签 and 标签完全一致 don't count as set: a tag click opens 标签完全一致.  A chip's ×
            // goes back to 标签完全一致.
            { button: ".search-mode-button", title: "搜索方式", items: SEARCH_MODE, unset: [0, 1], reset: 1 },
            { button: ".image-size-button", title: "图片尺寸", items: IMAGE_SIZE },
            { button: ".aspect-ratio-button", title: "比例", items: ASPECT },
            { button: ".bookmarked-by-user", title: "已收藏", items: BOOKMARKED, premiumOnly: true },
            { button: ".time-ago-button", title: "时间", items: time, time: true },
        ];

        if(ppixiv.mobile)
        {
            outside.push(...folded);
            folded = [];
        }
        else
        {
            // 收藏数 and 已收藏 are premium only.  Without 收藏数, 时间 takes its place in the row:
            // with newest first, a time range is the closest a free account gets to "recent and popular".
            if(!ppixiv.pixivInfo?.premium)
            {
                folded = folded.filter((section) => !section.premiumOnly);
                outside.push(folded.pop());
            }

            // Remove the row's buttons of the conditions that aren't in it.
            let inRow = new Set(outside.map(({button}) => button));
            for(let button of [".search-mode-button", ".image-size-button", ".aspect-ratio-button", ".bookmarked-by-user", ".time-ago-button"])
            {
                if(!inRow.has(button))
                    this.querySelector(button).remove();
            }
        }

        for(let { mode } of AGES)
        {
            // Write mode=all for 全部 too, so every search URL says which rating it shows.
            dataSource.setItem(this.root, { type: `age-${mode}`, fields: {mode}, defaults: {mode: "all"},
                adjustUrl: (args) => args.set("mode", mode) });

            // The rating is a preference: searches opened later without mode get it.
            this.querySelector(`[data-type='age-${mode}']`).addEventListener("click", () => rememberAgeMode(mode), this._signal);
        }
        let ageSet = (dataSource.url.searchParams.get("mode") ?? "all") != "all";

        for(let { button, items } of outside)
        {
            if(button == ".time-ago-button")
                this._setupTimeDropdown(this.querySelector(button), items);
            else
                dataSource.setupDropdown(this.querySelector(button), items);
        }

        // The 更多条件 button and the chips of the conditions set in it.
        let moreButton = this.querySelector(".more-conditions-button");
        let setCount = 0;
        if(folded.length == 0)
            moreButton.remove();
        else
        {
            let chips = this.querySelector(".n-cond-chips");
            for(let section of folded)
            {
                let state = this._sectionState(section);
                if(!state.set)
                    continue;

                setCount++;
                let chip = document.createElement("a");
                chip.className = "n-cond-chip";
                chip.href = state.resetUrl;
                chip.setAttribute("aria-label", `清除 ${state.label}`);
                chip.innerHTML = `<span class=n-cond-chip-label></span>${ helpers.createIcon("mat:close") }`;
                chip.querySelector(".n-cond-chip-label").innerText = state.label;
                chips.appendChild(chip);
            }

            if(setCount > 0)
            {
                let count = document.createElement("span");
                count.className = "n-more-count";
                count.innerText = setCount;
                moreButton.querySelector(".label").after(count);
            }
            helpers.html.setClass(moreButton, "selected", setCount > 0);

            this._setupMoreConditions(moreButton, folded);
        }

        // 重置 shows only when a condition is set, in the row or in 更多条件.  It removes every
        // condition and keeps the search mode, unless the search mode itself is the condition.
        let resetButton = this.querySelector(".reset-search");
        let outsideSet = outside.some((section) => this._sectionState(section).set);
        resetButton.hidden = !ageSet && !outsideSet && setCount == 0;
        resetButton.href = this._resetUrl();
        resetButton.addEventListener("click", () => rememberAgeMode("all"), this._signal);

        // The related tags as a line of chips in the desktop header, after the filter bar.
        let header = this.root.closest(".thumbnail-ui-box");
        if(!ppixiv.mobile && header)
            new RelatedTagsRow({ container: header, dataSource, signal: this.shutdownSignal });

        // Create the tag dropdown for the search page input.
        this.tagSearchBox = new TagSearchBoxWidget({
            container: this.querySelector(".tag-search-box-container"),
            dataSource: this.dataSource,
        });

        // Fill the search box with the current tag.
        //
        // Add a space to the end, so another tag can be typed immediately after focusing an existing search.
        let search = this.dataSource._searchTags;
        if(search)
            search += " ";
        this.querySelector(".tag-search-box .input-field-container > input").value = search;
    }

    // Return whether a condition is set, its chip label, and the URL its chip links to.
    _sectionState({ items, unset=[0], reset=0 })
    {
        let links = this.dataSource.createDropdownItems(document.createElement("div"), items);
        let selected = links.findIndex((link) => link.classList.contains("selected"));

        // Nothing is selected when the URL has a value no option makes, such as a 本周 from an
        // earlier week.  That still filters.
        let label = selected == -1? "其他":links[selected].dataset.shortLabel ?? items[selected].createOptions.label;
        return {
            set: !unset.includes(selected),
            label,
            resetUrl: links[reset].href,
        };
    }

    _resetUrl()
    {
        let url = new URL(this.dataSource.url);
        let mode = url.searchParams.get("s_mode");
        if(mode != "tag" && mode != "tag_full")
            mode = "tag_full";

        let tag = helpers.pixiv.getSearchTagsFromUrl(url);
        url.search = "";
        if(tag != null)
            url.searchParams.set("q", tag);
        url.searchParams.set("s_mode", mode);
        url.searchParams.set("type", "artwork");
        return url.toString();
    }

    // The 时间 dropdown: the ranges in a list, then the years in a row.
    _setupTimeDropdown(button, items)
    {
        new DropdownMenuOpener({
            button,
            createDropdown: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `<div class=vertical-list></div>`,
                });

                this._createTimeItems(dropdown.root, items, "years-ago");
                return dropdown;
            },
        });
    }

    // Add the time ranges to container, and the years in a row with the class yearsClass.
    _createTimeItems(container, items, yearsClass)
    {
        this.dataSource.createDropdownItems(container, items.slice(0, 4));

        let years = document.createElement("div");
        years.className = yearsClass;
        container.appendChild(years);
        this.dataSource.createDropdownItems(years, items.slice(4));

        let suffix = document.createElement("span");
        suffix.innerText = "年前";
        years.appendChild(suffix);
    }

    // The 更多条件 panel: one section per condition.  Picking an option applies it and the panel
    // stays open.
    _setupMoreConditions(button, sections)
    {
        let opener = new DropdownBoxOpener({
            button,
            clickToOpen: true,
            createDropdown: ({...options}) => {
                let panel = new Widget({
                    ...options,
                    template: `<div class="n-more-conditions popup-menu-box"></div>`,
                });

                for(let { title, items, time } of sections)
                {
                    let section = document.createElement("div");
                    section.className = "n-cond-section";
                    section.innerHTML = `<div class=n-cond-title></div><div class=n-cond-options></div>`;
                    section.querySelector(".n-cond-title").innerText = title;
                    panel.root.appendChild(section);

                    // The aspect ratio icons are for the mobile list.
                    items = items.map((item) => ({ ...item, createOptions: { ...item.createOptions, icon: null } }));

                    let options = section.querySelector(".n-cond-options");
                    if(time)
                        this._createTimeItems(options, items, "n-cond-years");
                    else
                        this.dataSource.createDropdownItems(options, items);
                }

                panel.root.addEventListener("click", (e) => {
                    let link = e.target.closest("a.box-link[href]");
                    if(link == null || link.classList.contains("selected"))
                        return;

                    // A keyboard click (detail 0) puts the focus back on the same option.
                    let links = [...panel.root.querySelectorAll("a.box-link[href]")];
                    reopenMoreConditions = {
                        until: Date.now() + 2000,
                        focusIndex: e.detail == 0? links.indexOf(link):-1,
                    };
                });

                return panel;
            },
        });

        // The button is a link without an href, so make it reachable by keyboard.
        button.tabIndex = 0;
        button.setAttribute("role", "button");
        button.addEventListener("keydown", (e) => {
            if(e.key != "Enter" && e.key != " ")
                return;

            e.preventDefault();
            opener.visible = !opener.visible;
        }, this._signal);

        if(reopenMoreConditions != null && Date.now() < reopenMoreConditions.until)
        {
            let { focusIndex } = reopenMoreConditions;
            opener.visible = true;
            if(focusIndex != -1)
                opener.dropdown.root.querySelectorAll("a.box-link[href]")[focusIndex]?.focus();
        }
        reopenMoreConditions = null;
    }
}
