// The search conditions (sort, score, rating, type, size, AI) of the posts list, as a row of menus
// like the Pixiv search options.  The tags URL parameter is the list's only state: each menu item
// is a link to the same list with the query rewritten through query.js, so a change loads the list
// again from its first page.  See .work/gelbooru/DESIGN.md, "The query is the state".
//
// A kind of condition written by hand in a way no menu item expresses (score:>5, sort:score:asc,
// width:1920) stays in the query as written and is shown on its menu as written.  Picking an item
// in that menu replaces it; changing another menu keeps it.
import { helpers } from '/vview/misc/helpers.js';
import Widget from '/vview/widgets/widget.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { TextPrompt } from '/vview/widgets/prompts.js';
import { RATINGS, parseQuery, setConditions, clearConditions, hasKind } from '/vview/sites/gelbooru/query.js';

export const SORT_LABELS = { score: "分数最高", random: "随机", updated: "最近更新" };
export const SCORES = [10, 50, 100, 200, 500, 1000];
export const RATING_LABELS = { general: "全年龄", sensitive: "轻微", questionable: "擦边", explicit: "R-18" };
const TYPE_LABELS = { image: "图片", animated: "动图", video: "视频" };
const SIZES = [
    { minWidth: 1920 }, { minWidth: 2560 }, { minWidth: 3840 },
    { minHeight: 1920 }, { minHeight: 2560 },
];

// The rating menu picks several ratings, but each pick loads the list again and creates a new
// row.  This tells the new row to open the menu again until.
let reopenRatingsUntil = 0;

export function ratingsLabel(ratings)
{
    if(ratings.length == 0)
        return "没有分级";
    if(ratings.length == RATINGS.length - 1)
    {
        let label = RATING_LABELS[RATINGS.find((rating) => !ratings.includes(rating))];
        return /^[A-Z]/.test(label)? `不看 ${label}`:`不看${label}`;
    }
    return ratings.map((rating) => RATING_LABELS[rating]).join(" + ");
}

export function sizeLabel({ minWidth, minHeight })
{
    let parts = [];
    if(minWidth != null)
        parts.push(`宽 ≥ ${minWidth}`);
    if(minHeight != null)
        parts.push(`高 ≥ ${minHeight}`);
    return parts.join(" · ");
}

// The label of each kind of condition the query sets, in menu order: [{ kind, label, raw }].
export function describeConditions(query)
{
    let parsed = parseQuery(query);
    let { conditions: c, raw } = parsed;
    let result = [];
    let add = (kind, label) => {
        if(raw[kind])
            result.push({ kind, label: raw[kind].join(" "), raw: true });
        else if(hasKind(parsed, kind))
            result.push({ kind, label, raw: false });
    };
    add("sort", SORT_LABELS[c.sort]);
    add("score", `分数 ≥ ${c.minScore}`);
    add("rating", c.ratings && ratingsLabel(c.ratings));
    add("type", TYPE_LABELS[c.type]);
    add("size", sizeLabel(c));
    add("ai", "隐藏 AI");
    return result;
}

// Return the URL of the list at url with its query changed to query, from the first page.
export function urlForQuery(url, query)
{
    let args = new helpers.args(url);
    if(query)
        args.query.set("tags", query);
    else
        args.query.delete("tags");
    args.query.delete("p");
    args.hash.delete("illust_id");
    return args;
}

// Ask for a whole number.  Return it, or null if cancelled or not a number, which says so.
export async function promptNumber(title, current)
{
    let text = await TextPrompt.prompt({ title, value: current != null? String(current):"" });
    if(text == null)
        return null;

    let match = /^\s*(\d+)\s*$/.exec(text);
    if(match == null)
    {
        ppixiv.message.show(`“${text.trim()}”不是数字，条件没有改`);
        return null;
    }
    return parseInt(match[1]);
}

export function createConditionsUi({ dataSource, container, signal })
{
    let query = dataSource.query;
    let parsed = parseQuery(query);
    let { conditions } = parsed;
    let described = Object.fromEntries(describeConditions(query).map((entry) => [entry.kind, entry]));
    let linkFor = (changes) => urlForQuery(dataSource.url, setConditions(query, changes)).url.toString();

    // A menu button.  items are [{ label, changes, selected }] or a function filling the
    // dropdown itself.
    let addMenu = (kind, title, fillMenu) => {
        let button = helpers.createBoxLink({ label: title, classes: ["gb-cond", "n-dropdown"], asElement: true });
        button.dataset.kind = kind;
        container.appendChild(button);

        let opener = new DropdownMenuOpener({
            button,
            createDropdown: ({ ...options }) => {
                let dropdown = new Widget({ ...options, template: `<div class="vertical-list gb-cond-menu"></div>` });
                dropdown.root.dataset.kind = kind;

                // The hand-written condition this menu would replace, first.
                if(described[kind]?.raw)
                {
                    let current = document.createElement("div");
                    current.className = "gb-cond-raw-current";
                    current.textContent = described[kind].label;
                    current.title = "在搜索里手写的条件，选下面一项会替换它";
                    dropdown.root.appendChild(current);
                }

                fillMenu(dropdown.root);
                return dropdown;
            },
        });

        // The button shows the condition when it isn't the default.
        let entry = described[kind];
        if(entry)
        {
            button.querySelector(".label").textContent = entry.label;
            helpers.html.setClass(button, "selected", true);
            helpers.html.setClass(button, "gb-cond-raw", entry.raw);
            if(entry.raw)
                button.title = `${title}：在搜索里手写的条件`;
        }
        return opener;
    };

    // The default item of each menu has data-default, which tells DropdownMenuOpener to leave the
    // button alone when it's selected.
    let addItem = (menu, label, { changes=null, selected=false, onclick=null, classes=[], isDefault=false }={}) => {
        let link = helpers.createBoxLink({ label, classes, asElement: true });
        if(isDefault)
            link.dataset.default = "1";
        if(changes)
            link.href = linkFor(changes);
        helpers.html.setClass(link, "selected", selected);
        if(onclick)
            link.addEventListener("click", onclick);
        menu.appendChild(link);
        return link;
    };

    // Items for the default and each value.  An item is selected only when the kind isn't
    // written by hand.
    let isSet = (kind) => hasKind(parsed, kind);
    let notRaw = (kind) => parsed.raw[kind] == null;

    addMenu("sort", "排序", (menu) => {
        addItem(menu, "最新", { changes: { sort: null }, selected: !isSet("sort"), isDefault: true });
        for(let [sort, label] of Object.entries({ score: "分数", random: "随机", updated: "最近更新" }))
            addItem(menu, label, { changes: { sort }, selected: notRaw("sort") && conditions.sort == sort });
    });

    addMenu("score", "分数", (menu) => {
        addItem(menu, "不限", { changes: { minScore: null }, selected: !isSet("score"), isDefault: true });
        for(let score of SCORES)
            addItem(menu, `≥ ${score}`, { changes: { minScore: score }, selected: notRaw("score") && conditions.minScore == score });

        let custom = notRaw("score") && conditions.minScore != null && !SCORES.includes(conditions.minScore);
        addItem(menu, custom? `自定义：≥ ${conditions.minScore}`:"自定义…", {
            selected: custom,
            classes: ["gb-cond-custom"],
            onclick: async () => {
                let score = await promptNumber("分数至少多少", conditions.minScore);
                if(score != null)
                    helpers.navigate(urlForQuery(dataSource.url, setConditions(query, { minScore: score })));
            },
        });
    });

    let ratingOpener = addMenu("rating", "分级", (menu) => {
        // Each rating turns on and off.  Choosing all of them or none is the same as 全部.
        let selected = notRaw("rating")? (conditions.ratings ?? []):[];
        if(selected.length == RATINGS.length)
            selected = [];
        addItem(menu, "全部", { changes: { ratings: null }, selected: !isSet("rating"), isDefault: true });
        for(let rating of RATINGS)
        {
            let on = selected.includes(rating);
            let next = on? selected.filter((r) => r != rating):[...selected, rating];
            let link = addItem(menu, RATING_LABELS[rating], {
                changes: { ratings: next.length == 0 || next.length == RATINGS.length? null:next },
                selected: on,
                classes: ["gb-rating-option"],
            });
            link.setAttribute("role", "menuitemcheckbox");
            link.setAttribute("aria-checked", String(on));
            link.addEventListener("click", () => { reopenRatingsUntil = Date.now() + 2000; });
        }
    });

    addMenu("type", "类型", (menu) => {
        addItem(menu, "全部", { changes: { type: null }, selected: !isSet("type"), isDefault: true });
        for(let [type, label] of Object.entries(TYPE_LABELS))
            addItem(menu, label, { changes: { type }, selected: notRaw("type") && conditions.type == type });
    });

    addMenu("size", "尺寸", (menu) => {
        let current = notRaw("size")? { minWidth: conditions.minWidth, minHeight: conditions.minHeight }:{};
        addItem(menu, "不限", { changes: { minWidth: null, minHeight: null }, selected: !isSet("size"), isDefault: true });
        let matched = false;
        for(let size of SIZES)
        {
            let changes = { minWidth: size.minWidth ?? null, minHeight: size.minHeight ?? null };
            let selected = notRaw("size") && changes.minWidth == conditions.minWidth && changes.minHeight == conditions.minHeight;
            matched ||= selected;
            addItem(menu, sizeLabel(size), { changes, selected });
        }

        // Custom width or height keeps the other one, so both can be set.
        let custom = notRaw("size") && isSet("size") && !matched;
        for(let [key, title, label] of [["minWidth", "宽度至少多少像素", "自定义宽度…"], ["minHeight", "高度至少多少像素", "自定义高度…"]])
        {
            addItem(menu, label, {
                selected: custom && current[key] != null,
                classes: ["gb-cond-custom"],
                onclick: async () => {
                    let value = await promptNumber(title, current[key]);
                    if(value == null)
                        return;
                    let changes = { minWidth: current.minWidth ?? null, minHeight: current.minHeight ?? null, [key]: value };
                    helpers.navigate(urlForQuery(dataSource.url, setConditions(query, changes)));
                },
            });
        }
    });

    // 隐藏 AI is a toggle.
    let ai = helpers.createBoxLink({ label: "隐藏 AI", classes: ["gb-cond", "gb-cond-ai"], asElement: true });
    ai.dataset.kind = "ai";
    ai.href = linkFor({ hideAi: !conditions.hideAi });
    ai.setAttribute("role", "button");
    ai.setAttribute("aria-pressed", String(conditions.hideAi));
    helpers.html.setClass(ai, "selected", conditions.hideAi);
    container.appendChild(ai);

    // 清除条件, when any is set.
    if(Object.keys(described).length)
    {
        let clear = helpers.createBoxLink({ label: "清除条件", popup: "去掉所有搜索条件，只留标签", classes: ["gb-cond-clear"], asElement: true });
        clear.href = urlForQuery(dataSource.url, clearConditions(query)).url.toString();
        container.appendChild(clear);
    }

    if(Date.now() < reopenRatingsUntil)
        ratingOpener.visible = true;
    reopenRatingsUntil = 0;
}

// The note at the end of a list with conditions, or under 没有结果: the active conditions and a
// link to the same tags without them.  Return null when the query has no condition.
export function createConditionsNote(dataSource)
{
    let query = dataSource.query;
    let described = describeConditions(query);
    if(described.length == 0)
        return null;

    let note = document.createElement("div");
    note.className = "gb-conditions-note";

    let text = document.createElement("span");
    text.className = "gb-conditions-note-text";
    text.textContent = `当前条件：${described.map(({ label }) => label).join(" · ")}`;

    let clear = document.createElement("a");
    clear.className = "gb-conditions-note-clear";
    clear.href = urlForQuery(dataSource.url, clearConditions(query)).url.toString();
    clear.textContent = "去掉条件再找";
    note.append(text, clear);
    return note;
}
