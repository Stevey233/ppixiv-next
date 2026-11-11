// The desktop navigation rail: a narrow strip on the left edge with the main lists, their names
// set vertically like notes in a manuscript's margin.  See docs/design.md.

import Widget from '/vview/widgets/widget.js';
import { SettingsDialog } from '/vview/widgets/settings-widgets.js';
import { DropdownMenuOpener } from '/vview/widgets/dropdown.js';
import { MenuOptionButton } from '/vview/widgets/menu-option.js';
import { mainDestinations, otherDestinations } from '/vview/next/nav.js';
import { helpers } from '/vview/misc/helpers.js';

export default class NavRail extends Widget
{
    constructor({ onSearch, ...options })
    {
        super({
            ...options,
            template: `
                <nav class="nav-rail" data-context-menu-target=off aria-label="列表">
                    <button type=button class="rail-button rail-search" data-popup="搜索（/）" aria-label="搜索">
                        ${ helpers.createIcon("mat:search") }
                    </button>

                    <div class=rail-destinations></div>

                    <button type=button class="rail-button rail-more" data-popup="更多列表" aria-label="更多列表">
                        ${ helpers.createIcon("mat:more_horiz") }
                    </button>

                    <div class=rail-spacer></div>

                    <button type=button class="rail-button rail-settings" data-popup="设置" aria-label="设置">
                        ${ helpers.createIcon("mat:settings") }
                    </button>
                    <a class="rail-button rail-pixiv" href="#no-ppixiv" data-popup="回到 Pixiv 原页面" aria-label="回到 Pixiv 原页面">
                        ${ helpers.createIcon("ppixiv:pixiv") }
                    </a>
                </nav>
            `,
        });

        let list = this.querySelector(".rail-destinations");
        this._links = [];
        for(let destination of mainDestinations())
        {
            let link = document.createElement("a");
            link.className = "rail-destination";
            link.href = destination.url;
            link.textContent = destination.label;
            list.appendChild(link);
            this._links.push({ link, destination });
        }

        this.querySelector(".rail-search").addEventListener("click", () => onSearch?.());
        this.querySelector(".rail-settings").addEventListener("click", () => new SettingsDialog());

        new DropdownMenuOpener({
            button: this.querySelector(".rail-more"),
            createDropdown: ({...options}) => {
                let dropdown = new Widget({
                    ...options,
                    template: `<div class="vertical-list rail-more-menu"></div>`,
                });
                for(let { label, icon, url } of otherDestinations())
                    new MenuOptionButton({ container: dropdown.root, label, icon, url, classes: ["navigation-button"] });
                return dropdown;
            },
        });
    }

    setDataSource(dataSource)
    {
        for(let { link, destination } of this._links)
        {
            let current = destination.matches(dataSource);
            helpers.html.setClass(link, "selected", current);
            if(current)
                link.setAttribute("aria-current", "page");
            else
                link.removeAttribute("aria-current");
        }
    }
}
