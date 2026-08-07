import { ChangeDetectionStrategy, Component } from '@angular/core';

import { ServerTreeDemoComponent } from './demos/server-tree-demo.component';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [ServerTreeDemoComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {}
