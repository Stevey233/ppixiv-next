// 标签库: our own search over the tag library (tag-library.js), opened from the rail and from the
// search box's dropdown.  See docs/design.md "Gelbooru".
//
// One field searches tags by Chinese name, alias and the tag itself.  With the field empty, the
// list is every tag of the chosen category, most used first, so the screen is also a browser.  A
// row's click searches that tag alone; its + and − put it into the selection at the top, which
// starts as the current search's tags and is searched with 搜索, so several tags can be picked in
// one visit; its star saves it as a saved tag.
//
// It's a dialog over the list.  Opening it adds a history entry, so Back closes it and leaves the
// list where it was.  Rows are rendered a page at a time as the list scrolls.
import DialogWidget from '/vview/widgets/dialog.js';
import SavedSearchTags from '/vview/misc/saved-search-tags.js';
import { helpers } from '/vview/misc/helpers.js';
import { parseQuery } from '/vview/sites/gelbooru/query.js';

const CATEGORY_TABS = [
    [null, "全部"],
    ["artist", "画师"],
    ["character", "角色"],
    ["copyright", "作品"],
    ["general", "普通"],
    ["metadata", "元数据"],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_TABS.filter(([category]) => category));

const SORTS = [
    ["count", "按作品数"],
    ["relevance", "按相关度"],
];

// Rows rendered at a time, about two screens.
const PAGE_ROWS = 60;

// The search runs this long after the last key.  A one-letter search over the whole library
// takes about 16 ms, so it shouldn't run on every key of a burst.
const SEARCH_DELAY_MS = 80;

// More rows are rendered when the list is scrolled this close to its end.
const LOAD_MORE_MARGIN_PX = 600;

// Marks the history entry the dialog adds.
const HISTORY_KEY = "gbTagLibrary";

// Gelbooru's metatags.  Query tokens with these aren't tags, so they aren't selection chips, and
// are kept in the search as they are, like the conditions.
const METATAGS = /^-?(fav|user|md5|rating|id|width|height|score|sort|parent|source|pool|title|status|child|date|comment_count|tagcount|filetype|order):/i;

// The category tab and sort chosen last, kept while the page is open.
let lastView = { category: null, sort: "count" };

export function openTagLibrary()
{
    if(DialogWidget.activeDialogs.some((dialog) => dialog instanceof TagLibraryDialog))
        return;
    new TagLibraryDialog();
}

// Whether a query token is a plain tag, which the selection can hold.
function isPlainTag(token)
{
    return !/^-?[{~]/.test(token) && !token.includes("*") && !METATAGS.test(token);
}

class TagLibraryDialog extends DialogWidget
{
    constructor(options={})
    {
        super({
            ...options,
            classes: "gb-taglib",
            header: "标签库",
            template: `
                <div class=gb-taglib-top>
                    <div class=gb-taglib-field>
                        ${ helpers.createIcon("mat:search") }
                        <input class=gb-taglib-input type=search autocomplete=off spellcheck=false
                            placeholder="中文名、英文标签或别名" aria-label="搜索标签">
                    </div>
                    <div class=gb-taglib-bar>
                        <div class=gb-taglib-tabs role=tablist></div>
                        <span class=gb-taglib-total></span>
                        <div class=gb-taglib-sorts></div>
                    </div>
                    <div class=gb-taglib-selection>
                        <div class=gb-taglib-chips translate=no></div>
                        <span class=gb-taglib-kept translate=no></span>
                        <button type=button class=gb-taglib-search>
                            ${ helpers.createIcon("mat:search") }
                            <span>搜索</span>
                        </button>
                    </div>
                </div>
                <div class=gb-taglib-status></div>
                <div class=gb-taglib-list translate=no></div>
            `,
        });

        this.library = ppixiv.site.tagLibrary;
        this.scroller = this.root.querySelector(".scroll");
        this.input = this.root.querySelector(".gb-taglib-input");
        this.list = this.root.querySelector(".gb-taglib-list");
        this.category = lastView.category;
        this.sort = lastView.sort;
        this._shown = [];           // the TagEntries rendered, in order
        this._total = 0;
        this._highlight = -1;       // the index in _shown of the highlighted row, or -1
        this._searchTimer = null;

        // The list the dialog was opened from.  A search keeps its conditions.
        this._fromUrl = ppixiv.plocation.toString();
        this._readSelection();

        this._createTabs();
        this._createSorts();

        this.input.addEventListener("input", () => this._queueSearch());
        this.input.addEventListener("keydown", this._inputKeydown);
        this.scroller.addEventListener("scroll", () => this._fillToScroll(), this._signal);
        this.list.addEventListener("click", this._listClick);
        this.root.querySelector(".gb-taglib-chips").addEventListener("click", this._chipClick);
        this.root.querySelector(".gb-taglib-search").addEventListener("click", () => this._searchSelection());
        this.root.querySelector(".gb-taglib-status").addEventListener("click", (e) => {
            if(e.target.closest(".gb-taglib-retry"))
                this.library.load().catch(() => {});
        });

        this.library.addEventListener("change", () => this._search(), this._signal);
        window.addEventListener("recent-tag-searches-changed", () => this._refreshSaved(), this._signal);

        // Back closes the dialog: it adds a history entry with the same URL, and DialogWidget
        // closes on the popstate of going back from it.
        let state = { ...ppixiv.phistory.state, [HISTORY_KEY]: true };
        ppixiv.phistory.pushState(state, "", ppixiv.plocation.toString());

        if(!this.library.loaded && !this.library.loading)
            this.library.load().catch(() => {});

        this._refreshSelection();
        this._search();
        this.input.focus();
    }

    // Closing the dialog any other way than Back, or a search from it, takes its history entry
    // back out.
    shutdown()
    {
        // Mobile history dispatches popstate inside back(). Remove our listener first.
        super.shutdown();
        if(!this._navigated && ppixiv.phistory.state?.[HISTORY_KEY])
            ppixiv.phistory.back();
    }

    // The selection starts as the current search's plain tags.  Anything else in its tags, like
    // fav: or a {a ~ b} group, is kept as it is.  The conditions are kept by getArgsForTagSearch.
    _readSelection()
    {
        this.selection = [];
        this.kept = [];
        let query = helpers.pixiv.getSearchTagsFromUrl(new URL(this._fromUrl));
        for(let token of parseQuery(query ?? "").tags)
        {
            if(isPlainTag(token))
                this.selection.push({ tag: token.replace(/^-/, ""), exclude: token.startsWith("-") });
            else
                this.kept.push(token);
        }
    }

    _createTabs()
    {
        let tabs = this.root.querySelector(".gb-taglib-tabs");
        for(let [category, label] of CATEGORY_TABS)
        {
            let tab = document.createElement("button");
            tab.type = "button";
            tab.className = "gb-taglib-tab";
            tab.setAttribute("role", "tab");
            tab.textContent = label;
            if(category)
                tab.classList.add(`tag-category-${category}`);
            tab.addEventListener("click", () => {
                this.category = lastView.category = category;
                this._search();
                this.input.focus();
            });
            tab.dataset.category = category ?? "";
            tabs.appendChild(tab);
        }
    }

    _createSorts()
    {
        let sorts = this.root.querySelector(".gb-taglib-sorts");
        for(let [sort, label] of SORTS)
        {
            let button = document.createElement("button");
            button.type = "button";
            button.className = "gb-taglib-sort";
            button.dataset.sort = sort;
            button.textContent = label;
            button.addEventListener("click", () => {
                this.sort = lastView.sort = sort;
                this._search();
                this.input.focus();
            });
            sorts.appendChild(button);
        }
    }

    _queueSearch()
    {
        realClearTimeout(this._searchTimer);
        this._searchTimer = realSetTimeout(() => this._search(), SEARCH_DELAY_MS);
    }

    // Search again from the first row.
    _search()
    {
        realClearTimeout(this._searchTimer);
        this._searchTimer = null;

        for(let tab of this.root.querySelectorAll(".gb-taglib-tab"))
        {
            let selected = tab.dataset.category == (this.category ?? "");
            helpers.html.setClass(tab, "selected", selected);
            tab.setAttribute("aria-selected", selected);
        }
        for(let button of this.root.querySelectorAll(".gb-taglib-sort"))
            helpers.html.setClass(button, "selected", button.dataset.sort == this.sort);

        this._text = this.input.value.trim();
        this._shown = [];
        this._total = 0;
        this._highlight = -1;
        this.list.replaceChildren();
        this.scroller.scrollTop = 0;

        if(this.library.loaded)
        {
            this._addRows();
            // Typing highlights the best match, so Enter searches it.
            if(this._text != "" && this._shown.length)
                this._setHighlight(0);
        }
        this._refreshStatus();
    }

    // Render the next page of rows.
    _addRows()
    {
        let { total, results } = this.library.search(this._text, {
            category: this.category,
            sort: this.sort,
            offset: this._shown.length,
            limit: PAGE_ROWS,
        });
        this._total = total;
        for(let entry of results)
        {
            this.list.appendChild(this._createRow(entry, this._shown.length));
            this._shown.push(entry);
        }
    }

    // Render more rows while the end of the list is near the bottom of the view.
    _fillToScroll()
    {
        let scroller = this.scroller;
        while(this.library.loaded && this._shown.length < this._total &&
            scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - LOAD_MORE_MARGIN_PX)
            this._addRows();
    }

    _createRow(entry, index)
    {
        let row = this.createTemplate({ name: "gb-taglib-row", html: `
            <div class=gb-taglib-row>
                <a class=gb-taglib-main>
                    <span class=gb-taglib-names>
                        <span class=gb-taglib-name></span>
                        <span class=gb-taglib-tag></span>
                    </span>
                    <span class=gb-taglib-note></span>
                </a>
                <span class=gb-taglib-count></span>
                <span class=gb-taglib-actions>
                    <button type=button class=gb-taglib-add title="加入搜索">${ helpers.createIcon("mat:add") }</button>
                    <button type=button class=gb-taglib-exclude title="排除">${ helpers.createIcon("mat:remove") }</button>
                    <button type=button class=gb-taglib-save>${ helpers.createIcon("mat:star") }</button>
                </span>
            </div>
        `});

        row.dataset.index = index;
        row.dataset.tag = entry.tag;
        row.classList.add(`tag-category-${entry.category}`);
        row.querySelector(".gb-taglib-name").textContent = entry.zh ?? entry.tag;
        row.querySelector(".gb-taglib-tag").textContent = entry.zh? entry.tag:"";
        row.querySelector(".gb-taglib-note").textContent = entry.notes ?? "";
        row.querySelector(".gb-taglib-count").textContent = entry.count.toLocaleString();

        let main = row.querySelector(".gb-taglib-main");
        main.href = helpers.getArgsForTagSearch(entry.tag, new URL(this._fromUrl)).url.toString();
        main.title = `${CATEGORY_LABELS[entry.category]} · ${entry.tag}`;
        this._refreshRowSaved(row);
        return row;
    }

    _refreshRowSaved(row)
    {
        let saved = SavedSearchTags.groupNameForTag(row.dataset.tag) != null;
        helpers.html.setClass(row, "saved", saved);
        let save = row.querySelector(".gb-taglib-save");
        save.querySelector(".font-icon").innerText = saved? "star":"star_border";
        save.title = saved? "已保存，点击取消保存":"保存标签";
        save.setAttribute("aria-pressed", saved);
    }

    _refreshSaved()
    {
        for(let row of this.list.querySelectorAll(".gb-taglib-row"))
            this._refreshRowSaved(row);
    }

    // The line between the controls and the list: loading, failed, no match, or nothing.
    _refreshStatus()
    {
        let status = this.root.querySelector(".gb-taglib-status");
        let total = this.root.querySelector(".gb-taglib-total");
        status.replaceChildren();
        status.className = "gb-taglib-status";
        total.textContent = this.library.loaded? `${this._total.toLocaleString()} 个标签`:"";

        if(this.library.loading)
        {
            status.classList.add("loading");
            status.textContent = "正在载入标签库……第一次打开要下载约 5 MB，之后直接从本地读取。";
        }
        else if(this.library.error)
        {
            status.classList.add("failed");
            let text = document.createElement("span");
            text.textContent = `标签库没有载入：${this.library.error.message}`;
            let retry = document.createElement("button");
            retry.type = "button";
            retry.className = "gb-taglib-retry";
            retry.textContent = "重试";
            status.append(text, retry);
        }
        else if(this.library.loaded && this._total == 0)
        {
            status.classList.add("empty");
            status.textContent = `没有找到「${this._text}」`;
        }
        status.hidden = status.childNodes.length == 0;
    }

    _listClick = (e) =>
    {
        let row = e.target.closest(".gb-taglib-row");
        if(row == null)
            return;
        let tag = row.dataset.tag;

        if(e.target.closest(".gb-taglib-add, .gb-taglib-exclude"))
        {
            this._select(tag, e.target.closest(".gb-taglib-exclude") != null);
            return;
        }

        if(e.target.closest(".gb-taglib-save"))
        {
            if(SavedSearchTags.groupNameForTag(tag) != null)
                SavedSearchTags.remove(tag);
            else
                SavedSearchTags.save(tag);
            return;
        }

        // A plain click on the row searches the tag alone.  Other clicks (a new tab) are the link's.
        if(e.target.closest(".gb-taglib-main") && e.button == 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey)
        {
            e.preventDefault();
            this._navigate(helpers.getArgsForTagSearch(tag, new URL(this._fromUrl)));
        }
    }

    // Add tag to the selection, or change it between included and excluded.
    _select(tag, exclude)
    {
        let item = this.selection.find((item) => item.tag == tag);
        if(item)
            item.exclude = exclude;
        else
            this.selection.push({ tag, exclude });
        this._refreshSelection();
    }

    _chipClick = (e) =>
    {
        let chip = e.target.closest(".gb-taglib-chip");
        if(chip == null)
            return;

        let index = this.selection.findIndex((item) => item.tag == chip.dataset.tag);
        if(e.target.closest(".gb-taglib-chip-remove"))
            this.selection.splice(index, 1);
        else
            this.selection[index].exclude = !this.selection[index].exclude;
        this._refreshSelection();
        this.input.focus();
    }

    _refreshSelection()
    {
        let chips = this.root.querySelector(".gb-taglib-chips");
        chips.replaceChildren();
        for(let { tag, exclude } of this.selection)
        {
            let entry = this.library.get(tag);
            let chip = document.createElement("span");
            chip.className = "gb-taglib-chip";
            chip.dataset.tag = tag;
            helpers.html.setClass(chip, "exclude", exclude);
            if(entry)
                chip.classList.add(`tag-category-${entry.category}`);

            let label = document.createElement("button");
            label.type = "button";
            label.className = "gb-taglib-chip-label";
            label.textContent = (exclude? "−":"") + (entry?.zh ?? tag);
            label.title = `${exclude? "排除":"包含"} ${tag}，点击切换`;

            let remove = document.createElement("button");
            remove.type = "button";
            remove.className = "gb-taglib-chip-remove";
            remove.title = "移出";
            remove.setAttribute("aria-label", "移出");
            remove.append(helpers.createIcon("mat:close", { asElement: true }));

            chip.append(label, remove);
            chips.appendChild(chip);
        }

        let kept = this.root.querySelector(".gb-taglib-kept");
        kept.textContent = this.kept.join(" ");
        kept.hidden = this.kept.length == 0;
        kept.title = "当前搜索里的这些也会保留";

        this.root.querySelector(".gb-taglib-search").disabled = this.selection.length == 0;
        helpers.html.setClass(this.root.querySelector(".gb-taglib-selection"), "empty", this.selection.length == 0);
    }

    _searchSelection()
    {
        if(this.selection.length == 0)
            return;

        let tags = [...this.selection.map(({ tag, exclude }) => (exclude? "-":"") + tag), ...this.kept];
        this._navigate(helpers.getArgsForTagSearch(tags.join(" "), new URL(this._fromUrl)));
    }

    // Open a search in place of the dialog's history entry, so Back from it returns to the list
    // the dialog was opened from.
    _navigate(args)
    {
        this._navigated = true;
        helpers.navigate(args, { addToHistory: false });

        // The navigation's popstate closed the dialog, unless the URL didn't change.
        if(!this.hasShutdown)
            this.visible = false;
    }

    _setHighlight(index)
    {
        this.list.querySelector(".gb-taglib-row.highlight")?.classList.remove("highlight");
        this._highlight = index;
        let row = this.list.children[index];
        if(row == null)
            return;
        row.classList.add("highlight");
        row.scrollIntoView({ block: "nearest" });
    }

    _inputKeydown = (e) =>
    {
        if(e.ctrlKey || e.altKey || e.metaKey || e.isComposing)
            return;

        if(e.key == "ArrowDown" || e.key == "ArrowUp")
        {
            e.preventDefault();
            e.stopPropagation();
            if(this._searchTimer != null)
                this._search();
            let index = Math.max(0, this._highlight + (e.key == "ArrowDown"? 1:-1));
            if(index >= this._shown.length && this._shown.length < this._total)
                this._addRows();
            this._setHighlight(Math.min(index, this._shown.length - 1));
        }
        else if(e.key == "Enter")
        {
            e.preventDefault();
            e.stopPropagation();
            if(this._searchTimer != null)
                this._search();
            let entry = this._shown[this._highlight];
            if(entry)
                this._navigate(helpers.getArgsForTagSearch(entry.tag, new URL(this._fromUrl)));
        }
        else if(e.key == "Escape")
        {
            e.preventDefault();
            e.stopPropagation();
            this.visible = false;
        }
    }
}
