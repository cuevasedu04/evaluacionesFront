
import { Component, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarService } from '../../../services/sidebar-service.service';
import { inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { UtilsService } from '../../../services/utils.service';
import { TipoToast } from '../../../../api/entidades/enumeraciones';
import { CatalogoService } from '../../../../api/catalogo/catalogo.service';
import { SessionService } from '../../../services/session.service';
import { RosterSyncService } from '../../../services/roster-sync.service';

@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent implements OnDestroy {
  public sidebarService = inject(SidebarService);

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  collapseSidebar(): void {
    this.sidebarService.collapseSidebar();
  }

  expandSidebar(): void {
    this.sidebarService.expandSidebar();
  }
   @Output() onLogout = new EventEmitter<void>();

  usuario:any;
  dependenciaDS: any = [];

  /** Nombre a mostrar a la izquierda del circulo -- cae a username si no hay nombreCompleto (ej. cuenta sin first_name/last_name capturados). */
  get nombreUsuario(): string {
    const nombre = (this.usuario?.nombreCompleto || '').trim();
    return nombre || this.usuario?.username || 'Usuario';
  }

  constructor(
    private router: Router,
    private utils: UtilsService,
    private catalogoApi: CatalogoService,
	private sessionS: SessionService,
    public rosterSync: RosterSyncService,
  ) {}

  /**
   * "ACTUALIZADO DD/MM HH:MM" para el badge tipo tablero de aeropuerto.
   * Vive en el header (no en "Imprimir credenciales") para que la fecha de
   * sincronizacion del poblado de credencial quede visible en todo el
   * sistema, no solo en esa pantalla -- ver RosterSyncService. Es de solo
   * lectura: la actualizacion manual (boton junto al badge) se quito
   * (2026-08-26), este sistema no la necesita -- el sondeo automatico de
   * RosterSyncService basta.
   */
  get textoUltimaActualizacion(): string {
    const fecha = this.rosterSync.ultimaActualizacion();
    if (!fecha) return '';

    const dosDigitos = (n: number) => String(n).padStart(2, '0');
    return `ACTUALIZADO ${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)} `
      + `${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
  }

   isDropdownOpen = false;

  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  logout() {
    this.isDropdownOpen = false;
    this.onLogout.emit();
    this.utils.MuestrasToast(TipoToast.Info, "Se ha finalizado la sesión.");
    this.sessionS.logout();
  }

  // Cerrar dropdown al hacer click fuera
  onDocumentClick(event: Event) {
    if (!event.target) return;

    const target = event.target as Element;
    if (!target.closest('.user-menu')) {
      this.isDropdownOpen = false;
    }
  }

  ngOnInit() {
	this.usuario = this.sessionS.getUsuario();
    document.addEventListener('click', this.onDocumentClick.bind(this));

    // Arranca el sondeo en cuanto se monta el header -- o sea, en cuanto se
    // entra al sistema autenticado, no cuando alguien visita "Imprimir
    // credenciales". Es idempotente y se mantiene solo mientras dure la
    // sesion (el header nunca se desmonta, vive fuera del router-outlet).
    this.rosterSync.iniciarSondeo();
  }

  ngOnDestroy() {
    document.removeEventListener('click', this.onDocumentClick.bind(this));
  }

  goHome(){
    this.router.navigate(['/dashboard']);
  }

}
