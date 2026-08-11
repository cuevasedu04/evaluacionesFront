import { ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CellClickedEvent, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { PlantillaCredencialService, EmpleadoSig } from '../../services/plantilla-credencial.service';
import { AcuseCredencialService, TipoAcuse } from '../../services/acuse-credencial.service';
import { COLUMNAS_SIG } from '../imprimir-credenciales/imprimir-credenciales.const';

/** Fila del roster con el estado de sus acuses ya fusionado, para pintar la ag-Grid. */
type FilaAcuse = EmpleadoSig & { acuse_alta: string | null; acuse_baja: string | null };

const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024;

/**
 * Pantalla "Acuses": roster completo (mismo dataset que "Imprimir
 * credenciales", filtrado 100% client-side) con dos columnas de accion para
 * cargar el acuse de alta y el de baja de cada empleado -- PDF o imagen del
 * documento firmado.
 *
 * El archivo se guarda por convencion de nombre (num_empleado), igual que
 * foto/firma: no hay ninguna ruta que persistir aqui, `mapa()` la resuelve
 * sola contra MEDIA_ROOT. Subir un acuse SIEMPRE reemplaza el vigente -- a
 * diferencia de una credencial impresa, no hace falta conservar versiones
 * anteriores del documento (la fila de auditoria en sicre_tbl_acuse_credencial
 * ya deja constancia de quien y cuando).
 */
@Component({
  standalone: false,
  selector: 'app-acuses',
  templateUrl: './acuses.component.html',
  styleUrls: ['./acuses.component.scss'],
})
export class AcusesComponent implements OnInit {
  @ViewChild('inputArchivo') inputArchivoRef!: ElementRef<HTMLInputElement>;

  cargandoRoster = false;
  busquedaGlobal = '';
  totalFiltrados = 0;

  private rowData: FilaAcuse[] = [];
  private gridApi!: GridApi;

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    resizable: true,
    minWidth: 110,
    suppressHeaderMenuButton: true,
  };

  columnDefs: ColDef[] = [];

  // Empleado/tipo pendientes de resolver en cuanto el usuario elija un
  // archivo en el <input type="file"> oculto -- se dispara desde el click en
  // el icono de la celda, ver onCellClicked().
  private pendiente: { numEmpleado: string; tipo: TipoAcuse } | null = null;

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private acuseApi: AcuseCredencialService,
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
      this.columnaAcuse('alta', 'Acuse alta'),
      this.columnaAcuse('baja', 'Acuse baja'),
    ];

    this.cargarDatos();
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
        const url = p.data?.[`acuse_${tipo}`];
        const verBoton = url
          ? `<span title="Ver acuse"><i class="tool-icon fas fa-file-circle-check text-success me-2" data-accion="ver-${tipo}" style="cursor:pointer"></i></span>`
          : '';
        const subirTitulo = url ? 'Reemplazar' : 'Cargar acuse';
        const subirColor = url ? 'text-secondary' : 'text-primary';
        return `${verBoton}<span title="${subirTitulo}"><i class="tool-icon fas fa-upload ${subirColor}" data-accion="subir-${tipo}" style="cursor:pointer"></i></span>`;
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
                acuse_alta: estado?.alta || null,
                acuse_baja: estado?.baja || null,
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
    const accion = (evento.event?.target as HTMLElement)?.dataset?.['accion'];
    if (!accion) return;

    const fila = evento.data as FilaAcuse;
    const numEmpleado = (fila.no_empleado || '').trim();
    if (!numEmpleado) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Este registro no tiene número de empleado asignado.');
      return;
    }

    const [accionBase, tipo] = accion.split('-') as [string, TipoAcuse];

    if (accionBase === 'ver') {
      const url = fila[`acuse_${tipo}`];
      if (url) window.open(url, '_blank');
      return;
    }

    if (accionBase === 'subir') {
      this.pendiente = { numEmpleado, tipo };
      this.inputArchivoRef.nativeElement.value = '';
      this.inputArchivoRef.nativeElement.click();
    }
  }

  onArchivoSeleccionado(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const pendiente = this.pendiente;
    this.pendiente = null;

    if (!archivo || !pendiente) return;

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
    lector.onload = () => this.subirAcuse(pendiente.numEmpleado, pendiente.tipo, lector.result as string);
    lector.readAsDataURL(archivo);
  }

  private subirAcuse(numEmpleado: string, tipo: TipoAcuse, archivoBase64: string): void {
    this.acuseApi.subir(numEmpleado, tipo, archivoBase64).subscribe({
      next: (res) => {
        const fila = this.rowData.find(f => (f.no_empleado || '').trim() === numEmpleado);
        if (fila) {
          fila[`acuse_${tipo}`] = res?.archivo || null;
          this.gridApi?.refreshCells({ columns: [`acuse_${tipo}`], force: true });
        }
        this.utils.MuestrasToast(TipoToast.Success, `Acuse de ${tipo} cargado correctamente.`);
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }
}
