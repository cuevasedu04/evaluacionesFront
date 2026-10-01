import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { FormularioService } from '../../services/formulario.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import { Formulario, temaPorClave, formularioVacio } from './formulario.const';

/**
 * Pantalla de entrada de "Formularios": la lista de lo ya creado y el botón
 * para empezar uno nuevo. El diseño de las preguntas ocurre en
 * FormularioEditorComponent (/formularios/editor/:id).
 *
 * "Nuevo formulario" crea la fila en el backend ANTES de navegar al editor,
 * en vez de abrir un editor en blanco que guarde al final: el editor
 * autoguarda mientras se escribe, y para autoguardar necesita un id. Así
 * nunca existe el estado "llevo veinte preguntas escritas y todavía no hay
 * nada en la base de datos".
 */
@Component({
  standalone: false,
  selector: 'app-formularios-lista',
  templateUrl: './formularios-lista.component.html',
  styleUrls: ['./formularios-lista.component.scss'],
})
export class FormulariosListaComponent implements OnInit {

  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  formularios: Formulario[] = [];
  cargando = false;
  creando = false;
  busqueda = '';
  confirmMessage = '';

  private formularioAEliminar: Formulario | null = null;

  constructor(
    private api: FormularioService,
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
        this.formularios = Array.isArray(res) ? res : (res?.results || []);
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.formularios = [];
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get formulariosFiltrados(): Formulario[] {
    const termino = this.busqueda.trim().toLowerCase();
    if (!termino) return this.formularios;
    return this.formularios.filter((f) =>
      (f.titulo || '').toLowerCase().includes(termino) ||
      (f.descripcion || '').toLowerCase().includes(termino));
  }

  colorTema(formulario: Formulario): string {
    return temaPorClave(formulario.configuracion?.tema || 'institucional').color;
  }

  // ====================================================================
  // Acciones
  // ====================================================================

  nuevoFormulario(): void {
    if (this.creando) return;
    this.creando = true;

    this.api.crear(formularioVacio()).subscribe({
      next: (res) => {
        this.creando = false;
        this.router.navigate(['/formularios/editor', res.id_formulario]);
      },
      error: (err) => {
        this.creando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  abrir(formulario: Formulario): void {
    this.router.navigate(['/formularios/editor', formulario.id_formulario]);
  }

  duplicar(formulario: Formulario, evento: MouseEvent): void {
    evento.stopPropagation();
    if (!formulario.id_formulario) return;

    this.api.duplicar(formulario.id_formulario).subscribe({
      next: () => {
        this.utils.MuestrasToast(TipoToast.Success, 'Formulario duplicado.');
        this.cargar();
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  confirmarEliminar(formulario: Formulario, evento: MouseEvent): void {
    evento.stopPropagation();
    this.formularioAEliminar = formulario;
    this.confirmMessage =
      `¿Eliminar el formulario «${formulario.titulo}»? Se pierden también sus preguntas. Esta acción no se puede deshacer.`;

    this.modalManager.openModal({
      title: 'Eliminar formulario',
      template: this.confirmDialog,
      onAccept: () => this.eliminar(),
    });
  }

  private eliminar(): void {
    const formulario = this.formularioAEliminar;
    if (!formulario?.id_formulario) return;

    this.api.eliminar(formulario.id_formulario).subscribe({
      next: () => {
        this.formularioAEliminar = null;
        this.utils.MuestrasToast(TipoToast.Success, 'Formulario eliminado.');
        this.cargar();
      },
      error: (err) => {
        this.formularioAEliminar = null;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }
}
