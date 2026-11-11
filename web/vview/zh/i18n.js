// Simplified Chinese for the upstream widgets.
//
// Widget templates are translated once when Actor.createTemplate parses them, so most text is
// Chinese before it reaches the page.  Text that widgets set later (labels, tooltips, messages)
// is translated by a MutationObserver limited to ppixiv's own elements, which carry the
// "widget" class.  Pixiv's page and other extensions sharing it are left alone.

import {
    DICT, PATTERNS, ICON_SELECTOR, SKIP_SELECTOR, ALLOW_SELECTOR,
    TAG_BUTTON_LABEL_SELECTOR, TAG_BUTTON_LABELS,
} from '/vview/zh/dict.js';

const ATTRS = ["data-popup", "title", "placeholder", "aria-label"];

const normalize = (s) => s.replace(/\s+/g, " ").trim();

// Return the Chinese for an English UI string, or null if there is none.
export function translateString(raw)
{
    const key = normalize(raw);
    if(!key || !/[A-Za-z]/.test(key))
        return null;
    if(Object.hasOwn(DICT, key))
        return DICT[key];
    for(const [re, replacement] of PATTERNS)
        if(re.test(key))
            return key.replace(re, replacement);
    return null;
}

// Translate a string, or return it unchanged.  For code that builds UI text itself.
export function t(text)
{
    return translateString(text) ?? text;
}

// Return true if text in element must stay as it is.  text is the normalized text being
// translated, or null for attributes.  inTemplate is true while translating a template that
// isn't in the document yet.
function isSkipped(element, text, inTemplate)
{
    if(element == null || element.closest(ICON_SELECTOR) != null)
        return true;
    if(!inTemplate && element.closest(".widget") == null)
        return true;

    // Tag filter buttons show the selected tag once one is picked.  Only their built-in labels
    // are UI text, and "Other" is the label upstream uses when the selected tag isn't listed.
    const tagLabel = element.closest(TAG_BUTTON_LABEL_SELECTOR);
    if(tagLabel != null)
    {
        if(inTemplate)
            return !TAG_BUTTON_LABELS.has(text);
        return isUserTagLabel(tagLabel, text);
    }

    if(element.closest(ALLOW_SELECTOR) != null)
        return false;
    return element.closest(SKIP_SELECTOR) != null || showsUserContent(element);
}

function isUserTagLabel(tagLabel, text)
{
    const button = tagLabel.closest(".bookmark-tag-button, .follow-tag-button, .follow-tags-button, .member-tags-button");
    const source = ppixiv.app?.currentDataSource;
    if(button == null || source == null)
        return true;
    const tag = button.matches(".bookmark-tag-button") ? source.displayingTag :
        button.matches(".member-tags-button") ? source.currentTag : source.url?.searchParams.get("tag");
    if(tag == null || tag == "")
        return !TAG_BUTTON_LABELS.has(text);
    if(text != "Other")
        return true;

    let listed;
    if(button.matches(".bookmark-tag-button"))
        listed = source.bookmarkTagCounts == null ? null : source.bookmarkTagCounts[tag] > 0;
    else if(button.matches(".member-tags-button"))
        listed = source.postTags?.some((item) => item.tag == tag && !(item.cnt < 5 && !item.recent));
    else
    {
        const tags = button.matches(".follow-tag-button") ? source.bookmarkTags : source.followTags;
        listed = tags?.length ? tags.includes(tag) : null;
    }
    const label = button.matches(".member-tags-button") ? source.translatedTags?.[tag] ?? tag : tag;
    return normalize(label) == text && listed !== false;
}

// User content in elements that also show UI text, depending on state.
function showsUserContent(element)
{
    // The viewer's error text is the muted tag or user name when "Muted:" is shown next to it.
    const errorText = element.closest(".viewer-error .error-text");
    if(errorText != null)
        return errorText.parentElement.querySelector(".muted-label")?.hidden === false;

    // The mobile info dialog's header is the work's title.  The "More" dialog shares the class.
    const header = element.closest(".mobile-illust-ui-dialog .header-text");
    return header != null && header.closest(".mobile-illust-ui-dialog").querySelector(".mobile-image-info") != null;
}

function translateTextNode(node, inTemplate=false)
{
    const text = node.nodeValue;
    if(!text || !/[A-Za-z]/.test(text) || isSkipped(node.parentElement, normalize(text), inTemplate))
        return;

    const translated = translateString(text);
    if(translated == null)
        return;

    // Keep the surrounding whitespace so inline layout doesn't change.
    const [, lead, , trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const result = lead + translated + trail;
    if(result != text)
        node.nodeValue = result;
}

function translateAttributes(element, inTemplate=false)
{
    if(!ATTRS.some((name) => element.hasAttribute(name)) || isSkipped(element, null, inTemplate))
        return;
    for(const name of ATTRS)
    {
        const value = element.getAttribute(name);
        if(!value)
            continue;
        const translated = translateString(value);
        if(translated != null && translated != value)
            element.setAttribute(name, translated);
    }
}

function translateTree(root, inTemplate=false)
{
    if(root.nodeType == Node.TEXT_NODE)
    {
        translateTextNode(root, inTemplate);
        return;
    }
    if(root.nodeType != Node.ELEMENT_NODE && root.nodeType != Node.DOCUMENT_FRAGMENT_NODE)
        return;

    if(root.nodeType == Node.ELEMENT_NODE)
        translateAttributes(root, inTemplate);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if(node.nodeType == Node.ELEMENT_NODE)
            {
                const tag = node.tagName;
                if(tag == "SCRIPT" || tag == "STYLE" || tag == "svg")
                    return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    for(let node = walker.nextNode(); node; node = walker.nextNode())
    {
        if(node.nodeType == Node.TEXT_NODE)
            translateTextNode(node, inTemplate);
        else
            translateAttributes(node, inTemplate);
    }
}

// Translate a parsed <template>'s content in place.  Called by Actor.createTemplate.
export function translateTemplate(template)
{
    translateTree(template.content, true);
}

let started = false;

// Start translating text that widgets change after they're created, and the page title.
export function startTranslating()
{
    if(started)
        return;
    started = true;

    const observer = new MutationObserver((mutations) => {
        for(const mutation of mutations)
        {
            if(mutation.type == "childList")
            {
                for(const node of mutation.addedNodes)
                    translateTree(node);
            }
            else if(mutation.type == "characterData")
                translateTextNode(mutation.target);
            else if(mutation.type == "attributes")
                translateAttributes(mutation.target);
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
    });
    translateTree(document.body);
}

// The page title, without the user name it may contain.  Called by helpers.setPageTitle.
export function translateTitle(title)
{
    const match = title.match(/^(.*?)( - ppixiv)?$/);
    if(match == null || match[1] == ppixiv.app?.currentDataSource?.userInfo?.name)
        return title;
    const translated = translateString(match[1]);
    return translated == null ? title : translated + (match[2] ?? "");
}
