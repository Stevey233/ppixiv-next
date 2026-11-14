// The main destinations, shared by the desktop rail and the mobile tab bar.
//
// Upstream puts every list in a dropdown behind the menu button, so switching between the lists
// people use every day takes two clicks.  The lists used most get their own entries, and the rest
// stay in the "more" menu.

// Return the main destinations.  Each has a label, a URL, and a test for whether a data source
// belongs to it.
//
// Each list has one name, which its header title and tab title show in full (the data source's
// getDisplayingText and pageTitle).  The rail label is the name's first two characters, which read
// well set vertically.  The "more" menu uses the full name.
export function mainDestinations()
{
    let userId = ppixiv.pixivInfo?.userId;
    return [
        {
            key: "discovery", label: "推荐", icon: "mat:auto_awesome",
            url: "/discovery#ppixiv",
            matches: (ds) => ds?.name == "discovery" || ds?.name == "from-bookmarks",
        },
        {
            key: "following", label: "关注", icon: "mat:photo_library",
            url: "/bookmark_new_illust.php#ppixiv",
            matches: (ds) => ds?.name == "new_works_by_following",
        },
        {
            key: "bookmarks", label: "收藏", icon: "mat:favorite",
            url: `/users/${userId}/bookmarks/artworks#ppixiv`,
            matches: (ds) => ds?.name == "bookmarks" && ds.viewingUserId == userId,
        },
        {
            key: "rankings", label: "排行", icon: "mat:leaderboard",
            url: "/ranking.php#ppixiv",
            matches: (ds) => ds?.name == "rankings",
        },
        {
            key: "new", label: "最新", icon: "mat:schedule",
            url: "/new_illust.php#ppixiv",
            matches: (ds) => ds?.name == "new_illust",
        },
    ];
}

// The other lists, for the "more" menu.
export function otherDestinations()
{
    let userId = ppixiv.pixivInfo?.userId;
    return [
        { label: "搜索作品", icon: "mat:search", url: "/search?s_mode=tag&type=artwork#ppixiv" },
        { label: "最近看过", icon: "mat:history", url: "/#ppixiv/history" },
        { label: "关注的用户", icon: "mat:visibility", url: `/users/${userId}/following#ppixiv` },
        { label: "推荐用户", icon: "ppixiv:suggestions", url: "/discovery/users#ppixiv" },
        { label: "搜索用户", icon: "mat:person_search", url: "/search_user.php#ppixiv" },
        { label: "已完成的约稿", icon: "mat:request_page", url: "/request/complete/illust#ppixiv" },
    ];
}
