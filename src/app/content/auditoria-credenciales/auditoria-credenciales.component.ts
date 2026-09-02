import { ChangeDetectorRef, Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CellClickedEvent, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';

import { UtilsService } from '../../services/utils.service';
import { CredencialRenderService } from '../../services/credencial-render.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import {
  ImpresionAuditoria, PlantillaCredencialService,
} from '../../services/plantilla-credencial.service';
import { CANVAS_ALTO_PX, CANVAS_ANCHO_PX, CaraCredencial } from '../plantilla-editor/plantilla-editor.const';

/**
 * Pantalla "Auditoría de credenciales".
 *
 * El historial completo de `sicre_tbl_enrolamiento_credencial`: una fila por
 * credencial impresa, con la credencial exacta que se expidió detrás del botón
 * de ver.
 *
 * Lo que hace posible esa consulta es que al imprimir se guarda el LIENZO
 * congelado, no solo la clave de la plantilla. Las plantillas se editan desde
 * `/plantillas`, así que reconstruir una credencial de hace meses con el diseño
 * de hoy mostraría un documento que nunca existió. Las imágenes tampoco se
 * reconstruyen: el servidor las archiva por hash de contenido en
 * `media/historico/`, de modo que recapturar la foto de alguien no reescribe
 * las credenciales que ya se le imprimieron.
 *
 * El listado NO trae los lienzos (~47 KB cada uno): se piden de uno en uno al
 * abrir el visor. Ver el action `auditoria` en el backend.
 */
@Component({
  standalone: false,
  selector: 'app-auditoria-credenciales',
  templateUrl: './auditoria-credenciales.component.html',
  styleUrls: ['./auditoria-credenciales.component.scss'],
})
export class AuditoriaCredencialesComponent implements OnInit {

  @ViewChild('modalCredencial') modalCredencial!: TemplateRef<any>;

  // ---- Datos ----
  /**
   * Todas las impresiones, tal como llegaron del servidor. El filtro por
   * fecha trabaja sobre este arreglo y deja el resultado en `filas`.
   */
  private todas: ImpresionAuditoria[] = [];

  /**
   * Lo que ve la grid. Es un CAMPO, no un getter con .filter(): un getter
   * devolvería un arreglo nuevo en cada ciclo de detección de cambios y
   * ag-Grid reemplazaría todas sus filas sin parar, perdiendo la selección al
   * hacer clic (ver CLAUDE.md, gotcha #14).
   */
  filas: ImpresionAuditoria[] = [];

  cargando = false;
  busqueda = '';
  desde = '';
  hasta = '';

  // ---- Visor ----
  detalle: any = null;
  cargandoDetalle = false;
  generandoPdf = false;
  cara: CaraCredencial = 'frente';
  imagenFrente: string | null = null;
  imagenReverso: string | null = null;

  /** Todas las impresiones del empleado abierto, para poder recorrerlas. */
  impresionesDelEmpleado: ImpresionAuditoria[] = [];

  /**
   * Descarta el render de una credencial que el usuario ya dejó de ver: al
   * saltar rápido entre impresiones, la respuesta lenta de la primera no debe
   * pintarse sobre la segunda.
   */
  private tokenDetalle = 0;

  // ---- ag-Grid ----
  private gridApi!: GridApi;

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    resizable: true,
    suppressHeaderMenuButton: true,
  };

  columnDefs: ColDef[] = [
    { headerName: 'No. empleado', field: 'num_empleado', width: 145 },
    { headerName: 'Nombre', field: 'nombre', flex: 2, minWidth: 220, tooltipField: 'nombre' },
    { headerName: 'CURP', field: 'curp', width: 175 },
    { headerName: 'Área', field: 'area', flex: 2, minWidth: 200, tooltipField: 'area' },
    { headerName: 'Folio', field: 'folio', width: 120, cellClass: 'ac-celda-folio' },
    { headerName: 'Plantilla', field: 'plantilla_credencial', width: 130 },
    {
      headerName: 'Expedición', field: 'fecha_expedicion', width: 135,
      valueFormatter: p => this.formatearFecha(p.value),
    },
    {
      headerName: 'Vigencia', field: 'fin_vig', width: 125,
      valueFormatter: p => this.formatearFecha(p.value),
    },
    {
      headerName: 'Impresa', field: 'fecha_registro', width: 165,
      // Ordena por el valor crudo ISO y muestra la fecha con hora: dos
      // reimpresiones del mismo día se distinguen por el minuto.
      valueFormatter: p => this.formatearFechaHora(p.value),
      sort: 'desc',
    },
    {
      headerName: 'Ajustes', field: 'con_ajustes', width: 110, filter: false,
      cellRenderer: (p: any) => p.value
        ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">Editada</span>'
        : '<span class="text-muted small">—</span>',
      cellStyle: { textAlign: 'center' },
    },
    {
      headerName: 'Impresa por', field: 'usuario_registra', width: 150,
      valueFormatter: p => p.value || '—',
    },
    {
      headerName: 'Modificada por', field: 'usuario_modifica', width: 150,
      valueFormatter: p => p.value || '—',
    },
    {
      headerName: 'Modificada el', field: 'fecha_modificacion', width: 165,
      valueFormatter: p => p.value ? this.formatearFechaHora(p.value) : '—',
    },
    {
      headerName: 'Acciones', colId: 'acciones', width: 110, sortable: false, filter: false,
      pinned: 'right',
      // Mismo patrón que el catálogo de áreas: el botón se pinta como HTML y
      // el clic se atiende en onCellClicked leyendo data-accion.
      cellRenderer: () => `
        <span title="Ver la constancia que se imprimió">
          <i class="tool-icon fas fa-id-card text-primary" data-accion="ver" style="cursor:pointer"></i>
        </span>`,
      cellStyle: { textAlign: 'center' },
    },
  ];

  constructor(
    private api: PlantillaCredencialService,
    private render: CredencialRenderService,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  // ====================================================================
  // Carga y filtros
  // ====================================================================

  cargar(): void {
    this.cargando = true;
    this.api.auditoria().subscribe({
      next: (res) => {
        this.todas = res?.resultados || [];
        this.aplicarFiltroFecha();
        this.cargando = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.cargando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  /** Buscador global: ag-Grid filtra sobre todas las columnas, en memoria. */
  onBusqueda(): void {
    this.gridApi?.setGridOption('quickFilterText', this.busqueda);
  }

  /**
   * Filtra por rango de fechas de IMPRESIÓN (`fecha_registro`), no por fecha
   * de expedición: lo que se audita es cuándo se emitió físicamente la
   * credencial. Se hace en memoria porque el listado ya está descargado
   * completo, así que responde sin ir al servidor.
   */
  aplicarFiltroFecha(): void {
    const desde = this.desde || null;
    const hasta = this.hasta || null;

    if (!desde && !hasta) {
      this.filas = this.todas;
      return;
    }

    this.filas = this.todas.filter(r => {
      // `fecha_registro` llega como ISO ('2026-08-07T14:03:11Z'); los primeros
      // 10 caracteres son la fecha, que se compara como texto sin construir
      // ningún Date -- evita que la conversión a UTC recorra el día.
      const dia = (r.fecha_registro || '').slice(0, 10);
      if (!dia) return false;
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
      return true;
    });
  }

  limpiarFiltros(): void {
    this.busqueda = '';
    this.desde = '';
    this.hasta = '';
    this.gridApi?.setGridOption('quickFilterText', '');
    this.gridApi?.setFilterModel(null);
    this.aplicarFiltroFecha();
  }

  get hayFiltros(): boolean {
    return !!(this.busqueda || this.desde || this.hasta);
  }

  /** Total sin filtrar, para contrastarlo con lo que queda visible. */
  get todasTotal(): number {
    return this.todas.length;
  }

  onCellClicked(evento: CellClickedEvent): void {
    const accion = (evento.event?.target as HTMLElement)?.dataset?.['accion'];
    if (accion === 'ver') this.verCredencial(evento.data);
  }

  // ====================================================================
  // Visor de la credencial impresa (solo consulta)
  // ====================================================================

  verCredencial(fila: ImpresionAuditoria): void {
    this.impresionesDelEmpleado = [];
    this.abrirDetalle(fila.id_enrolamiento);

    this.modalManager.openModal({
      title: `Constancia impresa — ${fila.nombre || fila.num_empleado || ''}`,
      template: this.modalCredencial,
      width: '900px',
      showFooter: false,
    });

    // Las demás impresiones de esta persona, para poder recorrer su historial
    // sin volver al listado. Va aparte del detalle porque no es lo que el
    // usuario pidió ver: si tarda, no debe retrasar la credencial en pantalla.
    if (fila.num_empleado) {
      this.api.auditoriaEmpleado(fila.num_empleado).subscribe({
        next: (res) => {
          this.impresionesDelEmpleado = res?.resultados || [];
          this.cdr.detectChanges();
        },
        error: () => { this.impresionesDelEmpleado = []; },
      });
    }
  }

  /** Carga y dibuja una impresión concreta dentro del visor. */
  abrirDetalle(idEnrolamiento: number): void {
    const token = ++this.tokenDetalle;

    this.cargandoDetalle = true;
    this.detalle = null;
    this.imagenFrente = null;
    this.imagenReverso = null;
    this.cara = 'frente';

    this.api.auditoriaDetalle(idEnrolamiento).subscribe({
      next: async (res) => {
        if (token !== this.tokenDetalle) return;
        this.detalle = res;

        try {
          if (res?.canvas_frente) {
            this.imagenFrente = await this.render.renderizarSnapshotComoImagen(
              res.canvas_frente, CANVAS_ANCHO_PX, CANVAS_ALTO_PX, 1
            );
          }
          if (res?.canvas_reverso) {
            this.imagenReverso = await this.render.renderizarSnapshotComoImagen(
              res.canvas_reverso, CANVAS_ANCHO_PX, CANVAS_ALTO_PX, 1
            );
          }
        } catch (err) {
          if (token === this.tokenDetalle) {
            this.utils.MuestraErrorInterno(err);
          }
        }

        if (token !== this.tokenDetalle) return;
        this.cargandoDetalle = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (token !== this.tokenDetalle) return;
        this.cargandoDetalle = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  cambiarCara(cara: CaraCredencial): void {
    this.cara = cara;
  }

  get imagenActual(): string | null {
    return this.cara === 'frente' ? this.imagenFrente : this.imagenReverso;
  }

  get tieneReverso(): boolean {
    return !!this.imagenReverso;
  }

  /** Impresión que se está viendo, dentro del historial del empleado. */
  esImpresionActual(impresion: ImpresionAuditoria): boolean {
    return this.detalle?.id_enrolamiento === impresion.id_enrolamiento;
  }

  /**
   * Descarga el MISMO PDF que se generó al imprimir: frente y reverso, al
   * tamaño físico real y a la resolución de exportación.
   *
   * Es un duplicado exacto, no una reimpresión: se dibuja desde los lienzos
   * congelados, así que sale con el folio y la fecha con los que se expidió,
   * no consume folio nuevo y no deja una fila más en el historial.
   */
  async descargarPdf(): Promise<void> {
    if (!this.detalle?.canvas_frente || this.generandoPdf) return;

    this.generandoPdf = true;
    try {
      await this.render.generarPdfDesdeSnapshots(
        this.detalle.canvas_frente,
        this.detalle.canvas_reverso || null,
        {
          nombreArchivo:
            `Constancia_${this.detalle.num_empleado || 'sin_numero'}`
            + `_folio_${this.detalle.folio || 'sn'}.pdf`,
        }
      );
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
    } finally {
      this.generandoPdf = false;
      this.cdr.detectChanges();
    }
  }

  // ====================================================================
  // Formato
  // ====================================================================

  /**
   * '2026-08-07' -> '07/08/2026', partiendo el texto en vez de construir un
   * Date: `new Date('2026-08-07')` se interpreta como UTC y en México
   * retrocede al día anterior.
   */
  formatearFecha(valor: string | null | undefined): string {
    if (!valor) return '';
    const [anio, mes, dia] = String(valor).slice(0, 10).split('-');
    return anio && mes && dia ? `${dia}/${mes}/${anio}` : String(valor);
  }

  /** Igual que arriba, más la hora local de la impresión. */
  formatearFechaHora(valor: string | null | undefined): string {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return this.formatearFecha(valor);

    const dosDigitos = (n: number) => String(n).padStart(2, '0');
    return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`
      + ` ${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
  }
}
