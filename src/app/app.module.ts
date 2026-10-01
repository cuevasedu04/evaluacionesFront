import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { DashboardComponent } from './content/dashboard/dashboard.component';
import { UxDesignComponent } from './content/ux-design/ux-design.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SharedModule } from './components/shared/shared.module';
import { LayoutsModule } from './layouts/layouts.module';
import { BusquedaAvanzadaComponent } from './content/busqueda-avanzada/busqueda-avanzada.component';
import { ReportesComponent } from './content/reportes/reportes.component';
import { UnitTestComponent } from './content/unit-test/unit-test.component';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import { HttpClientModule } from '@angular/common/http';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
import { LoaderInterceptor } from './components/shared/interceptors/loader.interceptor';
import { TokenInterceptor } from './components/shared/interceptors/token.interceptor';
import { DataTablesModule } from 'angular-datatables';
import { AccesoDenegadoComponent } from './content/acceso-denegado/acceso-denegado.component';
import { AgGridModule } from 'ag-grid-angular';
// Arrastrar y soltar del editor de formularios (reordenar preguntas y sus
// incisos). Es el paquete oficial de Angular, misma version mayor que el
// resto del framework -- por eso se prefirio a una libreria de terceros.
import { DragDropModule } from '@angular/cdk/drag-drop';
import { RegistroEmpleadoComponent } from './content/registro-empleado/registro-empleado.component';
import { EnrolamientoComponent } from './content/enrolamiento/enrolamiento.component';
import { ConsultaEnrolamientoComponent } from './content/enrolamiento/consulta-enrolamiento/consulta-enrolamiento.component';
import { PlantillaEnrolamientoComponent } from './content/enrolamiento/plantilla-enrolamiento/plantilla-enrolamiento.component';
import { CredencializacionComponent } from './content/credencializacion/credencializacion.component';
import { CargaMasivaComponent } from './content/carga-masiva/carga-masiva.component';
import { ProvisionalComponent } from './content/provisional/provisional.component';
import { FamiliarComponent } from './content/familiar/familiar.component';
import { PlantillaAnamComponent } from './content/plantilla-anam/plantilla-anam.component';
import { PlantillaEditorComponent } from './content/plantilla-editor/plantilla-editor.component';
import { PlantillaListaComponent } from './content/plantilla-editor/plantilla-lista.component';
import { ImprimirCredencialesComponent } from './content/imprimir-credenciales/imprimir-credenciales.component';
import { GeneradorMasivoComponent } from './content/generador-masivo/generador-masivo.component';
import { CorreoElectronicoComponent } from './content/correo-electronico/correo-electronico.component';
import { FormulariosListaComponent } from './content/formularios/formularios-lista.component';
import { FormularioEditorComponent } from './content/formularios/formulario-editor.component';
import { CursosListaComponent } from './content/cursos/cursos-lista.component';
import { CursoDetalleComponent } from './content/cursos/curso-detalle.component';
import { ResponderCuestionarioComponent } from './content/responder/responder-cuestionario.component';
import { EnrolamientoPrevioComponent } from './content/enrolamiento-previo/enrolamiento-previo.component';
import { InventarioMediosComponent } from './content/inventario-medios/inventario-medios.component';
import { CatalogoUnidadesComponent } from './content/catalogo-unidades/catalogo-unidades.component';
import { AuditoriaCredencialesComponent } from './content/auditoria-credenciales/auditoria-credenciales.component';
import { AdministracionComponent } from './content/administracion/administracion.component';
import { AcusesComponent } from './content/acuses/acuses.component';
import { CapturaMediosComponent } from './components/shared/captura-medios/captura-medios.component';
import { CredencialPanelPropiedadesComponent } from './components/shared/credencial-panel-propiedades/credencial-panel-propiedades.component';
import { AjusteImagenComponent } from './components/shared/ajuste-imagen/ajuste-imagen.component';
import { LanyardCredencialComponent } from './components/shared/lanyard-credencial/lanyard-credencial.component';
import { EnrolamientoMasivoComponent } from './content/enrolamiento-masivo/enrolamiento-masivo.component';
import { BusquedaEnrolamientoMasivosComponent } from './content/busqueda-enrolamiento-masivos/busqueda-enrolamiento-masivos.component';
import { LoginComponent } from './content/login/login.component';

@NgModule({
  declarations: [
    AppComponent,
    LoginComponent,
    DashboardComponent,
    UxDesignComponent,
    BusquedaAvanzadaComponent,
    ReportesComponent,
    UnitTestComponent,
    AccesoDenegadoComponent,
    RegistroEmpleadoComponent,
    EnrolamientoComponent,
    ConsultaEnrolamientoComponent,
    PlantillaEnrolamientoComponent,
    CredencializacionComponent,
    CargaMasivaComponent,
    ProvisionalComponent,
    FamiliarComponent,
    PlantillaAnamComponent,
    PlantillaEditorComponent,
    PlantillaListaComponent,
    ImprimirCredencialesComponent,
    GeneradorMasivoComponent,
    CorreoElectronicoComponent,
    FormulariosListaComponent,
    FormularioEditorComponent,
    CursosListaComponent,
    CursoDetalleComponent,
    ResponderCuestionarioComponent,
    EnrolamientoPrevioComponent,
    InventarioMediosComponent,
    CatalogoUnidadesComponent,
    AuditoriaCredencialesComponent,
    AdministracionComponent,
    AcusesComponent,
    CapturaMediosComponent,
    CredencialPanelPropiedadesComponent,
    AjusteImagenComponent,
    LanyardCredencialComponent,
    EnrolamientoMasivoComponent,
    BusquedaEnrolamientoMasivosComponent
  ],
  imports: [
    DataTablesModule,
    LayoutsModule,
    BrowserModule,
    AppRoutingModule,
    FormsModule,
    ReactiveFormsModule,
    SharedModule,
    AppRoutingModule,
    NgbModule,  
    BrowserAnimationsModule,
    ToastrModule.forRoot({
      timeOut: 3000,
      positionClass: 'toast-top-right',
      preventDuplicates: true,
    }), 
    HttpClientModule,
    AgGridModule,
    DragDropModule
  ],
  providers: [
    {
      provide: HTTP_INTERCEPTORS,
      useClass: LoaderInterceptor,
      multi: true
    },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: TokenInterceptor,
      multi: true
    }
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}
