import { AfterViewInit, Component, ElementRef, TemplateRef, ViewChild } from '@angular/core';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { CorreoService, PlantillaCorreo } from '../../services/correo.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';

/** Token que se sustituye por el nombre real del curso al momento de enviar (ver GeneradorMasivoComponent.enviarPorCorreo). */
export const VARIABLE_NOMBRE_CURSO = '{{nombre_curso}}';

const CUERPO_POR_DEFECTO = `
  <p>Estimado(a):</p>
  <p>Se adjunta tu constancia del curso <strong>${VARIABLE_NOMBRE_CURSO}</strong>.</p>
  <p>Saludos.</p>
`;

/** Tamaños de fuente que expone el editor -- mapeados a la escala clasica (1-7) de document.execCommand('fontSize'). */
const TAMANOS_FUENTE = [
  { valor: '2', label: 'Pequeña' },
  { valor: '3', label: 'Normal' },
  { valor: '4', label: 'Mediana' },
  { valor: '5', label: 'Grande' },
  { valor: '6', label: 'Muy grande' },
];

const FUENTES = ['Arial', 'Calibri', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'];

/**
 * "Correo electrónico": CRUD de plantillas con las que se envían las
 * constancias (nombre, asunto, cuerpo con formato tipo Outlook, y desde qué
 * buzón salen) -- ver PlantillaCorreo en el backend. Puede haber varias
 * (para distintos cursos/avisos); "Generador masivo" elige cuál usar al
 * enviar, igual que ya elige qué PlantillaCredencial imprimir.
 *
 * El editor de cuerpo es un `contenteditable` con `document.execCommand`
 * (negritas/cursiva/subrayado/fuente/tamaño/color/alineación/listas): no se
 * agregó ninguna librería de edición enriquecida nueva, execCommand cubre
 * el mismo set basico que trae el compositor de Outlook y no añade
 * dependencias. Si en el futuro hace falta algo más avanzado (deshacer más
 * robusto, tablas, etc.) valdría la pena evaluar una librería dedicada.
 */
@Component({
  standalone: false,
  selector: 'app-correo-electronico',
  templateUrl: './correo-electronico.component.html',
  styleUrls: ['./correo-electronico.component.scss'],
})
export class CorreoElectronicoComponent implements AfterViewInit {

  @ViewChild('cuerpoEditable') cuerpoRef!: ElementRef<HTMLDivElement>;
  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  readonly tamanosFuente = TAMANOS_FUENTE;
  readonly fuentes = FUENTES;
  readonly variableNombreCurso = VARIABLE_NOMBRE_CURSO;

  // ---- Lista de plantillas guardadas ----
  plantillas: PlantillaCorreo[] = [];
  cargandoLista = false;
  plantillaActual: PlantillaCorreo | null = null;

  // ---- Formulario (plantilla en edicion, nueva o existente) ----
  nombre = '';
  asunto = 'Constancia de evaluación';
  cuentaRemitente = '';
  guardando = false;
  eliminando = false;
  hayCambios = false;
  confirmMessage = '';
  descargandoAgente = false;

  /** Ultima seleccion de texto dentro del cuerpo, para poder insertar la variable en ese mismo punto aunque el foco haya salido del editor (p.ej. al hacer clic en el boton). */
  private rangoGuardado: Range | null = null;

  constructor(
    private correoApi: CorreoService,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    public permisosS: PermisosService,
  ) { }

  ngAfterViewInit(): void {
    this.cargarLista(true);
  }

  // ====================================================================
  // Lista de plantillas
  // ====================================================================

  cargarLista(seleccionarPrimera: boolean): void {
    this.cargandoLista = true;
    this.correoApi.listarPlantillas().subscribe({
      next: (res) => {
        this.plantillas = Array.isArray(res) ? res : (res?.results || []);
        this.cargandoLista = false;
        if (seleccionarPrimera && this.plantillas.length) {
          this.seleccionarPlantilla(this.plantillas[0]);
        } else if (!this.plantillas.length) {
          this.nuevaPlantilla();
        }
      },
      error: () => {
        this.cargandoLista = false;
        this.plantillas = [];
        this.nuevaPlantilla();
      },
    });
  }

  seleccionarPlantilla(plantilla: PlantillaCorreo): void {
    this.plantillaActual = plantilla;
    this.nombre = plantilla.nombre;
    this.asunto = plantilla.asunto;
    this.cuentaRemitente = plantilla.cuenta_remitente || '';
    if (this.cuerpoRef) {
      this.cuerpoRef.nativeElement.innerHTML = plantilla.cuerpo_html?.trim() || CUERPO_POR_DEFECTO;
    }
    this.hayCambios = false;
  }

  /** Limpia el formulario para capturar una plantilla nueva -- no toca la lista hasta que se guarde. */
  nuevaPlantilla(): void {
    this.plantillaActual = null;
    this.nombre = '';
    this.asunto = 'Constancia de evaluación';
    this.cuentaRemitente = '';
    if (this.cuerpoRef) {
      this.cuerpoRef.nativeElement.innerHTML = CUERPO_POR_DEFECTO;
    }
    this.hayCambios = false;
  }

  // ====================================================================
  // Editor de cuerpo (contenteditable + execCommand)
  // ====================================================================

  marcarCambio(): void {
    this.hayCambios = true;
  }

  /** Guarda la seleccion actual para poder restaurarla despues (p.ej. al insertar la variable desde un boton, que le quita el foco al editor). */
  guardarSeleccion(): void {
    const seleccion = window.getSelection();
    if (seleccion && seleccion.rangeCount > 0 && this.cuerpoRef?.nativeElement.contains(seleccion.anchorNode)) {
      this.rangoGuardado = seleccion.getRangeAt(0).cloneRange();
    }
  }

  private restaurarSeleccion(): void {
    const el = this.cuerpoRef?.nativeElement;
    if (!el) return;
    el.focus();

    const seleccion = window.getSelection();
    if (!seleccion) return;
    seleccion.removeAllRanges();

    if (this.rangoGuardado && el.contains(this.rangoGuardado.startContainer)) {
      seleccion.addRange(this.rangoGuardado);
      return;
    }

    // Sin seleccion previa util: insertar/aplicar al final del cuerpo.
    const rango = document.createRange();
    rango.selectNodeContents(el);
    rango.collapse(false);
    seleccion.addRange(rango);
  }

  comando(nombre: string, valor?: string): void {
    this.restaurarSeleccion();
    document.execCommand(nombre, false, valor);
    this.guardarSeleccion();
    this.marcarCambio();
  }

  insertarVariableNombreCurso(): void {
    this.restaurarSeleccion();
    document.execCommand('insertText', false, VARIABLE_NOMBRE_CURSO);
    this.guardarSeleccion();
    this.marcarCambio();
  }

  // ====================================================================
  // Cuenta remitente
  // ====================================================================

  get cuentaRemitenteValida(): boolean {
    const valor = (this.cuentaRemitente || '').trim();
    return !valor || /^[^\s@]+@anam\.gob\.mx$/i.test(valor);
  }

  // ====================================================================
  // Guardar / eliminar
  // ====================================================================

  guardar(): void {
    if (!this.nombre.trim()) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Ponle un nombre a la plantilla.');
      return;
    }
    const cuenta = (this.cuentaRemitente || '').trim();
    if (cuenta && !this.cuentaRemitenteValida) {
      this.utils.MuestrasToast(TipoToast.Warning, 'La cuenta remitente debe ser un correo @anam.gob.mx.');
      return;
    }

    this.guardando = true;
    const payload: PlantillaCorreo = {
      nombre: this.nombre.trim(),
      asunto: this.asunto,
      cuerpo_html: this.cuerpoRef?.nativeElement.innerHTML || '',
      cuenta_remitente: cuenta,
    };

    const peticion$ = this.plantillaActual?.id_plantilla_correo
      ? this.correoApi.actualizarPlantilla(this.plantillaActual.id_plantilla_correo, payload)
      : this.correoApi.crearPlantilla(payload);

    peticion$.subscribe({
      next: (res) => {
        this.guardando = false;
        this.hayCambios = false;
        this.plantillaActual = res;
        this.utils.MuestrasToast(TipoToast.Success, 'Plantilla de correo guardada.');
        this.cargarLista(false);
      },
      error: (err) => {
        this.guardando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  confirmarEliminar(): void {
    if (!this.plantillaActual?.id_plantilla_correo) return;
    this.confirmMessage = `¿Eliminar la plantilla «${this.plantillaActual.nombre}»? Esta acción no se puede deshacer.`;

    this.modalManager.openModal({
      title: 'Eliminar plantilla de correo',
      template: this.confirmDialog,
      onAccept: () => this.eliminar(),
    });
  }

  private eliminar(): void {
    if (!this.plantillaActual?.id_plantilla_correo) return;
    this.eliminando = true;

    this.correoApi.eliminarPlantilla(this.plantillaActual.id_plantilla_correo).subscribe({
      next: () => {
        this.eliminando = false;
        this.utils.MuestrasToast(TipoToast.Success, 'Plantilla eliminada.');
        this.cargarLista(true);
      },
      error: (err) => {
        this.eliminando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  // ====================================================================
  // Agente de correo (instalador)
  // ====================================================================

  descargarAgente(): void {
    this.descargandoAgente = true;
    this.correoApi.descargarAgente().subscribe({
      next: (blob) => {
        this.descargandoAgente = false;
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = 'AgenteCorreoANAM.exe';
        enlace.click();
        URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.descargandoAgente = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }
}
