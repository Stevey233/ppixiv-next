// 热门: the top-scored posts among those posted in the last day, week or month.
//
// Gelbooru can't search by date (date: answers nothing), but post IDs grow with time, so the list
// is sort:score id:>N with N the ID of a post about that old.  N is found with id:<=X limit=1
// probes, which answer the newest post at or below X with its date.  The rate of new posts is
// uneven (4,500 to 7,500 IDs a day, measured 2026-11-16), so each probe corrects the rate from the
// posts already found: at most 3 requests per period, kept for 6 hours.
import * as api from '/vview/sites/gelbooru/api.js';

export const PERIODS = [
    // [key, label, days]
    ["day", "今日", 1],
    ["week", "本周", 7],
    ["month", "本月", 30],
];

const DAY = 24 * 60 * 60 * 1000;
const CACHE_KEY = "ppixiv_gelbooru_popular";
const CACHE_TIME = 6 * 60 * 60 * 1000;
const PROBES = 2;

// The first guess at the rate, in IDs per millisecond.
const GUESS_RATE = 6000 / DAY;

export function periodKey(period)
{
    return PERIODS.some(([key]) => key == period)? period:"week";
}

export function periodLabel(period)
{
    return PERIODS.find(([key]) => key == periodKey(period))[1];
}

// Return the ID of a post about one period old.
export async function popularMinId(period)
{
    period = periodKey(period);
    let cache = JSON.parse(localStorage[CACHE_KEY] ?? "{}");
    let cached = cache[period];
    if(cached != null && Math.abs(Date.now() - cached.at) < CACHE_TIME)
        return cached.id;

    let id = await findIdAtAge(PERIODS.find(([key]) => key == period)[2] * DAY);
    cache[period] = { id, at: Date.now() };
    localStorage[CACHE_KEY] = JSON.stringify(cache);
    return id;
}

// Return { id, time } of the newest post at or below maxId, or of the newest post if maxId is
// null, or null if there is none.
async function probe(maxId)
{
    let { posts } = await api.searchPosts({ tags: maxId == null? "":`id:<=${maxId}`, limit: 1 });
    let post = posts[0];
    return post? { id: post.id, time: new Date(post.created_at).getTime() }:null;
}

async function findIdAtAge(age)
{
    let newest = await probe(null);
    if(newest == null)
        return 0;

    // Measure from the newest post's date rather than this computer's clock.
    let target = newest.time - age;
    let points = [newest];
    let guess = newest.id - GUESS_RATE * age;
    for(let i = 0; i < PROBES; i++)
    {
        let found = await probe(Math.max(1, Math.round(guess)));
        if(found == null)
            break;
        points.push(found);

        // Interpolate between the two posts closest in time to the target.
        let [a, b] = [...points].sort((x, y) => Math.abs(x.time - target) - Math.abs(y.time - target));
        let rate = a.time != b.time? (a.id - b.id) / (a.time - b.time):GUESS_RATE;
        if(!(rate > 0))
            rate = GUESS_RATE;
        guess = a.id + rate * (target - a.time);
    }
    return Math.max(0, Math.min(newest.id, Math.round(guess)));
}
