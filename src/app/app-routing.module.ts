import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { GeneralComponent } from './layouts/general/general.component';
import { DashboardComponent } from './content/dashboard/dashboard.component';
import { UxDesignComponent } from './content/ux-design/ux-design.component';
import { BusquedaAvanzadaComponent } from './content/busqueda-avanzada/busqueda-avanzada.component';
import { ReportesComponent } from './content/reportes/reportes.component';
import { UnitTestComponent } from './content/unit-test/unit-test.component';
import { AuthGuard } from './services/auth-guard';
import { AccesoDenegadoComponent } from './content/acceso-denegado/acceso-denegado.component';
import { RegistroEmpleadoComponent } from './content/registro-empleado/registro-empleado.component';
import { EnrolamientoComponent } from './content/enrolamiento/enrolamiento.component';
import { CredencializacionComponent } from './content/credencializacion/credencializacion.component';
import { CargaMasivaComponent } from './content/carga-masiva/carga-masiva.component';
import { ProvisionalComponent} from './content/provisional/provisional.component';
import { FamiliarComponent } from './content/familiar/familiar.component';
import { PlantillaAnamComponent } from './content/plantilla-anam/plantilla-anam.component';
import { BlockAccessGuard } from './services/block-access.guard';
import { EnrolamientoMasivoComponent } from './content/enrolamiento-masivo/enrolamiento-masivo.component';
import { BusquedaEnrolamientoMasivosComponent } from './content/busqueda-enrolamiento-masivos/busqueda-enrolamiento-masivos.component';
import { LoginComponent } from './content/login/login.component';
import { PlantillaEditorComponent } from './content/plantilla-editor/plantilla-editor.component';
import { PlantillaListaComponent } from './content/plantilla-editor/plantilla-lista.component';
import { ImprimirCredencialesComponent } from './content/imprimir-credenciales/imprimir-credenciales.component';
import { EnrolamientoPrevioComponent } from './content/enrolamiento-previo/enrolamiento-previo.component';
import { InventarioMediosComponent } from './content/inventario-medios/inventario-medios.component';
import { CatalogoUnidadesComponent } from './content/catalogo-unidades/catalogo-unidades.component';
import { AuditoriaCredencialesComponent } from './content/auditoria-credenciales/auditoria-credenciales.component';
import { AdministracionComponent } from './content/administracion/administracion.component';

const routes: Routes = [
  {
    path: '',
    component: GeneralComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' 
      },
      { path: 'dashboard', component: DashboardComponent 
      },
      {
        path: 'busqueda-enrolamiento-masivos',
        component: BusquedaEnrolamientoMasivosComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_busqueda_enrolamiento_masivos'  },
      },
      {
        path: 'enrolamiento-masivo',
        component: EnrolamientoMasivoComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_enrolamiento_masivo'  },
      },
      {
        path: 'familiar',
        component: FamiliarComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_familiar'  },
      },
      {
        path: 'plantilla-anam',
        component: PlantillaAnamComponent,
        canActivate: [AuthGuard, BlockAccessGuard],
        data: { permisoRequerido: 'ver_plantilla_anam'  },
      },
      {
        path: 'provisional',
        component: ProvisionalComponent,
        canActivate: [AuthGuard, BlockAccessGuard],
        data: { permisoRequerido: 'ver_provisional'  },
      },
      {
        path: 'busqueda-avanzada',
        component: BusquedaAvanzadaComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_busqueda_avanzada'  },
      },
      {
        path: 'reportes',
        component: ReportesComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_reportes'  },
      },
      // Editor visual de plantillas de credencial (canvas). Independiente de
      // plantilla-anam / provisional / familiar, que siguen funcionando igual.
      {
        path: 'plantillas',
        component: PlantillaListaComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_plantillas'  },
      },
      {
        path: 'plantillas/editor',
        component: PlantillaEditorComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_plantillas'  },
      },
      {
        path: 'plantillas/editor/:id',
        component: PlantillaEditorComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_plantillas'  },
      },
      {
        path: 'imprimir-credenciales',
        component: ImprimirCredencialesComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_imprimir_credenciales'  },
      },
      {
        path: 'enrolamiento-previo',
        component: EnrolamientoPrevioComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_enrolamiento_previo'  },
      },
      {
        path: 'inventario-medios',
        component: InventarioMediosComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_inventario_medios'  },
      },
      {
        path: 'catalogo-areas',
        component: CatalogoUnidadesComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_catalogo_areas'  },
      },
      {
        path: 'auditoria-credenciales',
        component: AuditoriaCredencialesComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_auditoria_credenciales'  },
      },
      {
        path: 'registro-empleado',
        component: RegistroEmpleadoComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_registro_empleado'  },
      },
      {
        path: 'enrolamiento',
        component: EnrolamientoComponent,
        canActivate: [AuthGuard, BlockAccessGuard],
        data: { permisoRequerido: 'ver_enrolamiento'  },
      },
      {
        path: 'credencializacion',
        component: CredencializacionComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_credencializacion'  },
      },
      {
        path: 'carga-masiva',
        component: CargaMasivaComponent,
        canActivate: [AuthGuard],
        data: { permisoRequerido: 'ver_carga_masiva'  },
      },
      {
        path: 'administracion',
        component: AdministracionComponent,
        canActivate: [AuthGuard],
        data: { soloSuperusuario: true },
      },
      {
        path: 'test',
        component: UnitTestComponent,
        canActivate: [AuthGuard],
        data: { soloSuperusuario: true },
      },
    ],
  },
  {
    path: 'login',
    component: LoginComponent,
  },
  {
    path: 'acceso-denegado',
    component: AccesoDenegadoComponent,
  },
  { path: '**', redirectTo: 'login' },
  {
    path: 'ux-design',
    component: UxDesignComponent,
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)] /*, { enableTracing: true }  */,
  exports: [RouterModule],
})
export class AppRoutingModule {}
