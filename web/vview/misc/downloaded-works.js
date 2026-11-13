// Works this script started a download of.
//
// Each download writes a record to IndexedDB, keyed by illust ID: { time, pages, zip, mkv }, where
// time is the latest download of any kind, pages maps a page number to when its original was saved
// on its own, and zip and mkv are when the whole work was saved that way.  Thumbnails of recorded
// works carry a marker and the viewer's download buttons say "下载过".
//
// The record says the script started a download, not that the file is on disk: a cancelled save
// dialog or a deleted file still counts.  The "mark_downloaded" setting hides the markers; works are
// recorded either way, so turning it back on shows the whole history.  The shape follows
// misc/seen-works.js: the records live in memory, and a BroadcastChannel tells other tabs about
// downloads and clears.

const DB_NAME = "ppixiv-downloaded";
const STORE = "downloaded";
const LIMIT = 20000; // the oldest are forgotten beyond this
const PRUNE_EXTRA = 500;

export default class DownloadedWorks extends EventTarget
{
    constructor()
    {
        super();

        this._records = new Map();
        this._writing = Promise.resolve();
        this._clears = 0;

        this._channel = typeof BroadcastChannel == "function"? new BroadcastChannel("ppixiv-downloaded"):null;
        if(this._channel)
            this._channel.onmessage = (e) => this._receive(e.data);

        this.loaded = this._load();
    }

    // Whether thumbnails and the viewer show the markers.
    get marking() { return ppixiv.settings.get("mark_downloaded"); }

    get count() { return this._records.size; }

    // Return when mediaId was downloaded, or null.  downloadType is "image" for the original of
    // mediaId's page (a ZIP of the work counts), "ZIP" or "MKV", or null for a download of any kind.
    downloadedTime(mediaId, downloadType=null)
    {
        let [id, page] = idAndPageFor(mediaId);
        let record = this._records.get(id);
        if(record == null)
            return null;

        if(downloadType == "image")
            return record.pages?.[page] ?? record.zip ?? null;
        if(downloadType == "ZIP")
            return record.zip ?? null;
        if(downloadType == "MKV")
            return record.mkv ?? null;
        return record.time;
    }

    // Record a download of mediaId started with Actions.downloadIllust's downloadType.  For "image",
    // mediaId's page is the one saved.
    record(mediaId, downloadType)
    {
        let [id, page] = idAndPageFor(mediaId);
        if(id == null)
            return;

        let time = Date.now();
        let merge = (record) => {
            record = { ...record, time };
            if(downloadType == "image")
                record.pages = { ...record.pages, [page]: time };
            else if(downloadType == "ZIP")
                record.zip = time;
            else if(downloadType == "MKV")
                record.mkv = time;
            return record;
        };

        // Another tab may have written this work since this tab loaded, so merge with what's stored.
        // If IndexedDB is unavailable, the record still lasts until the page is closed.
        return this._queueWrite(async () => {
            let record = null;
            await this._dbOp("readwrite", (store) => {
                let request = store.get(id);
                request.onsuccess = () => {
                    record = merge(request.result ?? this._records.get(id));
                    store.put(record, id);
                };
            });
            record ??= merge(this._records.get(id));

            this._records.set(id, record);
            this._channel?.postMessage({ id, record });
            this._changed(id);
        });
    }

    // Forget every download.  Resolve to true if it worked.
    clear()
    {
        return this._queueWrite(async () => {
            let result = await this._dbOp("readwrite", (store) => store.clear());
            if(result == null)
                return false;
            ++this._clears;
            this._records.clear();
            this._channel?.postMessage({ clear: true });
            this._changed(null);
            return true;
        });
    }

    _queueWrite(func)
    {
        let result = this._writing.then(func);
        this._writing = result.catch(() => {});
        return result;
    }

    _receive(data)
    {
        // Other code on the page can post to the channel too, so check what arrives.
        if(data?.clear)
        {
            ++this._clears;
            this._records.clear();
            this._changed(null);
        }
        else if(typeof data?.id == "string" && /^\d+$/.test(data.id) && typeof data.record?.time == "number")
        {
            this._records.set(data.id, data.record);
            this._changed(data.id);
        }
    }

    // Send "changed".  e.illustId is the work that changed, or null if everything did.
    _changed(illustId)
    {
        let e = new Event("changed");
        e.illustId = illustId;
        this.dispatchEvent(e);
    }

    async _load()
    {
        let clears = this._clears;
        let requests = await this._dbOp("readonly", (store) => [store.getAllKeys(), store.getAll()]);
        if(requests == null || this._clears != clears)
            return;

        // Downloads recorded while this was reading are already in memory and are newer.
        let [ids, records] = requests.map((request) => request.result);
        for(let i = 0; i < ids.length; ++i)
        {
            if(!this._records.has(String(ids[i])))
                this._records.set(String(ids[i]), records[i]);
        }

        // Forget PRUNE_EXTRA more than needed, so this doesn't happen again on every startup.
        if(this._records.size > LIMIT)
        {
            let oldest = [...this._records].sort((a, b) => a[1].time - b[1].time).slice(0, this._records.size - (LIMIT - PRUNE_EXTRA));
            for(let [id] of oldest)
                this._records.delete(id);
            this._dbOp("readwrite", (store) => oldest.forEach(([id]) => store.delete(id)));
        }
        this._changed(null);
    }

    // Run func(store) in a transaction, and resolve to what it returned once the transaction
    // completes, or to null if IndexedDB is unavailable, as in Firefox private windows.  The
    // database is closed after each operation, like seen-works.js.
    async _dbOp(mode, func)
    {
        let db;
        try {
            db = await new Promise((resolve, reject) => {
                let request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => request.result.createObjectStore(STORE);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch(e) {
            return null;
        }

        try {
            return await new Promise((resolve, reject) => {
                let transaction = db.transaction(STORE, mode);
                let result = func(transaction.objectStore(STORE)) ?? true;
                transaction.oncomplete = () => resolve(result);
                transaction.onerror = transaction.onabort = () => reject(transaction.error);
            });
        } catch(e) {
            return null;
        } finally {
            db.close();
        }
    }
}

// "illust:123-2" -> ["123", 2].  Users, folders and local files have no illust ID.
function idAndPageFor(mediaId)
{
    let match = /^illust:(\d+)(?:-(\d+))?/.exec(mediaId ?? "");
    return match? [match[1], Number(match[2] ?? 0)]:[null, 0];
}

// The date of a download for a tooltip: "11/12", with the year if it isn't this year.
export function downloadDate(time)
{
    let date = new Date(time);
    let day = `${date.getMonth()+1}/${date.getDate()}`;
    return date.getFullYear() == new Date().getFullYear()? day:`${date.getFullYear()}/${day}`;
}
