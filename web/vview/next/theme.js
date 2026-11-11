// Applies the "theme" setting ("auto", "dark" or "light") as html[data-theme], and loads the
// interface's Latin font.  See docs/design.md.

const FONT_URL = "https://fonts.googleapis.com/css2?family=Sofia+Sans:wght@400..700&family=Sofia+Sans+Condensed:wght@500..700&display=swap";

const THEME_COLORS = { dark: "#1C1D20", light: "#F3F5F6" };

export function startTheme()
{
    let link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_URL;
    document.head.appendChild(link);

    let meta = document.querySelector("meta[name='theme-color']");
    if(meta == null)
    {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
    }

    let query = window.matchMedia("(prefers-color-scheme: light)");
    let apply = () => {
        let theme = ppixiv.settings.get("theme");
        if(theme != "dark" && theme != "light")
            theme = query.matches? "light":"dark";
        document.documentElement.dataset.theme = theme;
        meta.setAttribute("content", THEME_COLORS[theme]);
    };

    query.addEventListener("change", apply);
    ppixiv.settings.addEventListener("theme", apply);
    apply();
}
