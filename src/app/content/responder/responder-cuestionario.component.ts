import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject, Subscription, interval } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { CuestionarioPublicoService } from '../../services/cuestionario-publico.service';
import {
  Pregunta, TIPOS_BLOQUE_NO_PREGUNTA, TIPOS_CUADRICULA,
  normalizarPregunta, temaPorClave,
} from '../formularios/formulario.const';
import {
  BorradorLocal, CuestionarioPublico, CursoPublico, EstadoCuestionario,
  IntentoPublico, ParticipantePublico, SituacionCuestionario,
  barajar, borrarBorrador, claveBorrador, escribirBorrador, formatoTiempo, leerBorrador,
} from './responder.const';

/** Espera tras la última tecla antes de mandar lo capturado. Corto: la promesa es que no se pierda nada. */
const RETARDO_GUARDADO = 800;
/** Cada cuánto se avisa al servidor que la persona sigue conectada (alimenta el monitoreo en vivo). */
const INTERVALO_LATIDO = 20000;
/** Tope del reintento con espera creciente cuando la red falla. */
const ESPERA_REINTENTO_MAX = 15000;

/** Valor que representa la opción «Otro» dentro de las respuestas. No puede chocar con un id real: los ids del editor son `o_xxxx`. */
export const ID_OTRO = '__otro__';

/**
 * Pantalla pública para responder el cuestionario de un curso.
 *
 * Es el único componente al que se entra SIN sesión. Dos enlaces llevan
 * aquí:
 *  - `/responder/:token` — el enlace individual de cada participante (vía
 *    normal). Identifica por sí solo, sin teclear nada.
 *  - `/responder/curso/:token` — el enlace genérico de respaldo, para quien
 *    no recibió su correo. Pide el número de empleado y lo valida contra la
 *    lista de participantes.
 *
 * Sobre la persistencia (el requisito central de esta pantalla): cada
 * respuesta se manda al servidor conforme se contesta, se guarda ADEMÁS en
 * el navegador, y lo que no alcance a salir queda en una cola que se
 * reintenta sola. No existe el escenario "contestó 40 preguntas, se cayó la
 * red al enviar, perdió todo": al enviar ya no queda nada por subir.
 *
 * Sobre el tiempo: el contador de esta pantalla es un INDICADOR, no la
 * autoridad. Quien corta es el servidor (`fecha_limite`, sellada al
 * iniciar). Manipular el reloj de la máquina o el código de esta página no
 * da un segundo más.
 *
 * Forma de cada respuesta según el tipo de pregunta (la fase 4 califica
 * contra esto, así que cambiarlo obliga a cambiar el calificador):
 *   respuesta_corta / parrafo   -> string
 *   opcion_multiple/desplegable -> { opcion: string, otro: string }
 *   casillas                    -> { opciones: string[], otro: string }
 *   escala_lineal / calificacion-> number
 *   cuadricula_opcion           -> { [idFila]: idColumna }
 *   cuadricula_casillas         -> { [idFila]: idColumna[] }
 *   fecha                       -> { fecha: string, hora: string }
 *   hora                        -> string
 */
@Component({
  standalone: false,
  selector: 'app-responder-cuestionario',
  templateUrl: './responder-cuestionario.component.html',
  styleUrls: ['./responder-cuestionario.component.scss'],
})
export class ResponderCuestionarioComponent implements OnInit, OnDestroy {

  // ---- Identidad del enlace ----
  token = '';
  esGenerico = false;
  numEmpleado = '';
  numEmpleadoCapturado = '';

  // ---- Estado de pantalla ----
  cargando = true;
  situacion: SituacionCuestionario = 'listo';
  fase: 'identificar' | 'portada' | 'respondiendo' | 'final' = 'portada';
  mensajeFinal = '';
  errorIdentificacion = '';

  curso: CursoPublico | null = null;
  participante: ParticipantePublico | null = null;
  /** El cuestionario permite volver a contestar (se decide en Formularios, no en el curso). */
  permiteRepetir = false;
  /** Vuelta en la que va: solo pasa de 1 si el cuestionario permite repetir. */
  numeroIntento = 1;
  cuestionario: CuestionarioPublico | null = null;
  intento: IntentoPublico | null = null;

  /** Preguntas en el orden en que se van a mostrar (ya barajadas si el cuestionario lo pide). */
  preguntas: Pregunta[] = [];
  respuestas: Record<string, any> = {};
  faltantes: string[] = [];
  intentoEnvio = false;

  // ---- Guardado ----
  estadoGuardado: 'guardado' | 'guardando' | 'pendiente' | 'sin_conexion' = 'guardado';
  enviando = false;

  private pendientes = new Set<string>();
  /** Versión de cada respuesta: si cambió mientras viajaba el guardado, no se da por confirmada. */
  private versiones = new Map<string, number>();
  private guardadoEnVuelo = false;
  private esperaReintento = 1000;
  private temporizadorReintento: any = null;

  // ---- Tiempo (el servidor manda; esto solo lo refleja) ----
  limiteMs: number | null = null;
  /** Diferencia entre el reloj del navegador y el del servidor, para que el contador coincida con el corte real. */
  private desfaseMs = 0;
  segundosRestantes: number | null = null;

  private claveLocal = '';
  private cambios$ = new Subject<void>();
  private subs: Subscription[] = [];

  constructor(
    private api: CuestionarioPublicoService,
    private ruta: ActivatedRoute,
    private sanitizador: DomSanitizer,
  ) { }

  // ====================================================================
  // Ciclo de vida
  // ====================================================================

  ngOnInit(): void {
    this.token = this.ruta.snapshot.paramMap.get('token') || '';
    this.esGenerico = !!this.ruta.snapshot.data['generico'];

    this.subs.push(
      this.cambios$.pipe(debounceTime(RETARDO_GUARDADO)).subscribe(() => this.enviarPendientes()),
      interval(1000).subscribe(() => this.tictac()),
      interval(INTERVALO_LATIDO).subscribe(() => this.latir()),
    );

    if (this.esGenerico) {
      // El genérico no sabe quién entra hasta que teclea su número. Se
      // recuerda el último usado en ESTA computadora para que recargar no
      // obligue a volver a escribirlo.
      this.numEmpleado = sessionStorage.getItem(`constancias.num.${this.token}`) || '';
      this.numEmpleadoCapturado = this.numEmpleado;
      if (!this.numEmpleado) {
        this.cargando = false;
        this.fase = 'identificar';
        return;
      }
    }

    this.cargarEstado();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    if (this.temporizadorReintento) clearTimeout(this.temporizadorReintento);
    // Último intento por lo que quedó en la cola. Es "mejor esfuerzo": si no
    // sale, la copia local lo conserva para la próxima vez que se abra el
    // enlace.
    if (this.pendientes.size) this.enviarPendientes();
  }

  /** Aviso del navegador si quedan respuestas sin confirmar (no reemplaza al guardado, lo acompaña). */
  @HostListener('window:beforeunload', ['$event'])
  alSalir(evento: BeforeUnloadEvent): void {
    if (this.fase === 'respondiendo' && this.pendientes.size) {
      evento.preventDefault();
      evento.returnValue = '';
    }
  }

  /** Volver la conexión es la señal más útil que hay para vaciar la cola: se aprovecha en vez de esperar al siguiente reintento programado. */
  @HostListener('window:online')
  alVolverLaRed(): void {
    this.esperaReintento = 1000;
    if (this.pendientes.size) this.enviarPendientes();
  }

  // ====================================================================
  // Carga
  // ====================================================================

  identificarse(): void {
    const numero = (this.numEmpleadoCapturado || '').trim();
    if (!numero) {
      this.errorIdentificacion = 'Escribe tu número de empleado.';
      return;
    }
    this.errorIdentificacion = '';
    this.numEmpleado = numero;
    try { sessionStorage.setItem(`constancias.num.${this.token}`, numero); } catch { /* modo privado */ }
    this.cargando = true;
    this.cargarEstado();
  }

  private cargarEstado(): void {
    this.api.estado(this.token, this.numEmpleado).subscribe({
      next: (res) => this.aplicarEstado(res),
      error: () => {
        this.cargando = false;
        this.situacion = 'sin_conexion';
      },
    });
  }

  private aplicarEstado(res: EstadoCuestionario): void {
    this.cargando = false;
    this.situacion = res.situacion;
    this.curso = res.curso || null;

    if (res.servidor_ahora) {
      this.desfaseMs = Date.now() - new Date(res.servidor_ahora).getTime();
    }

    if (res.situacion === 'requiere_num_empleado' || res.situacion === 'no_inscrito') {
      this.fase = 'identificar';
      this.errorIdentificacion = res.situacion === 'no_inscrito'
        ? 'Ese número de empleado no está en la lista de participantes de este curso.'
        : '';
      return;
    }

    this.permiteRepetir = !!res.permite_repetir;

    if (res.situacion === 'puede_repetir') {
      // Ya contestó una vez y el cuestionario permite otra. Se muestra la
      // portada con el aviso, en vez de dejarlo en la pantalla final sin
      // salida: la opción existe justamente para que pueda volver.
      this.participante = res.participante || null;
      this.cuestionario = res.cuestionario || null;
      this.intento = null;
      this.numeroIntento = (res.intento?.numero_intento || 1) + 1;
      this.claveLocal = claveBorrador(this.token, this.numEmpleado);
      this.respuestas = {};
      this.pendientes.clear();
      this.prepararPreguntas();
      this.fase = 'portada';
      this.situacion = 'listo';
      return;
    }

    if (res.situacion === 'ya_respondido') {
      this.participante = res.participante || null;
      this.fase = 'final';
      this.mensajeFinal = res.intento?.estado === 'cerrado_por_tiempo'
        ? 'Se acabó el tiempo. Se registró lo que alcanzaste a contestar.'
        : 'Ya registramos tus respuestas de este cuestionario.';
      return;
    }

    if (res.situacion !== 'listo') {
      this.fase = 'portada';
      return;
    }

    this.participante = res.participante || null;
    this.cuestionario = res.cuestionario || null;
    this.intento = res.intento || null;
    this.claveLocal = claveBorrador(this.token, this.numEmpleado);

    this.numeroIntento = res.intento?.numero_intento || 1;
    this.prepararPreguntas();
    this.sincronizarLimite(res.intento?.fecha_limite || null, res.intento?.segundos_restantes ?? null);

    if (res.intento?.iniciado) {
      this.restaurarRespuestas(res.intento);
      this.fase = 'respondiendo';
    } else {
      this.fase = 'portada';
    }
  }

  private prepararPreguntas(): void {
    const crudas = (this.cuestionario?.preguntas || []).map(normalizarPregunta);
    const config = this.cuestionario?.configuracion || {};

    // Barajar es seguro: las respuestas se guardan por id de pregunta y de
    // opción, nunca por posición, así que el orden puede cambiar entre
    // recargas sin perder nada.
    let lista = crudas;
    if (config.mezclarPreguntas) {
      const bloques = crudas.filter((p) => this.esBloque(p));
      const preguntas = crudas.filter((p) => !this.esBloque(p));
      lista = [...bloques, ...barajar(preguntas)];
    }

    lista.forEach((pregunta) => {
      if (pregunta.config?.mezclarOpciones && pregunta.opciones?.length) {
        pregunta.opciones = barajar(pregunta.opciones);
      }
    });

    this.preguntas = lista;

    this.numeroDePregunta = new Map<string, number>();
    let n = 0;
    lista.forEach((p) => { if (!this.esBloque(p)) this.numeroDePregunta.set(p.id, ++n); });

    // Las URLs de video se sanean una sola vez y se guardan: devolver un
    // SafeResourceUrl nuevo desde un getter haría que Angular considerara el
    // binding cambiado en cada ciclo y recargara el iframe sin parar.
    this.videos = new Map<string, SafeResourceUrl>();
    lista.filter((p) => p.tipo === 'video').forEach((p) => {
      const url = this.urlEmbebida(p.config?.url || '');
      if (url) this.videos.set(p.id, this.sanitizador.bypassSecurityTrustResourceUrl(url));
    });
  }

  /**
   * Repuebla lo ya contestado: el servidor manda, la copia local solo cubre
   * lo que nunca alcanzó a confirmarse.
   *
   * El orden importa. Si la copia local pisara todo, una respuesta corregida
   * desde otro dispositivo (o después de limpiar) se revertiría sola.
   */
  private restaurarRespuestas(intento: IntentoPublico): void {
    this.respuestas = { ...(intento.respuestas || {}) };

    const borrador: BorradorLocal | null = leerBorrador(this.claveLocal);
    if (borrador?.pendientes?.length) {
      borrador.pendientes.forEach((id) => {
        if (id in borrador.respuestas) {
          this.respuestas[id] = borrador.respuestas[id];
          this.pendientes.add(id);
          this.versiones.set(id, (this.versiones.get(id) || 0) + 1);
        }
      });
      if (this.pendientes.size) {
        this.estadoGuardado = 'pendiente';
        this.enviarPendientes();
      }
    }
  }

  comenzar(): void {
    this.api.iniciar(this.token, this.numEmpleado).subscribe({
      next: (res) => {
        if (res.situacion && res.situacion !== 'listo') {
          this.aplicarEstado(res);
          return;
        }
        this.intento = res.intento || null;
        this.numeroIntento = res.intento?.numero_intento || 1;
        this.sincronizarLimite(res.intento?.fecha_limite || null, res.intento?.segundos_restantes ?? null);
        if (res.servidor_ahora) this.desfaseMs = Date.now() - new Date(res.servidor_ahora).getTime();
        if (res.intento) this.restaurarRespuestas(res.intento);
        this.fase = 'respondiendo';
      },
      error: () => { this.situacion = 'sin_conexion'; },
    });
  }

  // ====================================================================
  // Tiempo
  // ====================================================================

  private sincronizarLimite(fechaLimite: string | null, segundos: number | null): void {
    this.limiteMs = fechaLimite ? new Date(fechaLimite).getTime() : null;
    this.segundosRestantes = segundos;
    this.tictac();
  }

  /** Recalcula el contador cada segundo a partir de la hora límite del SERVIDOR, corregida por el desfase medido. */
  private tictac(): void {
    if (this.fase !== 'respondiendo' || this.limiteMs === null) return;

    const ahoraServidor = Date.now() - this.desfaseMs;
    const restante = Math.floor((this.limiteMs - ahoraServidor) / 1000);
    this.segundosRestantes = Math.max(0, restante);

    if (restante <= 0) this.cerrarPorTiempo();
  }

  /**
   * Se acabó el plazo: se manda lo que quede en la cola y se cierra la
   * pantalla.
   *
   * No hace falta que la persona alcance a presionar "Enviar" -- el servidor
   * ya tiene todo lo capturado y lo califica igual. Esta pantalla solo deja
   * de aceptar más.
   */
  private cerrarPorTiempo(): void {
    if (this.fase !== 'respondiendo') return;
    this.fase = 'final';
    this.situacion = 'tiempo_agotado';
    this.mensajeFinal = 'Se acabó el tiempo. Se registró lo que alcanzaste a contestar.';
    if (this.pendientes.size) this.enviarPendientes();
  }

  get tiempoTexto(): string {
    return this.segundosRestantes === null ? '' : formatoTiempo(this.segundosRestantes);
  }

  get tiempoUrgente(): boolean {
    return this.segundosRestantes !== null && this.segundosRestantes <= 120;
  }

  // ====================================================================
  // Captura de respuestas
  // ====================================================================

  /** Toda modificación pasa por aquí: guarda local, encola para el servidor y refleja el estado en pantalla. */
  private marcar(idPregunta: string): void {
    this.pendientes.add(idPregunta);
    this.versiones.set(idPregunta, (this.versiones.get(idPregunta) || 0) + 1);
    this.estadoGuardado = 'pendiente';
    this.guardarLocal();
    this.cambios$.next();
    if (this.intentoEnvio) this.validar();
  }

  private guardarLocal(): void {
    escribirBorrador(this.claveLocal, {
      respuestas: this.respuestas,
      pendientes: [...this.pendientes],
      guardadoEn: Date.now(),
    });
  }

  texto(pregunta: Pregunta): string {
    return this.respuestas[pregunta.id] ?? '';
  }

  cambiarTexto(pregunta: Pregunta, valor: string): void {
    this.respuestas[pregunta.id] = valor;
    this.marcar(pregunta.id);
  }

  // ---- Opción única (opción múltiple / desplegable) ----

  opcionElegida(pregunta: Pregunta): string {
    return this.respuestas[pregunta.id]?.opcion ?? '';
  }

  elegirOpcion(pregunta: Pregunta, idOpcion: string): void {
    const previo = this.respuestas[pregunta.id] || {};
    this.respuestas[pregunta.id] = {
      opcion: idOpcion,
      // Se conserva lo escrito en «Otro» al cambiar de opción y volver: es
      // trabajo de la persona, no basura.
      otro: idOpcion === ID_OTRO ? (previo.otro || '') : '',
    };
    this.marcar(pregunta.id);
  }

  textoOtro(pregunta: Pregunta): string {
    return this.respuestas[pregunta.id]?.otro ?? '';
  }

  cambiarOtro(pregunta: Pregunta, valor: string): void {
    const previo = this.respuestas[pregunta.id] || {};
    if (pregunta.tipo === 'casillas') {
      const opciones: string[] = previo.opciones || [];
      this.respuestas[pregunta.id] = {
        opciones: opciones.includes(ID_OTRO) ? opciones : [...opciones, ID_OTRO],
        otro: valor,
      };
    } else {
      this.respuestas[pregunta.id] = { opcion: ID_OTRO, otro: valor };
    }
    this.marcar(pregunta.id);
  }

  // ---- Casillas ----

  casillaMarcada(pregunta: Pregunta, idOpcion: string): boolean {
    return (this.respuestas[pregunta.id]?.opciones || []).includes(idOpcion);
  }

  alternarCasilla(pregunta: Pregunta, idOpcion: string): void {
    const previo = this.respuestas[pregunta.id] || { opciones: [], otro: '' };
    const opciones: string[] = [...(previo.opciones || [])];
    const i = opciones.indexOf(idOpcion);

    if (i >= 0) {
      opciones.splice(i, 1);
    } else {
      // Se respeta el máximo capturado en el editor: pasarse haría inválida
      // la respuesta sin que nadie lo dijera.
      const max = Number(pregunta.config?.maxSelecciones) || 0;
      if (max > 0 && opciones.length >= max) return;
      opciones.push(idOpcion);
    }

    this.respuestas[pregunta.id] = {
      opciones,
      otro: opciones.includes(ID_OTRO) ? (previo.otro || '') : '',
    };
    this.marcar(pregunta.id);
  }

  // ---- Escala lineal / calificación ----

  valorNumerico(pregunta: Pregunta): number | null {
    const valor = this.respuestas[pregunta.id];
    return typeof valor === 'number' ? valor : null;
  }

  elegirNumero(pregunta: Pregunta, valor: number): void {
    // Volver a tocar el valor ya elegido lo quita: es la única forma de
    // dejar en blanco una escala una vez marcada.
    this.respuestas[pregunta.id] = this.respuestas[pregunta.id] === valor ? null : valor;
    this.marcar(pregunta.id);
  }

  rangoEscala(pregunta: Pregunta): number[] {
    const min = Number(pregunta.config?.escalaMin ?? 1);
    const max = Number(pregunta.config?.escalaMax ?? 5);
    const lista: number[] = [];
    for (let i = min; i <= max; i++) lista.push(i);
    return lista;
  }

  rangoEstrellas(pregunta: Pregunta): number[] {
    const max = Number(pregunta.config?.maxEstrellas ?? 5);
    return Array.from({ length: max }, (_, i) => i + 1);
  }

  iconoCalificacion(pregunta: Pregunta): string {
    const icono = pregunta.config?.iconoCalificacion;
    if (icono === 'corazon') return 'fa-heart';
    if (icono === 'pulgar') return 'fa-thumbs-up';
    return 'fa-star';
  }

  // ---- Cuadrículas ----

  celdaMarcada(pregunta: Pregunta, idFila: string, idColumna: string): boolean {
    const valor = this.respuestas[pregunta.id]?.[idFila];
    return pregunta.tipo === 'cuadricula_casillas'
      ? (valor || []).includes(idColumna)
      : valor === idColumna;
  }

  marcarCelda(pregunta: Pregunta, idFila: string, idColumna: string): void {
    const previo = { ...(this.respuestas[pregunta.id] || {}) };

    if (pregunta.tipo === 'cuadricula_casillas') {
      const marcadas: string[] = [...(previo[idFila] || [])];
      const i = marcadas.indexOf(idColumna);
      if (i >= 0) marcadas.splice(i, 1); else marcadas.push(idColumna);
      previo[idFila] = marcadas;
    } else {
      previo[idFila] = previo[idFila] === idColumna ? null : idColumna;
    }

    this.respuestas[pregunta.id] = previo;
    this.marcar(pregunta.id);
  }

  // ---- Fecha / hora ----

  parteFecha(pregunta: Pregunta, parte: 'fecha' | 'hora'): string {
    return this.respuestas[pregunta.id]?.[parte] ?? '';
  }

  cambiarFecha(pregunta: Pregunta, parte: 'fecha' | 'hora', valor: string): void {
    this.respuestas[pregunta.id] = { ...(this.respuestas[pregunta.id] || {}), [parte]: valor };
    this.marcar(pregunta.id);
  }

  // ====================================================================
  // Cola de guardado
  // ====================================================================

  /**
   * Manda al servidor lo que esté pendiente.
   *
   * Solo se da por confirmada una respuesta si su VERSIÓN no cambió mientras
   * viajaba: si la persona la corrigió en ese lapso, sigue pendiente y se
   * vuelve a mandar. Sin esa comparación, escribir rápido dejaría la última
   * corrección fuera del servidor con la pantalla diciendo "Guardado".
   */
  private enviarPendientes(): void {
    if (this.guardadoEnVuelo || !this.pendientes.size || !this.claveLocal) return;
    if (this.fase === 'final') return;

    const ids = [...this.pendientes];
    const lote: Record<string, any> = {};
    const versionesEnviadas = new Map<string, number>();
    ids.forEach((id) => {
      lote[id] = this.respuestas[id] ?? null;
      versionesEnviadas.set(id, this.versiones.get(id) || 0);
    });

    this.guardadoEnVuelo = true;
    this.estadoGuardado = 'guardando';

    this.api.guardar(this.token, lote, {
      numEmpleado: this.numEmpleado,
      ultimaPreguntaVista: ids[ids.length - 1],
    }).subscribe({
      next: (res) => {
        this.guardadoEnVuelo = false;
        this.esperaReintento = 1000;

        if (res.status !== 'success') {
          // El servidor rechazó por estado (tiempo agotado, ya respondido):
          // reintentar no lo va a arreglar.
          this.manejarRechazo(res.situacion);
          return;
        }

        (res.guardadas || []).forEach((id) => {
          if (this.versiones.get(id) === versionesEnviadas.get(id)) this.pendientes.delete(id);
        });

        if (typeof res.segundos_restantes === 'number' && res.servidor_ahora) {
          this.desfaseMs = Date.now() - new Date(res.servidor_ahora).getTime();
        }

        this.estadoGuardado = this.pendientes.size ? 'pendiente' : 'guardado';
        this.guardarLocal();
        if (this.pendientes.size) this.cambios$.next();
      },
      error: () => {
        this.guardadoEnVuelo = false;
        this.estadoGuardado = 'sin_conexion';
        this.programarReintento();
      },
    });
  }

  /** Espera creciente: si la red está caída, insistir cada segundo no ayuda y llena la consola de errores. */
  private programarReintento(): void {
    if (this.temporizadorReintento) clearTimeout(this.temporizadorReintento);
    this.temporizadorReintento = setTimeout(() => {
      this.esperaReintento = Math.min(this.esperaReintento * 2, ESPERA_REINTENTO_MAX);
      this.enviarPendientes();
    }, this.esperaReintento);
  }

  private manejarRechazo(situacion?: string): void {
    if (situacion === 'tiempo_agotado') {
      this.cerrarPorTiempo();
    } else if (situacion === 'ya_respondido') {
      this.fase = 'final';
      this.situacion = 'ya_respondido';
      this.mensajeFinal = 'Este cuestionario ya se registró como respondido.';
    } else {
      this.estadoGuardado = 'sin_conexion';
    }
  }

  private latir(): void {
    if (this.fase !== 'respondiendo') return;
    this.api.latido(this.token, { numEmpleado: this.numEmpleado }).subscribe({
      next: (res) => {
        if (res.status !== 'success') { this.manejarRechazo(res.situacion); return; }
        if (res.servidor_ahora) this.desfaseMs = Date.now() - new Date(res.servidor_ahora).getTime();
      },
      error: () => { /* el latido es informativo: perderlo no cambia nada de lo capturado */ },
    });
  }

  // ====================================================================
  // Envío
  // ====================================================================

  /** Preguntas obligatorias sin contestar. Se calcula aquí para señalarlas; el servidor no rechaza por esto (lo capturado siempre cuenta). */
  private validar(): void {
    this.faltantes = this.preguntas
      .filter((p) => !this.esBloque(p) && p.obligatoria && !this.tieneRespuesta(p))
      .map((p) => p.id);
  }

  tieneRespuesta(pregunta: Pregunta): boolean {
    const valor = this.respuestas[pregunta.id];
    if (valor === null || valor === undefined || valor === '') return false;

    switch (pregunta.tipo) {
      case 'opcion_multiple':
      case 'desplegable':
        return !!valor.opcion && (valor.opcion !== ID_OTRO || !!(valor.otro || '').trim());
      case 'casillas':
        return (valor.opciones || []).length > 0;
      case 'cuadricula_opcion':
      case 'cuadricula_casillas': {
        const filas = pregunta.config?.filas || [];
        const contestadas = filas.filter((f) => {
          const celda = valor[f.id];
          return Array.isArray(celda) ? celda.length > 0 : !!celda;
        }).length;
        // Con "requerir fila completa" no basta una fila: se exigen todas.
        return pregunta.config?.requerirFilaCompleta ? contestadas === filas.length : contestadas > 0;
      }
      case 'fecha':
        return !!(valor.fecha || '').trim();
      case 'archivo':
        // Ver `subidaNoDisponible`: sin captura posible, exigirla dejaría el
        // botón de enviar bloqueado para siempre.
        return true;
      default:
        return true;
    }
  }

  esFaltante(pregunta: Pregunta): boolean {
    return this.faltantes.includes(pregunta.id);
  }

  enviar(): void {
    if (this.enviando) return;
    this.intentoEnvio = true;
    this.validar();

    if (this.faltantes.length) {
      const primera = document.getElementById(`preg-${this.faltantes[0]}`);
      primera?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    this.enviando = true;

    // Se manda lo pendiente EN LA MISMA llamada: así no queda hueco entre
    // "guardé lo último" y "envié".
    const ultimas: Record<string, any> = {};
    this.pendientes.forEach((id) => { ultimas[id] = this.respuestas[id] ?? null; });

    this.api.enviar(this.token, ultimas, this.numEmpleado).subscribe({
      next: (res) => {
        this.enviando = false;
        if (res.status !== 'success') { this.manejarRechazo(res.situacion); return; }

        this.pendientes.clear();
        borrarBorrador(this.claveLocal);
        this.fase = 'final';
        this.situacion = 'enviado';
        this.mensajeFinal = res.mensaje || 'Se registró tu respuesta.';
      },
      error: () => {
        this.enviando = false;
        this.estadoGuardado = 'sin_conexion';
      },
    });
  }

  /** Empieza otra vuelta. Solo se ofrece si el cuestionario permite varias respuestas. */
  responderOtraVez(): void {
    this.intentoEnvio = false;
    this.faltantes = [];
    this.cargando = true;
    this.cargarEstado();
  }

  // ====================================================================
  // Presentación
  // ====================================================================

  esBloque(pregunta: Pregunta): boolean {
    return TIPOS_BLOQUE_NO_PREGUNTA.includes(pregunta.tipo);
  }

  esCuadricula(pregunta: Pregunta): boolean {
    return TIPOS_CUADRICULA.includes(pregunta.tipo);
  }

  /**
   * La subida de archivos no está disponible al responder.
   *
   * El tipo existe en el editor, pero recibirla desde el enlace público
   * necesitaría almacenamiento y validación propios que no se pidieron para
   * esta etapa. Se dice en pantalla en vez de mostrar un control que no
   * guarda nada, y no bloquea el envío aunque la pregunta esté marcada como
   * obligatoria.
   */
  subidaNoDisponible(pregunta: Pregunta): boolean {
    return pregunta.tipo === 'archivo';
  }

  /** Numeración visible ("Pregunta 3"). Se calcula UNA vez al preparar la lista: recalcularla en un getter la rehace en cada ciclo de detección de cambios. */
  numeroDePregunta = new Map<string, number>();

  numeroDe(pregunta: Pregunta): number {
    return this.numeroDePregunta.get(pregunta.id) || 0;
  }

  get totalPreguntas(): number {
    return this.preguntas.filter((p) => !this.esBloque(p)).length;
  }

  get contestadas(): number {
    return this.preguntas.filter((p) => !this.esBloque(p) && this.tieneRespuesta(p)).length;
  }

  get porcentajeAvance(): number {
    return this.totalPreguntas ? Math.round((this.contestadas / this.totalPreguntas) * 100) : 0;
  }

  get mostrarBarraProgreso(): boolean {
    return !!this.cuestionario?.configuracion?.mostrarBarraProgreso;
  }

  get esCuestionarioEvaluado(): boolean {
    return !!this.cuestionario?.configuracion?.esCuestionario;
  }

  get colorTema(): string {
    return temaPorClave(this.cuestionario?.configuracion?.tema || 'institucional').color;
  }

  get fondoTema(): string {
    return temaPorClave(this.cuestionario?.configuracion?.tema || 'institucional').fondo;
  }

  puntajeDe(pregunta: Pregunta): number {
    return this.esCuestionarioEvaluado ? (Number(pregunta.config?.puntaje) || 0) : 0;
  }

  videos = new Map<string, SafeResourceUrl>();

  /** Solo YouTube: es lo que acepta el editor, y limitarlo evita incrustar un origen arbitrario en la página. */
  private urlEmbebida(url: string): string {
    const id = (url || '').match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}` : '';
  }

  urlVideo(pregunta: Pregunta): SafeResourceUrl | null {
    return this.videos.get(pregunta.id) || null;
  }

  trackPregunta(_i: number, pregunta: Pregunta): string {
    return pregunta.id;
  }
}
