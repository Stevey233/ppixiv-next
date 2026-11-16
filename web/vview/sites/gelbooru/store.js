// The IndexedDB database for Gelbooru's lists, on gelbooru.com's origin:
//
//   favorites   key: post ID (number), value: 1.  The user's favorites, see favorites.js.
//   meta        key: name.  "favoritesUser" is the user ID the favorites belong to.
//   posts       key: post ID (number), value: { post, time }.  A copy of each post opened in the
//               viewer, for 最近看过, see data-sources/history.js.  Indexed by time for pruning.
const DB_NAME = "ppixiv-gelbooru-lists";

// Run func(stores) in one transaction over storeNames, and resolve to what it returned once the
// transaction completes, or to null if IndexedDB is unavailable, as in Firefox private windows.
// stores maps each name to its object store.  Like SeenWorks, the database is closed after each
// operation, so other tabs can upgrade it.
export async function dbOp(storeNames, mode, func)
{
    let db;
    try {
        db = await new Promise((resolve, reject) => {
            let request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                let db = request.result;
                db.createObjectStore("favorites");
                db.createObjectStore("meta");
                db.createObjectStore("posts").createIndex("time", "time");
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } catch(e) {
        return null;
    }

    try {
        return await new Promise((resolve, reject) => {
            let transaction = db.transaction(storeNames, mode);
            let stores = {};
            for(let name of storeNames)
                stores[name] = transaction.objectStore(name);
            let result = func(stores);
            transaction.oncomplete = () => resolve(result);
            transaction.onerror = transaction.onabort = () => reject(transaction.error);
        });
    } catch(e) {
        return null;
    } finally {
        db.close();
    }
}
