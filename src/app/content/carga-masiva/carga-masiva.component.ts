import { Component, OnInit, ViewChild, TemplateRef, HostListener } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { UtilsService } from '../../services/utils.service';
import { TipoToast } from '../../../api/entidades/enumeraciones';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { CargaMasivaService } from '../../services/carga-masiva.service';

@Component({
  selector: 'app-carga-masiva',
  standalone: false,
  templateUrl: './carga-masiva.component.html',
  styleUrl: './carga-masiva.component.scss'
})
export class CargaMasivaComponent implements OnInit {
  Math = Math;

  // Lotes disponibles
  lotes: any[] = [];
  loteSeleccionado: string = '';
  lotesLoading: boolean = false;

  // Tabla registros del lote
  registros: any[] = [];
  registrosTotal: number = 0;
  registrosPage: number = 1;
  registrosPageSize: number = 10;
  pageSizeOptions: number[] = [5, 10, 25, 50, 100];
  registrosTotalPages: number = 0;
  registrosVisiblePages: number[] = [];
  registrosLoading: boolean = false;
  searchTerm: string = '';
  private searchTimeout: any = null;

  // Columnas visibles
  columnasConfig = [
    { key: 'empleado_anam',    label: 'Empleado ANAM',    visible: true  },
    { key: 'no_empleado',      label: 'No. Empleado',     visible: true  },
    { key: 'curp',             label: 'CURP',             visible: true  },
    { key: 'nombres',          label: 'Nombres',          visible: true  },
    { key: 'primer_apellido',  label: 'Primer Apellido',  visible: true  },
    { key: 'segundo_apellido', label: 'Segundo Apellido', visible: true  },
    { key: 'area',             label: 'Área',             visible: true  },
    { key: 'cargo',            label: 'Cargo',            visible: true  },
    { key: 'fecha_expedicion', label: 'Fecha Expedición', visible: true  },
    { key: 'firma_drh',        label: 'Firma DRH',        visible: false },
    { key: 'cargo_drh',        label: 'Cargo DRH',        visible: false },
    { key: 'qr',               label: 'QR',               visible: false },
    { key: 'estatus',          label: 'Estatus',          visible: true  },
    { key: 'estado_hum',       label: 'Estado HUM',       visible: false },
    { key: 'estado_nom',       label: 'Estado NOM',       visible: false },
  ];
  mostrarMenuColumnas: boolean = false;

  // Upload
  subiendoRegistros: boolean = false;
  archivoSeleccionado: File | null = null;
  resumenCarga: any = null;

  @ViewChild('modalConfirmacion') modalConfirmacion!: TemplateRef<any>;
  @ViewChild('modalResumen') modalResumen!: TemplateRef<any>;

  private apiUrl = '/api/carga-masiva/';

  constructor(
    private http: HttpClient,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private cargaMasivaService: CargaMasivaService
  ) {}

  ngOnInit(): void {
    this.cargarLotes();
  }

  // ── Lotes ──────────────────────────────────────────────────────────────────
  cargarLotes() {
    this.lotesLoading = true;
    this.cargaMasivaService.obtenerResumenLotes().subscribe(
      (res: any[]) => {
        this.lotesLoading = false;
        this.lotes = res;
      },
      (error) => {
        this.lotesLoading = false;
        this.utils.MuestraErrorInterno(error);
      }
    );
  }

  seleccionarLote(lote: string) {
    this.loteSeleccionado = lote;
    this.searchTerm = '';
    this.cargarRegistros(1);
  }

  // ── Tabla registros ────────────────────────────────────────────────────────
  cargarRegistros(page: number = 1) {
    if (!this.loteSeleccionado) return;
    this.registrosLoading = true;
    this.registrosPage = page;
    const params: any = { lote: this.loteSeleccionado, page, page_size: this.registrosPageSize };
    if (this.searchTerm.trim()) params.search = this.searchTerm.trim();

    this.http.get(this.apiUrl, { params }).subscribe(
      (res: any) => {
        this.registrosLoading = false;
        this.registros = res.results || [];
        this.registrosTotal = res.count || 0;
        this.registrosTotalPages = Math.ceil(this.registrosTotal / this.registrosPageSize);
        this.updateVisiblePages();
      },
      (error) => {
        this.registrosLoading = false;
        this.utils.MuestraErrorInterno(error);
      }
    );
  }

  buscarRegistros() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.cargarRegistros(1), 400);
  }

  prevPage() { if (this.registrosPage > 1) this.cargarRegistros(this.registrosPage - 1); }
  nextPage() { if (this.registrosPage < this.registrosTotalPages) this.cargarRegistros(this.registrosPage + 1); }
  goToPage(page: number) { this.cargarRegistros(page); }
  changePageSize() { this.registrosPageSize = Number(this.registrosPageSize); this.cargarRegistros(1); }

  updateVisiblePages() {
    const total = this.registrosTotalPages;
    const current = this.registrosPage;
    const visibleCount = 5;
    let start = Math.max(current - Math.floor(visibleCount / 2), 1);
    let end = Math.min(start + visibleCount - 1, total);
    start = Math.max(end - visibleCount + 1, 1);
    this.registrosVisiblePages = [];
    for (let i = start; i <= end; i++) this.registrosVisiblePages.push(i);
  }

  get columnasVisibles() {
    return this.columnasConfig.filter(c => c.visible);
  }

  toggleMenuColumnas(event: MouseEvent) {
    event.stopPropagation();
    this.mostrarMenuColumnas = !this.mostrarMenuColumnas;
  }

  @HostListener('document:click')
  cerrarMenuColumnas() {
    this.mostrarMenuColumnas = false;
  }

  getCellValue(registro: any, key: string): string {
    if (key === 'fecha_expedicion') return this.formatearFecha(registro[key]);
    return registro[key] || 'N/A';
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    // Reset input para permitir seleccionar el mismo archivo nuevamente
    event.target.value = '';
    if (!this.loteSeleccionado) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Seleccione un lote antes de cargar el Excel');
      return;
    }
    this.archivoSeleccionado = file;
    this.modalManager.openModal({
      title: 'Confirmar carga Excel',
      template: this.modalConfirmacion,
      showFooter: true,
      onAccept: () => { this.ejecutarSubida(); }
    });
  }

  ejecutarSubida() {
    if (!this.archivoSeleccionado || !this.loteSeleccionado) return;
    this.subiendoRegistros = true;
    const formData = new FormData();
    formData.append('archivo', this.archivoSeleccionado);
    formData.append('lote', this.loteSeleccionado);

    this.http.post(`${this.apiUrl}cargar-lote-excel/`, formData).subscribe(
      (response: any) => {
        this.subiendoRegistros = false;
        this.archivoSeleccionado = null;
        this.resumenCarga = response;
        this.cargarRegistros(1);
        this.cargarLotes();
        setTimeout(() => {
          this.modalManager.openModal({
            title: 'Resumen de carga Excel',
            template: this.modalResumen,
            showFooter: true,
            width: '620px'
          });
        }, 100);
      },
      (error) => {
        this.subiendoRegistros = false;
        this.archivoSeleccionado = null;
        this.utils.MuestraErrorInterno(error);
      }
    );
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────
  formatearFecha(fecha: string): string {
    if (!fecha) return 'N/A';
    try {
      const date = new Date(fecha);
      const dia = String(date.getDate()).padStart(2, '0');
      const mes = String(date.getMonth() + 1).padStart(2, '0');
      const anio = date.getFullYear();
      return `${dia}/${mes}/${anio}`;
    } catch { return fecha; }
  }
}
