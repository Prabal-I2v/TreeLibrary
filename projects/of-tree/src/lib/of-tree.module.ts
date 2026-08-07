import { NgModule } from '@angular/core';
import * as C from './components';

/**
 * The components are standalone, so you can import them directly:
 *
 * ```ts
 * imports: [OfVirtualTreeComponent, OfBasicTreeComponent]
 * ```
 *
 * This module is kept so existing NgModule based apps keep working unchanged.
 */
@NgModule({
    imports: [C.OfVirtualTreeComponent, C.OfBasicTreeComponent, C.SetAttrsDirective],
    exports: [C.OfVirtualTreeComponent, C.OfBasicTreeComponent]
})
export class OfVirtualTreeModule {}
