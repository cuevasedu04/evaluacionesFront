import { Component, OnInit, OnDestroy, ViewChild, TemplateRef, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ColDef, GridApi, GridReadyEvent, ValueFormatterParams } from 'ag-grid-community';
import { UtilsService } from '../../services/utils.service';
import { TipoToast } from '../../../api/entidades/enumeraciones';
import { FechaMexicoPipe } from '../../../app/pipes/date-mx-format';
import { CargaMasivaService } from '../../services/carga-masiva.service';
import { EnrolamientoService } from '../../services/enrolamiento.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { PlantillaAnamComponent } from '../plantilla-anam/plantilla-anam.component';
import { ProvisionalComponent } from '../provisional/provisional.component';

@Component({
  selector: 'app-busqueda-enrolamiento-masivos',
  standalone: false,
  templateUrl: './busqueda-enrolamiento-masivos.component.html',
  styleUrl: './busqueda-enrolamiento-masivos.component.scss',
  providers: [FechaMexicoPipe]
})
export class BusquedaEnrolamientoMasivosComponent implements OnInit, OnDestroy {

  Math = Math;

  // AG-Grid
  private gridApi!: GridApi;
  rowData: any[] = [];
  columnDefs: ColDef[] = [];

  // Lotes
  lotesResumen: any[] = [];
  loteSeleccionado: string = '';
  cargandoLotes: boolean = false;

  // Modal visualizar
  @ViewChild('modalVisualizar') modalVisualizar!: TemplateRef<any>;
  @ViewChild('modalCargarExcel') modalCargarExcel!: TemplateRef<any>;
  @ViewChild('modalGenerarPDF') modalGenerarPDF!: TemplateRef<any>;

  // Generación PDF por lote
  estadoModalPDF: 'configuracion' | 'generando' | 'completado' = 'configuracion';
  plantillaSeleccionada: 'anam' | 'provisional' = 'anam';
  folioInicial: string = '';
  folioInicialLoading: boolean = false;
  progresoGeneracion: number = 0;
  totalAGenerar: number = 0;
  empleadoActualGenerando: string = '';

  // Carga Excel
  archivoExcel: File | null = null;
  cargandoExcel: boolean = false;
  resumenCarga: any = null;
  estadoCargaExcel: 'seleccion' | 'subiendo' | 'completado' = 'seleccion';
  empleadoSeleccionado: any = null;
  esEditable: boolean = false;

  @ViewChild('plantillaModalAnam') plantillaModalAnam!: PlantillaAnamComponent;
  @ViewChild('plantillaModalNuevoLaredo') plantillaModalNuevoLaredo!: ProvisionalComponent;
  @ViewChild('plantillaImprimirAnam') plantillaImprimirAnam!: PlantillaAnamComponent;
  @ViewChild('plantillaImprimirNuevoLaredo') plantillaImprimirNuevoLaredo!: ProvisionalComponent;
  @ViewChild('printContainer') printContainer!: ElementRef;

  empleadoImprimir: any = null;
  fotoFirmaLoading: boolean = false;

  // Estado
  isLoading: boolean = false;
  isRefreshing: boolean = false;
  showColumnPanel: boolean = false;
  totalRecords: number = 0;
  paginationPageSize: number = 50;
  paginationPageSizeSelector = [10, 25, 50, 100, 200];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true,
    minWidth: 100,
    suppressHeaderMenuButton: false,
    headerClass: 'text-center',
    cellStyle: { display: 'flex', alignItems: 'center' }
  };

  constructor(
    private cargaMasivaService: CargaMasivaService,
    private enrolamientoService: EnrolamientoService,
    private fechaMexicoPipe: FechaMexicoPipe,
    private utils: UtilsService,
    public modalManager: ModalManagerService,
    private cdRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.initColumnDefs();
    this.cargarLotes();
  }

  ngOnDestroy(): void {}

  // ─── Formateo de celdas ───────────────────────────────────────────────────

  emptyCellFormatter(params: ValueFormatterParams): string {
    if (params.value === null || params.value === undefined || params.value === '') return '---';
    return params.value;
  }

  getEmptyCellStyle(params: any) {
    if (params.value === null || params.value === undefined || params.value === '') {
      return { color: '#adb5bd', fontStyle: 'italic', fontSize: '0.85rem' };
    }
    return null;
  }

  dateFormatter(params: ValueFormatterParams, mostrarHora: boolean): string {
    if (!params.value) return '---';
    return this.fechaMexicoPipe.transform(params.value, mostrarHora, false);
  }

  // ─── Columnas ─────────────────────────────────────────────────────────────

  initColumnDefs(): void {
    const textCol = (props: ColDef): ColDef => ({
      ...props,
      valueFormatter: (p) => this.emptyCellFormatter(p),
      cellStyle: (p) => {
        const s = this.getEmptyCellStyle(p);
        return s ? { ...s, display: 'flex', alignItems: 'center' } : { display: 'flex', alignItems: 'center' };
      }
    });

    this.columnDefs = [
      textCol({ headerName: 'RFC / CURP', field: 'rfc', width: 180, hide: false, pinned: 'left', lockVisible: true }),
      textCol({ headerName: 'Nombre', field: 'nombre', width: 200, hide: false }),
      textCol({ headerName: 'Lote', field: 'lote', width: 130, hide: false }),
      {
        headerName: 'Foto',
        field: 'has_foto',
        width: 90,
        hide: false,
        cellRenderer: (p: any) => p.value
          ? '<i class="fas fa-check-circle text-success"></i>'
          : '<i class="fas fa-times-circle text-danger"></i>',
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' }
      },
      {
        headerName: 'Firma',
        field: 'has_firma',
        width: 90,
        hide: false,
        cellRenderer: (p: any) => p.value
          ? '<i class="fas fa-check-circle text-success"></i>'
          : '<i class="fas fa-times-circle text-danger"></i>',
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' }
      },
      textCol({ headerName: 'No. Empleado', field: 'no_empleado', width: 140, hide: false }),
      textCol({ headerName: 'CURP', field: 'curp', width: 190, hide: true }),
      textCol({ headerName: 'Área', field: 'area', width: 200, hide: true }),
      textCol({ headerName: 'Cargo', field: 'cargo', width: 200, hide: true }),
      {
        headerName: 'Fecha Enrolamiento',
        field: 'fecha_enrolamiento',
        width: 180,
        hide: false,
        valueFormatter: (p) => this.dateFormatter(p, true),
        filterValueGetter: (p: any) => this.dateFormatter({ value: p.data.fecha_enrolamiento } as any, true)
      },
      textCol({ headerName: 'Folio', field: 'folio', width: 120, hide: true }),
      {
        headerName: 'Fin Vigencia',
        field: 'fin_vig',
        width: 140,
        hide: true,
        valueFormatter: (p) => this.dateFormatter(p, false)
      },
      {
        headerName: 'Acciones',
        field: 'actions',
        pinned: 'right',
        width: 100, minWidth: 100, maxWidth: 100,
        hide: false, lockVisible: true,
        sortable: false, filter: false,
        cellRenderer: (p: any) => this.actionsRenderer(p)
      }
    ];
  }

  actionsRenderer(params: any) {
    return `
      <div class="d-flex gap-2 justify-content-center align-items-center w-100 h-100">
        <span title="Visualizar"><i class="tool-icon fas fa-eye" data-action="view" data-id="${params.data.id}" style="cursor:pointer;"></i></span>
        <span title="Imprimir"><i class="tool-icon fas fa-print" data-action="print" data-id="${params.data.id}" style="cursor:pointer;"></i></span>
      </div>`;
  }

  // ─── Carga Excel ──────────────────────────────────────────────────────────

  abrirModalExcel(): void {
    this.estadoCargaExcel = 'seleccion';
    this.resumenCarga = null;
    this.archivoExcel = null;
    this.modalManager.openModal({
      title: `Cargar Excel — ${this.loteSeleccionado}`,
      template: this.modalCargarExcel,
      showFooter: true,
      width: '580px',
      onAccept: () => { this.modalManager.closeModal(); }
    });
  }

  onArchivoSeleccionado(event: any): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    this.archivoExcel = file;
    this.subirExcel();
  }

  subirExcel(): void {
    if (!this.archivoExcel || !this.loteSeleccionado) return;
    this.estadoCargaExcel = 'subiendo';
    this.cargandoExcel = true;
    this.cdRef.detectChanges();

    this.cargaMasivaService.cargarLoteExcel(this.archivoExcel, this.loteSeleccionado).subscribe({
      next: (res) => {
        this.cargandoExcel = false;
        this.archivoExcel = null;
        this.resumenCarga = res;
        this.estadoCargaExcel = 'completado';
        this.cdRef.detectChanges();
        // Refrescar tabla del lote actual
        this.cargarRegistrosDeLote(this.loteSeleccionado);
        this.cargaMasivaService.obtenerResumenLotes().subscribe({
          next: (lotes) => { this.lotesResumen = lotes; this.cdRef.detectChanges(); }
        });
      },
      error: (err) => {
        this.cargandoExcel = false;
        this.estadoCargaExcel = 'seleccion';
        this.cdRef.detectChanges();
        const msg = err?.error?.error || err?.error?.mensaje || 'Error al cargar el Excel';
        const faltantes = err?.error?.columnas_faltantes;
        if (faltantes?.length) {
          this.utils.MuestrasToast(TipoToast.Error, `Columnas faltantes: ${faltantes.join(', ')}`);
        } else {
          this.utils.MuestrasToast(TipoToast.Error, msg);
        }
      }
    });
  }

  // ─── Lotes ────────────────────────────────────────────────────────────────

  cargarLotes(): void {
    this.cargandoLotes = true;
    this.cargaMasivaService.obtenerResumenLotes().subscribe({
      next: (res) => {
        this.lotesResumen = res;
        this.cargandoLotes = false;
        if (res.length > 0) {
          this.seleccionarLote(res[0].lote);
        }
      },
      error: () => {
        this.cargandoLotes = false;
        this.utils.MuestrasToast(TipoToast.Error, 'Error al cargar lotes');
      }
    });
  }

  seleccionarLote(lote: string): void {
    if (this.loteSeleccionado === lote) return;
    this.loteSeleccionado = lote;
    this.cargarRegistrosDeLote(lote);
  }

  cargarRegistrosDeLote(lote: string): void {
    this.isLoading = true;
    this.cargaMasivaService.obtenerProgresoLote(lote, true).subscribe({
      next: (res) => {
        this.rowData = res.registros || [];
        this.totalRecords = res.total_enrolados;
        this.isLoading = false;
      },
      error: () => {
        this.utils.MuestrasToast(TipoToast.Error, 'Error al cargar registros del lote');
        this.isLoading = false;
      }
    });
  }

  getLoteInfo(lote: string): any {
    return this.lotesResumen.find(l => l.lote === lote) || null;
  }

  // ─── Grid ─────────────────────────────────────────────────────────────────

  onGridReady(params: GridReadyEvent) {
    this.gridApi = params.api;
  }

  refreshGrid(): void {
    if (this.gridApi) {
      this.isRefreshing = true;
      this.gridApi.resetColumnState();
      this.gridApi.setFilterModel(null);
      this.gridApi.onFilterChanged();
    }
    this.cargarLotes();
    setTimeout(() => { this.isRefreshing = false; }, 1000);
  }

  generarExcel(): void {
    this.utils.MuestrasToast(TipoToast.Info, 'Generando archivo excel.');
    if (this.gridApi) {
      const date = new Date();
      const dateStr = `${date.getDate().toString().padStart(2,'0')}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getFullYear()}`;
      const columnKeys = this.gridApi.getAllDisplayedColumns()
        ?.filter((c: any) => c.getColId() !== 'actions')
        .map((c: any) => c.getColId());
      this.gridApi.exportDataAsCsv({
        fileName: `lote_${this.loteSeleccionado}_${dateStr}.csv`,
        columnKeys
      });
    }
  }

  toggleColumnPanel(): void { this.showColumnPanel = !this.showColumnPanel; }
  closeColumnPanel(): void { this.showColumnPanel = false; }

  toggleColumn(field: string): void {
    if (!this.gridApi) return;
    const col = this.gridApi.getColumnState().find(c => c.colId === field);
    if (col) this.gridApi.setColumnsVisible([field], !!col.hide);
  }

  isColumnVisible(field: string): boolean {
    if (!this.gridApi) {
      return !this.columnDefs.find(c => c.field === field)?.hide;
    }
    try {
      const col = this.gridApi.getColumnState().find(c => c.colId === field);
      return col ? !col.hide : false;
    } catch { return true; }
  }

  // ─── Generar PDF por lote ─────────────────────────────────────────────────

  get todosConNumeroEmpleado(): boolean {
    return this.rowData.length > 0 && this.rowData.every(r => r.no_empleado);
  }

  abrirModalGenerarPDF(): void {
    this.estadoModalPDF = 'configuracion';
    this.plantillaSeleccionada = 'anam';
    this.progresoGeneracion = 0;
    this.totalAGenerar = 0;
    this.empleadoActualGenerando = '';
    this.cargarFolioMaximo();
    this.modalManager.openModal({
      title: 'Generar PDF de constancias',
      template: this.modalGenerarPDF,
      showFooter: false,
      width: '580px'
    });
  }

  cargarFolioMaximo(): void {
    this.folioInicialLoading = true;
    const nuevoLaredo = this.plantillaSeleccionada === 'provisional' ? 1 : 0;
    this.enrolamientoService.obtenerFolioMaximo(nuevoLaredo).subscribe({
      next: (res: any) => {
        this.folioInicialLoading = false;
        this.folioInicial = res.siguiente_folio || '000001';
        this.cdRef.detectChanges();
      },
      error: () => {
        this.folioInicialLoading = false;
        this.folioInicial = '000001';
        this.cdRef.detectChanges();
      }
    });
  }

  async generarPDFLote(): Promise<void> {
    if (!this.folioInicial || this.estadoModalPDF === 'generando') return;

    this.estadoModalPDF = 'generando';
    this.progresoGeneracion = 0;
    this.cdRef.detectChanges();

    try {
      // Cargar todos los registros del lote con foto y firma completas
      const progreso = await this.cargaMasivaService
        .obtenerProgresoLote(this.loteSeleccionado, false)
        .toPromise();

      const registros: any[] = progreso?.registros || [];
      this.totalAGenerar = registros.length;

      if (this.totalAGenerar === 0) {
        this.estadoModalPDF = 'configuracion';
        this.utils.MuestrasToast(TipoToast.Warning, 'No hay registros en el lote');
        this.cdRef.detectChanges();
        return;
      }

      const pdfW = 54.0, pdfH = 86.0;
      const pdf = new jsPDF('p', 'mm', [pdfW, pdfH]);
      // skipFonts evita que htmlToImage intente leer reglas CSS de CDNs
      // externos (Google Fonts, Font Awesome) que bloquean por CORS.
      // Los fonts ya están renderizados en el DOM, por lo que el PNG
      // sigue capturando el texto correctamente.
      const imgOptions = { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true };
      const printRoot = this.printContainer?.nativeElement as HTMLElement;
      const esAnam = this.plantillaSeleccionada === 'anam';
      const selector = esAnam ? 'app-plantilla-anam' : 'app-provisional';

      let folioNum = parseInt((this.folioInicial).replace(/\D/g, ''), 10) || 1;
      let primeraImagen = true;

      for (let i = 0; i < registros.length; i++) {
        const reg = registros[i];
        const nombre = [reg.nombres || reg.nombre, reg.primer_apellido, reg.segundo_apellido]
          .filter(Boolean).join(' ').trim();
        this.empleadoActualGenerando = nombre || reg.rfc || `Registro ${i + 1}`;
        this.cdRef.detectChanges();

        const persona = {
          ...this.mapearAEmpleado(reg),
          folio: String(folioNum).padStart(6, '0'),
          nuevo_laredo: esAnam ? 0 : 1,
        };
        folioNum++;

        this.empleadoImprimir = persona;
        this.cdRef.detectChanges();

        // Esperar a que el componente renderice y el QR se genere
        await new Promise(r => setTimeout(r, 800));

        const plantilla = esAnam ? this.plantillaImprimirAnam : this.plantillaImprimirNuevoLaredo;
        if (!plantilla) continue;

        // — Frente —
        plantilla.vistaCredencial = 'frente';
        this.cdRef.detectChanges();
        await new Promise(r => setTimeout(r, 400));

        const elFrente = printRoot?.querySelector(`${selector} .credencial-frente`) as HTMLElement;
        if (elFrente) {
          const imgFrente = await htmlToImage.toPng(elFrente, imgOptions);
          if (!primeraImagen) pdf.addPage();
          pdf.addImage(imgFrente, 'PNG', 0, 0, pdfW, pdfH, '', 'FAST');
          primeraImagen = false;
        }

        // — Reverso —
        plantilla.vistaCredencial = 'reverso';
        this.cdRef.detectChanges();
        await new Promise(r => setTimeout(r, 400));

        const elReverso = printRoot?.querySelector(`${selector} .credencial-reverso`) as HTMLElement;
        if (elReverso) {
          pdf.addPage();
          const imgReverso = await htmlToImage.toPng(elReverso, imgOptions);
          pdf.addImage(imgReverso, 'PNG', 0, 0, pdfW, pdfH, '', 'FAST');
        }

        this.progresoGeneracion = Math.round(((i + 1) / this.totalAGenerar) * 100);
        this.cdRef.detectChanges();
      }

      this.empleadoImprimir = null;
      const folioFinal = String(folioNum - 1).padStart(6, '0');
      pdf.save(`Constancias_${this.loteSeleccionado}_${this.folioInicial}-${folioFinal}.pdf`);

      this.estadoModalPDF = 'completado';
      this.cdRef.detectChanges();

    } catch (e) {
      console.error('Error en generarPDFLote:', e);
      this.empleadoImprimir = null;
      this.estadoModalPDF = 'configuracion';
      this.utils.MuestrasToast(TipoToast.Error, 'Error al generar el PDF de constancias');
      this.cdRef.detectChanges();
    }
  }

  onCellClicked(event: any): void {
    const target = event.event.target;
    if (target?.dataset?.action) {
      this.handleAction(target.dataset.action, event.data);
    }
  }

  handleAction(action: string, rowData: any): void {
    if (action === 'view') this.visualizarRegistro(rowData);
    else if (action === 'print') this.imprimirRegistro(rowData);
  }

  // ─── Visualizar / Imprimir ────────────────────────────────────────────────

  visualizarRegistro(registro: any): void {
    this.fotoFirmaLoading = true;
    this.cargaMasivaService.obtenerRegistro(registro.id).subscribe({
      next: (res) => {
        this.fotoFirmaLoading = false;
        this.empleadoSeleccionado = this.mapearAEmpleado(res);
        this.esEditable = false;
        this.modalManager.openModal({
          title: `Registro — ${registro.rfc}`,
          template: this.modalVisualizar,
          width: '420px',
          showFooter: false
        });
      },
      error: () => {
        this.fotoFirmaLoading = false;
        this.empleadoSeleccionado = this.mapearAEmpleado(registro);
        this.esEditable = false;
        this.modalManager.openModal({
          title: `Registro — ${registro.rfc}`,
          template: this.modalVisualizar,
          width: '420px',
          showFooter: false
        });
      }
    });
  }

  private mapearAEmpleado(r: any): any {
    return {
      ...r,
      // Mapeo de campos carga masiva → campos que esperan las plantillas
      num_empleado: r.no_empleado || r.empleado_anam || r.rfc,
      nombre: r.nombres || r.nombre || '',
      paterno: r.primer_apellido || '',
      materno: r.segundo_apellido || '',
      adscripcion: r.area || '',
      puesto: r.cargo || '',
      // Campos de credencial
      tipo_credencial: r.nuevo_laredo === 1 ? 'provisional' : 'anam',
      source_table: 'enrolamiento',
      nuevo_laredo: r.nuevo_laredo || 0,
      provisional: 1,
    };
  }

  esCredencialFamiliar(p: any): boolean { return false; }

  esCredencialAnam(p: any): boolean {
    return !p || Number(p?.nuevo_laredo || 0) !== 1;
  }

  private obtenerPlantillaModalActiva(): any {
    if (this.esCredencialAnam(this.empleadoSeleccionado)) return this.plantillaModalAnam;
    return this.plantillaModalNuevoLaredo;
  }

  guardarCambios(): void {
    this.obtenerPlantillaModalActiva()?.guardarEnrolamiento?.();
  }

  onEnrolamientoCompletado(): void {
    this.modalManager.closeModal();
    if (this.loteSeleccionado) this.cargarRegistrosDeLote(this.loteSeleccionado);
  }

  async imprimirRegistro(registro: any): Promise<void> {
    this.fotoFirmaLoading = true;
    this.cargaMasivaService.obtenerRegistro(registro.id).subscribe({
      next: async (res) => {
        this.fotoFirmaLoading = false;
        await this.generarPDF(this.mapearAEmpleado(res));
      },
      error: async () => {
        this.fotoFirmaLoading = false;
        await this.generarPDF(this.mapearAEmpleado(registro));
      }
    });
  }

  private async generarPDF(persona: any): Promise<void> {
    this.utils.MuestrasToast(TipoToast.Info, 'Generando PDF...');
    this.empleadoImprimir = persona;

    setTimeout(async () => {
      try {
        const pdfW = 54.0, pdfH = 86.0;
        const pdf = new jsPDF('p', 'mm', [pdfW, pdfH]);
        const options = { pixelRatio: 2, backgroundColor: '#ffffff' };
        const selector = this.esCredencialAnam(persona) ? 'app-plantilla-anam' : 'app-provisional';
        const printRoot = this.printContainer?.nativeElement as HTMLElement;

        const plantilla = this.esCredencialAnam(persona) ? this.plantillaImprimirAnam : this.plantillaImprimirNuevoLaredo;

        await new Promise(r => setTimeout(r, 700));

        if (plantilla) {
          plantilla.vistaCredencial = 'frente';
          await new Promise(r => setTimeout(r, 400));
          const elFrente = printRoot?.querySelector(`${selector} .credencial-frente`) as HTMLElement;
          if (elFrente) {
            const img = await htmlToImage.toPng(elFrente, options);
            pdf.addImage(img, 'PNG', 0, 0, pdfW, pdfH, '', 'FAST');
          }

          plantilla.vistaCredencial = 'reverso';
          await new Promise(r => setTimeout(r, 400));
          const elReverso = printRoot?.querySelector(`${selector} .credencial-reverso`) as HTMLElement;
          if (elReverso) {
            pdf.addPage();
            const img = await htmlToImage.toPng(elReverso, options);
            pdf.addImage(img, 'PNG', 0, 0, pdfW, pdfH, '', 'FAST');
          }
        }

        pdf.save(`Constancia_${persona.rfc || persona.num_empleado}.pdf`);
        this.utils.MuestrasToast(TipoToast.Success, 'PDF generado correctamente');
      } catch (e) {
        console.error(e);
        this.utils.MuestrasToast(TipoToast.Error, 'Error al generar PDF');
      } finally {
        this.empleadoImprimir = null;
      }
    }, 500);
  }
}
