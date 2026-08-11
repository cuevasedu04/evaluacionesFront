import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../../services/session.service';
import { ModuleContextService, SidebarBlock } from '../../services/module-context.service';
import { PermisosService } from '../../services/permisos.service';

/** Una tarjeta de módulo en el dashboard. */
interface ModuloDashboard {
  id: string;
  label: string;
  descripcion: string;
  icon: string;
  link: string;
  /** Igual que en el sidebar: `undefined` = pantalla pública (no aplica aquí). */
  permiso?: string;
  soloSuperusuario?: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: false,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  usuario:any= {};

  /**
   * Mismo catálogo que `sidebar.component.ts` para el bloque "anam" -- hoy es
   * el único bloque real (los demás quedaron comentados, ver
   * ModuleContextService.getAllowedIds). En vez del banner ancho con un solo
   * botón "ANAM" que escondía todo detrás de un clic, cada módulo entra
   * directo desde aquí.
   */
  readonly modulos: ModuloDashboard[] = [
    {
      id: 'imprimir-credenciales', label: 'Imprimir credenciales',
      descripcion: 'Busca a un empleado en el poblado de credencial y genera su credencial en PDF.',
      icon: 'fas fa-id-card', link: '/imprimir-credenciales', permiso: 'ver_imprimir_credenciales',
    },
    {
      id: 'plantillas', label: 'Plantillas',
      descripcion: 'Diseña y administra los formatos de credencial (editor tipo canvas).',
      icon: 'fas fa-vector-square', link: '/plantillas', permiso: 'ver_plantillas',
    },
    {
      id: 'enrolamiento-previo', label: 'Enrolamiento previo',
      descripcion: 'Captura foto y firma de personal cuyo ingreso aún no se aplica en el poblado de credencial.',
      icon: 'fas fa-user-clock', link: '/enrolamiento-previo', permiso: 'ver_enrolamiento_previo',
    },
    {
      id: 'inventario-medios', label: 'Inventario de medios',
      descripcion: 'Busca, reemplaza y cruza fotos/firmas guardadas en el servidor.',
      icon: 'fas fa-photo-film', link: '/inventario-medios', permiso: 'ver_inventario_medios',
    },
    {
      id: 'catalogo-areas', label: 'Catálogo de áreas',
      descripcion: 'Nombre corto que se imprime en la credencial para cada unidad administrativa.',
      icon: 'fas fa-sitemap', link: '/catalogo-areas', permiso: 'ver_catalogo_areas',
    },
    {
      id: 'auditoria-credenciales', label: 'Auditoría de credenciales',
      descripcion: 'Historial de impresiones, con la credencial exacta que se expidió cada vez.',
      icon: 'fas fa-clipboard-check', link: '/auditoria-credenciales', permiso: 'ver_auditoria_credenciales',
    },
    {
      id: 'acuses', label: 'Acuses',
      descripcion: 'Carga el acuse de alta o de baja de credencial para cada empleado.',
      icon: 'fas fa-file-signature', link: '/acuses', permiso: 'ver_acuses',
    },
    {
      id: 'administracion', label: 'Administración',
      descripcion: 'Usuarios, roles y permisos del sistema.',
      icon: 'fas fa-user-shield', link: '/administracion', soloSuperusuario: true,
    },
  ];

  constructor(
    private sessionS: SessionService,
    private moduleContext: ModuleContextService,
    private permisosS: PermisosService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.usuario = this.sessionS.getUsuario();
    this.moduleContext.clearBlock();
  }

  /** Igual criterio que el sidebar: superusuario ve todo, si no, exige el permiso puntual. */
  get modulosVisibles(): ModuloDashboard[] {
    return this.modulos.filter(m =>
      m.soloSuperusuario ? this.permisosS.esSuperusuario() : this.permisosS.tiene(m.permiso)
    );
  }

  abrirModulo(modulo: ModuloDashboard): void {
    // El sidebar solo muestra estos ítems dentro del bloque "anam" -- sin
    // esto, entrar directo desde el dashboard dejaría el menú vacío.
    this.moduleContext.setBlock('anam');
    this.router.navigate([modulo.link]);
  }

  seleccionarBloque(bloque: Exclude<SidebarBlock, null>): void {
    this.moduleContext.setBlock(bloque);
  }

  esBloqueActivo(bloque: Exclude<SidebarBlock, null>): boolean {
    return this.moduleContext.selectedBlock() === bloque;
  }

  public openDocument(type: 'manual' | 'privacy' | 'regulation'): void {
    let url: string;

    switch (type) {
      case 'manual':
        url = '/docs/Manual de usuario_SCG_NV.pdf';
        break;
      case 'privacy':
        url = '/docs/Aviso de privacidad SCG.pdf';
        break;
      case 'regulation':
        url = '/docs/RIANAM_2023.pdf';
        break;
      default:
        console.error('Tipo de documento no válido');
        return;
    }

    // Abre el documento en una nueva pestaña/ventana
    window.open(url, '_blank');
  }
}
