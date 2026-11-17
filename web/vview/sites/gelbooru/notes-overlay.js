import Widget from '/vview/widgets/widget.js';
import { getNotes } from '/vview/sites/gelbooru/api.js';

// Parse in an inert document, then copy only the supported elements and color.  Unknown
// elements are displayed literally, including their attributes, rather than interpreted.
export function noteBody(body)
{
    let doc = new DOMParser().parseFromString(body, 'text/html');
    function copy(node)
    {
        if(node.nodeType == Node.TEXT_NODE)
            return document.createTextNode(node.textContent);
        let tag = node.localName;
        if(!['br', 'tn', 'font', 'b', 'i', 'u'].includes(tag))
            return document.createTextNode(node.outerHTML ?? node.textContent);
        let result = document.createElement(tag == 'tn'? 'span':tag);
        if(tag == 'tn') result.className = 'gb-translator-note';
        if(tag == 'font')
        {
            let color = node.getAttribute('color') ?? '';
            if(/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color) && CSS.supports('color', color))
                result.style.color = color;
        }
        for(let child of node.childNodes) result.append(copy(child));
        return result;
    }
    let result = document.createDocumentFragment();
    // HTML parsing can move a leading script into head.  Include it as literal text too.
    for(let node of [...doc.head.childNodes, ...doc.body.childNodes]) result.append(copy(node));
    return result;
}

export default class NotesOverlay extends Widget
{
    constructor({ viewer, ...options })
    {
        super({ ...options, template: '<div class="gb-notes-overlay"></div>' });
        this.viewer = viewer;
        this.popup = document.createElement('div');
        this.popup.className = 'gb-note-popup';
        this.popup.hidden = true;
        document.body.append(this.popup);
        this.shutdownSignal.addEventListener('abort', () => this.popup.remove());
        ppixiv.settings.addEventListener('gelbooru_show_notes', () => this.refresh(), this._signal);
        document.addEventListener('pointerdown', (event) => {
            if(!this.root.contains(event.target) && !this.popup.contains(event.target)) this.hidePopup();
        }, this._signal);
    }

    onkeydown(event)
    {
        if(event.code != 'KeyN' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat
            || event.target.closest?.('input, textarea, [contenteditable=true]')) return;
        event.preventDefault();
        event.stopPropagation();
        ppixiv.settings.set('gelbooru_show_notes', !ppixiv.settings.get('gelbooru_show_notes'));
    }

    refresh()
    {
        if(!this.viewer) return;
        this.root.hidden = !this.viewer.active || !ppixiv.settings.get('gelbooru_show_notes');
        this.hidePopup();
        let info = ppixiv.mediaCache.getMediaInfoSync(this.viewer.mediaId);
        if(!this.viewer.active || !info?.hasNotes || info.illustType == 'video' || this.loading) return;
        this.loading = true;
        getNotes(info.illustId).then((notes) => {
            if(this.hasShutdown) return;
            for(let note of notes)
            {
                let box = document.createElement('button');
                box.className = 'gb-note-box';
                box.type = 'button';
                box.setAttribute('aria-label', '查看图片注释');
                Object.assign(box.style, {
                    left: `${note.x / info.width * 100}%`, top: `${note.y / info.height * 100}%`,
                    width: `${note.width / info.width * 100}%`, height: `${note.height / info.height * 100}%`,
                });
                box.addEventListener('pointerenter', (event) => {
                    if(event.pointerType != 'touch') this.showPopup(box, note.body);
                });
                box.addEventListener('pointerleave', () => this.hidePopup());
                box.addEventListener('focus', () => this.showPopup(box, note.body));
                box.addEventListener('blur', () => this.hidePopup());
                box.addEventListener('pointerdown', (event) => event.stopPropagation());
                box.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.showPopup(box, note.body);
                });
                this.root.append(box);
            }
        });
    }

    hidePopup() { this.popup.hidden = true; }

    showPopup(box, body)
    {
        this.popup.replaceChildren(noteBody(body));
        this.popup.hidden = false;
        let rect = box.getBoundingClientRect();
        let width = this.popup.offsetWidth, height = this.popup.offsetHeight;
        this.popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
        let top = rect.bottom + 8;
        if(top + height > innerHeight - 8) top = rect.top - height - 8;
        this.popup.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
    }
}
