
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarService } from '../../../services/sidebar-service.service';
import { inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { UtilsService } from '../../../services/utils.service';
import { TipoToast } from '../../../../api/entidades/enumeraciones';
import { CatalogoService } from '../../../../api/catalogo/catalogo.service';
import { SessionService } from '../../../services/session.service';
import { RosterSyncService } from '../../../services/roster-sync.service';
import { PlantillaCredencialService } from '../../../services/plantilla-credencial.service';

@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {
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
    private plantillaApi: PlantillaCredencialService,
  ) {

  }

  /**
   * "ACTUALIZADO DD/MM HH:MM" para el badge tipo tablero de aeropuerto.
   * Vive en el header (no en "Imprimir credenciales") para que la fecha de
   * sincronizacion del poblado de credencial quede visible en todo el
   * sistema, no solo en esa pantalla -- ver RosterSyncService.
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

    // Se pide de entrada, al montar el header (o sea, en cuanto se entra al
    // sistema autenticado) -- NO se espera a que alguien visite "Imprimir
    // credenciales". Es un MAX() en el servidor, no las ~16k filas del
    // roster completo (ver empleadosSigUltimaActualizacion), asi que pedirlo
    // aqui de una vez es barato.
    this.plantillaApi.empleadosSigUltimaActualizacion().subscribe({
      next: (res) => {
        if (res?.fecha_actualizacion) {
          this.rosterSync.actualizar(new Date(res.fecha_actualizacion));
        }
      },
      error: () => {}, // El header no debe romperse por esto; "Imprimir credenciales" la sigue actualizando igual.
    });
  }

  ngOnDestroy() {
    document.removeEventListener('click', this.onDocumentClick.bind(this));
  }

  goHome(){
    this.router.navigate(['/dashboard']);
  }

}
