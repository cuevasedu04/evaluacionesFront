
import { Component, Input, Output, EventEmitter, EffectRef, OnDestroy, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarService } from '../../../services/sidebar-service.service';
import { inject, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { UtilsService } from '../../../services/utils.service';
import { TipoToast } from '../../../../api/entidades/enumeraciones';
import { CatalogoService } from '../../../../api/catalogo/catalogo.service';
import { SessionService } from '../../../services/session.service';
import { RosterSyncService } from '../../../services/roster-sync.service';
import { PlantillaCredencialService } from '../../../services/plantilla-credencial.service';
import { ModalManagerService } from '../modal-manager.service';

/** Duracion maxima que se espera la actualizacion manual antes de dejar de mostrar la barra de progreso. */
const TIMEOUT_ACTUALIZACION_MANUAL_MS = 5 * 60 * 1000;

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

  @ViewChild('confirmActualizarDialog') confirmActualizarDialog!: TemplateRef<any>;

  /** True mientras se espera a que la actualizacion manual (boton junto al badge) termine. */
  actualizandoManualmente = false;
  private valorAlDispararActualizacion: number | null = null;
  private timeoutSeguridad: ReturnType<typeof setTimeout> | null = null;
  private readonly efectoFinActualizacion: EffectRef;

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
    private modalManager: ModalManagerService,
  ) {
    // Detecta que la actualizacion manual YA TERMINO: la fecha que conoce
    // RosterSyncService (alimentada por su propio sondeo, acelerado mientras
    // `actualizandoManualmente` es true -- ver dispararActualizacionManual)
    // cambio respecto a la que habia antes de dispararla. No se basa en
    // ninguna respuesta del endpoint de disparo: ese solo encola la tarea y
    // regresa de inmediato, sin esperar a que el poblado de credencial
    // realmente se actualice.
    this.efectoFinActualizacion = effect(() => {
      const fecha = this.rosterSync.ultimaActualizacion();
      if (!this.actualizandoManualmente || !fecha || this.valorAlDispararActualizacion === null) return;
      if (fecha.getTime() !== this.valorAlDispararActualizacion) {
        this.finalizarActualizacionManual(true);
      }
    });
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

  // ====================================================================
  // Actualizacion manual del poblado de credencial
  // ====================================================================

  abrirConfirmacionActualizar(): void {
    if (this.actualizandoManualmente) return;

    this.modalManager.openModal({
      title: 'Actualizar poblado de credencial',
      template: this.confirmActualizarDialog,
      onAccept: () => this.dispararActualizacionManual(),
    });
  }

  private dispararActualizacionManual(): void {
    // Se marca YA, antes de que responda el servidor: el modal se cierra de
    // inmediato y la barra de progreso debe aparecer en ese mismo instante,
    // no tras un segundo viaje de red.
    this.actualizandoManualmente = true;
    this.valorAlDispararActualizacion = this.rosterSync.ultimaActualizacion()?.getTime() ?? null;

    this.plantillaApi.forzarActualizacionRoster().subscribe({
      next: () => {
        // El disparo se encolo; ahora hay que ESPERAR a que la tarea
        // termine de verdad, sondeando mas seguido de lo normal.
        this.rosterSync.activarSondeoRapido();
        this.armarTimeoutSeguridad();
      },
      error: (err) => {
        this.actualizandoManualmente = false;
        this.valorAlDispararActualizacion = null;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  private armarTimeoutSeguridad(): void {
    this.limpiarTimeoutSeguridad();
    this.timeoutSeguridad = setTimeout(() => {
      if (!this.actualizandoManualmente) return;
      this.utils.MuestrasToast(
        TipoToast.Warning,
        'La actualización está tardando más de lo esperado; seguirá en segundo plano.'
      );
      this.finalizarActualizacionManual(false);
    }, TIMEOUT_ACTUALIZACION_MANUAL_MS);
  }

  private limpiarTimeoutSeguridad(): void {
    if (this.timeoutSeguridad) {
      clearTimeout(this.timeoutSeguridad);
      this.timeoutSeguridad = null;
    }
  }

  private finalizarActualizacionManual(exito: boolean): void {
    this.actualizandoManualmente = false;
    this.valorAlDispararActualizacion = null;
    this.limpiarTimeoutSeguridad();
    this.rosterSync.restablecerSondeoNormal();
    if (exito) this.utils.MuestrasToast(TipoToast.Success, 'Poblado de credencial actualizado.');
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
    this.efectoFinActualizacion.destroy();
    this.limpiarTimeoutSeguridad();
  }

  goHome(){
    this.router.navigate(['/dashboard']);
  }

}
