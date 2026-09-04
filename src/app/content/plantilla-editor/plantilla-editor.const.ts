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
 * Formas basicas ofrecidas en el submodal "Formas" (boton en Elementos fijos).
 *
 * `motor` indica que clase de Fabric.js construir y que campos de esta misma
 * fila usar. Los puntos/paths estan normalizados a un lienzo conceptual de
 * 100x100 -- se usan tal cual para la vista previa SVG del submodal, y se
 * escalan a `ancho`/`alto` al agregar la figura real al canvas.
 */
export type MotorForma = 'rect' | 'circle' | 'line' | 'polygon' | 'path';

export interface FormaDisponible {
  /** Sufijo de object.data.binding = `forma_${tipo}`. */
  tipo: string;
  label: string;
  motor: MotorForma;
  ancho?: number;
  alto?: number;
  /** motor 'rect': radio de esquina inicial, 0-1 proporcional al lado menor. */
  rx?: number;
  ry?: number;
  /** motor 'polygon': puntos normalizados 0-1. */
  puntos?: [number, number][];
  /** motor 'path': 'd' de un SVG conceptual 100x100. */
  path?: string;
  /** motor 'line': patron de guiones (mismas unidades que strokeWidth). */
  strokeDashArray?: number[];
}

export const CATALOGO_FORMAS: FormaDisponible[] = [
  // ---- Rectangulos (soportan radio de esquina) ----
  { tipo: 'rectangulo',          label: 'Rectangulo',          motor: 'rect', ancho: 180, alto: 110 },
  { tipo: 'cuadrado',            label: 'Cuadrado',            motor: 'rect', ancho: 140, alto: 140 },
  { tipo: 'cuadrado_redondeado', label: 'Cuadrado redondeado', motor: 'rect', ancho: 140, alto: 140, rx: 0.22, ry: 0.22 },

  // ---- Circulo ----
  { tipo: 'circulo', label: 'Circulo', motor: 'circle', ancho: 140, alto: 140 },

  // ---- Lineas ----
  { tipo: 'linea',             label: 'Linea',             motor: 'line', ancho: 200, alto: 4 },
  { tipo: 'linea_punteada',    label: 'Linea punteada',    motor: 'line', ancho: 200, alto: 6, strokeDashArray: [1, 12] },
  { tipo: 'linea_discontinua', label: 'Linea discontinua', motor: 'line', ancho: 200, alto: 6, strokeDashArray: [22, 12] },

  // ---- Poligonos ----
  { tipo: 'triangulo',           label: 'Triangulo',           motor: 'polygon', ancho: 140, alto: 130, puntos: [[0.5, 0], [1, 1], [0, 1]] },
  { tipo: 'triangulo_invertido', label: 'Triangulo invertido', motor: 'polygon', ancho: 140, alto: 130, puntos: [[0, 0], [1, 0], [0.5, 1]] },
  { tipo: 'triangulo_rectangulo', label: 'Triangulo rectangulo', motor: 'polygon', ancho: 130, alto: 130, puntos: [[0, 0], [1, 1], [0, 1]] },
  { tipo: 'rombo', label: 'Rombo', motor: 'polygon', ancho: 150, alto: 150, puntos: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  {
    tipo: 'cruz', label: 'Cruz', motor: 'polygon', ancho: 140, alto: 140,
    puntos: [
      [1 / 3, 0], [2 / 3, 0], [2 / 3, 1 / 3], [1, 1 / 3], [1, 2 / 3], [2 / 3, 2 / 3],
      [2 / 3, 1], [1 / 3, 1], [1 / 3, 2 / 3], [0, 2 / 3], [0, 1 / 3], [1 / 3, 1 / 3],
    ],
  },
  {
    tipo: 'octagono', label: 'Octagono', motor: 'polygon', ancho: 140, alto: 140,
    puntos: [[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]],
  },
  {
    tipo: 'pentagono', label: 'Pentagono', motor: 'polygon', ancho: 140, alto: 135,
    puntos: [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]],
  },
  { tipo: 'trapecio', label: 'Trapecio', motor: 'polygon', ancho: 160, alto: 110, puntos: [[0.2, 0], [0.8, 0], [1, 1], [0, 1]] },
  {
    tipo: 'trapecio_invertido', label: 'Trapecio invertido', motor: 'polygon', ancho: 160, alto: 110,
    puntos: [[0, 0], [1, 0], [0.8, 1], [0.2, 1]],
  },

  // ---- Con curvas (SVG path, escalado a su propio bounding box) ----
  { tipo: 'semicirculo', label: 'Semicirculo', motor: 'path', ancho: 160, alto: 80, path: 'M5,75 A45,45 0 0 1 95,75 Z' },
  { tipo: 'cuarto_circulo', label: 'Cuarto de circulo', motor: 'path', ancho: 130, alto: 130, path: 'M0,100 L0,0 A100,100 0 0 1 100,100 Z' },
  { tipo: 'arco', label: 'Arco', motor: 'path', ancho: 150, alto: 150, path: 'M0,100 L0,50 A50,50 0 0 1 100,50 L100,100 Z' },
  { tipo: 'forma_u', label: 'Forma de U', motor: 'path', ancho: 150, alto: 150, path: 'M0,0 L0,50 A50,50 0 0 0 100,50 L100,0 Z' },
  {
    tipo: 'esquina_redondeada', label: 'Esquina redondeada', motor: 'path', ancho: 150, alto: 150,
    path: 'M0,0 L100,0 L100,60 A40,40 0 0 1 60,100 L0,100 Z',
  },
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
