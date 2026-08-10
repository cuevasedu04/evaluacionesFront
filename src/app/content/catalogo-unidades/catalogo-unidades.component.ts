import { ChangeDetectorRef, Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CellClickedEvent, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import {
  PlantillaCredencialService, UnidadAdministrativa,
} from '../../services/plantilla-credencial.service';
import { PermisosService } from '../../services/permisos.service';

/** Area del roster que todavia no existe en el catalogo. */
interface AreaSinCatalogo {
  area: string;
  empleados: number;
}

/**
 * Pantalla "Catalogo de areas".
 *
 * Administra `sicre_tbl_unidad_administrativa`, que traduce el nombre oficial
 * del area -- que llega a 91 caracteres y desborda la credencial -- al texto
 * corto que se imprime.
 *
 * El valor de `nombre_compactado` es literal: lo que diga aqui es lo que sale
 * impreso. Hoy las Direcciones Generales llevan su acronimo (DGTI, UAF...) y
 * las aduanas llevan 'ANAM', pero eso es solo con lo que se sembro la tabla:
 * si mas adelante quieren que una aduana imprima su propio nombre, se edita
 * en esta pantalla y funciona, sin tocar codigo ni volver a desplegar.
 */
@Component({
  standalone: false,
  selector: 'app-catalogo-unidades',
  templateUrl: './catalogo-unidades.component.html',
  styleUrls: ['./catalogo-unidades.component.scss'],
})
export class CatalogoUnidadesComponent implements OnInit {

  @ViewChild('modalUnidad') modalUnidad!: TemplateRef<any>;
  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  registros: UnidadAdministrativa[] = [];
  sinCatalogo: AreaSinCatalogo[] = [];

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
    {
      headerName: 'Área (nombre oficial)', field: 'nombre', flex: 2, minWidth: 280,
      tooltipField: 'nombre',
    },
    {
      headerName: 'Se imprime', field: 'nombre_compactado', width: 160,
      cellClass: 'cu-celda-corto',
    },
    {
      headerName: 'Empleados', field: 'total_empleados', width: 130, filter: 'agNumberColumnFilter',
      type: 'numericColumn',
      valueFormatter: p => (p.value ?? 0).toLocaleString('es-MX'),
    },
    {
      headerName: 'Activo', field: 'activo', width: 100, filter: false,
      cellRenderer: (p: any) => p.value
        ? '<i class="fas fa-check-circle text-success"></i>'
        : '<i class="fas fa-times-circle text-muted"></i>',
      cellStyle: { textAlign: 'center' },
    },
    {
      headerName: 'Acciones', colId: 'acciones', width: 120, sortable: false, filter: false,
      pinned: 'right',
      // Los botones se pintan como HTML y el clic se atiende en onCellClicked
      // leyendo data-accion: mas simple que registrar un componente por celda
      // para dos iconos. Se omiten del todo (no solo se deshabilitan) para
      // quien no tenga `areas_administrar`: el backend ya rechaza la accion,
      // asi que un boton visible pero inutil solo confundiria.
      cellRenderer: () => this.permisosS.tiene('areas_administrar') ? `
        <span title="Editar"><i class="tool-icon fas fa-pen text-primary me-3" data-accion="editar" style="cursor:pointer"></i></span>
        <span title="Eliminar"><i class="tool-icon fas fa-trash text-danger" data-accion="eliminar" style="cursor:pointer"></i></span>` : '',
      cellStyle: { textAlign: 'center' },
    },
  ];
  cargando = false;
  guardando = false;
  busqueda = '';
  confirmMessage = '';

  /** Registro en edicion. Sin id_unidad significa alta nueva. */
  enFormulario: UnidadAdministrativa = this.vacio();

  constructor(
    private api: PlantillaCredencialService,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private cdRef: ChangeDetectorRef,
    public permisosS: PermisosService,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  private vacio(): UnidadAdministrativa {
    return { nombre: '', nombre_compactado: '', activo: true };
  }

  // ====================================================================
  // Carga
  // ====================================================================

  cargar(): void {
    this.cargando = true;
    this.api.unidadesListar().subscribe({
      next: (res) => {
        this.registros = res?.registros || [];
        this.cargando = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.cargando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });

    // Areas que llegaron con el sync y nadie ha catalogado: su credencial
    // saldria con el nombre largo, asi que conviene avisarlo aqui y no
    // descubrirlo al imprimir.
    this.api.unidadesSinCatalogo().subscribe({
      next: (res) => { this.sinCatalogo = res?.registros || []; },
      error: () => { this.sinCatalogo = []; },
    });
  }

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  /** Buscador global: ag-Grid filtra sobre todas las columnas en memoria. */
  onBusqueda(): void {
    this.gridApi?.setGridOption('quickFilterText', this.busqueda);
  }

  limpiarBusqueda(): void {
    this.busqueda = '';
    this.gridApi?.setGridOption('quickFilterText', '');
    this.gridApi?.setFilterModel(null);
  }

  onCellClicked(evento: CellClickedEvent): void {
    const accion = (evento.event?.target as HTMLElement)?.dataset?.['accion'];
    if (!accion) return;
    if (accion === 'editar') this.editar(evento.data);
    else if (accion === 'eliminar') this.confirmarEliminar(evento.data);
  }

  get totalEmpleadosSinCatalogo(): number {
    return this.sinCatalogo.reduce((suma, a) => suma + a.empleados, 0);
  }

  // ====================================================================
  // Alta / edicion
  // ====================================================================

  nuevo(nombreSugerido = ''): void {
    this.enFormulario = { ...this.vacio(), nombre: nombreSugerido };
    this.abrirModal(nombreSugerido ? 'Catalogar área' : 'Nueva área');
  }

  editar(registro: UnidadAdministrativa): void {
    this.enFormulario = { ...registro };
    this.abrirModal('Editar área');
  }

  private abrirModal(titulo: string): void {
    this.modalManager.openModal({
      title: titulo,
      template: this.modalUnidad,
      width: '620px',
      showFooter: true,
      onAccept: () => this.guardar(),
    });
  }

  get formularioValido(): boolean {
    return !!this.enFormulario.nombre.trim() && !!this.enFormulario.nombre_compactado.trim();
  }

  private guardar(): void {
    if (!this.formularioValido) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El nombre y el nombre corto son obligatorios.');
      return;
    }

    const datos: UnidadAdministrativa = {
      nombre: this.enFormulario.nombre.trim(),
      nombre_compactado: this.enFormulario.nombre_compactado.trim(),
      activo: this.enFormulario.activo,
    };

    this.guardando = true;
    const peticion = this.enFormulario.id_unidad
      ? this.api.unidadActualizar(this.enFormulario.id_unidad, datos)
      : this.api.unidadCrear(datos);

    peticion.subscribe({
      next: () => {
        this.guardando = false;
        this.utils.MuestrasToast(TipoToast.Success, 'Catálogo actualizado');
        this.cargar();
      },
      error: (err) => {
        this.guardando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  confirmarEliminar(registro: UnidadAdministrativa): void {
    this.confirmMessage =
      `¿Eliminar «${registro.nombre}» del catálogo? Los ${registro.total_empleados || 0} `
      + 'empleados de esa área pasarían a imprimir su nombre completo en la credencial.';

    this.modalManager.openModal({
      title: 'Eliminar del catálogo',
      template: this.confirmDialog,
      onAccept: () => {
        if (!registro.id_unidad) return;
        this.api.unidadEliminar(registro.id_unidad).subscribe({
          next: () => {
            this.utils.MuestrasToast(TipoToast.Success, 'Área eliminada del catálogo');
            this.cargar();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }
}
