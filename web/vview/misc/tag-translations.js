import KeyStorage from '/vview/misc/key-storage.js';
import { helpers } from '/vview/misc/helpers.js';

const KANA_RE = /[\u3040-\u30ff]/;
const HAN_RE = /[\u3400-\u9fff]/;

// Fetching missing translations: one request at a time this far apart, at most this many tags
// waiting (the newest are kept), a pause after an error, and how long a tag Pixiv has no
// translation for is left alone.
const FETCH_SPACING_MS = 700;
const FETCH_QUEUE_MAX = 40;
const FETCH_ERROR_PAUSE_MS = 60 * 1000;
const CHANGED_EVENT_SPACING_MS = 2000;
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export default class TagTranslations
{
    constructor()
    {
        this._db = new KeyStorage("ppixiv-tag-translations");

        // Firefox's private mode is broken: instead of making storage local to the session and
        // not saved to disk, it just disables IndexedDB entirely, which is lazy and breaks pages.
        // Keep a copy of tags we've seen in this session to work around this  This isn't a problem
        // in other browsers.
        // tag -> translations by language.
        this._cache = new Map();
        this._pendingWrites = Promise.resolve();

        // Tags waiting for a translation request, oldest first, and every tag queued this session.
        this._fetchQueue = [];
        this._fetchQueued = new Set();
        this._fetching = false;
    }

    // Return true if translations are enabled by the user.
    get enabled()
    {
        return ppixiv.site.caps.tagTranslations && !ppixiv.settings.get("disable-translations");
    }

    // Store a list of tag translations.
    // 
    // tags is a dictionary:
    // {
    //     original_tag: {
    //         en: "english tag",
    //     }
    // }
    async addTranslationsDict(tags, { overwrite=true }={})
    {
        let translations = [];
        for(let tag of Object.keys(tags))
        {
            let tagInfo = tags[tag];
            let tagTranslation = {};
            for(let lang of Object.keys(tagInfo))
            {
                if(tagInfo[lang] == "")
                    continue;
                tagTranslation[lang] = tagInfo[lang];
            }

            if(Object.keys(tagTranslation).length > 0)
            {
                translations.push({
                    tag: tag,
                    translation: tagTranslation,
                });
            }
        }

        return this.addTranslations(translations, { overwrite });
    }
    
    // Store a list of tag translations.
    // 
    // tagList is a list of
    // {
    //     tag: "original tag",
    //     translation: {
    //         en: "english tag",
    //         zh: "中文",
    //     },
    // }
    //
    // This is the same format that Pixiv uses in newer APIs.  New translations are merged into the
    // stored ones rather than replacing them: Pixiv's illust API only returns English, and replacing
    // would lose the Chinese translation that search results gave us.
    //
    // If overwrite is false, languages that already have a translation keep it.  If onlyMissingZh is
    // true, tags that already have a Chinese translation are left alone.
    addTranslations(tagList, { overwrite=true, onlyMissingZh=false }={})
    {
        // Keep each read, merge and write together, so a batch from search results and one from
        // full work info arriving at once can't drop each other's languages.
        let result = this._pendingWrites.then(() => this._addTranslations(tagList, { overwrite, onlyMissingZh }));
        this._pendingWrites = result.catch(() => {});
        return result;
    }

    async _addTranslations(tagList, { overwrite, onlyMissingZh })
    {
        let data = {};
        for(let tag of tagList)
        {
            // Remove empty translation values.
            let translation = {};
            for(let [lang, value] of Object.entries(tag.translation || {}))
            {
                if(value)
                    translation[lang] = value;
            }

            // If a tag has no translations and no romanization, skip it so we don't fill our database
            // with useless entries.
            if(Object.keys(translation).length == 0 && tag.romaji == null)
                continue;

            data[tag.tag] = { tag: tag.tag, translation, romaji: tag.romaji };
        }

        let tags = Object.keys(data);
        if(tags.length == 0)
            return;

        let stored = await this._db.multiGet(tags);
        let merged = {};
        for(let i = 0; i < tags.length; ++i)
        {
            let tag = tags[i];
            let old = stored?.[i] ?? null;
            let oldTranslation = { ...old?.translation, ...this._cache.get(tag) };
            if(onlyMissingZh && oldTranslation.zh)
                continue;

            let { translation, romaji } = data[tag];
            translation = overwrite? { ...oldTranslation, ...translation }:{ ...translation, ...oldTranslation };
            this._cache.set(tag, translation);

            let tagInfo = { tag, translation };
            if(old?.checked)
                tagInfo.checked = old.checked;
            romaji ??= old?.romaji;
            if(romaji)
                tagInfo.romaji = romaji;
            merged[tag] = tagInfo;
        }

        await this._db.multiSet(merged);
    }

    async getTagInfo(tags)
    {
        // If the user has disabled translations, don't return any.
        if(!this.enabled)
            return {};

        let result = {};
        let translations = await this._db.multiGet(tags);
        for(let i = 0; i < tags.length; ++i)
        {
            if(translations[i] == null)
                continue;
            result[tags[i]] = translations[i];
        }
        return result;
    }

    // Return the translation to show for tag, given its translations by language, or null to
    // show the tag itself.
    static pickTranslation(tag, translation, language)
    {
        if(language == "en")
            return translation?.en || null;

        let value = translation?.zh || translation?.zh_tw || translation?.en;
        if(!value || value == tag)
            return null;

        // Pixiv also "translates" tags that are already Chinese, or kanji-only Japanese, into
        // English, like 原神 to "Genshin Impact".  A Chinese reader is better off with the tag itself.
        if(HAN_RE.test(tag) && !KANA_RE.test(tag) && !HAN_RE.test(value))
            return null;
        return value;
    }

    // The language tags are shown in: "zh" (Chinese, falling back on English) or "en".
    get displayLanguage()
    {
        return ppixiv.settings.get("tag_language") == "en"? "en":"zh";
    }

    // Return { tag: translation } for the tags in tags that have one.  Callers from upstream pass
    // "en" as the language.  It's ignored, and the user's tag language is used.
    //
    // Tags with no translation in the user's language are looked up on Pixiv in the background;
    // "tag-translations-changed" on window says when new ones arrive, so the caller can redraw.
    //
    // lookups limits how many of the tags are looked up, for long lists like an artist's tags.
    //
    // A site with its own tag names (ppixiv.site.tagNames, like Gelbooru's Chinese names) answers
    // from them instead.
    async getTranslations(tags, language=null, { lookups=Infinity }={})
    {
        if(ppixiv.site.tagNames)
            return ppixiv.site.tagNames(tags);

        if(!this.enabled)
            return {};

        await this._pendingWrites;
        let info = await this.getTagInfo(tags);
        let result = {};
        let missing = [];
        for(let tag of tags)
        {
            let translation = { ...info[tag]?.translation, ...this._cache.get(tag) };
            let value = TagTranslations.pickTranslation(tag, translation, this.displayLanguage);
            if(value != null)
                result[tag] = value;

            if(this._needsLookup(tag, translation, info[tag]?.checked))
                missing.push(tag);
        }

        this._queueLookups(missing.slice(0, lookups));
        return result;
    }

    // Whether to ask Pixiv for tag's translation.  Pixiv's work info only has English, and the
    // other lists only translate the tags on their own works, so a saved search or a work's tags
    // often have no Chinese translation stored.  Only Japanese is looked up for Chinese: a tag in
    // kanji alone or in Latin letters reads fine as it is.
    _needsLookup(tag, translation, checked)
    {
        if(!tag || ppixiv.native)
            return false;
        if(checked && Date.now() - checked < RECHECK_AFTER_MS)
            return false;

        if(this.displayLanguage == "en")
            return !translation.en && /[^\x00-\x7f]/.test(tag);
        return !translation.zh && !translation.zh_tw && KANA_RE.test(tag);
    }

    _queueLookups(tags)
    {
        for(let tag of tags)
        {
            if(this._fetchQueued.has(tag))
                continue;
            this._fetchQueued.add(tag);
            this._fetchQueue.push(tag);
        }

        // Keep the newest tags, the ones on screen now.  Dropped tags are queued again the next
        // time they're shown.
        while(this._fetchQueue.length > FETCH_QUEUE_MAX)
            this._fetchQueued.delete(this._fetchQueue.shift());

        if(this._fetchQueue.length && !this._fetching)
            this._runLookups();
    }

    async _runLookups()
    {
        this._fetching = true;

        // "tag-translations-changed" redraws tag lists and page headers, so it's only sent when a
        // looked-up tag got a translation, at most every CHANGED_EVENT_SPACING_MS and when the
        // queue is done.  A redraw under the pointer can swallow a click.
        let changed = false, lastEvent = 0;
        let sendChanged = () => {
            changed = false;
            lastEvent = Date.now();
            window.dispatchEvent(new Event("tag-translations-changed"));
        };

        try {
            while(this._fetchQueue.length)
            {
                // Newest first.
                let tag = this._fetchQueue.pop();
                let result = await helpers.pixivRequest.get(`/ajax/search/tags/${encodeURIComponent(tag)}`);
                if(result?.error || result?.body == null)
                {
                    // Back off in case this was a rate limit.  An error page or a failed request
                    // ("429 Too Many Requests", "Invalid response") is tried again the next time
                    // the tag is shown.  An error Pixiv answers in JSON is about this tag, so it
                    // isn't asked again for a while.
                    let message = result?.message ?? "";
                    console.log(`Tag translation lookup for ${tag} failed: ${message}`);
                    if(/^\d{3} |^Invalid response$/.test(message) || result == null)
                        this._fetchQueued.delete(tag);
                    else
                        await this._markChecked(tag);

                    if(changed)
                        sendChanged();
                    await helpers.other.sleep(FETCH_ERROR_PAUSE_MS);
                    continue;
                }

                // The response also translates the user's favorite tags.  Keep those too.
                let translations = result.body.tagTranslation;
                if(translations && !Array.isArray(translations))
                {
                    await this.addTranslationsDict(translations);
                    if(TagTranslations.pickTranslation(tag, translations[tag], this.displayLanguage) != null)
                        changed = true;
                }
                await this._markChecked(tag);

                if(changed && (this._fetchQueue.length == 0 || Date.now() - lastEvent >= CHANGED_EVENT_SPACING_MS))
                    sendChanged();

                await helpers.other.sleep(FETCH_SPACING_MS);
            }

            if(changed)
                sendChanged();
        } finally {
            this._fetching = false;
        }
    }

    // Record that tag was looked up, so a tag Pixiv has no translation for isn't asked again
    // for a while.
    _markChecked(tag)
    {
        let result = this._pendingWrites.then(async() => {
            // multiGet returns {} if IndexedDB is unavailable (Firefox's private mode).
            let old = (await this._db.multiGet([tag]))?.[0];
            await this._db.multiSet({ [tag]: { translation: {}, ...old, tag, checked: Date.now() } });
        });
        this._pendingWrites = result.catch(() => {});
        return result;
    }

    // Pixiv's tag autocomplete matches Chinese typed by the user against tag translations, so
    // typing 碧蓝 suggests アズールレーン, whose translation is 碧蓝航线.  tag_translation is the text
    // the suggestion matched, which can be in any language, so only a translation that contains
    // the Chinese the user typed is recorded, and only for tags with no Chinese translation yet.
    async addAutocompleteTranslations(candidates, keyword)
    {
        keyword = keyword?.trim();
        if(this.displayLanguage != "zh" || !keyword || !HAN_RE.test(keyword) || KANA_RE.test(keyword))
            return;

        let found = [];
        for(let { type, tag_name: tag, tag_translation: translation } of candidates ?? [])
        {
            if(type == "tag_translation" && tag && translation && tag != translation &&
                translation.includes(keyword) && !KANA_RE.test(translation))
                found.push({ tag, translation: { zh: translation } });
        }
        if(found.length > 0)
            await this.addTranslations(found, { onlyMissingZh: true });
    }

    // Given a tag search, return a translated search.
    async translateTagList(tags, language)
    {
        // Pull out individual tags, removing -prefixes.
        let splitTags = helpers.pixiv.splitSearchTags(tags);
        let tagList = [];
        for(let tag of splitTags)
        {
            let [prefix, unprefixedTag] = helpers.pixiv.splitTagPrefixes(tag);
            tagList.push(unprefixedTag);
        }

        // Get translations.
        let translatedTags = await this.getTranslations(tagList, language);

        // Put the search back together.
        let result = [];
        for(let oneTag of splitTags)
        {
            let prefixAndTag = helpers.pixiv.splitTagPrefixes(oneTag);
            let prefix = prefixAndTag[0];
            let tag = prefixAndTag[1];
            if(translatedTags[tag])
                tag = translatedTags[tag];
            result.push(prefix + tag);
        }
        return result;
    }

    // A shortcut to retrieve one translation.  If no translation is available, returns the
    // original tag.
    async getTranslation(tag, language=null)
    {
        let translatedTags = await this.getTranslations([tag]);
        return translatedTags[tag] ?? tag;
    }
}
