import { NgModule } from '@angular/core';
import * as C from './components';

/**
 * The components are standalone, so you can import them directly:
 *
 * ```ts
 * imports: [I2vVirtualTreeComponent]
 * ```
 *
 * This module is kept so existing NgModule based apps keep working unchanged.
 */
@NgModule({
    imports: [C.I2vVirtualTreeComponent, C.SetAttrsDirective],
    exports: [C.I2vVirtualTreeComponent, C.SetAttrsDirective]
})
export class I2vVirtualTreeModule {}
