import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * A switch that can be projected into a tree row's action slot, showing that row actions are
 * not limited to buttons. Being a component, it carries its own encapsulated styles into the
 * slot - which raw projected markup cannot do.
 */
@Component({
    selector: 'app-node-toggle',
    standalone: true,
    template: `
        <button
            type="button"
            class="switch"
            role="switch"
            [attr.aria-checked]="on()"
            [class.on]="on()"
            [title]="on() ? 'Enabled' : 'Disabled'"
            (click)="flip($event)"
        >
            <span class="knob"></span>
        </button>
    `,
    styles: [
        `
            .switch {
                width: 1.6rem;
                height: 0.85rem;
                border-radius: 0.85rem;
                border: none;
                padding: 0;
                background: #0002;
                cursor: pointer;
                display: flex;
                align-items: center;
                transition: background 0.15s ease;
            }
            .switch.on {
                background: #3f9d5a;
            }
            .knob {
                width: 0.65rem;
                height: 0.65rem;
                margin: 0 0.1rem;
                border-radius: 50%;
                background: #fff;
                transition: transform 0.15s ease;
            }
            .switch.on .knob {
                transform: translateX(0.75rem);
            }
        `
    ],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class NodeToggleComponent {
    public readonly on = input(false);
    public readonly toggled = output<boolean>();

    /** Without stopPropagation the row's own click handler would also select the row. */
    public flip(event: MouseEvent) {
        event.stopPropagation();
        this.toggled.emit(!this.on());
    }
}
