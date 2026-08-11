import { Component, effect, EffectRef, OnDestroy, OnInit } from '@angular/core';
import { SidebarService } from '../../../services/sidebar-service.service';
import { NavigationEnd, Router } from '@angular/router';
import { UtilsService } from '../../../services/utils.service';
import { SessionService } from '../../../services/session.service';
import { ModuleContextService } from '../../../services/module-context.service';
import { PermisosService } from '../../../services/permisos.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-sidebar',
  standalone: false,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent implements OnInit, OnDestroy {
  usuario:any = null;
  private routerSub?: Subscription;
  private blockEffect?: EffectRef;
  constructor(
    private router: Router,
    public sidebarService: SidebarService,
    private utils: UtilsService,
	private sessionS: SessionService,
    public moduleContext: ModuleContextService,
    private permisosS: PermisosService,
  ){
    this.blockEffect = effect(() => {
      this.moduleContext.selectedBlock();
      this.rebuildMenu();
    });
  }
  menuItems = [
    {
      id: 'Carga masiva',
      label: 'Carga excel',
      icon: 'fas fa-upload',
      link: '/carga-masiva',
      permiso: 'ver_carga_masiva',
    },
    {
      id: 'busqueda-enrolamiento-masivos',
      label: 'Búsqueda enrolamiento masivo',
      icon: 'fas fa-users',
      link: '/busqueda-enrolamiento-masivos',
      permiso: 'ver_busqueda_enrolamiento_masivos',
    },
    {
      id: 'enrolamiento-masivo',
      label: 'Enrolamiento masivo',
      icon: 'fas fa-users',
      link: '/enrolamiento-masivo',
      permiso: 'ver_enrolamiento_masivo',
    },
    {
      id: 'enrolamiento',
      label: 'Enrolamiento',
      icon: 'fas fa-user-plus',
      link: '/enrolamiento',
      permiso: 'ver_enrolamiento',
    },
    //  {
    //    id: 'credencializacion',
    //    label: 'Impresión',
    //    icon: 'fas fa-id-card',
    //    link: '/credencializacion',
    //    rol: [1,2,3,4,9999],
    //  },
    {
      id: 'provisional',
      label: 'Carga manual - NL',
      icon: 'fa-solid fa-id-badge',
      link: '/provisional',
      permiso: 'ver_provisional',
    },
    {
      id: 'familiar',
      label: 'Familiares - NL',
      icon: 'fa-solid fa-id-badge',
      link: '/familiar',
      permiso: 'ver_familiar',
    },
    {
      id: 'plantilla-anam',
      label: 'Carga manual - ANAM',
      icon: 'fa-solid fa-id-badge',
      link: '/plantilla-anam',
      permiso: 'ver_plantilla_anam',
    },
    {
      id: 'busquedaAvanzada',
      label: 'Búsqueda avanzada',
      icon: 'fas fa-search',
      link: '/busqueda-avanzada',
      permiso: 'ver_busqueda_avanzada',
    },
    {
      id: 'reportes',
      label: 'Reportes',
      icon: 'fas fa-chart-pie',
      link: '/reportes',
      permiso: 'ver_reportes',
    },
    {
      id: 'plantillas',
      label: 'Plantillas',
      icon: 'fas fa-vector-square',
      link: '/plantillas',
      permiso: 'ver_plantillas',
    },
    {
      id: 'imprimir-credenciales',
      label: 'Imprimir credenciales',
      icon: 'fas fa-id-card',
      link: '/imprimir-credenciales',
      permiso: 'ver_imprimir_credenciales',
    },
    {
      id: 'enrolamiento-previo',
      label: 'Enrolamiento previo',
      icon: 'fas fa-user-clock',
      link: '/enrolamiento-previo',
      permiso: 'ver_enrolamiento_previo',
    },
    {
      id: 'inventario-medios',
      label: 'Inventario de medios',
      icon: 'fas fa-photo-film',
      link: '/inventario-medios',
      permiso: 'ver_inventario_medios',
    },
    {
      id: 'catalogo-areas',
      label: 'Catálogo de áreas',
      icon: 'fas fa-sitemap',
      link: '/catalogo-areas',
      permiso: 'ver_catalogo_areas',
    },
    {
      id: 'auditoria-credenciales',
      label: 'Auditoría de credenciales',
      icon: 'fas fa-clipboard-check',
      link: '/auditoria-credenciales',
      permiso: 'ver_auditoria_credenciales',
    },
    {
      id: 'acuses',
      label: 'Acuses',
      icon: 'fas fa-file-signature',
      link: '/acuses',
      permiso: 'ver_acuses',
    },
    {
      id: 'administracion',
      label: 'Administración',
      icon: 'fas fa-user-shield',
      link: '/administracion',
      soloSuperusuario: true,
    },
  ];
  menuUsuario:any = []
  ngOnInit(): void {
    this.usuario = this.sessionS.getUsuario();
	this.rebuildMenu();

    this.routerSub = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event.urlAfterRedirects.includes('/dashboard')) {
          this.moduleContext.clearBlock();
        }
        this.rebuildMenu();
      });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.blockEffect?.destroy();
  }

  private rebuildMenu(): void {
    // Reemplaza al viejo `rol: [1,2,3,4,9999]`, identico en todos los items
    // y que en la practica nunca distinguio a nadie (ver CLAUDE.md,
    // gotcha #4). Cada item ahora declara el permiso concreto que necesita
    // (`ver_x`) o `soloSuperusuario` para los de administracion -- ver
    // PermisosService y RecursoSistema.Meta.permissions en el backend.
    const menuPorPermiso = this.menuItems.filter((item: any) =>
      item.soloSuperusuario ? this.permisosS.esSuperusuario() : this.permisosS.tiene(item.permiso)
    );
    const bloque = this.moduleContext.resolveBlockFromRoute(this.router.url);
    const idsPermitidos = this.moduleContext.getAllowedIds(bloque);

    if (this.router.url.includes('/dashboard') && !bloque) {
      this.menuUsuario = [];
      return;
    }

    this.menuUsuario = idsPermitidos.length
      ? menuPorPermiso.filter(item => idsPermitidos.includes(item.id))
      : menuPorPermiso;
  }

  get mostrarMensajeDashboard(): boolean {
    return this.router.url.includes('/dashboard') && this.menuUsuario.length === 0;
  }


   /**
   * Navega al enlace del ítem y colapsa si está en móvil
   */
selectItem(item: any, event: Event): void {
  event.preventDefault();
  this.router.navigate([item.link]);
  this.sidebarService.autoCloseOnMobile();
}

  /**
   * Cierra el sidebar cuando se hace click en el overlay
   */
  public onOverlayClick(): void {
    this.sidebarService.collapseSidebar();
  }
}