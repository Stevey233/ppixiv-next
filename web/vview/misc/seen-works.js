// Works opened in the image viewer.
//
// Each opened work's illust ID is kept in IndexedDB with the time it was last opened, and search
// results dim their thumbnails.  The "seen_works" setting is "dim" (the default), "keep" to remember
// without dimming, or "off" to stop recording.  Filters can also hide seen works, see
// misc/result-filters.js.
//
// The database and the BroadcastChannel are the ones ppixiv-zh used, so the history is shared with
// it, and other tabs learn about works opened or cleared in one tab.

const DB_NAME = "ppx-zh-seen";
const STORE = "seen";
const LIMIT = 50000; // the oldest are forgotten beyond this

export default class SeenWorks extends EventTarget
{
    constructor()
    {
        super();

        this._ids = new Set();
        this._writing = Promise.resolve();
        this._clears = 0;
        this._lastRecorded = null;
        this.clearFailed = false;

        this._channel = typeof BroadcastChannel == "function"? new BroadcastChannel("ppx-zh-seen"):null;
        if(this._channel)
            this._channel.onmessage = (e) => this._receive(e.data);

        this.loaded = this._load();
    }

    get mode()
    {
        let mode = ppixiv.settings.get("seen_works");
        return mode == "keep" || mode == "off"? mode:"dim";
    }

    get count() { return this._ids.size; }

    // Return true if the work mediaId belongs to has been opened.
    hasSeen(mediaId)
    {
        let id = illustIdFor(mediaId);
        return id != null && this._ids.has(id);
    }

    // Return true if mediaId's thumbnail should be dimmed.
    shouldDim(mediaId)
    {
        return this.mode == "dim" && this.hasSeen(mediaId);
    }

    // Record that mediaId was shown in the viewer.  Turning the pages of a work doesn't count again.
    record(mediaId)
    {
        let id = illustIdFor(mediaId);
        if(id == this._lastRecorded)
            return;
        this._lastRecorded = id;
        if(id == null || this.mode == "off")
            return;

        let time = Date.now();
        return this._queueWrite(async () => {
            await this._dbOp("readwrite", (store) => store.put(time, id));
            if(this._ids.has(id))
                return;
            this._ids.add(id);
            this._channel?.postMessage({ id });
            this._changed(id);
        });
    }

    // Forget every seen work.  Resolve to true if it worked.
    clear()
    {
        return this._queueWrite(async () => {
            let result = await this._dbOp("readwrite", (store) => store.clear());
            this.clearFailed = result == null;
            if(this.clearFailed)
            {
                this._changed(null);
                return false;
            }
            ++this._clears;
            this._ids.clear();
            this._lastRecorded = null;
            this._channel?.postMessage({ clear: true });
            this._changed(null);
            return true;
        });
    }

    // Commit writes and apply their memory and broadcast changes in the same order.
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
            this._ids.clear();
            this._changed(null);
        }
        else if(typeof data?.id == "string" && /^\d+$/.test(data.id))
        {
            this._ids.add(data.id);
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
        // If they're cleared while this reads them, what it read may be from before.  Works opened
        // after the clear are added by the queued record operations.
        let clears = this._clears;
        let requests = await this._dbOp("readonly", (store) => [store.getAllKeys(), store.getAll()]);
        if(requests == null || this._clears != clears)
            return;

        let [ids, times] = requests.map((request) => request.result);
        for(let id of ids)
            this._ids.add(String(id));

        if(ids.length > LIMIT)
        {
            let oldest = ids.map((id, i) => [times[i], id]).sort((a, b) => a[0] - b[0]).slice(0, ids.length - LIMIT);
            for(let [, id] of oldest)
                this._ids.delete(String(id));
            this._dbOp("readwrite", (store) => oldest.forEach(([, id]) => store.delete(id)));
        }
        this._changed(null);
    }

    // Run func(store) in a transaction, and resolve to what it returned once the transaction
    // completes, or to null if IndexedDB is unavailable, as in Firefox private windows.  Like
    // KeyStorage, the database is closed after each operation.
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
                let result = func(transaction.objectStore(STORE));
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

// "illust:123-0" -> "123".  Users, folders and local files have no illust ID.
function illustIdFor(mediaId)
{
    return /^illust:(\d+)/.exec(mediaId ?? "")?.[1] ?? null;
}
