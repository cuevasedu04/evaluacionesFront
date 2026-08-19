import { ChangeDetectorRef, Component, ElementRef, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CellClickedEvent, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { PlantillaCredencialService, EmpleadoSig } from '../../services/plantilla-credencial.service';
import {
  AcuseCredencialService, TipoAcuse, AcuseAuditoria, AcuseCredencial, MAX_ACUSES_POR_TIPO,
} from '../../services/acuse-credencial.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { COLUMNAS_SIG } from '../imprimir-credenciales/imprimir-credenciales.const';

/** Fila del roster con el conteo de sus acuses ya fusionado, para pintar la ag-Grid. */
type FilaAcuse = EmpleadoSig & { acuse_alta: number; acuse_baja: number };

type SeccionAcuses = 'roster' | 'auditoria';

const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024;

/**
 * Pantalla "Acuses": roster completo (mismo dataset que "Imprimir
 * credenciales", filtrado 100% client-side) con dos columnas de accion --
 * una por tipo -- que muestran cuantos acuses tiene ya cada empleado y abren
 * un modal para gestionarlos (ver/agregar/eliminar).
 *
 * Un empleado puede tener HASTA MAX_ACUSES_POR_TIPO (10) acuses del mismo
 * tipo -- varios movimientos de alta o de baja a lo largo del tiempo -- asi
 * que subir uno nuevo siempre AGREGA, nunca reemplaza. El archivo se guarda
 * por convencion de nombre (num_empleado + numero de acuse), igual que
 * foto/firma: no hay ninguna ruta que persistir aqui, el backend la resuelve
 * sola contra MEDIA_ROOT.
 */
@Component({
  standalone: false,
  selector: 'app-acuses',
  templateUrl: './acuses.component.html',
  styleUrls: ['./acuses.component.scss'],
})
export class AcusesComponent implements OnInit {
  @ViewChild('inputArchivo') inputArchivoRef!: ElementRef<HTMLInputElement>;
  @ViewChild('modalGestion') modalGestionRef!: TemplateRef<any>;
  @ViewChild('modalConfirmarEliminar') modalConfirmarEliminarRef!: TemplateRef<any>;

  readonly maxAcuses = MAX_ACUSES_POR_TIPO;

  seccion: SeccionAcuses = 'roster';

  cargandoRoster = false;
  busquedaGlobal = '';
  totalFiltrados = 0;

  private rowData: FilaAcuse[] = [];
  private gridApi!: GridApi;

  cargandoAuditoria = false;
  auditoriaData: AcuseAuditoria[] = [];
  private gridApiAuditoria!: GridApi;

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    resizable: true,
    minWidth: 110,
    suppressHeaderMenuButton: true,
  };

  columnDefs: ColDef[] = [];
  columnDefsAuditoria: ColDef[] = [];

  // ---- Modal de gestion (ver/agregar/eliminar acuses de UN empleado+tipo) ----
  gestionEmpleado: { numEmpleado: string; nombre: string; tipo: TipoAcuse } | null = null;
  gestionLista: AcuseCredencial[] = [];
  cargandoGestion = false;
  subiendoGestion = false;
  private modalGestionInstancia: NgbModalRef | undefined;

  // Acuse pendiente de confirmar borrado (ver eliminarAcuse()/confirmarEliminar()).
  private pendienteEliminar: AcuseCredencial | null = null;

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private acuseApi: AcuseCredencialService,
    private modalManager: ModalManagerService,
    private utils: UtilsService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.columnDefs = [
      ...COLUMNAS_SIG.map(col => ({
        field: col.campo,
        headerName: col.titulo,
        width: col.ancho,
        tooltipField: col.campo,
      })),
      this.columnaAcuse('alta', 'Acuses alta'),
      this.columnaAcuse('baja', 'Acuses baja'),
    ];

    this.columnDefsAuditoria = [
      { field: 'num_empleado', headerName: 'Núm. empleado', width: 140 },
      { field: 'nombre', headerName: 'Nombre', flex: 1, minWidth: 220 },
      {
        field: 'tipo', headerName: 'Tipo', width: 90,
        valueFormatter: p => p.value === 'alta' ? 'Alta' : 'Baja',
      },
      { field: 'numero', headerName: '#', width: 60, cellStyle: { textAlign: 'center' } },
      {
        headerName: 'Archivo', colId: 'archivo', width: 100, sortable: false, filter: false,
        cellStyle: { textAlign: 'center' },
        cellRenderer: (p: any) => p.data?.archivo
          ? '<span title="Ver acuse"><i class="tool-icon fas fa-file-arrow-down text-primary" data-accion="ver-archivo" style="cursor:pointer"></i></span>'
          : '—',
      },
      {
        field: 'fecha_carga', headerName: 'Cargado', width: 160,
        valueFormatter: p => this.formatearFechaHora(p.value),
      },
      {
        field: 'usuario_carga', headerName: 'Usuario que cargó', width: 170,
        valueFormatter: p => p.value || '—',
      },
    ];

    this.cargarDatos();
  }

  seleccionarSeccion(seccion: SeccionAcuses): void {
    this.seccion = seccion;
    if (seccion === 'auditoria') this.cargarAuditoria();
  }

  private columnaAcuse(tipo: TipoAcuse, titulo: string): ColDef {
    return {
      headerName: titulo,
      colId: `acuse_${tipo}`,
      width: 140,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellStyle: { textAlign: 'center' },
      cellRenderer: (p: any) => {
        const n = p.data?.[`acuse_${tipo}`] || 0;
        const color = n === 0 ? 'text-muted' : (n >= this.maxAcuses ? 'text-danger' : 'text-success');
        return `<span class="tool-icon ${color}" data-accion="gestionar-${tipo}" style="cursor:pointer;font-weight:600;"
                  title="Ver / agregar acuses de ${tipo === 'alta' ? 'alta' : 'baja'}">
                  <i class="fas ${n ? 'fa-folder-open' : 'fa-folder-plus'} me-1"></i>${n}/${this.maxAcuses}
                </span>`;
      },
    };
  }

  cargarDatos(): void {
    this.cargandoRoster = true;
    this.plantillaApi.empleadosSigTodos().subscribe({
      next: (resRoster) => {
        this.acuseApi.mapa().subscribe({
          next: (resAcuses) => {
            const mapa = resAcuses?.registros || {};
            this.rowData = (resRoster?.registros || []).map((fila: EmpleadoSig) => {
              const numEmpleado = (fila.no_empleado || '').trim();
              const estado = mapa[numEmpleado];
              return {
                ...fila,
                acuse_alta: estado?.alta || 0,
                acuse_baja: estado?.baja || 0,
              } as FilaAcuse;
            });
            this.totalFiltrados = this.rowData.length;
            this.cargandoRoster = false;
            this.cdr.detectChanges();
          },
          error: (err) => {
            this.cargandoRoster = false;
            this.utils.MuestraErrorInterno(err);
          },
        });
      },
      error: (err) => {
        this.cargandoRoster = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get rowDataActivo(): FilaAcuse[] {
    return this.rowData;
  }

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  onBusquedaGlobal(): void {
    this.gridApi?.setGridOption('quickFilterText', this.busquedaGlobal);
  }

  onFiltroCambiado(): void {
    this.totalFiltrados = this.gridApi?.getDisplayedRowCount() ?? this.rowData.length;
  }

  onCellClicked(evento: CellClickedEvent): void {
    const accion = (evento.event?.target as HTMLElement)?.closest<HTMLElement>('[data-accion]')?.dataset?.['accion'];
    if (!accion) return;

    const fila = evento.data as FilaAcuse;
    const numEmpleado = (fila.no_empleado || '').trim();
    if (!numEmpleado) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Este registro no tiene número de empleado asignado.');
      return;
    }

    const [, tipo] = accion.split('-') as [string, TipoAcuse];
    if (accion.startsWith('gestionar-')) {
      const nombre = [fila.nombres, fila.primer_apellido, fila.segundo_apellido].filter(Boolean).join(' ');
      this.abrirGestion(numEmpleado, nombre, tipo);
    }
  }

  // ====================================================================
  // Modal de gestion: lista de acuses de UN empleado+tipo, con agregar/ver/eliminar.
  // ====================================================================

  abrirGestion(numEmpleado: string, nombre: string, tipo: TipoAcuse): void {
    this.gestionEmpleado = { numEmpleado, nombre, tipo };
    this.gestionLista = [];
    this.modalGestionInstancia = this.modalManager.openModal({
      title: `Acuses de ${tipo === 'alta' ? 'alta' : 'baja'} — ${nombre || numEmpleado}`,
      template: this.modalGestionRef,
      showFooter: false,
      width: '560px',
    });
    this.modalGestionInstancia.hidden.subscribe(() => { this.gestionEmpleado = null; });
    this.cargarGestion();
  }

  private cargarGestion(): void {
    if (!this.gestionEmpleado) return;
    const { numEmpleado, tipo } = this.gestionEmpleado;
    this.cargandoGestion = true;
    this.acuseApi.porEmpleado(numEmpleado, tipo).subscribe({
      next: (res) => {
        this.gestionLista = (res?.resultados || []).slice().sort((a, b) => a.numero - b.numero);
        this.cargandoGestion = false;
      },
      error: (err) => {
        this.cargandoGestion = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  agregarAcuse(): void {
    if (!this.gestionEmpleado || this.gestionLista.length >= this.maxAcuses) return;
    this.inputArchivoRef.nativeElement.value = '';
    this.inputArchivoRef.nativeElement.click();
  }

  onArchivoSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const gestion = this.gestionEmpleado;

    if (!archivo || !gestion) return;

    const esPdf = archivo.type === 'application/pdf';
    const esImagen = archivo.type.startsWith('image/');
    if (!esPdf && !esImagen) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El acuse debe ser un PDF o una imagen.');
      return;
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo no debe superar 8 MB.');
      return;
    }

    const lector = new FileReader();
    lector.onload = () => this.subirAcuse(gestion.numEmpleado, gestion.tipo, lector.result as string);
    lector.readAsDataURL(archivo);
  }

  private subirAcuse(numEmpleado: string, tipo: TipoAcuse, archivoBase64: string): void {
    this.subiendoGestion = true;
    this.acuseApi.subir(numEmpleado, tipo, archivoBase64).subscribe({
      next: () => {
        this.subiendoGestion = false;
        this.actualizarConteo(numEmpleado, tipo, +1);
        this.cargarGestion();
        this.utils.MuestrasToast(TipoToast.Success, `Acuse de ${tipo} agregado correctamente.`);
      },
      error: (err) => {
        this.subiendoGestion = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  verAcuse(item: AcuseCredencial): void {
    if (item.archivo) window.open(item.archivo, '_blank');
  }

  eliminarAcuse(item: AcuseCredencial): void {
    this.pendienteEliminar = item;
    this.modalManager.openModal({
      title: 'Eliminar acuse',
      template: this.modalConfirmarEliminarRef,
      onAccept: () => this.confirmarEliminar(),
      onCancel: () => { this.pendienteEliminar = null; },
    });
  }

  private confirmarEliminar(): void {
    const item = this.pendienteEliminar;
    this.pendienteEliminar = null;
    if (!item) return;

    this.acuseApi.eliminar(item.id_acuse).subscribe({
      next: () => {
        this.actualizarConteo(item.num_empleado, item.tipo, -1);
        this.cargarGestion();
        this.utils.MuestrasToast(TipoToast.Success, 'Acuse eliminado.');
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  /** Ajusta el contador en memoria (sin recargar todo el roster) y refresca esa celda de la grid. */
  private actualizarConteo(numEmpleado: string, tipo: TipoAcuse, delta: number): void {
    const fila = this.rowData.find(f => (f.no_empleado || '').trim() === numEmpleado);
    if (!fila) return;
    fila[`acuse_${tipo}`] = Math.max(0, fila[`acuse_${tipo}`] + delta);
    this.gridApi?.refreshCells({ columns: [`acuse_${tipo}`], force: true });
  }

  // ====================================================================
  // Auditoría: quién subió cada acuse.
  // ====================================================================

  cargarAuditoria(): void {
    this.cargandoAuditoria = true;
    this.acuseApi.auditoria().subscribe({
      next: (res) => {
        this.auditoriaData = res?.resultados || [];
        this.cargandoAuditoria = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.cargandoAuditoria = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  onGridReadyAuditoria(evento: GridReadyEvent): void {
    this.gridApiAuditoria = evento.api;
  }

  onCellClickedAuditoria(evento: CellClickedEvent): void {
    const accion = (evento.event?.target as HTMLElement)?.dataset?.['accion'];
    if (accion !== 'ver-archivo') return;

    const fila = evento.data as AcuseAuditoria;
    if (fila.archivo) window.open(fila.archivo, '_blank');
  }

  /**
   * '2026-08-11T20:17:46Z' -> '11/08/2026 20:17', en hora LOCAL. No se usa
   * toISOString/slice: la fecha ya llega con hora, y construir el Date y
   * leerlo con los getters locales (no UTC) es lo que evita que retroceda
   * un dia en Mexico, igual que auditoria-credenciales.component.ts.
   */
  formatearFechaHora(valor: string | null | undefined): string {
    if (!valor) return '';
    const fecha = new Date(valor);
    if (isNaN(fecha.getTime())) return String(valor);

    const dosDigitos = (n: number) => String(n).padStart(2, '0');
    return `${dosDigitos(fecha.getDate())}/${dosDigitos(fecha.getMonth() + 1)}/${fecha.getFullYear()}`
      + ` ${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
  }
}
