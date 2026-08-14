import { NgModule } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import { HeaderComponent } from './header/header.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { ModalComponent } from './modal/modal.component';
import { NgbModalModule } from '@ng-bootstrap/ng-bootstrap';
import { FechaMexicoPipe } from '../../pipes/date-mx-format';
import { SizeFormatPipe } from '../../pipes/size-files-format';
/* local mx date */
import localeEsMx from '@angular/common/locales/es-MX';
import { GraficasComponent } from './graficas/graficas.component';
import { LoaderComponent } from './loader/loader.component';
import { SplitFlapTextComponent } from './split-flap-text/split-flap-text.component';
registerLocaleData(localeEsMx, 'es-MX');
@NgModule({
  declarations: [
    HeaderComponent,
    SidebarComponent,
    ModalComponent,
    FechaMexicoPipe,
    GraficasComponent,
    LoaderComponent,
    SizeFormatPipe,
    SplitFlapTextComponent
  ],
  imports: [
    CommonModule,
    NgbModalModule
  ],
  exports: [
    HeaderComponent,
    SidebarComponent,
    ModalComponent,
    FechaMexicoPipe,
    GraficasComponent,
    LoaderComponent,
    SizeFormatPipe,
    SplitFlapTextComponent
  ],
})
export class SharedModule { }
