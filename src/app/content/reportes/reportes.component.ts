import { Component, OnInit, ViewChild, TemplateRef } from '@angular/core';
import { UtilsService } from '../../services/utils.service';
import { TipoToast } from '../../../api/entidades/enumeraciones';
import { EnrolamientoService } from '../../services/enrolamiento.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';

@Component({
  selector: 'app-reportes',
  standalone: false,
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss'
})
export class ReportesComponent implements OnInit {
  startDate: string = '';
  endDate: string = '';
  
  // Estadísticas de credenciales
  estadisticas: any = null;
  totalCredenciales: number = 0;
  credencialesCompletas: number = 0;
  credencialesImpresas: number = 0;
  credencialesPendientes: number = 0;
  credencialesIncompletas: number = 0;
  credencialesImpresasHoy: number = 0;
  
  porcentajeImpresas: number = 0;
  porcentajeCompletas: number = 0;
  porcentajePendientes: number = 0;
  
  // Detalles para modales
  detallePendientes: any[] = [];
  detalleIncompletas: any[] = [];
  porAdscripcion: any[] = [];
  
  cargando: boolean = false;
  reporteCargado: boolean = false;

  @ViewChild('modalDetalle') modalDetalle!: TemplateRef<any>;
  tituloModal: string = '';
  datosModal: any[] = [];

  constructor(
    private enrolamientoService: EnrolamientoService,
    private utils: UtilsService,
    private modalManager: ModalManagerService
  ) {}

  ngOnInit(): void {
    this.cargarEstadisticas();
  }

  applyFilter(): void {
    if (this.startDate && this.endDate) {
      if (new Date(this.startDate) > new Date(this.endDate)) {
        this.utils.MuestrasToast(TipoToast.Warning, 'La fecha de inicio debe ser menor a la fecha fin');
        return;
      }
    }
    this.cargarEstadisticas();
  }

  clearFilter(): void {
    this.startDate = '';
    this.endDate = '';
    this.cargarEstadisticas();
  }

  cargarEstadisticas(): void {
    this.cargando = true;
    
    this.enrolamientoService.obtenerEstadisticas(this.startDate, this.endDate).subscribe({
      next: (response: any) => {
        if (response.status === 'success') {
          this.estadisticas = response;
          this.totalCredenciales = response.totales.total_credenciales;
          this.credencialesCompletas = response.totales.credenciales_completas;
          this.credencialesImpresas = response.totales.credenciales_impresas;
          this.credencialesPendientes = response.totales.credenciales_pendientes;
          this.credencialesIncompletas = response.totales.credenciales_incompletas;
          this.credencialesImpresasHoy = response.hoy.credenciales_impresas_hoy;
          
          this.porcentajeImpresas = response.porcentajes.porcentaje_impresas;
          this.porcentajeCompletas = response.porcentajes.porcentaje_completas;
          this.porcentajePendientes = response.porcentajes.porcentaje_pendientes;
          
          this.detallePendientes = response.detalle_pendientes || [];
          this.detalleIncompletas = response.detalle_incompletas || [];
          this.porAdscripcion = response.por_adscripcion || [];
          
          this.reporteCargado = true;
        }
        this.cargando = false;
      },
      error: (error) => {
        console.error('Error al cargar estadísticas:', error);
        this.utils.MuestrasToast(TipoToast.Error, 'No se pudieron cargar las estadísticas');
        this.cargando = false;
      }
    });
  }

  abrirModalDetalle(tipo: string): void {
    if (tipo === 'pendientes') {
      this.tituloModal = 'Constancias Pendientes de Imprimir';
      this.datosModal = this.detallePendientes;
    } else if (tipo === 'incompletas') {
      this.tituloModal = 'Constancias Incompletas (sin foto o firma)';
      this.datosModal = this.detalleIncompletas;
    }

    if (this.datosModal.length === 0) {
      this.utils.MuestrasToast(TipoToast.Info, 'No hay registros para mostrar');
      return;
    }

    this.modalManager.openModal({
      title: this.tituloModal,
      template: this.modalDetalle,
      showFooter: false,
      width: '400px'
    });
  }
}
