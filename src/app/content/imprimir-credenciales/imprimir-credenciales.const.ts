/**
 * Mapeo del roster SIG (sicre_tbl_sig) al modelo de datos que consumen las
 * plantillas del editor tipo canvas.
 *
 * Las plantillas guardan sus bindings con nombres genericos de credencial
 * (`nombre`, `apellidos`, `puesto`, `adscripcion`...), mientras que el roster
 * usa los nombres de columna del SIG (`nombres`, `primer_apellido`, `cargo`,
 * `area`...). Este archivo es el unico lugar donde viven esas equivalencias.
 */
import { EmpleadoSig } from '../../services/plantilla-credencial.service';

/** Columnas de sicre_tbl_sig con su etiqueta legible, en orden de despliegue. */
export const COLUMNAS_SIG: { campo: string; titulo: string; ancho?: number }[] = [
  { campo: 'empleado_anam', titulo: 'Numero de empleado', ancho: 145 },
  { campo: 'nombres', titulo: 'Nombres', ancho: 170 },
  { campo: 'primer_apellido', titulo: 'Primer apellido', ancho: 150 },
  { campo: 'segundo_apellido', titulo: 'Segundo apellido', ancho: 150 },
  { campo: 'curp', titulo: 'CURP', ancho: 165 },
  { campo: 'area', titulo: 'Área', ancho: 240 },
  { campo: 'cargo', titulo: 'Cargo', ancho: 190 },
  { campo: 'estado_nom', titulo: 'Estado nómina', ancho: 130 },
  { campo: 'fecha_expedicion', titulo: 'Fecha expedición', ancho: 140 },
];

/** Ano al que vencen todas las credenciales de esta emision. */
export const ANIO_FIN_VIGENCIA = 2030;

/**
 * Fecha de hoy en formato 'YYYY-MM-DD', en hora LOCAL.
 *
 * No se usa `toISOString().split('T')[0]`: ese convierte a UTC, y en Mexico
 * (UTC-6) a partir de las 18:00 devolveria ya la fecha del dia siguiente --
 * las credenciales impresas por la tarde saldrian fechadas manana.
 */
export function fechaHoyLocal(): string {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

/**
 * Fin de vigencia: mismo dia y mes de la columna `fecha_expedicion` del
 * ROSTER SIG (sicre_tbl_sig), pero del ano ANIO_FIN_VIGENCIA. Varia por
 * empleado.
 *
 * OJO: no confundir con el campo `fecha_expedicion` que se imprime al reverso
 * de la credencial. Ese es la fecha del dia en que se genera el plastico y no
 * guarda ninguna relacion con esta columna; son dos fechas distintas que
 * casualmente comparten nombre (ver `sigAEmpleadoCredencial`).
 *
 * Se calcula sobre el texto 'YYYY-MM-DD' que entrega el backend en vez de
 * construir un Date: `new Date('2022-01-01')` se interpreta como UTC y, en
 * husos al oeste como el de Mexico, al leerlo en local retrocede al dia
 * anterior -- la credencial saldria venciendo el 31/12/2029 en lugar del
 * 01/01/2030.
 */
export function calcularFinVigencia(fechaExpedicion: string | null | undefined): string {
  if (!fechaExpedicion) return '';

  const partes = String(fechaExpedicion).slice(0, 10).split('-');
  if (partes.length !== 3) return '';

  const [, mes, dia] = partes;
  if (!/^\d{2}$/.test(mes) || !/^\d{2}$/.test(dia)) return '';

  // 2030 no es bisiesto: un 29 de febrero daria una fecha inexistente, asi
  // que se recorre al 28. Hoy no hay ninguna en el roster, pero un sync
  // futuro podria traerla y el fallo seria silencioso.
  const diaAjustado = (mes === '02' && dia === '29') ? '28' : dia;

  return `${ANIO_FIN_VIGENCIA}-${mes}-${diaAjustado}`;
}

/**
 * Traduce una fila del roster SIG al objeto que espera
 * CredencialRenderService (mismas claves que `campo` en
 * plantilla-editor.const.ts).
 *
 * `rfc` no existe en el roster: se deja vacio para que el enrolador lo capture
 * a mano si su plantilla lo usa. `foto`/`firma` las resuelve aparte el
 * endpoint `medios` contra MEDIA_ROOT. `folio` lo asigna
 * "Imprimir credenciales" desde el consecutivo del servidor.
 */
export function sigAEmpleadoCredencial(fila: EmpleadoSig): any {
  const paterno = fila.primer_apellido || '';
  const materno = fila.segundo_apellido || '';

  return {
    // Identificadores
    num_empleado: fila.no_empleado || '',
    empleado_anam: fila.empleado_anam || '',
    curp: fila.curp || '',
    rfc: '',

    // Nombre
    nombre: fila.nombres || '',
    paterno,
    materno,
    apellidos: `${paterno} ${materno}`.trim(),

    // Puesto / adscripcion.
    //
    // `area` Y `adscripcion` llevan el nombre CORTO (catalogo
    // sicre_cat_unidad_compactada, resuelto por el backend en
    // `area_compactada`): el nombre oficial llega a 91 caracteres y desborda
    // o tapa otros campos del gafete.
    //
    // Los DOS van compactados a proposito. Antes solo `adscripcion` lo
    // estaba, y las plantillas reales usan el campo "Área" -- que es lo
    // natural al disenarlas --, asi que seguian imprimiendo el nombre largo.
    // Quien disene una plantilla no tiene por que saber cual de los dos
    // campos casi identicos trae la version corta.
    //
    // El nombre oficial completo queda en `area_completa` para quien lo
    // necesite. Si faltara el compactado se cae al largo: texto apretado es
    // preferible a un campo vacio.
    puesto: fila.cargo || '',
    cargo: fila.cargo || '',
    area: fila.area_compactada || fila.area || '',
    adscripcion: fila.area_compactada || fila.area || '',
    area_completa: fila.area || '',

    // Fechas y firma de autoridad.
    //
    // `fecha_expedicion` es la de HOY: es la fecha en que se expide el
    // plastico, no la que trae el roster (que corresponde al movimiento del
    // empleado en el SIG). Sigue siendo editable a mano en el modo edicion.
    // La del roster se conserva en `fecha_expedicion_sig` porque de ella se
    // deriva la vigencia.
    fecha_expedicion: fechaHoyLocal(),
    fecha_expedicion_sig: fila.fecha_expedicion || '',
    inicio_vig: fechaHoyLocal(),
    fin_vig: calcularFinVigencia(fila.fecha_expedicion),
    folio: '',
    firma_drh: fila.firma_drh || '',
    cargo_drh: fila.cargo_drh || '',

    // Estatus (util para avisar si es personal dado de baja)
    estatus: fila.estatus || '',
    estado_hum: fila.estado_hum || '',
    estado_nom: fila.estado_nom || '',

    // Medios: se rellenan tras consultar el endpoint `medios`.
    foto: null,
    firma: null,
  };
}
