/**
 * Modelos de la pantalla pública para responder un cuestionario.
 *
 * Es el único componente del sistema al que se entra SIN sesión: quien
 * responde es un empleado que recibió un enlace por correo, no un usuario
 * del sistema. Su credencial es el token de la URL.
 *
 * Ojo con lo que NO está aquí: la clave de respuestas. El backend la
 * arranca antes de mandar el cuestionario (ver `cuestionario.py`,
 * `cuestionario_para_responder`) justamente para que no se pueda leer
 * abriendo las herramientas de desarrollo. Este archivo no debe reintroducir
 * esos campos ni calcular calificaciones: eso vive en el servidor.
 */
import { Pregunta } from '../formularios/formulario.const';

/**
 * En qué situación está el enlace. Las decide el servidor y viajan como
 * texto en la respuesta (nunca como código HTTP de error): un 401 o un 403
 * haría que el `TokenInterceptor` mandara a /login a alguien que está a
 * media evaluación.
 */
export type SituacionCuestionario =
  | 'listo'
  | 'token_invalido'
  | 'no_abierto'
  | 'curso_cerrado'
  | 'tiempo_agotado'
  | 'ya_respondido'
  | 'requiere_num_empleado'
  | 'no_inscrito'
  /** Ya contestó, pero el cuestionario permite volver a hacerlo (se decide en Formularios). */
  | 'puede_repetir'
  | 'generico_deshabilitado'
  | 'sin_intento'
  | 'enviado'
  | 'sin_conexion';

export interface CursoPublico {
  nombre: string;
  descripcion?: string;
  estado?: string;
  fecha_apertura_programada?: string | null;
}

export interface ParticipantePublico {
  num_empleado: string;
  nombre_completo: string;
  area: string;
  puesto: string;
}

export interface CuestionarioPublico {
  titulo: string;
  descripcion: string;
  preguntas: Pregunta[];
  configuracion: any;
}

export interface IntentoPublico {
  iniciado: boolean;
  estado: 'en_progreso' | 'enviado' | 'cerrado_por_tiempo';
  fecha_inicio: string | null;
  fecha_limite: string | null;
  /** Calculado por el SERVIDOR. El contador en pantalla es solo un reflejo de esto. */
  segundos_restantes: number | null;
  respuestas: Record<string, any>;
  ultima_pregunta_vista: string;
  /** 1, 2, 3... Solo pasa de 1 si el cuestionario permite varias respuestas. */
  numero_intento?: number;
}

export interface EstadoCuestionario {
  status: 'success' | 'error';
  situacion: SituacionCuestionario;
  via_acceso?: 'token' | 'generico';
  curso?: CursoPublico | null;
  participante?: ParticipantePublico;
  cuestionario?: CuestionarioPublico;
  intento?: IntentoPublico | null;
  /** Hora del servidor al responder: con ella el navegador calcula su desfase y pinta un contador que coincide con el corte real. */
  servidor_ahora?: string;
  /** Si el cuestionario permite volver a contestar tras enviar. */
  permite_repetir?: boolean;
  mensaje?: string;
}

/** Lo que se conserva en el navegador por si se cae la red o se cierra la pestaña. */
export interface BorradorLocal {
  respuestas: Record<string, any>;
  /** Ids cuya última versión todavía NO confirmó el servidor. Son los únicos que la copia local puede imponer sobre lo que el servidor devuelve. */
  pendientes: string[];
  guardadoEn: number;
}

/**
 * Clave de la copia local. Incluye el token (y el número de empleado en el
 * enlace genérico) para que dos personas que usan la misma computadora no
 * se pisen el borrador.
 */
export function claveBorrador(token: string, numEmpleado: string): string {
  return `constancias.cuestionario.${token}${numEmpleado ? '.' + numEmpleado : ''}`;
}

export function leerBorrador(clave: string): BorradorLocal | null {
  try {
    const crudo = localStorage.getItem(clave);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    return {
      respuestas: datos?.respuestas && typeof datos.respuestas === 'object' ? datos.respuestas : {},
      pendientes: Array.isArray(datos?.pendientes) ? datos.pendientes : [],
      guardadoEn: Number(datos?.guardadoEn) || 0,
    };
  } catch {
    // Modo privado, cuota llena o JSON corrupto: se sigue sin copia local.
    // El servidor ya tiene lo confirmado; la copia local solo cubre el hueco
    // entre teclear y que el guardado llegue.
    return null;
  }
}

export function escribirBorrador(clave: string, borrador: BorradorLocal): void {
  try {
    localStorage.setItem(clave, JSON.stringify(borrador));
  } catch {
    /* sin copia local; el guardado en servidor sigue siendo el camino principal */
  }
}

export function borrarBorrador(clave: string): void {
  try {
    localStorage.removeItem(clave);
  } catch { /* nada que hacer */ }
}

/** mm:ss (o h:mm:ss si pasa de una hora) para el contador en pantalla. */
export function formatoTiempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(seg)}` : `${p(m)}:${p(seg)}`;
}

/**
 * Baraja una copia del arreglo (Fisher-Yates).
 *
 * Se usa para `mezclarPreguntas` / `mezclarOpciones`. Es seguro que el orden
 * cambie entre recargas: las respuestas se guardan referenciando el id de
 * cada pregunta y de cada opción, nunca su posición.
 */
export function barajar<T>(lista: T[]): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}
