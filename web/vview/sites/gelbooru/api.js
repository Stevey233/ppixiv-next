// Every request to gelbooru.com goes through here.  See .work/gelbooru/API.md for what the site
// answers and .work/gelbooru/DESIGN.md, "Requests", for the rules.
//
// The API key and user ID come from the account options page, which shows them to a logged-in
// user as "&api_key=<key>&user_id=<id>".  They're kept in this origin's localStorage under their
// own key, outside ppixiv's settings, so a settings export doesn't carry them.  The key is sent
// only to gelbooru.com and never logged.

const CREDENTIALS_KEY = "ppixiv_gelbooru_credentials";
const OPTIONS_URL = "/index.php?page=account&s=options";

// The account allows 10 requests a second.  Stay well under it.
const MAX_IN_FLIGHT = 2;
const MIN_START_SPACING = 150;

export class LoggedOutError extends Error { }

// Start functions at most MAX_IN_FLIGHT at a time and at least MIN_START_SPACING ms apart.
class RequestSpacing
{
    constructor()
    {
        this._inFlight = 0;
        this._lastStart = 0;
        this._waiting = [];
    }

    async run(func)
    {
        await new Promise((resolve) => {
            this._waiting.push(resolve);
            this._startNext();
        });

        try {
            return await func();
        } finally {
            this._inFlight--;
            this._startNext();
        }
    }

    _startNext()
    {
        if(this._timer != null || this._waiting.length == 0 || this._inFlight >= MAX_IN_FLIGHT)
            return;

        let wait = this._lastStart + MIN_START_SPACING - Date.now();
        if(wait > 0)
        {
            this._timer = realSetTimeout(() => {
                this._timer = null;
                this._startNext();
            }, wait);
            return;
        }

        this._inFlight++;
        this._lastStart = Date.now();
        this._waiting.shift()();
        this._startNext();
    }
}

let spacing = new RequestSpacing();

function fetchSite(path, options={})
{
    return window.realFetch(new URL(path, location.origin), { credentials: "same-origin", ...options });
}

// Return the stored { apiKey, userId }, or null.
function storedCredentials()
{
    let value = localStorage[CREDENTIALS_KEY];
    return value? JSON.parse(value):null;
}

// Read the credentials from the account options page and store them.  Return null if the page
// shows no key, which means the user isn't logged in.
export async function readCredentials()
{
    let response = await fetchSite(OPTIONS_URL);
    let doc = new DOMParser().parseFromString(await response.text(), "text/html");
    let credentials = null;
    for(let textarea of doc.querySelectorAll("textarea"))
    {
        let params = new URLSearchParams(textarea.value.trim().replace(/^&/, ""));
        if(!params.has("api_key"))
            continue;
        if(params.get("api_key") && params.get("user_id"))
            credentials = { apiKey: params.get("api_key"), userId: params.get("user_id") };
        break;
    }

    if(credentials)
        localStorage[CREDENTIALS_KEY] = JSON.stringify(credentials);
    else
        delete localStorage[CREDENTIALS_KEY];
    return credentials;
}

// After a 401 with staleKey: the credentials read again, once for every request refused together
// (the favorites check and the first list start at the same time), or the ones another request
// already read.
let rereading = null;
async function rereadCredentials(staleKey)
{
    let stored = storedCredentials();
    if(stored != null && stored.apiKey != staleKey)
        return stored;

    rereading ??= readCredentials().finally(() => rereading = null);
    return await rereading;
}

// Return the credentials, reading them from the options page if they aren't stored yet.
export async function getCredentials()
{
    return storedCredentials() ?? await readCredentials();
}

// The user ID of the logged-in user, once getCredentials has run.
export function userId()
{
    return storedCredentials()?.userId ?? null;
}

// Run a dapi request.  params are the query arguments after page=dapi.  Return the parsed
// JSON, or { tooDeep: true } when Gelbooru refuses to page that far.  A 401 means the stored key
// is stale: read it again once and retry.
async function dapi(params, { signal=null }={})
{
    let credentials = null;
    for(let attempt = 0; ; attempt++)
    {
        credentials = attempt == 0? await getCredentials():await rereadCredentials(credentials.apiKey);
        if(credentials == null)
            throw new LoggedOutError("Not logged in to Gelbooru");

        let query = new URLSearchParams({ page: "dapi", ...params, json: "1" });
        query.set("api_key", credentials.apiKey);
        query.set("user_id", credentials.userId);

        let response = await spacing.run(() => fetchSite(`/index.php?${query}`, { signal }));
        if(response.status == 401 && attempt == 0)
        {
            console.log("Gelbooru refused the stored API key, reading it again");
            continue;
        }
        if(!response.ok)
            throw new Error(`Gelbooru API request failed: HTTP ${response.status}`);

        let text = await response.text();
        if(text.startsWith("Too deep"))
            return { tooDeep: true };
        return JSON.parse(text);
    }
}

// Search posts.  pid is the 0-based page of limit posts.  Return { count, posts, tooDeep }.
export async function searchPosts({ tags="", pid=0, limit=100, signal=null }={})
{
    let result = await dapi({ s: "post", q: "index", limit: String(limit), pid: String(pid), tags }, { signal });
    if(result.tooDeep)
        return { count: null, posts: [], tooDeep: true };

    return {
        count: result["@attributes"]?.count ?? 0,
        posts: result.post ?? [],
        tooDeep: false,
    };
}

// Return the post with the given ID, or null if it doesn't exist.
export async function getPost(postId)
{
    let { posts } = await searchPosts({ tags: `id:${postId}`, limit: 1 });
    return posts[0] ?? null;
}

// Look up tags by name, at most 100 per call.  Return [{ name, type }], where type is Gelbooru's
// category ID (0 general, 1 artist, 3 copyright, 4 character, 5 metadata).  Names Gelbooru
// doesn't know are left out.
export async function getTags(names)
{
    console.assert(names.length <= 100);
    let result = await dapi({ s: "tag", q: "index", limit: "100", names: names.join(" ") });
    return result.tag ?? [];
}

// Tag autocomplete, which needs no key.  Return [{ tag, label, category, count }].  category is
// Gelbooru's: tag (general), artist, character, copyright or metadata.
export async function autocomplete(term, { signal=null }={})
{
    let query = new URLSearchParams({ page: "autocomplete2", term, type: "tag_query", limit: "10" });
    let response = await fetchSite(`/index.php?${query}`, { signal });
    if(!response.ok)
        throw new Error(`Gelbooru autocomplete failed: HTTP ${response.status}`);

    let results = await response.json();
    return results.map((entry) => ({
        tag: entry.value,
        label: entry.label,
        category: entry.category,
        count: parseInt(entry.post_count) || 0,
    }));
}

// Add a favorite with the session cookie.  Return true if the post is a favorite afterwards.
// The answer is 3 (added), 1 (already a favorite) or 2 (not logged in).
export async function addFavorite(postId)
{
    let response = await spacing.run(() => fetchSite(`/public/addfav.php?id=${encodeURIComponent(postId)}`));
    let text = (await response.text()).trim();
    return response.ok && (text == "3" || text == "1");
}

// Remove a favorite.  The page redirects to the favorites list, so a 200 is success.
export async function removeFavorite(postId)
{
    let response = await spacing.run(() => fetchSite(`/index.php?page=favorites&s=delete&id=${encodeURIComponent(postId)}`));
    return response.ok;
}

// Upvote a post, as Gelbooru's own favorite button does.  Only sent when the setting
// gelbooru_upvote_on_favorite is on.
export async function upvote(postId)
{
    let response = await spacing.run(() => fetchSite(`/index.php?page=post&s=vote&id=${encodeURIComponent(postId)}&type=up`));
    return response.ok;
}

export const loginUrl = "/index.php?page=account&s=login&code=00#no-ppixiv";
