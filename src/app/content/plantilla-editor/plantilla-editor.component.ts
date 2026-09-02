import {
  AfterViewInit, Component, ElementRef, OnDestroy, OnInit, TemplateRef, ViewChild
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as fabric from 'fabric';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { CredencialRenderService } from '../../services/credencial-render.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import {
  FondoDisponible, PlantillaCredencial, PlantillaCredencialService
} from '../../services/plantilla-credencial.service';
import {
  CAMPOS_DISPONIBLES, CampoPlantilla,
  ELEMENTOS_ESTATICOS, FUENTE_POR_DEFECTO,
  TamanoPapel, TAMANOS_PAPEL, OrientacionPapel,
  TAMANO_PAPEL_POR_DEFECTO, ORIENTACION_POR_DEFECTO,
  dimensionesPapel, tamanoPapelDesdeMm,
  CAMPOS_QR_DISPONIBLES, CAMPOS_QR_POR_DEFECTO, CampoQr,
} from './plantilla-editor.const';

/**
 * Editor visual de plantillas de credencial (tipo Canva) sobre Fabric.js.
 *
 * Este componente es independiente de plantilla-anam / provisional / familiar:
 * aquellos siguen funcionando tal cual. Aqui la disposicion de los elementos ya
 * no vive en SCSS con porcentajes fijos, sino como objetos manipulables que se
 * serializan a JSON y se guardan en la base de datos.
 */
@Component({
  standalone: false,
  selector: 'app-plantilla-editor',
  templateUrl: './plantilla-editor.component.html',
  styleUrls: ['./plantilla-editor.component.scss'],
})
export class PlantillaEditorComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('canvasEl', { static: false }) canvasEl!: ElementRef<HTMLCanvasElement>;
  @ViewChild('inputFondo') inputFondo!: ElementRef<HTMLInputElement>;
  @ViewChild('inputImagen') inputImagen!: ElementRef<HTMLInputElement>;
  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;
  @ViewChild('qrCamposDialog') qrCamposDialog!: TemplateRef<any>;

  // ---- Catalogos para la plantilla lateral ----
  readonly campos = CAMPOS_DISPONIBLES;
  readonly estaticos = ELEMENTOS_ESTATICOS;

  // ---- Seleccion de datos del QR (modal previo a colocarlo en el lienzo) ----
  readonly camposQrDisponibles: CampoQr[] = CAMPOS_QR_DISPONIBLES;
  camposQrSeleccion: string[] = [];
  /** Texto fijo opcional que se agrega al final del contenido del QR, igual para todos los empleados. */
  textoQrLibre = '';
  private campoQrPendiente: CampoPlantilla | null = null;

  // ---- Tamano de papel y orientacion ----
  // A diferencia de la credencial CR80 (tamano fijo), aqui el lienzo cambia
  // de resolucion segun lo que elija el usuario -- ver cambiarTamanoPapel().
  readonly tamanosPapel = TAMANOS_PAPEL;
  tamanoPapel: TamanoPapel = TAMANO_PAPEL_POR_DEFECTO;
  orientacion: OrientacionPapel = ORIENTACION_POR_DEFECTO;
  /** true cuando ancho_mm/alto_mm de la plantilla no matchean ningun preset del catalogo (p.ej. una plantilla CR80 vieja). */
  tamanoPersonalizado = false;

  anchoDiseno = dimensionesPapel(TAMANO_PAPEL_POR_DEFECTO, ORIENTACION_POR_DEFECTO).anchoPx;
  altoDiseno = dimensionesPapel(TAMANO_PAPEL_POR_DEFECTO, ORIENTACION_POR_DEFECTO).altoPx;

  // ---- Estado del editor ----
  canvas!: fabric.Canvas;
  objetoSeleccionado: fabric.FabricObject | null = null;
  zoom = 0.55;

  guardando = false;
  cargando = false;
  hayCambios = false;

  /**
   * JSON del lienzo (Fabric). Las constancias de evaluaciones son a una
   * sola cara -- a diferencia de la credencial CR80, que tenia frente y
   * reverso -- asi que solo existe esta.
   */
  private canvasFrente: any = null;

  fondos: FondoDisponible[] = [];
  fondoFrente: string | null = null;
  borrandoFondo: string | null = null;
  confirmMessage = '';

  plantilla: PlantillaCredencial = {
    clave: '',
    nombre: '',
    descripcion: '',
    ancho_px: this.anchoDiseno,
    alto_px: this.altoDiseno,
    ancho_mm: dimensionesPapel(TAMANO_PAPEL_POR_DEFECTO, ORIENTACION_POR_DEFECTO).anchoMm,
    alto_mm: dimensionesPapel(TAMANO_PAPEL_POR_DEFECTO, ORIENTACION_POR_DEFECTO).altoMm,
    activo: true,
  };

  // ---- Previsualizacion con datos reales ----
  numEmpleadoPreview = '';
  empleadoPreview: any = null;
  buscandoEmpleado = false;

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private render: CredencialRenderService,
    private utils: UtilsService,
    private route: ActivatedRoute,
    private router: Router,
    private modalManager: ModalManagerService,
    public permisosS: PermisosService,
  ) { }

  // ====================================================================
  // Ciclo de vida
  // ====================================================================

  ngOnInit(): void {
    this.cargarFondos();
  }

  ngAfterViewInit(): void {
    this.inicializarCanvas();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.cargarPlantilla(Number(id));
    }
  }

  ngOnDestroy(): void {
    this.canvas?.dispose();
  }

  // ====================================================================
  // Canvas
  // ====================================================================

  private inicializarCanvas(): void {
    this.canvas = new fabric.Canvas(this.canvasEl.nativeElement, {
      width: this.anchoDiseno,
      height: this.altoDiseno,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
    });

    // El canvas no dispara la descarga de las @font-face (ver
    // CredencialRenderService.asegurarFuentes). Sin esto, el editor mostraria
    // los textos con la fuente de respaldo hasta que algo mas del sistema
    // cargara la real, y el diseno no coincidiria con lo impreso.
    this.render.asegurarFuentes().then(() => {
      this.canvas.requestRenderAll();
    });

    this.aplicarZoom();

    this.canvas.on('selection:created', () => this.actualizarSeleccion());
    this.canvas.on('selection:updated', () => this.actualizarSeleccion());
    this.canvas.on('selection:cleared', () => { this.objetoSeleccionado = null; });
    this.canvas.on('object:modified', () => { this.hayCambios = true; });
    this.canvas.on('object:added', () => { this.hayCambios = true; });
    this.canvas.on('object:removed', () => { this.hayCambios = true; });
  }

  /**
   * El canvas mantiene SIEMPRE la resolucion de diseno actual (anchoDiseno x
   * altoDiseno -- variable segun el tamano de papel elegido, ver
   * aplicarTamanoPapel()) internamente; el zoom solo cambia el tamano CSS.
   * Asi las coordenadas guardadas son las mismas que usara el PDF,
   * independientemente de la pantalla.
   */
  private aplicarZoom(): void {
    if (!this.canvas) return;
    this.canvas.setDimensions(
      { width: `${this.anchoDiseno * this.zoom}px`, height: `${this.altoDiseno * this.zoom}px` },
      { cssOnly: true }
    );
  }

  cambiarZoom(delta: number): void {
    this.zoom = Math.min(1.2, Math.max(0.25, Number((this.zoom + delta).toFixed(2))));
    this.aplicarZoom();
  }

  // ====================================================================
  // Tamano de papel y orientacion
  // ====================================================================

  seleccionarTamanoPapel(tamano: TamanoPapel): void {
    this.tamanoPapel = tamano;
    this.tamanoPersonalizado = false;
    this.aplicarTamanoPapel();
  }

  /** Wrapper para el <select> del template, que solo puede mandar el id. */
  seleccionarTamanoPapelPorId(id: string): void {
    const tamano = this.tamanosPapel.find(t => t.id === id);
    if (tamano) this.seleccionarTamanoPapel(tamano);
  }

  cambiarOrientacion(orientacion: OrientacionPapel): void {
    if (orientacion === this.orientacion) return;
    this.orientacion = orientacion;
    this.aplicarTamanoPapel();
  }

  /**
   * Aplica el tamano/orientacion elegidos al lienzo: recalcula la
   * resolucion de diseno, la escribe en la plantilla (ancho_mm/alto_mm van
   * en el payload que se guarda) y redimensiona el <canvas> real.
   *
   * A diferencia de aplicarZoom() (que SOLO cambia el tamano CSS con
   * cssOnly:true), aqui SI cambia la resolucion interna -- por eso hay que
   * reaplicar el zoom actual despues, o el canvas se veria a tamano
   * completo sin importar el zoom seleccionado.
   */
  private aplicarTamanoPapel(): void {
    const huboElementos = this.canvas?.getObjects().length > 0
      || !!this.canvasFrente?.objects?.length;

    const { anchoMm, altoMm, anchoPx, altoPx } = dimensionesPapel(this.tamanoPapel, this.orientacion);

    this.anchoDiseno = anchoPx;
    this.altoDiseno = altoPx;
    this.plantilla.ancho_mm = anchoMm;
    this.plantilla.alto_mm = altoMm;
    this.plantilla.ancho_px = anchoPx;
    this.plantilla.alto_px = altoPx;

    if (this.canvas) {
      this.canvas.setDimensions({ width: anchoPx, height: altoPx });
      this.aplicarZoom();
      // El fondo esta escalado al tamano viejo; reaplicarlo
      // lo estira al nuevo. Los demas elementos (texto, marcadores) NO se
      // reescalan: sus coordenadas son absolutas y pueden quedar fuera del
      // lienzo nuevo, por eso la advertencia de abajo.
      this.render.aplicarFondo(this.canvas, this.fondoFrente, this.anchoDiseno, this.altoDiseno);
    }

    this.hayCambios = true;

    if (huboElementos) {
      this.utils.MuestrasToast(
        TipoToast.Warning,
        'Cambiaste el tamano del papel: revisa que los elementos ya colocados sigan bien alineados.'
      );
    }
  }

  private actualizarSeleccion(): void {
    this.objetoSeleccionado = this.canvas.getActiveObject() || null;
  }

  // ====================================================================
  // Lienzo
  // ====================================================================

  private guardarEnMemoria(): void {
    this.canvasFrente = this.serializarCanvas();
  }

  private async cargarEnCanvas(): Promise<void> {
    this.canvas.clear();
    this.canvas.backgroundColor = '#ffffff';

    if (this.canvasFrente) {
      await this.canvas.loadFromJSON(this.canvasFrente);
    }

    await this.render.aplicarFondo(
      this.canvas,
      this.fondoFrente,
      this.anchoDiseno,
      this.altoDiseno
    );

    this.canvas.renderAll();
    this.objetoSeleccionado = null;
  }

  private serializarCanvas(): any {
    // En Fabric v6 toJSON() no acepta argumentos; toObject() si permite indicar
    // las propiedades extra (data) que deben sobrevivir la serializacion.
    const json = this.canvas.toObject(CredencialRenderService.PROPS_EXTRA);

    // El fondo se guarda aparte (columna fondo_frente/fondo_reverso). Dejarlo
    // tambien dentro del JSON lo duplicaria y podria desincronizarse.
    delete json.backgroundImage;
    delete json.background;

    return json;
  }

  // ====================================================================
  // Fondos
  // ====================================================================

  cargarFondos(): void {
    this.plantillaApi.fondosDisponibles().subscribe({
      next: (res) => { this.fondos = res?.fondos || []; },
      error: () => { this.fondos = []; },
    });
  }

  async seleccionarFondo(ruta: string | null): Promise<void> {
    this.fondoFrente = ruta;
    await this.render.aplicarFondo(this.canvas, ruta, this.anchoDiseno, this.altoDiseno);
    this.hayCambios = true;
  }

  abrirSubirFondo(): void {
    this.inputFondo?.nativeElement.click();
  }

  onFondoSeleccionado(evento: any): void {
    const archivo = evento.target?.files?.[0];
    evento.target.value = '';
    if (!archivo) return;

    if (!archivo.type?.startsWith('image/')) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El fondo debe ser una imagen.');
      return;
    }
    // El backend ya sube su propio limite (ver settings.py,
    // DATA_UPLOAD_MAX_MEMORY_SIZE), pero avisar aqui evita subir 15MB para
    // enterarse hasta el final que no van a caber.
    if (archivo.size > 15 * 1024 * 1024) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El fondo es muy pesado. Máximo 15MB.');
      return;
    }

    const lector = new FileReader();
    lector.onload = () => {
      const base64 = lector.result as string;
      const nombre = archivo.name.replace(/\.[^.]+$/, '');

      this.plantillaApi.subirFondo(base64, `${nombre}_${Date.now()}`).subscribe({
        next: async (res) => {
          this.utils.MuestrasToast(TipoToast.Success, 'Fondo subido correctamente');
          this.cargarFondos();
          await this.seleccionarFondo(res.ruta);
        },
        error: (err) => this.utils.MuestraErrorInterno(err),
      });
    };

    lector.readAsDataURL(archivo);
  }

  /** Borra un fondo subido. Se niega si alguna plantilla lo sigue usando (ver borrar-fondo en el backend). */
  confirmarBorrarFondo(fondo: FondoDisponible, evento: MouseEvent): void {
    evento.stopPropagation(); // no dispara seleccionarFondo() del botón que lo envuelve
    this.confirmMessage = `¿Eliminar el fondo «${fondo.nombre}»? Esta acción no se puede deshacer.`;

    this.modalManager.openModal({
      title: 'Eliminar fondo',
      template: this.confirmDialog,
      onAccept: () => {
        this.borrandoFondo = fondo.ruta;
        this.plantillaApi.borrarFondo(fondo.ruta).subscribe({
          next: () => {
            this.borrandoFondo = null;
            this.utils.MuestrasToast(TipoToast.Success, 'Fondo eliminado');

            if (this.fondoFrente === fondo.ruta) {
              this.fondoFrente = null;
              this.render.aplicarFondo(this.canvas, null, this.anchoDiseno, this.altoDiseno);
              this.hayCambios = true;
            }

            this.cargarFondos();
          },
          error: (err) => {
            this.borrandoFondo = null;
            this.utils.MuestraErrorInterno(err);
          },
        });
      },
    });
  }

  // ====================================================================
  // Agregar elementos
  // ====================================================================

  agregarCampo(campo: CampoPlantilla): void {
    if (campo.tipo === 'qr') {
      this.abrirSelectorCamposQr(campo);
      return;
    }

    if (campo.tipo === 'imagen') {
      this.agregarMarcadorImagen(campo);
      return;
    }

    if (campo.binding === 'imagen_fija') {
      this.inputImagen?.nativeElement.click();
      return;
    }

    this.agregarTexto(campo);
  }

  /**
   * Antes de colocar el marcador de QR en el lienzo, pregunta que datos debe
   * llevar (modal nativo del sistema, ver ModalManagerService). La seleccion
   * queda en `data.camposQr` del marcador -- ver agregarMarcadorImagen() y
   * CredencialRenderService.construirContenidoQr().
   */
  abrirSelectorCamposQr(campo: CampoPlantilla): void {
    this.campoQrPendiente = campo;
    this.camposQrSeleccion = [...CAMPOS_QR_POR_DEFECTO];
    this.textoQrLibre = '';

    this.modalManager.openModal({
      title: 'Datos del código QR',
      template: this.qrCamposDialog,
      onAccept: () => {
        const textoLibre = this.textoQrLibre.trim();
        // Solo cae a la seleccion por omision si no quedo NADA que codificar
        // -- si el usuario dejo destildados todos los datos pero escribio
        // texto libre, un QR con solo ese texto es una eleccion valida.
        let seleccion = [...this.camposQrSeleccion];
        if (!seleccion.length && !textoLibre) {
          seleccion = [...CAMPOS_QR_POR_DEFECTO];
          this.utils.MuestrasToast(TipoToast.Warning, 'No se marcó ningún dato; se usó la selección por omisión.');
        }
        if (this.campoQrPendiente) this.agregarMarcadorImagen(this.campoQrPendiente, seleccion, textoLibre);
        this.campoQrPendiente = null;
      },
      onCancel: () => { this.campoQrPendiente = null; },
    });
  }

  campoQrMarcado(clave: string): boolean {
    return this.camposQrSeleccion.includes(clave);
  }

  alternarCampoQr(clave: string): void {
    this.camposQrSeleccion = this.campoQrMarcado(clave)
      ? this.camposQrSeleccion.filter(c => c !== clave)
      : [...this.camposQrSeleccion, clave];
  }

  private agregarTexto(campo: CampoPlantilla): void {
    const texto = new fabric.Textbox(campo.placeholder || campo.label, {
      left: this.anchoDiseno * 0.1,
      top: this.altoDiseno * 0.1,
      width: this.anchoDiseno * 0.6,
      fontSize: 28,
      fontFamily: FUENTE_POR_DEFECTO,
      fontWeight: 'bold',
      fill: '#000000',
      textAlign: 'left',
      editable: true,
      splitByGrapheme: false,
    });

    (texto as any).data = {
      binding: campo.binding,
      tipo: campo.tipo,
      campo: campo.campo,
      mayusculas: false,
    };

    this.canvas.add(texto);
    this.canvas.setActiveObject(texto);
    this.canvas.renderAll();
    this.actualizarSeleccion();
  }

  /**
   * Los campos de imagen (foto, firma, QR) se representan en el editor como un
   * recuadro punteado. Al generar la credencial, el recuadro se sustituye por la
   * imagen real ajustada exactamente a ese mismo espacio.
   */
  private agregarMarcadorImagen(campo: CampoPlantilla, camposQr?: string[], textoQrLibre?: string): void {
    const ancho = campo.ancho || 200;
    const alto = campo.alto || 200;

    const marcador = new fabric.Rect({
      left: this.anchoDiseno * 0.1,
      top: this.altoDiseno * 0.1,
      width: ancho,
      height: alto,
      fill: 'rgba(160, 180, 210, 0.35)',
      stroke: '#2E5DAA',
      strokeWidth: 2,
      strokeDashArray: [8, 6],
      strokeUniform: true,
    });

    (marcador as any).data = {
      binding: campo.binding,
      tipo: campo.tipo,
      campo: campo.campo,
      etiqueta: campo.label,
      ajuste: campo.binding === 'foto' ? 'cover' : 'contain',
      // Solo aplica a campo.tipo === 'qr' -- que datos del empleado va a
      // llevar este QR en particular, elegidos en abrirSelectorCamposQr().
      ...(campo.tipo === 'qr' ? {
        camposQr: camposQr?.length ? camposQr : CAMPOS_QR_POR_DEFECTO,
        // Texto fijo adicional (igual para todos los empleados), opcional.
        textoQrLibre: textoQrLibre || undefined,
      } : {}),
    };

    this.canvas.add(marcador);
    this.canvas.setActiveObject(marcador);
    this.canvas.renderAll();
    this.actualizarSeleccion();
  }

  onImagenFijaSeleccionada(evento: any): void {
    const archivo = evento.target?.files?.[0];
    if (!archivo) return;

    const lector = new FileReader();
    lector.onload = async () => {
      try {
        const imagen = await fabric.FabricImage.fromURL(lector.result as string);
        const escala = Math.min(300 / (imagen.width || 300), 300 / (imagen.height || 300));
        imagen.set({ left: this.anchoDiseno * 0.1, top: this.altoDiseno * 0.1, scaleX: escala, scaleY: escala });
        (imagen as any).data = { binding: 'imagen_fija', tipo: 'estatico' };

        this.canvas.add(imagen);
        this.canvas.setActiveObject(imagen);
        this.canvas.renderAll();
        this.actualizarSeleccion();
      } catch {
        this.utils.MuestrasToast(TipoToast.Error, 'No se pudo cargar la imagen.');
      }
    };

    lector.readAsDataURL(archivo);
    evento.target.value = '';
  }

  // ====================================================================
  // Elementos del lienzo
  // ====================================================================

  limpiarLienzo(): void {
    this.canvas.getObjects().forEach(obj => this.canvas.remove(obj));
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    this.objetoSeleccionado = null;
  }

  // ====================================================================
  // Persistencia
  // ====================================================================

  cargarPlantilla(id: number): void {
    this.cargando = true;

    this.plantillaApi.obtener(id).subscribe({
      next: async (res) => {
        this.plantilla = res;
        this.canvasFrente = res.canvas_frente || null;
        this.fondoFrente = res.fondo_frente || null;

        // El tamano de papel ya no es fijo (CR80): hay que leer el de ESTA
        // plantilla y redimensionar el <canvas> real antes de poblarlo, y
        // reflejar el preset/orientacion correctos en el selector.
        this.anchoDiseno = Number(res.ancho_px) || this.anchoDiseno;
        this.altoDiseno = Number(res.alto_px) || this.altoDiseno;
        const anchoMm = Number(res.ancho_mm) || this.anchoDiseno;
        const altoMm = Number(res.alto_mm) || this.altoDiseno;
        const detectado = tamanoPapelDesdeMm(anchoMm, altoMm);
        this.tamanoPapel = detectado.tamano || TAMANO_PAPEL_POR_DEFECTO;
        this.tamanoPersonalizado = !detectado.tamano;
        this.orientacion = detectado.orientacion;

        this.canvas.setDimensions({ width: this.anchoDiseno, height: this.altoDiseno });
        this.aplicarZoom();

        await this.cargarEnCanvas();
        this.cargando = false;
        this.hayCambios = false;
      },
      error: (err) => {
        this.cargando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  guardar(): void {
    if (!this.plantilla.clave?.trim() || !this.plantilla.nombre?.trim()) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Clave y nombre de la plantilla son obligatorios.');
      return;
    }

    this.guardarEnMemoria();
    this.guardando = true;

    // canvas_reverso/fondo_reverso NO se mandan a proposito: las
    // constancias son a una sola cara. El PATCH deja esas columnas tal
    // cual esten en BD (si una plantilla vieja de credencial CR80 aun
    // tenia reverso, no se borra solo, simplemente ya no es editable
    // desde aqui).
    const payload: PlantillaCredencial = {
      ...this.plantilla,
      clave: this.plantilla.clave.trim().toUpperCase().replace(/\s+/g, '_'),
      canvas_frente: this.canvasFrente,
      fondo_frente: this.fondoFrente,
      ancho_px: this.anchoDiseno,
      alto_px: this.altoDiseno,
    };

    const peticion$ = this.plantilla.id_plantilla
      ? this.plantillaApi.actualizar(this.plantilla.id_plantilla, payload)
      : this.plantillaApi.crear(payload);

    peticion$.subscribe({
      next: (res) => {
        this.guardando = false;
        this.hayCambios = false;
        this.plantilla = { ...this.plantilla, ...res };
        this.utils.MuestrasToast(TipoToast.Success, 'Plantilla guardada correctamente');

        if (res.id_plantilla && !this.route.snapshot.paramMap.get('id')) {
          this.router.navigate(['/plantillas/editor', res.id_plantilla], { replaceUrl: true });
        }
      },
      error: (err) => {
        this.guardando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  volverAlListado(): void {
    this.router.navigate(['/plantillas']);
  }

  // ====================================================================
  // Previsualizacion e impresion con datos reales
  // ====================================================================

  buscarEmpleado(): void {
    const num = this.numEmpleadoPreview?.trim();
    if (!num) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Escriba un numero de empleado.');
      return;
    }

    this.buscandoEmpleado = true;

    this.plantillaApi.buscarEmpleado(num).subscribe({
      next: (res) => {
        this.buscandoEmpleado = false;
        this.empleadoPreview = res?.datos || null;

        if (this.empleadoPreview) {
          this.utils.MuestrasToast(TipoToast.Success, `Empleado cargado (${res.origen})`);
        } else {
          this.utils.MuestrasToast(TipoToast.Warning, 'No se encontro al empleado.');
        }
      },
      error: () => {
        this.buscandoEmpleado = false;
        this.empleadoPreview = null;
        this.utils.MuestrasToast(TipoToast.Warning, `No se encontro al empleado ${num}.`);
      },
    });
  }

  private plantillaActualParaRender(): PlantillaCredencial {
    this.guardarEnMemoria();
    return {
      ...this.plantilla,
      canvas_frente: this.canvasFrente,
      fondo_frente: this.fondoFrente,
      ancho_px: this.anchoDiseno,
      alto_px: this.altoDiseno,
    };
  }

  /** Genera el PDF con lo que hay AHORA en el editor, sin necesidad de guardar. */
  async generarPdfPrueba(): Promise<void> {
    const datos = this.empleadoPreview || this.datosDeEjemplo();

    try {
      await this.render.generarPdf(this.plantillaActualParaRender(), datos, {
        nombreArchivo: `Prueba_${this.plantilla.clave || 'plantilla'}.pdf`,
        // Las constancias son a una sola cara: aunque la plantilla cargada
        // traiga un reverso viejo (de cuando era credencial CR80), la
        // prueba desde este editor nunca lo imprime.
        incluirReverso: false,
      });
      this.utils.MuestrasToast(TipoToast.Success, 'PDF generado');
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
    }
  }

  private datosDeEjemplo(): any {
    return {
      num_empleado: '20222493',
      rfc: 'AAAA000000AAA',
      curp: 'AAAA000000HDFXXX00',
      nombre: 'NOMBRE DE EJEMPLO',
      paterno: 'APELLIDO',
      materno: 'EJEMPLO',
      apellidos: 'APELLIDO EJEMPLO',
      puesto: 'PUESTO DE EJEMPLO',
      // Nombre corto, como sale de sicre_cat_unidad_compactada: asi el PDF de
      // prueba muestra el ancho real que ocupara el texto y no uno inventado.
      area: 'DGTI',
      adscripcion: 'DGTI',
      area_completa: 'DIRECCION GENERAL DE TECNOLOGIAS DE LA INFORMACION',
      folio: 'FOLIO-0001',
      fecha_expedicion: '2026-01-01',
      inicio_vig: '2026-01-01',
      fin_vig: '2030-01-01',
    };
  }
}
