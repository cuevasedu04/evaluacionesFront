import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { CursoService } from '../../services/curso.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import { Curso, claseEstado, cursoVacio, etiquetaEstado } from './curso.const';

/**
 * Pantalla de entrada de "Cursos": lo ya creado y el botón para empezar uno.
 *
 * El armado (asignar constancia, correo y cuestionario, cargar
 * participantes, configurar tiempos) ocurre en CursoDetalleComponent.
 */
@Component({
  standalone: false,
  selector: 'app-cursos-lista',
  templateUrl: './cursos-lista.component.html',
  styleUrls: ['./cursos-lista.component.scss'],
})
export class CursosListaComponent implements OnInit {

  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;
  @ViewChild('nuevoDialog') nuevoDialog!: TemplateRef<any>;

  cursos: Curso[] = [];
  cargando = false;
  creando = false;
  busqueda = '';
  confirmMessage = '';

  nombreNuevo = '';

  private cursoAEliminar: Curso | null = null;

  constructor(
    private api: CursoService,
    private router: Router,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    public permisosS: PermisosService,
  ) { }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.api.listar().subscribe({
      next: (res) => {
        this.cursos = Array.isArray(res) ? res : (res?.results || []);
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.cursos = [];
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get cursosFiltrados(): Curso[] {
    const termino = this.busqueda.trim().toLowerCase();
    if (!termino) return this.cursos;
    return this.cursos.filter((c) =>
      (c.nombre || '').toLowerCase().includes(termino) ||
      (c.descripcion || '').toLowerCase().includes(termino));
  }

  // ---- Métricas del encabezado ----
  get totalAbiertos(): number {
    return this.cursos.filter((c) => c.estado === 'abierto').length;
  }
  get totalBorradores(): number {
    return this.cursos.filter((c) => c.estado === 'borrador' || c.estado === 'listo').length;
  }
  get totalCerrados(): number {
    return this.cursos.filter((c) => c.estado === 'cerrado' || c.estado === 'constancias_enviadas').length;
  }

  etiqueta(curso: Curso): string { return etiquetaEstado(curso.estado); }
  clase(curso: Curso): string { return claseEstado(curso.estado); }

  // ====================================================================
  // Acciones
  // ====================================================================

  abrirNuevo(): void {
    this.nombreNuevo = '';
    this.modalManager.openModal({
      title: 'Nuevo curso',
      template: this.nuevoDialog,
      onAccept: () => this.crear(),
    });
  }

  private crear(): void {
    const nombre = this.nombreNuevo.trim();
    if (!nombre) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Ponle un nombre al curso.');
      return;
    }
    if (this.creando) return;

    this.creando = true;
    this.api.crear({ ...cursoVacio(), nombre }).subscribe({
      next: (res) => {
        this.creando = false;
        this.router.navigate(['/cursos', res.id_curso]);
      },
      error: (err) => {
        this.creando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  abrir(curso: Curso): void {
    this.router.navigate(['/cursos', curso.id_curso]);
  }

  confirmarEliminar(curso: Curso, evento: MouseEvent): void {
    evento.stopPropagation();
    this.cursoAEliminar = curso;
    this.confirmMessage =
      `¿Eliminar el curso «${curso.nombre}»? Se pierden también sus participantes y sus respuestas. Esta acción no se puede deshacer.`;

    this.modalManager.openModal({
      title: 'Eliminar curso',
      template: this.confirmDialog,
      onAccept: () => this.eliminar(),
    });
  }

  private eliminar(): void {
    const curso = this.cursoAEliminar;
    if (!curso?.id_curso) return;

    this.api.eliminar(curso.id_curso).subscribe({
      next: () => {
        this.cursoAEliminar = null;
        this.utils.MuestrasToast(TipoToast.Success, 'Curso eliminado.');
        this.cargar();
      },
      error: (err) => {
        this.cursoAEliminar = null;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }
}
