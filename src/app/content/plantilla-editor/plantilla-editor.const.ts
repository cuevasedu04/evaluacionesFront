/**
 * Definiciones del editor de plantillas tipo canvas.
 *
 * El espacio de diseno esta fijado en px equivalentes a una credencial CR80
 * vertical (54 x 86 mm) a ~300dpi. Editor, previsualizacion y PDF comparten
 * exactamente estas mismas coordenadas, que es lo que garantiza que el PDF
 * salga identico a lo disenado.
 */

export const CANVAS_ANCHO_PX = 638;
export const CANVAS_ALTO_PX = 1016;

/** Tamano fisico de impresion (CR80 vertical), en milimetros. Queda como
 *  valor de respaldo para plantillas viejas -- las nuevas usan TAMANOS_PAPEL. */
export const CREDENCIAL_ANCHO_MM = 54;
export const CREDENCIAL_ALTO_MM = 86;

/** Multiplicador de exportacion sobre la resolucion de diseno del lienzo. */
export const MULTIPLICADOR_EXPORT = 2;

export type CaraCredencial = 'frente' | 'reverso';

/**
 * Tamanos de papel para plantillas de constancia (Carta por omision, mas
 * Oficio y A4). A diferencia de la credencial CR80 (tamano fijo, un solo
 * valor posible), aqui el usuario elige tamano + orientacion desde el editor.
 */
export interface TamanoPapel {
  id: string;
  label: string;
  /** Medidas en orientacion vertical (el mayor de los dos siempre es el alto). */
  anchoMm: number;
  altoMm: number;
}

export const TAMANOS_PAPEL: TamanoPapel[] = [
  { id: 'carta',  label: 'Carta (Letter)', anchoMm: 215.9, altoMm: 279.4 },
  { id: 'oficio', label: 'Oficio',         anchoMm: 215.9, altoMm: 340 },
  { id: 'a4',     label: 'A4',             anchoMm: 210,   altoMm: 297 },
];

export type OrientacionPapel = 'vertical' | 'horizontal';

export const TAMANO_PAPEL_POR_DEFECTO = TAMANOS_PAPEL[0];
/** Plantilla nueva (sin id): siempre arranca horizontal. Una plantilla ya
 *  guardada conserva su propia orientacion (ver tamanoPapelDesdeMm en
 *  cargarPlantilla), esto solo aplica al estado inicial en blanco. */
export const ORIENTACION_POR_DEFECTO: OrientacionPapel = 'horizontal';

/**
 * DPI de TRABAJO del lienzo interactivo (distinto del DPI final impreso).
 * A diferencia de CR80 -- que por ser fisicamente chico usa 300dpi nativos
 * sin problema -- una hoja carta completa a 300dpi da un canvas de
 * ~2550x3300px, pesado para que Fabric.js lo mantenga interactivo. Se
 * disena a 150dpi y se compensa al exportar con MULTIPLICADOR_EXPORT (2),
 * dando 300dpi reales en el PDF final.
 */
export const DPI_EDITOR_PAPEL = 150;

export function mmAPx(mm: number, dpi: number = DPI_EDITOR_PAPEL): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Ancho/alto (mm y px) de un TamanoPapel ya aplicada la orientacion elegida. */
export function dimensionesPapel(
  tamano: TamanoPapel,
  orientacion: OrientacionPapel
): { anchoMm: number; altoMm: number; anchoPx: number; altoPx: number } {
  // anchoMm/altoMm del catalogo siempre vienen en vertical (altoMm >= anchoMm).
  const anchoMm = orientacion === 'vertical' ? tamano.anchoMm : tamano.altoMm;
  const altoMm = orientacion === 'vertical' ? tamano.altoMm : tamano.anchoMm;
  return { anchoMm, altoMm, anchoPx: mmAPx(anchoMm), altoPx: mmAPx(altoMm) };
}

/**
 * Deduce que TamanoPapel/orientacion corresponden a un ancho/alto en mm ya
 * guardados (p.ej. al cargar una plantilla existente), comparando por
 * mayor/menor dimension con tolerancia de 1mm. Si no matchea ningun preset
 * del catalogo (plantillas CR80 viejas, o un tamano hecho a mano), regresa
 * `tamano: null` -- el selector debe mostrarse entonces como "Personalizado".
 */
export function tamanoPapelDesdeMm(
  anchoMm: number,
  altoMm: number
): { tamano: TamanoPapel | null; orientacion: OrientacionPapel } {
  const mayor = Math.max(anchoMm, altoMm);
  const menor = Math.min(anchoMm, altoMm);

  const tamano = TAMANOS_PAPEL.find(
    t => Math.abs(t.altoMm - mayor) < 1 && Math.abs(t.anchoMm - menor) < 1
  ) || null;

  const orientacion: OrientacionPapel = altoMm >= anchoMm ? 'vertical' : 'horizontal';
  return { tamano, orientacion };
}

/** Como se rellena un elemento al generar la credencial de un empleado. */
export type TipoBinding =
  | 'texto'        // campo de texto tomado del enrolamiento
  | 'fecha'        // campo de fecha, se formatea dd/MM/yyyy
  | 'imagen'       // foto o firma del empleado
  | 'qr'           // codigo QR generado con los datos del empleado
  | 'estatico';    // texto o imagen fija, no depende del empleado

export interface CampoPlantilla {
  /** Identificador que se guarda en object.data.binding */
  binding: string;
  label: string;
  tipo: TipoBinding;
  /** Propiedad del registro de enrolamiento de donde sale el valor */
  campo?: string;
  /** Texto mostrado en el editor mientras no hay datos reales */
  placeholder?: string;
  icono: string;
  /** Ancho/alto sugeridos al soltar el elemento por primera vez */
  ancho?: number;
  alto?: number;
}

/**
 * Catalogo de elementos que el usuario puede colocar en la credencial.
 * Tomado como referencia del set de campos de plantilla-anam/provisional.
 */
export const CAMPOS_DISPONIBLES: CampoPlantilla[] = [
  // 'nombre' y 'apellidos' se quitaron del catalogo (2026-08-25): en su
  // lugar se ofrece 'nombre_completo', que CredencialRenderService.aplicarTexto()
  // arma concatenando `${nombre} ${apellidos}` -- no es un campo nuevo en el
  // dataset del empleado, se calcula al momento de poblar el texto. Las
  // plantillas viejas que ya tengan 'nombre'/'apellidos' colocados siguen
  // funcionando: poblarDatos() resuelve por data.campo, no por esta lista.
  { binding: 'nombre_completo', label: 'Nombre completo', tipo: 'texto', campo: 'nombre_completo', placeholder: 'NOMBRE APELLIDOS', icono: 'fa-font' },
  { binding: 'paterno',       label: 'Apellido paterno',  tipo: 'texto',  campo: 'paterno',           placeholder: 'PATERNO',             icono: 'fa-font' },
  { binding: 'materno',       label: 'Apellido materno',  tipo: 'texto',  campo: 'materno',           placeholder: 'MATERNO',             icono: 'fa-font' },
  { binding: 'num_empleado',  label: 'No. de empleado',   tipo: 'texto',  campo: 'num_empleado',      placeholder: '00000000',            icono: 'fa-hashtag' },
  { binding: 'puesto',        label: 'Puesto',            tipo: 'texto',  campo: 'puesto',            placeholder: 'PUESTO',              icono: 'fa-briefcase' },
  // 'adscripcion' se quito del catalogo: entregaba exactamente lo mismo que
  // 'area' y tener dos campos identicos en la paleta solo invitaba a elegir
  // el equivocado. Las plantillas viejas que ya lo tengan enlazado siguen
  // funcionando: poblarDatos() resuelve por data.campo, no por esta lista.
  { binding: 'area',          label: 'Area (corta)',      tipo: 'texto',  campo: 'area',              placeholder: 'DGTI',                icono: 'fa-sitemap' },
  { binding: 'area_completa', label: 'Area (nombre largo)', tipo: 'texto', campo: 'area_completa',    placeholder: 'DIRECCION GENERAL DE...', icono: 'fa-sitemap' },
  { binding: 'curp',          label: 'CURP',              tipo: 'texto',  campo: 'curp',              placeholder: 'CURP000000HDFXXX00',  icono: 'fa-id-badge' },
  { binding: 'rfc',           label: 'RFC',               tipo: 'texto',  campo: 'rfc',               placeholder: 'RFC0000000A0',        icono: 'fa-id-badge' },
  { binding: 'folio',         label: 'Folio',             tipo: 'texto',  campo: 'folio',             placeholder: 'FOLIO-0001',          icono: 'fa-list-ol' },
  { binding: 'fecha_expedicion', label: 'Fecha expedicion', tipo: 'fecha', campo: 'fecha_expedicion', placeholder: '01/01/2026',          icono: 'fa-calendar-day' },
  // Para plantillas tipo "...el ___ de ___ de ___", donde dia/mes/año van en
  // recuadros separados en vez de una sola fecha junta. 'campo' es un
  // pseudo-nombre resuelto aparte en CredencialRenderService.aplicarTexto()
  // (no existe como tal en el dataset del empleado) -- tipo 'texto' porque
  // ya llegan formateados, no hay que pasarlos por formatearFecha().
  { binding: 'fecha_expedicion_dia',  label: 'Fecha expedicion - solo dia', tipo: 'texto', campo: 'fecha_expedicion_dia',  placeholder: '25',      icono: 'fa-calendar-day' },
  { binding: 'fecha_expedicion_mes',  label: 'Fecha expedicion - solo mes', tipo: 'texto', campo: 'fecha_expedicion_mes',  placeholder: 'agosto',  icono: 'fa-calendar-day' },
  { binding: 'fecha_expedicion_anio', label: 'Fecha expedicion - solo año', tipo: 'texto', campo: 'fecha_expedicion_anio', placeholder: '2026',    icono: 'fa-calendar-day' },
  { binding: 'qr',            label: 'Codigo QR',         tipo: 'qr',                                 icono: 'fa-qrcode', ancho: 180, alto: 180 },
];

/**
 * Datos seleccionables para el contenido del codigo QR (ver
 * PlantillaEditorComponent.abrirSelectorCamposQr y
 * CredencialRenderService.construirContenidoQr). Se eligen desde un modal al
 * arrastrar el campo QR al lienzo, y quedan guardados en
 * `data.camposQr` del marcador -- asi que agregar o quitar un dato aqui a
 * futuro no rompe QRs ya colocados con una seleccion previa.
 */
export interface CampoQr {
  clave: string;
  label: string;
}

export const CAMPOS_QR_DISPONIBLES: CampoQr[] = [
  { clave: 'nombre_completo',    label: 'Nombre completo' },
  { clave: 'num_empleado',       label: 'No. de empleado' },
  { clave: 'puesto',             label: 'Puesto' },
  { clave: 'area',               label: 'Area (corta)' },
  { clave: 'area_completa',      label: 'Area (nombre largo)' },
  { clave: 'paterno',            label: 'Apellido paterno' },
  { clave: 'materno',            label: 'Apellido materno' },
  { clave: 'curp',               label: 'CURP' },
  { clave: 'rfc',                label: 'RFC' },
  { clave: 'folio',              label: 'Folio' },
  { clave: 'fecha_expedicion',   label: 'Fecha de expedicion' },
  { clave: 'nombre_plantilla',   label: 'Nombre de la plantilla' },
];

/** Seleccion inicial del modal -- tambien lo que usa un QR guardado antes de que existiera `data.camposQr`. */
export const CAMPOS_QR_POR_DEFECTO: string[] = [
  'nombre_completo', 'num_empleado', 'puesto', 'area_completa', 'fecha_expedicion', 'nombre_plantilla',
];

/** Elementos estaticos que no dependen del empleado. */
export const ELEMENTOS_ESTATICOS: CampoPlantilla[] = [
  { binding: 'texto_fijo',   label: 'Texto fijo',    tipo: 'estatico', placeholder: 'Texto',  icono: 'fa-i-cursor' },
  { binding: 'imagen_fija',  label: 'Imagen / logo', tipo: 'estatico',                        icono: 'fa-image', ancho: 200, alto: 200 },
];

/**
 * Fuente por omision de los campos de texto nuevos.
 *
 * Es la institucional (public/fonts/NotoSans-Black.ttf), ya declarada como
 * @font-face en assets/styles.scss y usada por las credenciales antiguas
 * (plantilla-enrolamiento). Debe ir tambien en FUENTES_DISPONIBLES o el
 * selector del panel de propiedades apareceria vacio al seleccionar un campo.
 */
export const FUENTE_POR_DEFECTO = 'NotoSans-Black';

export const FUENTES_DISPONIBLES = [
  FUENTE_POR_DEFECTO,
  'NotoSans-Bold',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
];

/**
 * Fuentes que vienen de archivos propios (public/fonts, declaradas como
 * @font-face en assets/styles.scss) y por tanto hay que precargar antes de
 * dibujar en canvas -- ver CredencialRenderService.asegurarFuentes().
 * Las demas de FUENTES_DISPONIBLES son del sistema y siempre estan listas.
 */
export const FUENTES_PERSONALIZADAS = ['NotoSans-Black', 'NotoSans-Bold'];

export const ALINEACIONES = [
  { valor: 'left',   label: 'Izquierda', icono: 'fa-align-left' },
  { valor: 'center', label: 'Centro',    icono: 'fa-align-center' },
  { valor: 'right',  label: 'Derecha',   icono: 'fa-align-right' },
];

export function getCampo(binding: string): CampoPlantilla | undefined {
  return [...CAMPOS_DISPONIBLES, ...ELEMENTOS_ESTATICOS].find(c => c.binding === binding);
}
