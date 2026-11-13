import Widget from '/vview/widgets/widget.js';

// Display messages in the popup widget.  This is a singleton.
export default class MessageWidget extends Widget
{
    constructor(options)
    {
        super({...options, template: `
            <div class=hover-message>
                <div class=message></div>
            </div>`,
        });

        this.timer = null;

        this._hasAction = false;

        // Dismiss messages when changing screens.  A message with an action stays, so 撤销 after
        // a removal in the viewer still works back in the list.
        window.addEventListener("screenchanged", (e) => {
            if(!this._hasAction)
                this.hide();
        }, this._signal);
    }

    // action is { label, onclick }: a button after the message.  Clicking it hides the message.
    // Messages with an action stay up 6 seconds instead of 3, so there's time to reach it.
    show(message, { action=null, duration=null }={})
    {
        console.assert(message != null);
        console.log(message);

        this.clearTimer();

        let messageNode = this.root.querySelector(".message");
        messageNode.innerHTML = message;

        this._hasAction = action != null;
        if(action != null)
        {
            let button = document.createElement("button");
            button.type = "button";
            button.className = "message-action";
            button.textContent = action.label;
            button.addEventListener("click", (e) => {
                this.hide();
                action.onclick();
            });
            messageNode.append(button);
        }

        this.root.classList.add("show");
        this.root.classList.remove("centered");
        this.timer = realSetTimeout(() => {
            this.root.classList.remove("show");
            this._hasAction = false;
        }, duration ?? (action? 6000:3000));
    }

    clearTimer()
    {
        if(this.timer != null)
        {
            realClearTimeout(this.timer);
            this.timer = null;
        }
    }

    hide()
    {
        this.clearTimer();
        this.root.classList.remove("show");
        this._hasAction = false;
    }
}
