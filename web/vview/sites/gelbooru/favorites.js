// Which posts are the user's Gelbooru favorites.
//
// For now this only knows what this session saw: posts listed by the user's own fav:<id> search
// and favorites added or removed here.  The post mapper (media.js) reads isFavorite for every post
// it registers, so a fuller record (the favorites set kept in IndexedDB, see DESIGN.md
// "Favorites") replaces the functions here without touching the mapper.
let favorites = new Set();

export function isFavorite(postId)
{
    return favorites.has(String(postId));
}

export function setFavorite(postId, favorite)
{
    if(favorite)
        favorites.add(String(postId));
    else
        favorites.delete(String(postId));
}
