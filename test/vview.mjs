// Load web/vview modules in Node.  "/vview/..." imports resolve to web/vview, except the
// modules in STUBS, which pull in the DOM or the rest of the app and are replaced with the
// small versions below.
import { registerHooks } from 'node:module';

const root = new URL('../web/', import.meta.url);

const STUBS = {
    '/vview/misc/helpers.js': `
        import * as mediaId from '/vview/util/media-id.js';
        import Args from '/vview/util/args.js';
        export class helpers {}
        helpers.mediaId = mediaId;
        helpers.args = Args;
        helpers.other = {
            sleep: () => new Promise((resolve) => setImmediate(resolve)),
            defer: (func) => Promise.resolve().then(func),
        };
        export class SafetyBackoffTimer { async wait() { } }
    `,
    '/vview/widgets/widget.js': `export default class Widget { }`,
    '/vview/widgets/dropdown.js': `export class DropdownMenuOpener { }`,
    '/vview/misc/local-api.js': `export default class LocalAPI { }`,
};

registerHooks({
    resolve(specifier, context, nextResolve)
    {
        if(STUBS[specifier] != null)
            return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[specifier]), shortCircuit: true };
        if(specifier.startsWith('/vview/'))
            return { url: new URL(specifier.slice(1), root).href, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

// A fake ppixiv global with a media cache.  media maps illust IDs to partial media info.
export function setupPpixiv({ url='https://www.pixiv.net/bookmark_new_illust.php#ppixiv', media={}, seen=new Set() }={})
{
    let infoFor = (mediaId) => {
        let id = mediaId.replace(/^illust:/, '').replace(/-\d+$/, '');
        return media[id] ?? null;
    };
    globalThis.ppixiv = {
        native: false,
        plocation: new URL(url),
        phistory: { state: null },
        mediaCache: {
            getMediaInfoSync: (mediaId) => infoFor(mediaId),
            getMediaInfo: async (mediaId) => infoFor(mediaId),
        },
        extraCache: { getQuickUserData: () => ({}) },
        seenWorks: { loaded: Promise.resolve(), hasSeen: (mediaId) => seen.has(mediaId) },
    };
    return globalThis.ppixiv;
}
