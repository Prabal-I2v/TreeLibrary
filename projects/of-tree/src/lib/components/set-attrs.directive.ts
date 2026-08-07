import { Directive, ElementRef, Input, inject } from '@angular/core';

type Attributes = { [attr: string]: any } | undefined;

@Directive({
    selector: '[ofSetAttrs]',
    standalone: true
})
export class SetAttrsDirective {
    private readonly el = inject(ElementRef);

    private _attrs: Attributes = undefined;

    @Input('ofSetAttrs')
    public set attrs(value: Attributes) {
        this._attrs = value;
        this.applyAttributes();
    }

    constructor() {
        this.applyAttributes();
    }

    private applyAttributes() {
        const attrs = this._attrs,
            el = this.el.nativeElement;

        if (attrs && el) {
            for (const name of Object.keys(attrs)) {
                el.setAttribute(name, attrs[name]);
            }
        }
    }
}
