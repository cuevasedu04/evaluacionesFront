/**
 * Modelos del módulo "Cursos".
 *
 * Un curso amarra una constancia (PlantillaCredencial), una plantilla de
 * correo (PlantillaCorreo) y un cuestionario (Formulario), y los aplica a
 * una lista cerrada de participantes. Ver `PLAN_CURSOS.md` en la raíz del
 * repo y el comentario del modelo `Curso` en el backend.
 */

export type EstadoCurso =
  | 'borrador'
  | 'listo'
  | 'abierto'
  | 'cerrado'
  | 'constancias_enviadas';

export interface Curso {
  id_curso?: number;
  nombre: string;
  descripcion: string;

  // Los tres elementos que el curso amarra (por valor, sin FK).
  id_plantilla: number | null;
  id_plantilla_correo: number | null;
  id_formulario: number | null;

  estado: EstadoCurso;

  fecha_apertura_programada: string | null;
  fecha_cierre_programada: string | null;
  fecha_apertura_real?: string | null;
  fecha_cierre_real?: string | null;
  minutos_por_persona: number;
  fecha_cierre_excepcion: string | null;

  /** Aviso opcional a quienes NO aprueban. Se decide por curso: el mismo cuestionario puede aplicarse a un grupo al que se le avisa y a otro al que no. */
  enviar_correo_reprobados: boolean;
  id_plantilla_correo_reprobados: number | null;

  token_curso?: string;
  permitir_enlace_generico: boolean;

  activo?: boolean;
  fecha_registro?: string;
  fecha_modificacion?: string;

  // ---- Calculados por el backend (solo lectura) ----
  // Se exponen para que la pantalla habilite/deshabilite con la MISMA regla
  // que aplica el servidor; el servidor las vuelve a verificar al ejecutar
  // cada acción, porque el estado de un botón en el navegador no es garantía.
  /**
   * Calificación mínima para aprobar (0-10). **Solo lectura**: se captura
   * en el cuestionario (pantalla "Formularios"), que es donde están los
   * puntos con los que se calcula. Tenerla editable también aquí obligaría
   * a decidir cuál gana cada vez que difirieran.
   *
   * Si el curso ya se abrió, es la del cuestionario CONGELADO: quien ya
   * respondió se califica con la regla vigente cuando contestó.
   */
  calificacion_aprobatoria?: number;
  /** También del cuestionario: si una persona puede volver a contestar tras enviar. */
  permitir_varias_respuestas?: boolean;
  /** También del cuestionario: si se le muestra su calificación al terminar. */
  mostrar_calificacion_al_enviar?: boolean;

  tiene_tiempo_configurado?: boolean;
  tiempo_agotado?: boolean;
  puede_enviar_enlaces?: boolean;
  generico_disponible?: boolean;
  esta_completo?: boolean;
  total_participantes?: number;
}

export type EstadoParticipante =
  | 'pendiente'
  | 'en_progreso'
  | 'terminado'
  | 'sin_responder';

export interface ParticipanteCurso {
  id_participante: number;
  id_curso: number;
  num_empleado: string;
  nombre_completo: string;
  email: string;
  puesto: string;
  area: string;
  curp: string;
  token_participante: string;
  estado: EstadoParticipante;
  fecha_envio_enlace: string | null;
  veces_enlace_enviado: number;
  constancia_enviada: boolean;
  fecha_envio_constancia: string | null;
  fecha_registro: string;
}

/** Persona que el backend rechazó o admitió con reserva al cargar la lista. */
export interface ParticipanteObservado {
  num_empleado: string;
  nombre_completo: string;
  estado_nom: string;
}

export interface RespuestaCargaParticipantes {
  status: string;
  agregados: ParticipanteCurso[];
  /** Dados de baja o fallecidos: NO se cargaron. */
  no_activos: ParticipanteObservado[];
  /** Suspendidos, con permiso, o sin estado en el padrón: sí se cargaron. */
  con_aviso: ParticipanteObservado[];
  no_encontrados: string[];
  ya_estaban: string[];
}

export const ESTADOS_CURSO: { valor: EstadoCurso; label: string; clase: string }[] = [
  { valor: 'borrador', label: 'Borrador', clase: 'cu-estado-borrador' },
  { valor: 'listo', label: 'Listo para abrir', clase: 'cu-estado-listo' },
  { valor: 'abierto', label: 'Abierto', clase: 'cu-estado-abierto' },
  { valor: 'cerrado', label: 'Cerrado', clase: 'cu-estado-cerrado' },
  { valor: 'constancias_enviadas', label: 'Constancias enviadas', clase: 'cu-estado-enviadas' },
];

export function etiquetaEstado(estado: EstadoCurso): string {
  return ESTADOS_CURSO.find((e) => e.valor === estado)?.label || estado;
}

export function claseEstado(estado: EstadoCurso): string {
  return ESTADOS_CURSO.find((e) => e.valor === estado)?.clase || 'cu-estado-borrador';
}

export function cursoVacio(): Partial<Curso> {
  return {
    nombre: '',
    descripcion: '',
    minutos_por_persona: 0,
    enviar_correo_reprobados: false,
    id_plantilla_correo_reprobados: null,
    permitir_enlace_generico: true,
  };
}

/**
 * Convierte una fecha ISO del backend al formato que exige
 * `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`, sin zona).
 *
 * No se puede pasar el ISO tal cual: el input lo ignora si trae segundos,
 * milisegundos o sufijo de zona, y se queda en blanco sin avisar de nada.
 */
export function isoAInputLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (isNaN(fecha.getTime())) return '';

  const p = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`
       + `T${p(fecha.getHours())}:${p(fecha.getMinutes())}`;
}

/** Lo contrario de `isoAInputLocal`: lo que teclea la persona -> ISO para el backend. */
export function inputLocalAIso(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const fecha = new Date(valor);
  return isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * Separa un texto pegado (Excel, correo, lista suelta) en números de
 * empleado. Acepta saltos de línea, comas, punto y coma, tabuladores y
 * espacios -- quien pega una columna de Excel no debería tener que
 * limpiarla primero.
 */
export function numerosDesdeTexto(texto: string): string[] {
  return (texto || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Token que se puede insertar en el cuerpo de la plantilla de correo para colocar el enlace donde se quiera. */
export const TOKEN_ENLACE = '{{enlace_cuestionario}}';
/** Token ya existente en las plantillas de correo del sistema. */
export const TOKEN_CURSO = '{{nombre_curso}}';

/**
 * Arma el cuerpo del correo con el que se le manda a UNA persona su enlace
 * al cuestionario.
 *
 * Si la plantilla ya trae `{{enlace_cuestionario}}`, el botón se coloca ahí.
 * Si no, se agrega al final: las plantillas que ya existían se escribieron
 * antes de que este token existiera, y dejarlas mandar un correo sin enlace
 * sería la peor forma de enterarse.
 */
export function cuerpoConEnlace(cuerpoHtml: string, nombreCurso: string, enlace: string): string {
  const boton =
    `<p style="margin:18px 0;">` +
    `<a href="${enlace}" style="background:#691C32;color:#ffffff;text-decoration:none;` +
    `padding:12px 22px;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;` +
    `display:inline-block;">Responder el cuestionario</a></p>` +
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">` +
    `Si el botón no funciona, copia esta dirección en tu navegador:<br>` +
    `<span style="word-break:break-all;">${enlace}</span></p>` +
    `<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">` +
    `Este enlace es personal: identifica tus respuestas. No lo compartas.</p>`;

  const base = (cuerpoHtml || '').split(TOKEN_CURSO).join(nombreCurso || '');

  return base.includes(TOKEN_ENLACE)
    ? base.split(TOKEN_ENLACE).join(boton)
    : base + boton;
}
