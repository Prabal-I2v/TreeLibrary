import { Directive, ElementRef, Input, inject } from '@angular/core';

type Attributes = { [attr: string]: any } | undefined;

@Directive({
    selector: '[i2vSetAttrs]',
    standalone: true
})
export class SetAttrsDirective {
    private readonly el = inject(ElementRef);

    private appliedNames: string[] = [];

    @Input('i2vSetAttrs')
    public set attrs(value: Attributes) {
        this.applyAttributes(value);
    }

    private applyAttributes(attrs: Attributes) {
        const el = this.el.nativeElement;
        if (!el) {
            return;
        }

        // Rows are recycled as the tree scrolls, so an attribute left over from the item that
        // previously occupied this element has to be removed rather than just overwritten.
        const entries = attrs ? Object.entries(attrs) : [],
            names = entries.map(([name]) => name);

        for (const stale of this.appliedNames) {
            if (!names.includes(stale)) {
                el.removeAttribute(stale);
            }
        }
        for (const [name, value] of entries) {
            el.setAttribute(name, value);
        }
        this.appliedNames = names;
    }
}
