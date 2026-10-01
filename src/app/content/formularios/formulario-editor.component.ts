import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { FormularioService } from '../../services/formulario.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import {
  ConfiguracionFormulario, Formulario, OpcionPregunta, Pregunta, TipoPregunta,
  TIPOS_ARCHIVO_PERMITIDOS, TIPOS_BLOQUE_NO_PREGUNTA, TIPOS_CON_OPCIONES,
  TIPOS_CON_OTRO, TIPOS_CUADRICULA, TIPOS_PREGUNTA, TIPOS_TEXTO_LIBRE, TEMAS,
  aplicarDefaultsDeTipo, definicionTipo, normalizarFormulario, normalizarPregunta,
  nuevaOpcion, nuevaPregunta, nuevoId, temaPorClave, esTipoCalificable, puntajeTotal,
} from './formulario.const';

/** Milisegundos de inactividad antes de guardar. Suficiente para no mandar un PATCH por tecla, corto para que "Guardando..." aparezca mientras la persona sigue en la misma pregunta. */
const RETARDO_AUTOGUARDADO = 1200;

/** Snapshots de deshacer/rehacer. Cada uno es el formulario completo en JSON; 50 caben de sobra en memoria y cubren una sesión larga de edición. */
const MAX_HISTORIAL = 50;

/**
 * Editor de formularios: el equivalente interno del constructor de Google
 * Forms. Se llega aquí desde /formularios (la lista) y el formulario ya
 * existe en la base de datos -- este componente nunca crea uno.
 *
 * Todo el estado vive en `formulario` (un solo objeto) y se guarda completo
 * en cada autoguardado, no pregunta por pregunta: ver el comentario del
 * modelo `Formulario` en el backend sobre por qué las preguntas son un
 * documento JSON y no filas con FK. Eso es justo lo que hace baratos el
 * arrastrar-y-soltar y el deshacer/rehacer: reordenar es mover un elemento
 * de un arreglo, y deshacer es reemplazar el objeto por un snapshot previo.
 */
@Component({
  standalone: false,
  selector: 'app-formulario-editor',
  templateUrl: './formulario-editor.component.html',
  styleUrls: ['./formulario-editor.component.scss'],
})
export class FormularioEditorComponent implements OnInit, OnDestroy {

  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  /**
   * Distancia en px desde arriba del todo hasta la barra flotante de
   * insertar (◉ pregunta / título / imagen / video / sección), a la
   * derecha de la pantalla.
   *
   * Es un número fijo A PROPÓSITO -- se intentó medir el alto real del
   * topbar en vivo con un ResizeObserver, pero el offset resultante seguía
   * sin coincidir exactamente en todas las pantallas/zooms, así que se
   * volvió a un valor simple y ajustable a mano. SI LA BARRA SE VE ENCIMADA
   * SOBRE EL ENCABEZADO (topbar blanco + pestañas), o si se ve MUY separada
   * de él, sube o baja este número -- es el único lugar que hay que tocar.
   */
  readonly topbarAltura = 180;

  readonly tiposPregunta = TIPOS_PREGUNTA;
  readonly tiposEnSelector = TIPOS_PREGUNTA.filter((t) => t.enSelector);
  readonly temas = TEMAS;
  readonly tiposArchivoPermitidos = TIPOS_ARCHIVO_PERMITIDOS;

  formulario: Formulario | null = null;
  cargando = true;
  guardando = false;
  hayCambiosSinGuardar = false;
  errorCarga = '';

  /** Pregunta con la tarjeta expandida. Solo una a la vez, como en Google Forms: con todas expandidas un formulario de 30 preguntas es ilegible. */
  idSeleccionada: string | null = null;
  /** Id de la pregunta cuyo menú "⋮" está abierto (solo uno a la vez). */
  menuAbiertoId: string | null = null;
  /** Id de la pregunta cuya "Clave de respuestas" está expandida (solo una a la vez, igual que el menú "⋮"). */
  claveAbiertaId: string | null = null;

  /**
   * Este editor solo CREA y EDITA el cuestionario (incluida su clave de
   * respuestas). Las respuestas que capture la gente y sus resultados
   * viven en el módulo "Cursos", que es donde el cuestionario se aplica a
   * un grupo concreto -- un mismo cuestionario puede aplicarse a varios
   * grupos en fechas distintas, y cada aplicación necesita su propio
   * registro.
   */
  pestana: 'preguntas' | 'configuracion' = 'preguntas';
  vistaPreviaAbierta = false;
  selectorTemaAbierto = false;
  confirmMessage = '';

  // ---- Deshacer / rehacer ----
  private historial: string[] = [];
  private indiceHistorial = -1;
  /** Evita que aplicar un snapshot (deshacer/rehacer) se registre a su vez como un cambio nuevo. */
  private restaurando = false;

  private cambios$ = new Subject<void>();
  private subs: Subscription[] = [];
  private preguntaAEliminar: Pregunta | null = null;

  constructor(
    private api: FormularioService,
    private ruta: ActivatedRoute,
    private router: Router,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    public permisosS: PermisosService,
  ) { }

  ngOnInit(): void {
    this.subs.push(
      this.cambios$.pipe(debounceTime(RETARDO_AUTOGUARDADO)).subscribe(() => this.guardar(true)),
    );

    const id = Number(this.ruta.snapshot.paramMap.get('id'));
    if (!id) {
      this.cargando = false;
      this.errorCarga = 'No se indicó qué formulario abrir.';
      return;
    }
    this.cargar(id);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    // Un cambio hecho justo antes de salir todavía está esperando el debounce:
    // sin este guardado, navegar rápido lo perdería en silencio.
    if (this.hayCambiosSinGuardar) {
      this.guardar(true);
    }
  }

  // ====================================================================
  // Carga y guardado
  // ====================================================================

  private cargar(id: number): void {
    this.cargando = true;
    this.api.obtener(id).subscribe({
      next: (res) => {
        this.formulario = normalizarFormulario(res);
        this.cargando = false;
        this.reiniciarHistorial();
      },
      error: (err) => {
        this.cargando = false;
        this.errorCarga = 'No se pudo abrir el formulario.';
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Marca que hubo un cambio: agenda el autoguardado y guarda un punto de deshacer. */
  marcarCambio(): void {
    if (this.restaurando) return;
    this.hayCambiosSinGuardar = true;
    this.registrarHistorial();
    this.cambios$.next();
  }

  guardar(silencioso = false): void {
    const formulario = this.formulario;
    if (!formulario?.id_formulario || this.guardando) return;

    const payload = {
      titulo: formulario.titulo,
      descripcion: formulario.descripcion,
      preguntas: formulario.preguntas,
      configuracion: formulario.configuracion,
      publicado: formulario.publicado,
      acepta_respuestas: formulario.acepta_respuestas,
    };

    this.guardando = true;
    const peticion$ = silencioso
      ? this.api.autoguardar(formulario.id_formulario, payload)
      : this.api.actualizar(formulario.id_formulario, payload);

    peticion$.subscribe({
      next: (res) => {
        this.guardando = false;
        this.hayCambiosSinGuardar = false;
        if (formulario) {
          formulario.fecha_modificacion = res?.fecha_modificacion;
        }
        if (!silencioso) {
          this.utils.MuestrasToast(TipoToast.Success, 'Formulario guardado.');
        }
      },
      error: (err) => {
        this.guardando = false;
        // El autoguardado no se traga el error: si falla, la persona debe
        // saberlo antes de seguir escribiendo veinte preguntas más.
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  volverALista(): void {
    this.router.navigate(['/formularios']);
  }

  // ====================================================================
  // Deshacer / rehacer
  // ====================================================================

  private instantanea(): string {
    const f = this.formulario;
    if (!f) return '';
    return JSON.stringify({
      titulo: f.titulo, descripcion: f.descripcion,
      preguntas: f.preguntas, configuracion: f.configuracion,
    });
  }

  private reiniciarHistorial(): void {
    this.historial = [this.instantanea()];
    this.indiceHistorial = 0;
  }

  private registrarHistorial(): void {
    const actual = this.instantanea();
    if (!actual || actual === this.historial[this.indiceHistorial]) return;

    // Un cambio nuevo después de deshacer descarta lo que se había rehecho:
    // la rama alternativa deja de ser alcanzable, igual que en cualquier
    // editor.
    this.historial = this.historial.slice(0, this.indiceHistorial + 1);
    this.historial.push(actual);

    if (this.historial.length > MAX_HISTORIAL) {
      this.historial.shift();
    }
    this.indiceHistorial = this.historial.length - 1;
  }

  get puedeDeshacer(): boolean { return this.indiceHistorial > 0; }
  get puedeRehacer(): boolean { return this.indiceHistorial < this.historial.length - 1; }

  deshacer(): void {
    if (!this.puedeDeshacer) return;
    this.indiceHistorial--;
    this.aplicarInstantanea(this.historial[this.indiceHistorial]);
  }

  rehacer(): void {
    if (!this.puedeRehacer) return;
    this.indiceHistorial++;
    this.aplicarInstantanea(this.historial[this.indiceHistorial]);
  }

  private aplicarInstantanea(json: string): void {
    if (!json || !this.formulario) return;
    const datos = JSON.parse(json);

    this.restaurando = true;
    this.formulario.titulo = datos.titulo;
    this.formulario.descripcion = datos.descripcion;
    this.formulario.preguntas = datos.preguntas.map(normalizarPregunta);
    this.formulario.configuracion = datos.configuracion;
    this.restaurando = false;

    this.hayCambiosSinGuardar = true;
    this.cambios$.next();
  }

  // ====================================================================
  // Preguntas: alta, orden, duplicado, borrado
  // ====================================================================

  seleccionar(pregunta: Pregunta): void {
    // La tarjeta detiene la propagación del clic en CUALQUIER punto de su
    // interior (para no perder la selección al escribir dentro de ella) --
    // eso incluye clics en la clave de respuestas, el campo de puntos o el
    // menú "⋮" de esta misma pregunta, que también burbujean hasta aquí.
    // Solo hay que cerrar esos paneles cuando de verdad se cambia a OTRA
    // pregunta: si ya estaba seleccionada, cualquier clic dentro de su
    // propio panel abierto lo cerraría de inmediato sin que nadie lo pidiera.
    const cambioDePregunta = this.idSeleccionada !== pregunta.id;
    this.idSeleccionada = pregunta.id;
    if (cambioDePregunta) {
      this.menuAbiertoId = null;
      this.selectorTemaAbierto = false;
      this.claveAbiertaId = null;
    }
  }

  esSeleccionada(pregunta: Pregunta): boolean {
    return this.idSeleccionada === pregunta.id;
  }

  /**
   * Agrega un elemento debajo del que está seleccionado (no al final):
   * es lo que espera quien está trabajando a la mitad de un formulario
   * largo, y evita tener que arrastrar la pregunta nueva desde el fondo.
   */
  agregarElemento(tipo: TipoPregunta): void {
    if (!this.formulario) return;

    const pregunta = nuevaPregunta(tipo);
    const indice = this.formulario.preguntas.findIndex((p) => p.id === this.idSeleccionada);

    if (indice >= 0) {
      this.formulario.preguntas.splice(indice + 1, 0, pregunta);
    } else {
      this.formulario.preguntas.push(pregunta);
    }

    this.idSeleccionada = pregunta.id;
    this.marcarCambio();
  }

  duplicarPregunta(pregunta: Pregunta): void {
    if (!this.formulario) return;

    // Copia profunda con ids NUEVOS en la pregunta y en cada inciso/fila:
    // reusarlos haría que dos preguntas distintas compartieran identidad y
    // sus respuestas se mezclarían al recolectarlas.
    const copia: Pregunta = JSON.parse(JSON.stringify(pregunta));
    copia.id = nuevoId('p');
    copia.opciones = copia.opciones.map((o) => ({ ...o, id: nuevoId('o') }));
    copia.config.filas = (copia.config.filas || []).map((f) => ({ ...f, id: nuevoId('o') }));

    const indice = this.formulario.preguntas.findIndex((p) => p.id === pregunta.id);
    this.formulario.preguntas.splice(indice + 1, 0, copia);

    this.idSeleccionada = copia.id;
    this.menuAbiertoId = null;
    this.marcarCambio();
  }

  confirmarEliminarPregunta(pregunta: Pregunta): void {
    this.menuAbiertoId = null;

    // Una pregunta en blanco se borra sin preguntar: pedir confirmación
    // para algo que no tiene nada escrito solo estorba.
    if (!pregunta.titulo.trim() && !pregunta.descripcion.trim()) {
      this.eliminarPregunta(pregunta);
      return;
    }

    this.preguntaAEliminar = pregunta;
    this.confirmMessage = `¿Eliminar «${pregunta.titulo.trim() || 'esta pregunta'}»?`;
    this.modalManager.openModal({
      title: 'Eliminar elemento',
      template: this.confirmDialog,
      onAccept: () => {
        if (this.preguntaAEliminar) this.eliminarPregunta(this.preguntaAEliminar);
        this.preguntaAEliminar = null;
      },
    });
  }

  private eliminarPregunta(pregunta: Pregunta): void {
    if (!this.formulario) return;
    this.formulario.preguntas = this.formulario.preguntas.filter((p) => p.id !== pregunta.id);
    if (this.idSeleccionada === pregunta.id) {
      this.idSeleccionada = null;
    }
    this.marcarCambio();
  }

  moverPregunta(evento: CdkDragDrop<Pregunta[]>): void {
    if (!this.formulario || evento.previousIndex === evento.currentIndex) return;
    moveItemInArray(this.formulario.preguntas, evento.previousIndex, evento.currentIndex);
    this.marcarCambio();
  }

  // ====================================================================
  // Tipo de pregunta
  // ====================================================================

  cambiarTipo(pregunta: Pregunta, tipo: TipoPregunta): void {
    if (pregunta.tipo === tipo) return;
    pregunta.tipo = tipo;
    // Conserva lo ya capturado y solo completa lo que el tipo nuevo exige
    // (ver aplicarDefaultsDeTipo): cambiar de tipo no debe borrar el trabajo.
    aplicarDefaultsDeTipo(pregunta);
    // La clave de respuestas sí se reinicia: un id marcado como correcto en
    // "casillas" (varios a la vez) no tiene el mismo significado en
    // "opción múltiple" (uno solo), y arrastrarlo daría una clave
    // incoherente sin que nadie la haya tocado a propósito.
    pregunta.config.respuestaCorrecta = '';
    pregunta.config.respuestasCorrectas = [];
    pregunta.config.respuestasCorrectasTexto = [];
    pregunta.config.correctasPorFila = {};
    this.marcarCambio();
  }

  iconoTipo(tipo: TipoPregunta): string { return definicionTipo(tipo).icono; }
  labelTipo(tipo: TipoPregunta): string { return definicionTipo(tipo).label; }

  esBloque(pregunta: Pregunta): boolean {
    return TIPOS_BLOQUE_NO_PREGUNTA.includes(pregunta.tipo);
  }
  tieneOpciones(pregunta: Pregunta): boolean {
    return TIPOS_CON_OPCIONES.includes(pregunta.tipo);
  }
  esCuadricula(pregunta: Pregunta): boolean {
    return TIPOS_CUADRICULA.includes(pregunta.tipo);
  }
  admiteOtro(pregunta: Pregunta): boolean {
    return TIPOS_CON_OTRO.includes(pregunta.tipo);
  }
  esTextoLibre(pregunta: Pregunta): boolean {
    return TIPOS_TEXTO_LIBRE.includes(pregunta.tipo);
  }
  esCalificable(pregunta: Pregunta): boolean {
    return esTipoCalificable(pregunta.tipo);
  }

  /**
   * Invierte un booleano por nombre de campo y agenda el autoguardado.
   *
   * Los interruptores del editor (obligatoria, cuestionario, aceptar
   * respuestas, etc.) usan esto en vez de `<input type="checkbox">` +
   * `<label for>`: ese patrón nativo depende de que el navegador interprete
   * el gesto del mouse como un "clic" y no como un "arrastre de selección
   * de texto" sobre la etiqueta -- con el más mínimo movimiento del mouse
   * (trackpad, mouse rápido) el navegador puede decidir que es selección de
   * texto y entonces NUNCA dispara el evento click, dejando el interruptor
   * completamente inerte aunque se le dé clic una y otra vez. Un `<button>`
   * con `(click)` no tiene esa ambigüedad: cualquier click (o tap) lo
   * dispara siempre, sin importar la velocidad o el dispositivo señalador.
   */
  alternar(objeto: any, campo: string): void {
    objeto[campo] = !objeto[campo];
    this.marcarCambio();
  }

  // ====================================================================
  // Modo cuestionario: clave de respuestas y puntaje
  // ====================================================================

  get esCuestionario(): boolean {
    return !!this.formulario?.configuracion?.esCuestionario;
  }

  alternarClave(pregunta: Pregunta, evento: MouseEvent): void {
    evento.stopPropagation();
    this.claveAbiertaId = this.claveAbiertaId === pregunta.id ? null : pregunta.id;
  }

  alternarModoCuestionario(): void {
    if (!this.formulario) return;
    this.formulario.configuracion.esCuestionario = !this.formulario.configuracion.esCuestionario;
    this.marcarCambio();
  }

  get puntajeTotalFormulario(): number {
    return this.formulario ? puntajeTotal(this.formulario) : 0;
  }

  /** Puntos mínimos para alcanzar la calificación aprobatoria configurada (0-10), redondeados hacia arriba: nunca aprobar "de más" por un redondeo generoso. */
  get puntosMinimosAprobatorios(): number {
    const total = this.puntajeTotalFormulario;
    const minimo = Number(this.formulario?.configuracion?.calificacionAprobatoria ?? 6);
    if (!total) return 0;
    return Math.ceil((minimo / 10) * total);
  }

  /**
   * Marca/desmarca una opción como correcta.
   *
   * En "opción múltiple" y "desplegable" es una sola respuesta correcta
   * (como un radio button); en "casillas" pueden ser varias a la vez
   * (Google Forms también permite marcar más de una como correcta ahí).
   */
  alternarOpcionCorrecta(pregunta: Pregunta, opcionId: string): void {
    const config = pregunta.config;
    if (pregunta.tipo === 'casillas') {
      const indice = config.respuestasCorrectas.indexOf(opcionId);
      if (indice >= 0) config.respuestasCorrectas.splice(indice, 1);
      else config.respuestasCorrectas.push(opcionId);
    } else {
      config.respuestaCorrecta = config.respuestaCorrecta === opcionId ? '' : opcionId;
    }
    this.marcarCambio();
  }

  esOpcionCorrecta(pregunta: Pregunta, opcionId: string): boolean {
    return pregunta.tipo === 'casillas'
      ? pregunta.config.respuestasCorrectas.includes(opcionId)
      : pregunta.config.respuestaCorrecta === opcionId;
  }

  /** Cuadrícula de opción: fija la columna correcta de una fila (una sola por fila, como una tabla de verdad). */
  elegirColumnaCorrecta(pregunta: Pregunta, filaId: string, columnaId: string): void {
    pregunta.config.correctasPorFila[filaId] = columnaId;
    this.marcarCambio();
  }

  agregarRespuestaCortaCorrecta(pregunta: Pregunta, campoTexto: HTMLInputElement): void {
    const valor = campoTexto.value.trim();
    if (!valor) return;
    if (!pregunta.config.respuestasCorrectasTexto.some((v) => v.toLowerCase() === valor.toLowerCase())) {
      pregunta.config.respuestasCorrectasTexto.push(valor);
      this.marcarCambio();
    }
    campoTexto.value = '';
  }

  quitarRespuestaCortaCorrecta(pregunta: Pregunta, valor: string): void {
    pregunta.config.respuestasCorrectasTexto = pregunta.config.respuestasCorrectasTexto.filter((v) => v !== valor);
    this.marcarCambio();
  }

  /** Numeración visible: los bloques no cuentan, igual que en el formulario publicado. */
  numeroDePregunta(pregunta: Pregunta): number {
    if (!this.formulario || this.esBloque(pregunta)) return 0;
    let numero = 0;
    for (const p of this.formulario.preguntas) {
      if (!this.esBloque(p)) numero++;
      if (p.id === pregunta.id) break;
    }
    return numero;
  }

  get totalPreguntas(): number {
    return (this.formulario?.preguntas || []).filter((p) => !this.esBloque(p)).length;
  }

  // ====================================================================
  // Opciones e incisos
  // ====================================================================

  agregarOpcion(pregunta: Pregunta): void {
    pregunta.opciones.push(nuevaOpcion(`Opción ${pregunta.opciones.length + 1}`));
    this.marcarCambio();
  }

  quitarOpcion(pregunta: Pregunta, opcion: OpcionPregunta): void {
    // Nunca dejar la pregunta sin ningún inciso: quedaría imposible de
    // responder y sin forma de agregar el primero desde la vista publicada.
    if (pregunta.opciones.length <= 1) {
      this.utils.MuestrasToast(TipoToast.Warning, 'La pregunta debe tener al menos una opción.');
      return;
    }
    pregunta.opciones = pregunta.opciones.filter((o) => o.id !== opcion.id);
    this.limpiarClaveTrasQuitar(pregunta, opcion.id);
    this.marcarCambio();
  }

  /**
   * Al borrar una opción o una fila, quita cualquier referencia a su id que
   * hubiera quedado en la clave de respuestas -- sin esto, una pregunta
   * podría marcar como "correcta" un inciso que ya no existe.
   */
  private limpiarClaveTrasQuitar(pregunta: Pregunta, idQuitado: string): void {
    const config = pregunta.config;
    if (config.respuestaCorrecta === idQuitado) config.respuestaCorrecta = '';
    config.respuestasCorrectas = config.respuestasCorrectas.filter((id) => id !== idQuitado);
    for (const filaId of Object.keys(config.correctasPorFila)) {
      if (config.correctasPorFila[filaId] === idQuitado) delete config.correctasPorFila[filaId];
      if (filaId === idQuitado) delete config.correctasPorFila[filaId];
    }
  }

  moverOpcion(pregunta: Pregunta, evento: CdkDragDrop<OpcionPregunta[]>): void {
    if (evento.previousIndex === evento.currentIndex) return;
    moveItemInArray(pregunta.opciones, evento.previousIndex, evento.currentIndex);
    this.marcarCambio();
  }

  agregarFila(pregunta: Pregunta): void {
    pregunta.config.filas.push(nuevaOpcion(`Fila ${pregunta.config.filas.length + 1}`));
    this.marcarCambio();
  }

  quitarFila(pregunta: Pregunta, fila: OpcionPregunta): void {
    if (pregunta.config.filas.length <= 1) {
      this.utils.MuestrasToast(TipoToast.Warning, 'La cuadrícula debe tener al menos una fila.');
      return;
    }
    pregunta.config.filas = pregunta.config.filas.filter((f) => f.id !== fila.id);
    this.limpiarClaveTrasQuitar(pregunta, fila.id);
    this.marcarCambio();
  }

  moverFila(pregunta: Pregunta, evento: CdkDragDrop<OpcionPregunta[]>): void {
    if (evento.previousIndex === evento.currentIndex) return;
    moveItemInArray(pregunta.config.filas, evento.previousIndex, evento.currentIndex);
    this.marcarCambio();
  }

  alternarOtro(pregunta: Pregunta): void {
    pregunta.config.incluirOtro = !pregunta.config.incluirOtro;
    this.marcarCambio();
  }

  // ====================================================================
  // Menú "⋮" de cada pregunta
  // ====================================================================

  alternarMenu(pregunta: Pregunta, evento: MouseEvent): void {
    evento.stopPropagation();
    this.menuAbiertoId = this.menuAbiertoId === pregunta.id ? null : pregunta.id;
  }

  alternarDescripcion(pregunta: Pregunta): void {
    pregunta.mostrarDescripcion = !pregunta.mostrarDescripcion;
    if (!pregunta.mostrarDescripcion) {
      pregunta.descripcion = '';
    }
    this.menuAbiertoId = null;
    this.marcarCambio();
  }

  alternarMezclarOpciones(pregunta: Pregunta): void {
    pregunta.config.mezclarOpciones = !pregunta.config.mezclarOpciones;
    this.menuAbiertoId = null;
    this.marcarCambio();
  }

  alternarValidacion(pregunta: Pregunta): void {
    const activa = pregunta.config.validacion.tipo !== 'ninguna';
    pregunta.config.validacion = activa
      ? { tipo: 'ninguna', regla: '', valor: '', valor2: '', mensaje: '' }
      : { tipo: 'numero', regla: 'mayor_que', valor: '', valor2: '', mensaje: '' };
    this.menuAbiertoId = null;
    this.marcarCambio();
  }

  validacionActiva(pregunta: Pregunta): boolean {
    return pregunta.config.validacion.tipo !== 'ninguna';
  }

  alternarTipoArchivo(pregunta: Pregunta, valor: string): void {
    const lista = pregunta.config.tiposArchivo;
    const indice = lista.indexOf(valor);
    if (indice >= 0) lista.splice(indice, 1); else lista.push(valor);
    this.marcarCambio();
  }

  // ====================================================================
  // Imagen de la pregunta
  // ====================================================================

  seleccionarImagen(pregunta: Pregunta, evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = () => {
      this.api.subirImagen(String(lector.result), `form_${pregunta.id}`).subscribe({
        next: (res) => {
          pregunta.imagen = res.ruta;
          // La URL viene versionada por el backend (?v=mtime): reemplazar la
          // imagen de una pregunta cambia la URL y el navegador no sirve la
          // anterior desde su caché.
          pregunta.imagenUrl = res.url;
          this.marcarCambio();
        },
        error: (err) => this.utils.MuestraErrorInterno(err),
      });
    };
    lector.readAsDataURL(archivo);
    input.value = '';
  }

  quitarImagen(pregunta: Pregunta): void {
    // Solo se desliga del formulario; el archivo se queda en el servidor
    // porque pudo haberse duplicado en otra pregunta u otro formulario, y
    // borrarlo dejaría a esa otra con la imagen rota.
    pregunta.imagen = null;
    pregunta.imagenUrl = null;
    this.marcarCambio();
  }

  // ====================================================================
  // Tema, publicación y vista previa
  // ====================================================================

  get tema() {
    return temaPorClave(this.formulario?.configuracion?.tema || 'institucional');
  }

  elegirTema(clave: string): void {
    if (!this.formulario) return;
    this.formulario.configuracion.tema = clave;
    this.selectorTemaAbierto = false;
    this.marcarCambio();
  }

  alternarPublicado(): void {
    if (!this.formulario) return;

    if (!this.formulario.publicado && !this.totalPreguntas) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Agrega al menos una pregunta antes de publicar.');
      return;
    }

    this.formulario.publicado = !this.formulario.publicado;
    this.marcarCambio();
    this.utils.MuestrasToast(
      TipoToast.Success,
      this.formulario.publicado
        ? 'Formulario publicado: el enlace ya se puede compartir.'
        : 'Formulario despublicado: el enlace deja de abrir.',
    );
  }

  get enlacePublico(): string {
    const token = this.formulario?.token_publico;
    return token ? `${window.location.origin}/responder/${token}` : '';
  }

  copiarEnlace(): void {
    const enlace = this.enlacePublico;
    if (!enlace) return;

    navigator.clipboard.writeText(enlace).then(
      () => this.utils.MuestrasToast(TipoToast.Success, 'Enlace copiado.'),
      () => this.utils.MuestrasToast(TipoToast.Error, 'No se pudo copiar el enlace.'),
    );
  }

  abrirVistaPrevia(): void {
    this.vistaPreviaAbierta = true;
  }

  cerrarVistaPrevia(): void {
    this.vistaPreviaAbierta = false;
  }

  /** Rango de una escala lineal, para pintar sus botones en la vista previa. */
  rangoEscala(pregunta: Pregunta): number[] {
    const min = Number(pregunta.config.escalaMin ?? 1);
    const max = Number(pregunta.config.escalaMax ?? 5);
    if (max < min) return [min];
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  rangoEstrellas(pregunta: Pregunta): number[] {
    const total = Number(pregunta.config.maxEstrellas ?? 5);
    return Array.from({ length: Math.max(1, total) }, (_, i) => i + 1);
  }

  /** trackBy para que arrastrar una pregunta no vuelva a crear el DOM de todas (perdería el foco del campo que se está escribiendo). */
  trackPorId(_indice: number, item: { id: string }): string {
    return item.id;
  }

  configuracion(): ConfiguracionFormulario {
    return this.formulario!.configuracion;
  }
}
