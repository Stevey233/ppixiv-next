// The conditions a new Gelbooru tag search starts with, chosen in settings: sort, minimum score,
// ratings and 隐藏 AI.  SiteGelbooru.getArgsForTagSearch applies them to a search from the search
// box, a tag pill or a saved tag, for each kind of condition that neither the typed query nor the
// posts list it starts from sets.  Opening a URL, the rail's lists and adding or excluding a tag
// on the current search don't use them.
import { MenuOptionOptionsSetting, MenuOptionToggleSetting } from '/vview/widgets/menu-option.js';
import { RATINGS, SORTS } from '/vview/sites/gelbooru/query.js';
import { SCORES, RATING_LABELS, ratingsLabel, promptNumber } from '/vview/sites/gelbooru/conditions-ui.js';

// The rating choices of the setting, as comma-separated ratings.
const RATING_CHOICES = [
    "general",
    "general,sensitive",
    "general,sensitive,questionable",
    "questionable,explicit",
    "explicit",
];

// The default conditions, for query.js.
export function defaultConditions()
{
    let sort = ppixiv.settings.get("gelbooru_default_sort");
    let score = parseInt(ppixiv.settings.get("gelbooru_default_score"));
    let ratings = ppixiv.settings.get("gelbooru_default_ratings");
    return {
        sort: SORTS.includes(sort)? sort:null,
        minScore: score > 0? score:null,
        ratings: ratings == "all"? null:ratings.split(",").filter((rating) => RATINGS.includes(rating)),
        hideAi: ppixiv.settings.get("gelbooru_default_hide_ai"),
    };
}

const EXPLANATION = "从搜索框、保存的标签或作品的标签搜新标签时用。从帖子列表搜时，列表已经设了的条件优先；搜索里自己写了的条件也不会被替换。";

export function createSearchSettings(globalOptions)
{
    // The related tags row is on desktop only.
    if(!ppixiv.mobile)
    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "搜索结果上方显示相关标签",
        setting: "search_related_tags",
        explanationEnabled: "标签搜索的页头显示一行这批结果里最常见的标签，点一下加到当前搜索。",
        explanationDisabled: "不显示。",
    });

    new MenuOptionOptionsSetting({
        ...globalOptions,
        setting: "gelbooru_default_sort",
        label: "新搜索的排序",
        values: { newest: "最新", score: "分数最高", random: "随机", updated: "最近更新" },
        explanation: () => EXPLANATION,
    });

    new MenuOptionOptionsSetting({
        ...globalOptions,
        setting: "gelbooru_default_score",
        label: "新搜索的最低分数",
        // A score set with 自定义… is listed too.
        values: () => {
            let scores = SCORES;
            let current = parseInt(ppixiv.settings.get("gelbooru_default_score"));
            if(current > 0 && !scores.includes(current))
                scores = [...scores, current].sort((a, b) => a - b);
            return {
                "0": "不限",
                ...Object.fromEntries(scores.map((score) => [String(score), `≥ ${score}`])),
                custom: "自定义…",
            };
        },
        choose: async (value) => {
            if(value != "custom")
                return value;
            let current = parseInt(ppixiv.settings.get("gelbooru_default_score"));
            let score = await promptNumber("新搜索的分数至少多少", current > 0? current:null);
            return score == null? null:String(score);
        },
        explanation: () => EXPLANATION,
    });

    new MenuOptionOptionsSetting({
        ...globalOptions,
        setting: "gelbooru_default_ratings",
        label: "新搜索的分级",
        values: {
            all: "全部",
            ...Object.fromEntries(RATING_CHOICES.map((choice) => [choice, ratingsLabel(choice.split(","))])),
        },
        explanation: (value) => value == "all"? EXPLANATION:
            `只看${value.split(",").map((rating) => RATING_LABELS[rating]).join("、")}。${EXPLANATION}`,
    });

    new MenuOptionToggleSetting({
        ...globalOptions,
        label: "新搜索隐藏 AI 作品",
        setting: "gelbooru_default_hide_ai",
        explanationEnabled: "新搜索带上“隐藏 AI”（-ai-generated）。",
        explanationDisabled: "新搜索不隐藏 AI 作品。",
    });
}
