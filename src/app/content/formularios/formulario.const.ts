/**
 * Catalogo de tipos de pregunta y modelos del constructor de formularios.
 *
 * El formulario completo (titulo, descripcion, preguntas y ajustes) viaja
 * como un solo documento JSON hacia y desde el backend -- ver el comentario
 * del modelo `Formulario` en credencializacion/models.py sobre por que las
 * preguntas no viven en su propia tabla.
 */

export type TipoPregunta =
  | 'respuesta_corta'
  | 'parrafo'
  | 'opcion_multiple'
  | 'casillas'
  | 'desplegable'
  | 'archivo'
  | 'escala_lineal'
  | 'calificacion'
  | 'cuadricula_opcion'
  | 'cuadricula_casillas'
  | 'fecha'
  | 'hora'
  // Bloques que se intercalan entre preguntas pero NO se responden. Viven en
  // la misma lista para que el orden visual (y el arrastrar y soltar) sea
  // uno solo; el backend los excluye del conteo (TIPOS_BLOQUE_NO_PREGUNTA).
  | 'seccion'
  | 'titulo_texto'
  | 'imagen_bloque'
  | 'video';

export const TIPOS_BLOQUE_NO_PREGUNTA: TipoPregunta[] = [
  'seccion', 'titulo_texto', 'imagen_bloque', 'video',
];

/** Tipos cuyas respuestas se eligen de una lista de incisos editables. */
export const TIPOS_CON_OPCIONES: TipoPregunta[] = [
  'opcion_multiple', 'casillas', 'desplegable',
];

/** Tipos que se responden en una matriz de filas x columnas. */
export const TIPOS_CUADRICULA: TipoPregunta[] = [
  'cuadricula_opcion', 'cuadricula_casillas',
];

/** Tipos que aceptan la opcion "Otro" (respuesta libre del que contesta). */
export const TIPOS_CON_OTRO: TipoPregunta[] = ['opcion_multiple', 'casillas'];

/** Tipos de texto libre, unicos que admiten reglas de validacion de respuesta. */
export const TIPOS_TEXTO_LIBRE: TipoPregunta[] = ['respuesta_corta', 'parrafo'];

/**
 * Tipos con una respuesta objetivamente correcta -- son los únicos que el
 * modo "cuestionario" puede calificar solo, sin intervención humana.
 *
 * Se deja fuera a `parrafo` (una redacción libre no tiene un "correcto"
 * verificable por máquina), `archivo` (solo se puede calificar viendo el
 * contenido), `fecha`/`hora`/`escala_lineal`/`calificacion` (miden una
 * opinión o un dato, no una respuesta correcta) y `cuadricula_casillas`
 * (una fila puede tener varias marcas correctas a la vez, lo que vuelve la
 * calificación ambigua sin una regla adicional que nadie pidió todavía).
 * Si se necesita calificar alguno de estos después, es una regla nueva por
 * tipo, no una generalización de esta lista.
 */
export const TIPOS_CALIFICABLES: TipoPregunta[] = [
  'respuesta_corta', 'opcion_multiple', 'casillas', 'desplegable', 'cuadricula_opcion',
];

export interface DefinicionTipoPregunta {
  tipo: TipoPregunta;
  label: string;
  icono: string;
  /** Se muestra en el selector de tipo de pregunta (los bloques se agregan desde la barra lateral, no desde ahi). */
  enSelector: boolean;
  grupo: 'texto' | 'eleccion' | 'escala' | 'cuadricula' | 'fecha' | 'archivo' | 'bloque';
}

export const TIPOS_PREGUNTA: DefinicionTipoPregunta[] = [
  { tipo: 'respuesta_corta',   label: 'Respuesta corta',            icono: 'fas fa-minus',              enSelector: true,  grupo: 'texto' },
  { tipo: 'parrafo',           label: 'Párrafo',                    icono: 'fas fa-align-left',         enSelector: true,  grupo: 'texto' },
  { tipo: 'opcion_multiple',   label: 'Opción múltiple',            icono: 'fas fa-circle-dot',         enSelector: true,  grupo: 'eleccion' },
  { tipo: 'casillas',          label: 'Casillas',                   icono: 'fas fa-square-check',       enSelector: true,  grupo: 'eleccion' },
  { tipo: 'desplegable',       label: 'Lista desplegable',          icono: 'fas fa-caret-square-down',  enSelector: true,  grupo: 'eleccion' },
  { tipo: 'archivo',           label: 'Subida de archivos',         icono: 'fas fa-cloud-arrow-up',     enSelector: true,  grupo: 'archivo' },
  { tipo: 'escala_lineal',     label: 'Escala lineal',              icono: 'fas fa-ellipsis',           enSelector: true,  grupo: 'escala' },
  { tipo: 'calificacion',      label: 'Calificación',               icono: 'fas fa-star',               enSelector: true,  grupo: 'escala' },
  { tipo: 'cuadricula_opcion', label: 'Cuadrícula de opciones',     icono: 'fas fa-table-cells',        enSelector: true,  grupo: 'cuadricula' },
  { tipo: 'cuadricula_casillas', label: 'Cuadrícula de casillas',   icono: 'fas fa-border-all',         enSelector: true,  grupo: 'cuadricula' },
  { tipo: 'fecha',             label: 'Fecha',                      icono: 'fas fa-calendar-days',      enSelector: true,  grupo: 'fecha' },
  { tipo: 'hora',              label: 'Hora',                       icono: 'fas fa-clock',              enSelector: true,  grupo: 'fecha' },
  { tipo: 'seccion',           label: 'Sección',                    icono: 'fas fa-grip-lines',         enSelector: false, grupo: 'bloque' },
  { tipo: 'titulo_texto',      label: 'Título y descripción',       icono: 'fas fa-heading',            enSelector: false, grupo: 'bloque' },
  { tipo: 'imagen_bloque',     label: 'Imagen',                     icono: 'fas fa-image',              enSelector: false, grupo: 'bloque' },
  { tipo: 'video',             label: 'Video',                      icono: 'fas fa-video',              enSelector: false, grupo: 'bloque' },
];

export function definicionTipo(tipo: TipoPregunta): DefinicionTipoPregunta {
  return TIPOS_PREGUNTA.find((t) => t.tipo === tipo) || TIPOS_PREGUNTA[0];
}

export function esTipoCalificable(tipo: TipoPregunta): boolean {
  return TIPOS_CALIFICABLES.includes(tipo);
}

/**
 * Puntos totales que vale el formulario si es un cuestionario: la suma de
 * `puntaje` de las preguntas calificables. Las no calificables (párrafo,
 * archivo, escala, etc.) no suman -- no tienen una respuesta correcta que
 * el sistema pueda verificar solo.
 */
export function puntajeTotal(formulario: Formulario): number {
  if (!formulario.configuracion?.esCuestionario) return 0;
  return formulario.preguntas
    .filter((p) => esTipoCalificable(p.tipo))
    .reduce((suma, p) => suma + (Number(p.config.puntaje) || 0), 0);
}

// ======================================================================
// Modelos
// ======================================================================

export interface OpcionPregunta {
  id: string;
  texto: string;
}

export type TipoValidacion = 'ninguna' | 'numero' | 'longitud' | 'expresion';

export interface ReglaValidacion {
  tipo: TipoValidacion;
  /** Comparador dentro del tipo: 'mayor_que', 'entre', 'minimo', 'contiene', etc. */
  regla: string;
  valor: string;
  valor2: string;
  mensaje: string;
}

export interface ConfigPregunta {
  // --- escala lineal ---
  escalaMin: number;
  escalaMax: number;
  etiquetaMin: string;
  etiquetaMax: string;
  // --- calificación ---
  maxEstrellas: number;
  iconoCalificacion: 'estrella' | 'corazon' | 'pulgar';
  // --- cuadrículas: las columnas son `opciones`, las filas van aquí ---
  filas: OpcionPregunta[];
  requerirFilaCompleta: boolean;
  // --- opción múltiple / casillas / desplegable ---
  incluirOtro: boolean;
  mezclarOpciones: boolean;
  /** Solo casillas: cuántas casillas debe marcar quien responde. */
  minSelecciones: number;
  maxSelecciones: number;
  // --- texto libre ---
  validacion: ReglaValidacion;
  // --- archivo ---
  tiposArchivo: string[];
  maxArchivos: number;
  maxTamanoMb: number;
  // --- fecha / hora ---
  incluirAnio: boolean;
  incluirHora: boolean;
  formatoHora: 'hora' | 'duracion';
  // --- bloque de video ---
  url: string;
  // --- modo cuestionario (calificación automática) ---
  /** Puntos que vale la pregunta si se responde correctamente. */
  puntaje: number;
  /** opción_múltiple / desplegable: id de la única opción correcta. */
  respuestaCorrecta: string;
  /** casillas: ids de TODAS las opciones correctas -- se califica todo o nada, igual que Google Forms por omisión. */
  respuestasCorrectas: string[];
  /** respuesta_corta: lista de respuestas aceptadas como correctas (comparación sin mayúsculas ni espacios sobrantes). */
  respuestasCorrectasTexto: string[];
  /** cuadrícula de opción: id de fila -> id de columna correcta. */
  correctasPorFila: Record<string, string>;
}

export interface Pregunta {
  id: string;
  tipo: TipoPregunta;
  titulo: string;
  descripcion: string;
  /** La descripción existe siempre en el modelo; esto controla si se muestra su campo en el editor (igual que Google Forms). */
  mostrarDescripcion: boolean;
  obligatoria: boolean;
  /** Ruta relativa en MEDIA_ROOT (la devuelve el backend al subirla). */
  imagen: string | null;
  imagenUrl: string | null;
  opciones: OpcionPregunta[];
  config: ConfigPregunta;
}

export interface ConfiguracionFormulario {
  tema: string;
  mensajeConfirmacion: string;
  permitirVariasRespuestas: boolean;
  mostrarBarraProgreso: boolean;
  mezclarPreguntas: boolean;
  pedirNumEmpleado: boolean;
  pedirCorreo: boolean;
  mostrarEnlaceOtraRespuesta: boolean;
  mostrarResumenRespuestas: boolean;
  // ---- Modo cuestionario ----
  /** Convierte el formulario en un cuestionario evaluado: cada pregunta calificable tiene puntaje y respuesta(s) correcta(s). */
  esCuestionario: boolean;
  /** Calificación mínima para aprobar, en escala 0-10 (la misma que usa el resto del sistema de evaluaciones) -- se calcula sobre el % de puntos obtenidos. */
  calificacionAprobatoria: number;
  /** Si se le muestra a quien responde su calificación y aciertos justo al enviar (como el "ver calificación" de Google Forms) o si se mantiene oculta hasta que el sistema decida publicarla. */
  mostrarCalificacionAlEnviar: boolean;
}

export interface Formulario {
  id_formulario?: number;
  titulo: string;
  descripcion: string;
  preguntas: Pregunta[];
  configuracion: ConfiguracionFormulario;
  token_publico?: string;
  publicado?: boolean;
  acepta_respuestas?: boolean;
  activo?: boolean;
  total_preguntas?: number;
  fecha_registro?: string;
  fecha_modificacion?: string;
}

// ======================================================================
// Temas de color
// ======================================================================

export interface TemaFormulario {
  clave: string;
  nombre: string;
  color: string;
  /** Fondo del área de trabajo/respuesta; se calcula a mano y no con opacidad para que el contraste del texto sea predecible. */
  fondo: string;
}

export const TEMAS: TemaFormulario[] = [
  { clave: 'institucional', nombre: 'Institucional', color: '#6b1d45', fondo: '#f4eef1' },
  { clave: 'vino',          nombre: 'Vino',          color: '#8b2942', fondo: '#f7eef0' },
  { clave: 'azul',          nombre: 'Azul',          color: '#1a4f8b', fondo: '#eef2f8' },
  { clave: 'verde',         nombre: 'Verde',         color: '#1e6b4f', fondo: '#eef5f2' },
  { clave: 'ocre',          nombre: 'Ocre',          color: '#8a6a1f', fondo: '#f7f3e9' },
  { clave: 'gris',          nombre: 'Gris',          color: '#455a64', fondo: '#eef1f3' },
  { clave: 'morado',        nombre: 'Morado',        color: '#5a3a86', fondo: '#f2eef8' },
  { clave: 'teal',          nombre: 'Turquesa',      color: '#0f6b73', fondo: '#eaf4f5' },
];

export function temaPorClave(clave: string): TemaFormulario {
  return TEMAS.find((t) => t.clave === clave) || TEMAS[0];
}

// ======================================================================
// Fábricas
// ======================================================================

/**
 * Id corto y único para preguntas y opciones.
 *
 * Se genera en el navegador (no en el backend) porque el editor crea y
 * reordena elementos sin ir al servidor en cada acción; el id tiene que
 * existir desde el instante en que aparece la tarjeta. Es estable de por
 * vida: las respuestas se guardan referenciando este id, así que renombrar
 * o mover una pregunta nunca pierde sus respuestas.
 */
export function nuevoId(prefijo: string): string {
  const aleatorio = Math.random().toString(36).slice(2, 8);
  return `${prefijo}_${Date.now().toString(36)}${aleatorio}`;
}

export function configPorDefecto(): ConfigPregunta {
  return {
    escalaMin: 1,
    escalaMax: 5,
    etiquetaMin: '',
    etiquetaMax: '',
    maxEstrellas: 5,
    iconoCalificacion: 'estrella',
    filas: [],
    requerirFilaCompleta: false,
    incluirOtro: false,
    mezclarOpciones: false,
    minSelecciones: 0,
    maxSelecciones: 0,
    validacion: { tipo: 'ninguna', regla: '', valor: '', valor2: '', mensaje: '' },
    tiposArchivo: [],
    maxArchivos: 1,
    maxTamanoMb: 10,
    incluirAnio: true,
    incluirHora: false,
    formatoHora: 'hora',
    url: '',
    puntaje: 1,
    respuestaCorrecta: '',
    respuestasCorrectas: [],
    respuestasCorrectasTexto: [],
    correctasPorFila: {},
  };
}

export function nuevaOpcion(texto: string): OpcionPregunta {
  return { id: nuevoId('o'), texto };
}

export function nuevaPregunta(tipo: TipoPregunta = 'opcion_multiple'): Pregunta {
  const config = configPorDefecto();
  const pregunta: Pregunta = {
    id: nuevoId('p'),
    tipo,
    titulo: '',
    descripcion: '',
    mostrarDescripcion: false,
    obligatoria: false,
    imagen: null,
    imagenUrl: null,
    opciones: [],
    config,
  };
  aplicarDefaultsDeTipo(pregunta);
  return pregunta;
}

/**
 * Da a la pregunta las opciones/filas mínimas que su tipo necesita para ser
 * usable, sin destruir lo que ya tenga.
 *
 * Se llama tanto al crear una pregunta como al CAMBIARLE el tipo: si
 * alguien pasa de "opción múltiple" a "cuadrícula", las opciones ya
 * escritas se conservan como columnas y solo se agregan las filas que
 * faltaban -- perder el trabajo capturado por cambiar de tipo sería el peor
 * comportamiento posible en un editor.
 */
export function aplicarDefaultsDeTipo(pregunta: Pregunta): void {
  const necesitaOpciones =
    TIPOS_CON_OPCIONES.includes(pregunta.tipo) || TIPOS_CUADRICULA.includes(pregunta.tipo);

  if (necesitaOpciones && !pregunta.opciones.length) {
    pregunta.opciones = [nuevaOpcion(TIPOS_CUADRICULA.includes(pregunta.tipo) ? 'Columna 1' : 'Opción 1')];
  }

  if (TIPOS_CUADRICULA.includes(pregunta.tipo) && !pregunta.config.filas.length) {
    pregunta.config.filas = [nuevaOpcion('Fila 1')];
  }

  // "Otro" solo tiene sentido donde se elige de una lista de una sola cara.
  if (!TIPOS_CON_OTRO.includes(pregunta.tipo)) {
    pregunta.config.incluirOtro = false;
  }
}

export function formularioVacio(): Formulario {
  return {
    titulo: 'Formulario sin título',
    descripcion: '',
    preguntas: [nuevaPregunta('opcion_multiple')],
    configuracion: configuracionPorDefecto(),
  };
}

export function configuracionPorDefecto(): ConfiguracionFormulario {
  return {
    tema: 'institucional',
    mensajeConfirmacion: 'Se registró tu respuesta.',
    permitirVariasRespuestas: false,
    mostrarBarraProgreso: false,
    mezclarPreguntas: false,
    pedirNumEmpleado: true,
    pedirCorreo: false,
    mostrarEnlaceOtraRespuesta: false,
    mostrarResumenRespuestas: false,
    esCuestionario: false,
    calificacionAprobatoria: 6,
    mostrarCalificacionAlEnviar: true,
  };
}

/**
 * Completa un formulario recién traído del backend con los campos que su
 * JSON pudiera no traer.
 *
 * Necesario porque el JSON guardado es un documento libre: un formulario
 * creado antes de que existiera un ajuste no lo tiene, y el editor haría
 * `undefined.algo` al pintarlo. Normalizar al entrar es más barato que
 * sembrar `?.` por toda la plantilla.
 */
export function normalizarFormulario(datos: any): Formulario {
  const preguntas: Pregunta[] = Array.isArray(datos?.preguntas) ? datos.preguntas : [];

  return {
    ...datos,
    titulo: datos?.titulo || 'Formulario sin título',
    descripcion: datos?.descripcion || '',
    preguntas: preguntas.map(normalizarPregunta),
    configuracion: { ...configuracionPorDefecto(), ...(datos?.configuracion || {}) },
  };
}

export function normalizarPregunta(pregunta: any): Pregunta {
  const config = { ...configPorDefecto(), ...(pregunta?.config || {}) };
  config.validacion = { ...configPorDefecto().validacion, ...(pregunta?.config?.validacion || {}) };
  config.filas = Array.isArray(config.filas) ? config.filas : [];
  config.tiposArchivo = Array.isArray(config.tiposArchivo) ? config.tiposArchivo : [];
  config.respuestasCorrectas = Array.isArray(config.respuestasCorrectas) ? config.respuestasCorrectas : [];
  config.respuestasCorrectasTexto = Array.isArray(config.respuestasCorrectasTexto) ? config.respuestasCorrectasTexto : [];
  config.correctasPorFila = (config.correctasPorFila && typeof config.correctasPorFila === 'object') ? config.correctasPorFila : {};
  config.puntaje = Number.isFinite(config.puntaje) ? config.puntaje : 1;

  return {
    id: pregunta?.id || nuevoId('p'),
    tipo: pregunta?.tipo || 'respuesta_corta',
    titulo: pregunta?.titulo || '',
    descripcion: pregunta?.descripcion || '',
    mostrarDescripcion: !!pregunta?.mostrarDescripcion || !!(pregunta?.descripcion || '').trim(),
    obligatoria: !!pregunta?.obligatoria,
    imagen: pregunta?.imagen || null,
    imagenUrl: pregunta?.imagenUrl || null,
    opciones: Array.isArray(pregunta?.opciones) ? pregunta.opciones : [],
    config,
  };
}

/** Tipos de archivo que se pueden exigir en una pregunta de subida. */
export const TIPOS_ARCHIVO_PERMITIDOS = [
  { valor: 'documento',   label: 'Documento' },
  { valor: 'hoja_calculo', label: 'Hoja de cálculo' },
  { valor: 'presentacion', label: 'Presentación' },
  { valor: 'pdf',         label: 'PDF' },
  { valor: 'imagen',      label: 'Imagen' },
  { valor: 'video',       label: 'Video' },
  { valor: 'audio',       label: 'Audio' },
];
