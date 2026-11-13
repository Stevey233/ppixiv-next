// /ranking.php
//
// This one has an API, and also formats the first page of results into the page.
// They have completely different formats, and the page is updated dynamically (unlike
// the pages we scrape), so we ignore the page for this one and just use the API.
//
// An exception is that we load the previous and next days from the page.  This is better
// than using our current date, since it makes sure we have the same view of time as
// the search results.

import DataSource from '/vview/sites/data-source.js';
import Widget from '/vview/widgets/widget.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { helpers } from '/vview/misc/helpers.js';

// The latest ranking date ("YYYYMMDD") seen this session, by mode.  It's the date picker's last day.
// Each date is its own data source, so this isn't kept on one.
let latestDates = new Map();

// The first day of each ranking, from Pixiv's answers on 2026-11-13.  The modes not measured then
// (male_r18, female_r18, r18g) use their all-ages mode's day.  The date picker's first day.
const firstDates = {
    daily: "20070913", daily_r18: "20070913",
    weekly: "20080415", weekly_r18: "20080415", r18g: "20080415", monthly: "20080415",
    rookie: "20100331",
    male: "20111012", male_r18: "20111012", female: "20111012", female_r18: "20111012",
    original: "20120502",
    daily_ai: "20221031", daily_r18_ai: "20221031",
};

// Ranking dates are Japanese calendar days, so all date math here is UTC on the day itself and never
// uses the local time zone.  Return a Date at UTC midnight for "YYYYMMDD" or "YYYY-MM-DD", or null.
function parseDate(text)
{
    let match = String(text ?? "").match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if(match == null)
        return null;
    return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
}

// Format a Date from parseDate as "YYYYMMDD", or with separator, "YYYY-MM-DD".
function formatDate(date, separator="")
{
    let year = date.getUTCFullYear();
    let month = String(date.getUTCMonth() + 1).padStart(2, "0");
    let day = String(date.getUTCDate()).padStart(2, "0");
    return [year, month, day].join(separator);
}

function addDays(date, days)
{
    return new Date(date.getTime() + days * 24*60*60*1000);
}

// The last day the date picker offers: the latest ranking seen for the mode, any mode's latest if this
// one hasn't been loaded yet, or else yesterday in Japan, since Pixiv publishes a day's ranking the
// next day.
function lastDate(mode)
{
    let latest = latestDates.get(mode) ?? latestDates.values().next().value;
    if(latest)
        return parseDate(latest);

    let japanNow = new Date(Date.now() + 9*60*60*1000);
    let today = new Date(Date.UTC(japanNow.getUTCFullYear(), japanNow.getUTCMonth(), japanNow.getUTCDate()));
    return addDays(today, -1);
}

function firstDate(mode)
{
    return parseDate(firstDates[mode] ?? firstDates.daily);
}

// When Pixiv has no ranking for a date it doesn't say which days are next to it, so work them out:
// one day either side, kept inside the mode's first and last day.  A date before the first day steps
// forward to it, and one after the last day steps back to it.
function neighborDates(date, mode)
{
    let day = parseDate(date);
    if(day == null)
        return { prevDate: null, nextDate: null };

    let first = firstDate(mode), last = lastDate(mode);
    let prev = day > last? last: addDays(day, -1);
    let next = day < first? first: addDays(day, +1);
    return {
        prevDate: prev >= first? formatDate(prev):null,
        nextDate: next <= last? formatDate(next):null,
    };
}

export default class DataSource_Rankings extends DataSource
{
    get name() { return "rankings"; }
    get pageTitle() { return "Rankings"; }
    getDisplayingText() { return "Rankings"; }
    get ui() { return UI; }

    // The list's empty text when Pixiv has no ranking for the date.  Read by the search view.
    get noResultsText() { return this.rankingError? "这一天没有排行榜":null; }

    // This gives a tiny number of results per page on mobile.
    get estimatedItemsPerPage() { return ppixiv.mobile? 18:50; }

    constructor(args)
    {
        super(args);

        this.maxPage = 999999;
    }
    
    // A Pixiv classic: two separate, vaguely-similar ways of doing the same thing on desktop
    // and mobile (and a third, mobile apps).  It's like they use the same backend but are
    // implemented by two people who never talk to each other.  The desktop version is
    // preferred since it gives us thumbnail data, where the mobile version only gives
    // thumbnail IDs that we have to look up, but the desktop version can't be accessed
    // from mobile.
    async loadDataMobile({ date, mode, content, page })
    {
        let data = {
            mode,
            page,
            type: content,
        };

        if(date)
            data.date = date;

        let result = await helpers.pixivRequest.get("/touch/ajax/ranking/illust", data);
        let thisDate = result.body.rankingDate;

        function formatDate(date)
        {
            let year = date.getUTCFullYear();
            let month = date.getUTCMonth() + 1;
            let day = date.getUTCDate();
            return year + "-" + 
                month.toString().padStart(2, '0') + "-" +
                day.toString().padStart(2, '0');
        }

        // This API doesn't tell us the previous and next ranking dates, so we have to figure
        // it out ourself.
        let nextDate = new Date(thisDate);
        let prevDate = new Date(thisDate);
        nextDate.setDate(nextDate.getDate() + 1);
        prevDate.setDate(prevDate.getDate() - 1);

        nextDate = formatDate(nextDate);
        prevDate = formatDate(prevDate);

        // This version doesn't indicate the last page, and just keeps loading until it gets
        // an empty response.  It also doesn't indicate the first page where a ranking type
        // starts.  For example, AI results begin on 2022-10-31.  I'm not sure how to guess
        // the last page.  Are these dates UTC or JST?  Are new results available at exactly
        // midnight?
        let lastPage = false;

        let mediaIds = [];
        for(let item of result.body.ranking)
        {
            let mediaId = helpers.mediaId.fromIllustId("" + item.illustId);
            mediaIds.push(mediaId);
            this._setRank(mediaId, item.rank);
        }

        // All search APIs return image info except for this one, so we need to load it to
        // behave the same as other data source.
        await ppixiv.mediaCache.batchGetMediaInfoPartial(mediaIds);

        // Muted images won't be returned.  Make sure we don't return media IDs that we
        // haven't registered media info for.
        let foundMediaIds = [];
        for(let mediaId of mediaIds)
        {
            if(ppixiv.mediaCache.getMediaInfoSync(mediaId, { full: false }))
                foundMediaIds.push(mediaId);
        }

        return { mediaIds: foundMediaIds, thisDate, nextDate, prevDate, lastPage };
    }

    async loadDataDesktop({ date, mode, content, page })
    {
        let data = {
            content,
            mode,
            format:  "json",
            p: page,
        };

        if(date)
            data.date = date;

        let result = await helpers.pixivRequest.get("/ranking.php", data);

        // Pixiv answers {error: "不在排行榜统计范围内"} for a date it has no ranking for: before the
        // mode's first day, a day not published yet, or a mode that didn't exist then.  Keep the
        // requested date, so the stepper still shows it and can step out of it.
        if(result.error)
        {
            console.log(`Ranking for ${date} not available: ${result.error}`);
            this.rankingError = true;
            return { mediaIds: [], thisDate: date, lastPage: true, ...neighborDates(date, mode) };
        }

        // The latest ranking: loaded without a date, or the date has no next day.
        if(!date || !result.next_date)
            latestDates.set(mode, result.date);

        let thisDate = result.date;
        let nextDate = result.next_date || null;
        let prevDate = result.prev_date || null;
        let lastPage = !result.next;

        // Weekly and monthly rankings cover a range ending on the date, like "2026年11月6日 ～ 2026年11月12日".
        this.dateRangeText = result.date_range_text ?? null;

        // This API doesn't return aiType, but we can fill it in ourself since we know whether
        // we're on an AI rankings page or not.
        let isAI = mode == "daily_ai" || mode == "daily_r18_ai";
        for(let illust of result.contents)
            illust.aiType = isAI? 2:1;
        
        // This returns a struct of data that's like the thumbnails data response,
        // but it's not quite the same.
        let mediaIds = [];
        for(let item of result.contents)
        {
            let mediaId = helpers.mediaId.fromIllustId("" + item.illust_id);
            mediaIds.push(mediaId);
            this._setRank(mediaId, item.rank);
        }

        // Register this as thumbnail data.
        await ppixiv.mediaCache.addMediaInfosPartial(result.contents, "rankings");

        return { mediaIds, thisDate, nextDate, prevDate, lastPage };
    }

    // Each work's place in the ranking, shown on its thumbnail.  See docs/design.md.
    _setRank(mediaId, rank)
    {
        this._ranks ??= new Map();
        if(rank != null)
            this._ranks.set(mediaId, Number(rank));
    }

    rankForMediaId(mediaId)
    {
        return this._ranks?.get(helpers.mediaId.getMediaIdForPage(mediaId, 0)) ?? null;
    }

    loadDataForPlatform(options)
    {
        if(ppixiv.mobile)
            return this.loadDataMobile(options);
        else
            return this.loadDataDesktop(options);
    }

    async loadPageInternal(page)
    {
        // Stop if we already know this is past the end.
        if(page > this.maxPage)
            return;

        let queryArgs = this.url.searchParams;
        let date = queryArgs.get("date");
        let mode = queryArgs.get("mode") ?? "daily";
        let content = queryArgs.get("content") ?? "all";

        let { mediaIds, thisDate, nextDate, prevDate, lastPage } = await this.loadDataForPlatform({ date, mode, content, page });

        if(lastPage)
            this.maxPage = Math.min(page, this.maxPage);

        this.rankingDate = thisDate;
        this.prevDate = prevDate;
        this.nextDate = nextDate;
        this.callUpdateListeners();

        return { mediaIds };
    };
}

class UI extends Widget
{
    constructor({dataSource, ...options})
    {
        super({ ...options, template: `
            <div class="ranking-data-source box-button-row">
                <div class=n-rank-date>
                    <div class=n-rank-stepper>
                        <a class="n-rank-step n-rank-prev" aria-label="前一天" title="前一天">${ helpers.createIcon("mat:chevron_left") }</a>
                        <button type=button class=n-rank-day title="选择日期">
                            <span class=n-rank-day-date></span>
                            <span class=n-rank-day-sub></span>
                        </button>
                        <a class="n-rank-step n-rank-next" aria-label="后一天" title="后一天">${ helpers.createIcon("mat:chevron_right") }</a>
                        <input type=date class=n-rank-picker tabindex=-1 aria-hidden=true>
                    </div>
                    <a class=n-rank-latest hidden>最新</a>
                </div>

                <div class=box-button-row>
                    ${ helpers.createBoxLink({label: "Ranking type",    popup: "Rankings to display", classes: ["mode-button"] }) }
                    ${ helpers.createBoxLink({label: "Contents",    popup: "Content type to display", classes: ["content-type-button"] }) }
                </div>

                <div class="box-button-row modes"></div>
            </div>
        `});

        this.dataSource = dataSource;

        dataSource.addEventListener("updated", () => this.refreshDates(), { signal: this.shutdownSignal });
        this.refreshDates();
        this.querySelector(".n-rank-day").addEventListener("click", () => this._openPicker(), { signal: this.shutdownSignal });
        this.querySelector(".n-rank-picker").addEventListener("change", () => this._pickedDate(), { signal: this.shutdownSignal });

        /*
         * Pixiv has a fixed list of rankings, but it displays them as a set of buttons
         * based on the current selection, showing which rankings are available in the current
         * category.
         *     
         * These are the available ranking modes, and whether they're available in overall,
         * content=illust/manga (these have the same selections) and content=ugoira, and
         * whether there are R18 rankings.  R18 rankings have the same mode name with "_r18"
         * appended.  (Except for AI which puts it in the middle, because Pixiv.)
         *
         * Be careful: Pixiv's UI has buttons in some filters that don't actually exist in the
         * mode it's in, which actually redirect out of the content mode, such as "popular among
         * male users" in "Illustrations" mode which actually goes back to "Overall".
         *
         * o: overall (all) o*: overall R18      o**: overall R18G
         * i: illust/manga  i*: illust/manga R18 i**: illust/manga R18G
         * u: ugoira        u*: ugoira R18
         */
        let rankingTypes = {
            //                       Overall    Illust     Ugoira
            //                            R18        R18        R18       
            "daily":     { content: ["o", "o*", "i", "i*", "u", "u*"],                label: "Daily",    popup: "Daily rankings" },

            // Weekly also has "r18g" for most content types.
            "weekly":    { content: ["o", "o*", "i", "i*", "u", "u*", "o**", "i**"],  label: "Weekly",   popup: "Weekly rankings" },
            "monthly":   { content: ["o",       "i"],                                 label: "Monthly",  popup: "Monthly rankings" },
            "rookie":    { content: ["o",       "i"],                                 label: "Rookie",   popup: "Rookie rankings" },
            "original":  { content: ["o"],                                            label: "Original", popup: "Original rankings" },
            "daily_ai":  { content: ["o", "o*"],                                      label: "AI",       popup: "Show AI works" },
            "male":      { content: ["o", "o*"],                                      label: "Male",     popup: "Popular with men" },
            "female":    { content: ["o", "o*"],                                      label: "Female",   popup: "Popular with women" },
        };

        // Given a content selection ("all", "illust", "manga", "ugoira") and an ages selection, return
        // the shorthand key for this combination, such as "i*".
        function contentKeyFor(content, ages)
        {
            let keys = { "all": "o", "illust": "i", "manga": "i" /* same as illust */, "ugoira": "u" };
            let contentKey = keys[content];

            // Append * for r18 and ** for r18g.
            if(ages == "r18")
                contentKey += "*";
            else if(ages == "r18g")
                contentKey += "**";

            return contentKey;
        }

        // Given a mode ("daily") and an ages selection ("r18"), return the combined mode,
        // eg. "daily_r18".
        function modeWithAges(mode, ages)
        {
            if(ages == "r18")
                mode += "_r18"; // daily_r18
            else if(ages == "r18g")
                mode += "_r18g"; // daily_r18g

            // Seriously, guys?
            if(mode == "daily_ai_r18")
                mode = "daily_r18_ai";
            else if(mode == "weekly_r18g")
                mode = "r18g";

            return mode;
        }

        // Switching rankings keeps the date, like Pixiv.  A date before the new ranking's first day
        // moves to that day, which is the closest one it has.
        function keepDateInRange(args)
        {
            let day = parseDate(args.query.get("date"));
            let first = firstDate(args.query.get("mode") ?? "daily");
            if(day && day < first)
                args.query.set("date", formatDate(first, ppixiv.mobile? "-":""));
        }

        let currentArgs = new helpers.args(dataSource.url);

        // The current content type: all, illust, manga, ugoira
        let currentContent = currentArgs.query.get("content") || "all";

        // The current mode: daily, weekly, etc.
        let currentMode = currentArgs.query.get("mode") || "daily";
        if(currentMode == "r18g") // work around Pixiv inconsistency
            currentMode = "weekly_r18g";

        // "all", "r18", "r18g"
        let currentAges = currentMode.indexOf("r18g") != -1? "r18g":
            currentMode.indexOf("r18") != -1? "r18":"all";
        
        // Strip _r18 or _r18g out of currentMode, so currentMode is the base mode, ignoring the
        // ages selection.
        currentMode = currentMode.replace("_r18g", "").replace("_r18", "");

        // The key for the current mode:
        let contentKey = contentKeyFor(currentContent, currentAges);
        console.log(`Rankings content mode: ${currentContent}, ages: ${currentAges}, key: ${contentKey}`);

        let modeContainer = this.querySelector(".modes");

        // Create the R18 and R18G buttons.  If we're on a selection where toggling this doesn't exist,
        // pick a default.
        for(let agesToggle of ["r18", "r18g"])
        {
            let targetMode = currentMode;

            let currentRankingType = rankingTypes[currentMode];
            console.assert(currentRankingType, currentMode);
            let { content } = currentRankingType;

            let button = helpers.createBoxLink({
                label: agesToggle.toUpperCase(),
                popup: `Show ${agesToggle.toUpperCase()} works`,
                classes: [agesToggle],
                asElement: true,
            });
            modeContainer.appendChild(button);

            // If toggling this would put us in a mode that doesn't exist, default to "daily" for R18 and
            // "weekly" for R18G, since those combinations always exist.  The buttons aren't disabled or
            // removed since it makes it confusing to find them.
            let contentKeyForMode = contentKeyFor(currentContent, agesToggle);
            if(content.indexOf(contentKeyForMode) == -1)
                targetMode = agesToggle == "r18"? "daily":"weekly";

            let modeEnabled = modeWithAges(targetMode, agesToggle);
            let modeDisabled = modeWithAges(targetMode, "all");

            dataSource.setItem(button, {
                fields: {mode: modeEnabled},
                toggle: true,
                classes: [agesToggle], // only show if enabled
                adjustUrl: (args) => {
                    // If we're in R18, clicking this would remove the mode field entirely.  Instead,
                    // switch to the all-ages link.
                    if(currentAges == agesToggle)
                        args.query.set("mode", modeDisabled);
                    keepDateInRange(args);
                }
            });
        }

        // Create the content dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".content-type-button"),
            createDropdown: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `
                        <div class="vertical-list">
                            ${ helpers.createBoxLink({label: "All",           popup: "Show all works",           dataType: "content-all" }) }
                            ${ helpers.createBoxLink({label: "Illustrations", popup: "Show illustrations only",  dataType: "content-illust" }) }
                            ${ helpers.createBoxLink({label: "Animations",    popup: "Show animations only",     dataType: "content-ugoira" }) }
                            ${ helpers.createBoxLink({label: "Manga",         popup: "Show manga only",          dataType: "content-manga" }) }
                        </div>
                    `,
                });

                // Set up the content links.
                // grr: this doesn't work with the dropdown text
                for(let content of ["all", "illust", "ugoira", "manga"])
                {
                    dataSource.setItem(dropdown, {
                        type: "content-" + content, // content-all, content-illust, etc
                        fields: {content},
                        defaults: {content: "all"},
                        adjustUrl: (args) => {
                            if(content == currentContent)
                                return;

                            // If the current mode and ages combination doesn't exist in the content type
                            // this link will switch to, also reset the mode to daily, since it exists for
                            // all "all-ages" modes.
                            let currentRankingType = rankingTypes[currentMode];
                            console.assert(currentRankingType, currentMode);
                            let switching_to_content_key = contentKeyFor(content, currentAges);
                            if(currentRankingType.content.indexOf(switching_to_content_key) == -1)
                                args.query.set("mode", "daily");
                        },
                    });
                }

                return dropdown;
            },
        });

        // Create the mode dropdown.
        new DropdownMenuOpener({
            button: this.querySelector(".mode-button"),
            createDropdown: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `
                        <div class="vertical-list">
                        </div>
                    `
                });

                // Create mode links for rankings that exist in the current content and ages selection.
                for(let [mode, {content, label, popup}] of Object.entries(rankingTypes))
                {
                    console.assert(content, mode);

                    mode = modeWithAges(mode, currentAges);

                    // Skip this mode if it's not available in the selected content and ages combination.
                    if(content.indexOf(contentKey) == -1)
                        continue;

                    let button = helpers.createBoxLink({
                        label,
                        popup,
                        asElement: true,
                    });
                    dropdown.root.appendChild(button);

                    dataSource.setItem(button, {
                        fields: {mode},
                        defaults: {mode: "daily"},
                        adjustUrl: keepDateInRange,
                    });
                }

                return dropdown;
            }
        });
    }

    // The date stepper: "‹ 2026/11/12 周四 ›", or for weekly and monthly "‹ 11/06 – 11/12 2026 ›".  See
    // docs/design.md.
    refreshDates = () =>
    {
        let dataSource = this.dataSource;
        let url = new URL(dataSource.url);
        let urlDate = url.searchParams.get("date");
        let mode = url.searchParams.get("mode") ?? "daily";

        // Before the first page loads, show the date from the URL, so the row doesn't change size.
        let day = parseDate(dataSource.rankingDate ?? urlDate);
        let range = dataSource.rankingError? null:compactRange(dataSource.dateRangeText);
        let dateText = "", subText = "";
        if(range)
            [dateText, subText] = range;
        else if(day)
        {
            dateText = formatDate(day, "/");
            subText = "周" + "日一二三四五六"[day.getUTCDay()];
        }
        else
            dateText = dataSource.rankingDate ?? urlDate ?? "";
        this.querySelector(".n-rank-day-date").textContent = dateText;
        this.querySelector(".n-rank-day-sub").textContent = subText;
        this.querySelector(".n-rank-day").title = dataSource.dateRangeText && !dataSource.rankingError?
            `${dataSource.dateRangeText}，选择日期`:"选择日期";

        // The arrows are disabled until the first page says which days exist, rather than hidden,
        // so the row doesn't shift as it loads.
        for(let [selector, date] of [[".n-rank-prev", dataSource.prevDate], [".n-rank-next", dataSource.nextDate]])
        {
            let link = this.querySelector(selector);
            link.setAttribute("aria-disabled", date == null? "true":"false");
            if(date == null)
                link.removeAttribute("href");
            else
                link.href = this._urlForDate(date);
        }

        // "最新" goes back to the latest ranking from an earlier day.  The latest day has no next day.
        let isLatest = !dataSource.rankingError && dataSource.rankingDate != null && dataSource.nextDate == null;
        let latest = this.querySelector(".n-rank-latest");
        latest.hidden = urlDate == null || isLatest;
        latest.href = this._urlForDate(null);

        let picker = this.querySelector(".n-rank-picker");
        picker.min = formatDate(firstDate(mode), "-");
        picker.max = formatDate(lastDate(mode), "-");
    }

    // The URL of this ranking on date ("YYYYMMDD", or YYYY-MM-DD on mobile), or the latest if null.
    _urlForDate(date)
    {
        let url = new URL(this.dataSource.url);
        if(date == null)
            url.searchParams.delete("date");
        else
            url.searchParams.set("date", date);
        url.searchParams.delete("p");
        return url.toString();
    }

    // Open the browser's own date picker under the date.  The click is the user gesture showPicker needs.
    _openPicker()
    {
        let picker = this.querySelector(".n-rank-picker");
        let day = parseDate(this.dataSource.rankingDate ?? new URL(this.dataSource.url).searchParams.get("date"));
        picker.value = day? formatDate(day, "-"):"";
        picker.showPicker();
    }

    _pickedDate()
    {
        let day = parseDate(this.querySelector(".n-rank-picker").value);
        if(day == null)
            return;

        // The mobile API takes YYYY-MM-DD, the desktop one YYYYMMDD.
        let date = formatDate(day, ppixiv.mobile? "-":"");
        helpers.navigate(new URL(this._urlForDate(date)));
    }
}

// Shorten Pixiv's date_range_text for weekly and monthly rankings to ["11/06 – 11/12", "2026"].  Return
// null for a single day.  The text is Pixiv's, "2026年11月6日 ～ 2026年11月12日"; the second year may be
// missing.  The year shown is the last day's.
function compactRange(text)
{
    let days = [...String(text ?? "").matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)];
    if(days.length < 2)
        return null;

    let [start, end] = [days[0], days.at(-1)];
    let monthDay = (match) => `${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`;
    return [`${monthDay(start)} – ${monthDay(end)}`, end[1] ?? start[1] ?? ""];
}
