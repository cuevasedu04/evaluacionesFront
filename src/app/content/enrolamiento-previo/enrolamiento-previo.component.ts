import {
  ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, TemplateRef, ViewChild,
} from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { WacomService } from '../../services/wacom.service';
import { PlantillaCredencialService } from '../../services/plantilla-credencial.service';
import { motivoSinCamara, motivoSinWacom, soportaCamara } from '../../services/soporte-navegador';
import { PdfAImagenService } from '../../services/pdf-a-imagen.service';
import { AjusteImagenComponent } from '../../components/shared/ajuste-imagen/ajuste-imagen.component';

/** Una captura de enrolamiento previo, identificada por RFC. */
export interface EnrolamientoPrevio {
  rfc: string;
  foto: string | null;
  firma: string | null;
}

/**
 * RFC de persona fisica: 4 letras + 6 digitos (AAMMDD) + 3 de homoclave.
 * La homoclave es opcional porque el acervo historico tiene muchisimos
 * archivos nombrados solo con los 10 primeros caracteres. Debe coincidir
 * con `_RE_RFC` de media_utils.py.
 */
const RE_RFC = /^[A-ZÑ&]{4}[0-9]{6}([A-Z0-9]{3})?$/i;

/** Clave de localStorage con los RFC de la sesion de enrolamiento en curso. */
const CLAVE_SESION = 'sicre_enrolamiento_previo_sesion';

/**
 * Pantalla "Enrolamiento previo".
 *
 * Captura foto y firma de personal cuyo movimiento de ingreso TODAVIA no se
 * aplica en el sistema y que, por tanto, aun no tiene num_empleado asignado.
 * Por eso ambos archivos se guardan en MEDIA_ROOT nombrados por **RFC** en
 * vez de por numero de empleado.
 *
 * Ciclo completo:
 *  1. Aqui se capturan foto/firma y se guardan como `fotos/<RFC>.jpg` y
 *     `FIRMAS/<RFC>.png`.
 *  2. Cuando RH aplica el movimiento, el sync del roster trae a esa persona a
 *     `sicre_tbl_sig` ya con num_empleado.
 *  3. En "Imprimir credenciales", al seleccionar ese registro, el endpoint
 *     `medios/` no encuentra nada por num_empleado y reintenta por el prefijo
 *     de 10 caracteres COMUN a RFC y CURP -- necesario porque el roster SIG
 *     solo entrega CURP, nunca RFC, y la homoclave del RFC no es derivable
 *     del CURP (ver media_utils.resolver_por_prefijo). Asi la credencial sale
 *     poblada con la foto/firma capturadas aqui.
 *  4. Al imprimir, los archivos se renombran al num_empleado definitivo
 *     (media_utils.migrar_medios), cerrando el ciclo.
 *
 * Ese mismo cruce por prefijo recupera de paso los ~950 archivos historicos
 * del acervo que ya estaban nombrados con RFC corto (zuaa771125.jpg).
 *
 * Esta pantalla SOLO enrola. El inventario de todo lo que ya vive en disco
 * nombrado por RFC (incluido el acervo historico) se consulta y se cruza en
 * "Inventario de medios" (/inventario-medios).
 */
@Component({
  standalone: false,
  selector: 'app-enrolamiento-previo',
  templateUrl: './enrolamiento-previo.component.html',
  styleUrls: ['./enrolamiento-previo.component.scss'],
})
export class EnrolamientoPrevioComponent implements OnInit, OnDestroy {

  @ViewChild('modalUnificado') modalUnificado!: TemplateRef<any>;
  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  // ---- Ajuste de encuadre (recorte/zoom) tras capturar o cargar ----
  @ViewChild('modalAjuste') modalAjusteTpl!: TemplateRef<any>;
  @ViewChild('ajustador') ajustador?: AjusteImagenComponent;
  srcParaAjustar: string | null = null;
  tipoAjusteActual: 'foto' | 'firma' = 'foto';
  convirtiendoPdf = false;
  private readonly ANCHO_MARCO_FOTO = 300;
  private readonly ALTO_MARCO_FOTO = 375;
  private readonly ANCHO_MARCO_FIRMA = 480;
  private readonly ALTO_MARCO_FIRMA = 180;

  get anchoMarcoAjuste(): number {
    return this.tipoAjusteActual === 'foto' ? this.ANCHO_MARCO_FOTO : this.ANCHO_MARCO_FIRMA;
  }
  get altoMarcoAjuste(): number {
    return this.tipoAjusteActual === 'foto' ? this.ALTO_MARCO_FOTO : this.ALTO_MARCO_FIRMA;
  }

  // ---- Camara ----
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;
  dispositivosVideo: MediaDeviceInfo[] = [];
  camaraSeleccionadaId = '';
  stream: MediaStream | null = null;
  fotoCapturada: string | null = null;

  // ---- Firma ----
  @ViewChild('firmaCanvas') firmaCanvas!: ElementRef<HTMLCanvasElement>;
  private cx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  firmaCapturada: string | null = null;

  // ---- Wacom ----
  private wacomSub: Subscription | null = null;
  isWacomSupported = false;
  wacomConnected = false;
  /** Explica por que no hay tableta/camara; null si si estan disponibles. */
  avisoWacom: string | null = null;
  avisoCamara: string | null = null;

  // ---- Estado ----
  /**
   * Capturas de la sesion de enrolamiento en curso.
   *
   * Cada captura se sube a MEDIA_ROOT en cuanto se acepta (no al final), y el
   * RFC se anota en localStorage. Asi la sesion sobrevive a recargar, cambiar
   * de pantalla, cerrar el navegador o perder la conexion: al volver, la
   * lista se reconstruye pidiendole al servidor los medios de esos RFC. Mismo
   * modelo que "Enrolamiento masivo" con su lote.
   *
   * Esta pantalla NO lista el inventario completo de medios en disco: eso
   * vive en "Inventario de medios" (/inventario-medios).
   */
  registros: EnrolamientoPrevio[] = [];
  guardando = false;
  cargandoSesion = false;
  modoEdicion = false;
  confirmMessage = '';
  /** Indice del registro que se esta editando, o -1 si es una captura nueva. */
  private indiceEdicion = -1;

  /** RFC de la sesion en curso, espejo de lo guardado en localStorage. */
  private rfcsSesion: string[] = [];

  /** RFC en captura. Se mantiene en mayusculas (el backend nombra el archivo tal cual). */
  rfcEnFormulario = '';
  /** RFC original cuando se esta editando, para detectar que cambio. */
  private rfcOriginal = '';

  get totalFotografias(): number {
    return this.registros.filter(r => !!r.foto).length;
  }

  get totalFirmas(): number {
    return this.registros.filter(r => !!r.firma).length;
  }

  get hayRegistrosIncompletos(): boolean {
    return this.registros.some(r => !r.foto || !r.firma);
  }

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private wacomService: WacomService,
    private cdRef: ChangeDetectorRef,
    private pdfService: PdfAImagenService,
  ) {
    this.isWacomSupported = this.wacomService.isBrowserSupported();
    this.avisoWacom = motivoSinWacom();
    this.avisoCamara = motivoSinCamara();
  }

  ngOnInit(): void {
    this.restaurarSesion();
  }

  ngOnDestroy(): void {
    this.detenerCamara();
    this.wacomSub?.unsubscribe();
  }

  // ====================================================================
  // Sesion persistida
  // ====================================================================

  /**
   * Reconstruye la sesion tras recargar: lee los RFC de localStorage y le
   * pide al servidor los medios de cada uno. Los que ya no existan en disco
   * (borrados desde el inventario) se descartan solos, porque `medios-lote`
   * no los devuelve.
   */
  private restaurarSesion(): void {
    this.rfcsSesion = this.leerSesion();
    if (!this.rfcsSesion.length) return;

    this.cargandoSesion = true;
    this.plantillaApi.mediosLote(this.rfcsSesion).subscribe({
      next: (res) => {
        this.registros = (res?.registros || []).map((r: any) => ({
          rfc: r.rfc, foto: r.foto, firma: r.firma,
        }));
        // Resincroniza por si alguno ya no estaba en disco.
        this.rfcsSesion = this.registros.map(r => r.rfc);
        this.escribirSesion();
        this.cargandoSesion = false;
      },
      error: () => {
        this.cargandoSesion = false;
        this.utils.MuestrasToast(TipoToast.Error, 'No se pudo recuperar la sesión de enrolamiento.');
      },
    });
  }

  private leerSesion(): string[] {
    try {
      const crudo = localStorage.getItem(CLAVE_SESION);
      const lista = crudo ? JSON.parse(crudo) : [];
      return Array.isArray(lista) ? lista.filter(x => typeof x === 'string') : [];
    } catch {
      // localStorage corrupto o deshabilitado: se arranca con sesion vacia en
      // vez de tumbar la pantalla.
      return [];
    }
  }

  private escribirSesion(): void {
    try {
      if (this.rfcsSesion.length) {
        localStorage.setItem(CLAVE_SESION, JSON.stringify(this.rfcsSesion));
      } else {
        localStorage.removeItem(CLAVE_SESION);
      }
    } catch { /* modo privado o cuota llena: la captura ya esta en el servidor */ }
  }

  // ====================================================================
  // Validacion
  // ====================================================================

  isRfcValido(): boolean {
    return RE_RFC.test((this.rfcEnFormulario || '').trim());
  }

  isFotoVerde(): boolean { return !!this.fotoCapturada; }
  isFirmaVerde(): boolean { return !!this.firmaCapturada; }
  isDatosVerde(): boolean { return this.isRfcValido(); }

  onRfcInput(): void {
    this.rfcEnFormulario = (this.rfcEnFormulario || '').toUpperCase().replace(/\s/g, '');
  }

  /** True si el RFC ya fue capturado antes (evita pisar sin querer otra captura). */
  get rfcDuplicado(): boolean {
    const rfc = (this.rfcEnFormulario || '').trim().toUpperCase();
    if (!rfc || (this.modoEdicion && rfc === this.rfcOriginal)) return false;
    return this.registros.some(r => r.rfc.toUpperCase() === rfc);
  }

  // ====================================================================
  // Modal de captura
  // ====================================================================

  comenzarEnrolamiento(): void {
    this.modoEdicion = false;
    this.indiceEdicion = -1;
    this.rfcEnFormulario = '';
    this.rfcOriginal = '';
    this.fotoCapturada = null;
    this.firmaCapturada = null;
    this.abrirModal('Enrolamiento previo — Captura continua');
  }

  editarRegistro(registro: EnrolamientoPrevio): void {
    this.modoEdicion = true;
    this.indiceEdicion = this.registros.indexOf(registro);
    this.rfcEnFormulario = registro.rfc.toUpperCase();
    this.rfcOriginal = registro.rfc.toUpperCase();
    this.fotoCapturada = registro.foto;
    this.firmaCapturada = registro.firma;
    this.abrirModal(`Editar captura — ${registro.rfc}`);
  }

  private abrirModal(titulo: string): void {
    this.modalManager.openModal({
      title: titulo,
      template: this.modalUnificado,
      showFooter: false,
      width: '95vw',
      onCancel: () => this.cerrarModal(),
    });

    // Doble requestAnimationFrame en vez de un setTimeout con delay fijo: hay
    // que esperar a que el navegador PINTE el modal antes de medir el
    // <canvas> de la firma. Si se mide antes, offsetWidth/Height salen en 0 y
    // el canvas queda con resolucion interna 0x0 -- los eventos de mouse se
    // siguen disparando (sin error visible) pero no hay un solo pixel donde
    // dibujar, y el trazo resulta invisible.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.iniciarCamara();
      this.inicializarCanvasFirma();
      if (this.firmaCapturada) this.dibujarImagenEnFirma(this.firmaCapturada);
      this.cdRef.detectChanges();
    }));
  }

  private cerrarModal(): void {
    this.detenerCamara();
    this.modalManager.closeModal();
  }

  // ====================================================================
  // Ajuste de encuadre (recorte/zoom) -- se abre SIEMPRE tras una captura
  // de cámara o una carga de archivo, para foto y firma. El trazo a mano
  // (mouse/touch/Wacom) NO pasa por aquí: ya se dibuja directo y a escala
  // real sobre el canvas de firma, así que forzar un recorte después de
  // cada trazo interrumpiría el dibujo en vez de ayudarlo.
  // ====================================================================

  private abrirAjuste(tipo: 'foto' | 'firma', dataUrl: string): void {
    this.tipoAjusteActual = tipo;
    this.srcParaAjustar = dataUrl;
    this.modalManager.openModal({
      title: tipo === 'foto' ? 'Ajustar fotografía' : 'Ajustar firma',
      template: this.modalAjusteTpl,
      width: '480px',
      onAccept: () => this.confirmarAjuste(),
    });
  }

  private confirmarAjuste(): void {
    if (!this.ajustador) return;
    const resultado = this.ajustador.exportar();

    if (this.tipoAjusteActual === 'foto') {
      this.fotoCapturada = resultado;
    } else {
      this.firmaCapturada = resultado;
      // Refleja el recorte en el canvas visible de firma, no solo en la
      // variable: es lo que se ve en el modal principal y lo que
      // guardarFirmaTemporal() volvería a leer si se sigue dibujando encima.
      this.dibujarImagenEnFirma(resultado);
    }
    this.cdRef.detectChanges();
  }

  /**
   * Sube la captura actual a MEDIA_ROOT (nombrada por RFC) y deja el
   * formulario listo para la siguiente persona, sin cerrar el modal ni
   * apagar la camara -- de ahi lo de "captura continua".
   *
   * Se guarda AQUI, no al terminar: si se acumulara todo en memoria hasta el
   * final, un corte de red, un cambio de pantalla o cerrar la pestana
   * borraria el trabajo de toda la jornada.
   */
  siguienteEmpleado(): void {
    if (!this.isFotoVerde() || !this.isFirmaVerde() || !this.isDatosVerde()) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Falta capturar foto, firma o un RFC válido.');
      return;
    }

    const rfc = this.rfcEnFormulario.trim().toUpperCase();
    const rfcPrevio = this.rfcOriginal;
    this.guardando = true;
    this.cdRef.detectChanges();

    this.plantillaApi.guardarMediosPorRfc(rfc, this.fotoCapturada!, this.firmaCapturada!).subscribe({
      next: (res) => {
        this.guardando = false;
        this.registrarEnSesion(rfc, res);
        this.utils.MuestrasToast(TipoToast.Success, `Captura guardada (${rfc})`);

        if (this.modoEdicion) {
          // Si al editar se corrigio el RFC, la captura vieja quedaria
          // huerfana en disco con el nombre equivocado: hay que borrarla.
          if (rfcPrevio && rfcPrevio !== rfc) {
            this.quitarDeSesion(rfcPrevio);
            this.plantillaApi.borrarMediosPrevio(rfcPrevio).subscribe({ error: () => {} });
          }
          this.cerrarModal();
          return;
        }

        this.rfcEnFormulario = '';
        this.fotoCapturada = null;
        this.firmaCapturada = null;
        this.limpiarFirma();
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.guardando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Refleja en la lista y en localStorage lo que ya quedo en el servidor. */
  private registrarEnSesion(rfc: string, res: any): void {
    const sufijo = `?t=${Date.now()}`;
    const entrada: EnrolamientoPrevio = {
      rfc,
      // El backend guarda siempre en la misma ruta determinista, asi que al
      // recapturar la URL es identica a la anterior y el navegador serviria
      // la imagen vieja desde cache. El sufijo la fuerza a recargar.
      foto: res?.foto ? `${res.foto}${sufijo}` : this.fotoCapturada,
      firma: res?.firma ? `${res.firma}${sufijo}` : this.firmaCapturada,
    };

    const indice = this.registros.findIndex(r => r.rfc.toUpperCase() === rfc);
    if (indice >= 0) {
      this.registros[indice] = entrada;
      this.registros = [...this.registros];
    } else {
      this.registros = [entrada, ...this.registros];
    }

    if (!this.rfcsSesion.some(x => x.toUpperCase() === rfc)) {
      this.rfcsSesion = [rfc, ...this.rfcsSesion];
    }
    this.escribirSesion();
  }

  private quitarDeSesion(rfc: string): void {
    const clave = rfc.toUpperCase();
    this.registros = this.registros.filter(r => r.rfc.toUpperCase() !== clave);
    this.rfcsSesion = this.rfcsSesion.filter(r => r.toUpperCase() !== clave);
    this.escribirSesion();
  }

  // ====================================================================
  // Terminar / cancelar
  // ====================================================================

  confirmarTerminar(): void {
    if (!this.registros.length) return;

    this.confirmMessage =
      `¿Finalizar el enrolamiento de ${this.registros.length} personas? `
      + 'Sus fotos y firmas YA están guardadas en el servidor; solo se cierra esta sesión.';

    this.modalManager.openModal({
      title: 'Terminar enrolamiento',
      template: this.confirmDialog,
      onAccept: () => {
        const total = this.registros.length;
        // Los archivos se quedan: terminar solo limpia la sesion de trabajo.
        this.registros = [];
        this.rfcsSesion = [];
        this.escribirSesion();
        this.utils.MuestrasToast(TipoToast.Success, `Enrolamiento finalizado (${total} personas).`);
        this.cdRef.detectChanges();
      },
    });
  }

  confirmarCancelar(): void {
    if (!this.registros.length) return;

    this.confirmMessage =
      `¿Cancelar el enrolamiento? Se BORRARÁN del servidor las fotos y firmas de `
      + `las ${this.registros.length} personas capturadas en esta sesión.`;

    this.modalManager.openModal({
      title: 'Cancelar enrolamiento',
      template: this.confirmDialog,
      onAccept: () => this.cancelarEnrolamiento(),
    });
  }

  /** Borra del servidor todo lo capturado en la sesion y la vacia. */
  private async cancelarEnrolamiento(): Promise<void> {
    this.guardando = true;
    this.cdRef.detectChanges();

    const fallidos: EnrolamientoPrevio[] = [];
    for (const registro of this.registros) {
      try {
        await firstValueFrom(this.plantillaApi.borrarMediosPrevio(registro.rfc));
      } catch {
        fallidos.push(registro);
      }
    }

    // Lo que no se pudo borrar sigue en el servidor: se conserva en la lista
    // para reintentar, en vez de dejar archivos huerfanos sin rastro.
    this.registros = fallidos;
    this.rfcsSesion = fallidos.map(r => r.rfc);
    this.escribirSesion();
    this.guardando = false;

    if (fallidos.length) {
      this.utils.MuestrasToast(
        TipoToast.Warning,
        `No se pudieron borrar ${fallidos.length} capturas; siguen en la lista.`
      );
    } else {
      this.utils.MuestrasToast(TipoToast.Success, 'Enrolamiento cancelado y capturas eliminadas.');
    }
    this.cdRef.detectChanges();
  }

  /** Quita una captura de la sesion y borra sus archivos del servidor. */
  confirmarQuitar(registro: EnrolamientoPrevio): void {
    this.confirmMessage =
      `¿Eliminar la captura de ${registro.rfc}? Se borrarán su foto y su firma del servidor.`;

    this.modalManager.openModal({
      title: 'Eliminar captura',
      template: this.confirmDialog,
      onAccept: () => {
        this.plantillaApi.borrarMediosPrevio(registro.rfc).subscribe({
          next: () => {
            this.quitarDeSesion(registro.rfc);
            this.utils.MuestrasToast(TipoToast.Success, 'Captura eliminada');
            this.cdRef.detectChanges();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  // ====================================================================
  // Camara
  // ====================================================================

  async iniciarCamara(deviceId?: string): Promise<void> {
    this.detenerCamara();
    if (!soportaCamara()) {
      if (this.avisoCamara) this.utils.MuestrasToast(TipoToast.Warning, this.avisoCamara);
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      await this.listarCamaras();

      setTimeout(() => {
        if (this.videoElement) this.videoElement.nativeElement.srcObject = this.stream;
      }, 100);
    } catch (err) {
      console.warn('Error al iniciar cámara:', err);
    }
  }

  private async listarCamaras(): Promise<void> {
    try {
      const dispositivos = await navigator.mediaDevices.enumerateDevices();
      this.dispositivosVideo = dispositivos.filter(d => d.kind === 'videoinput');
      const track = this.stream?.getVideoTracks()[0];
      const settings = track?.getSettings();
      if (settings?.deviceId) this.camaraSeleccionadaId = settings.deviceId;
    } catch { /* sin permisos aun: se resuelve al conceder la camara */ }
  }

  cambiarCamara(evento: any): void {
    this.iniciarCamara(evento.target.value);
  }

  detenerCamara(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  capturarFoto(): void {
    if (!this.videoElement || !this.canvasElement) return;
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    // PNG y no JPEG: el backend guarda todo en PNG, y capturar en JPEG para
    // luego convertir dejaria los artefactos de compresion grabados.
    this.abrirAjuste('foto', canvas.toDataURL('image/png'));
  }

  repetirFoto(): void {
    // No se reinicia la camara: el stream sigue vivo detras del [hidden].
    this.fotoCapturada = null;
  }

  async onArchivoFotoSeleccionado(evento: any): Promise<void> {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) return;

    if (archivo.size > 8 * 1024 * 1024) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo es muy pesado. Máximo 8MB.');
      return;
    }

    if (this.pdfService.esPdf(archivo)) {
      await this.convertirYAjustarPdf('foto', archivo);
      return;
    }
    if (!archivo.type?.startsWith('image/')) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo debe ser una imagen o un PDF.');
      return;
    }

    const lector = new FileReader();
    lector.onload = () => this.abrirAjuste('foto', lector.result as string);
    lector.readAsDataURL(archivo);
  }

  /** Convierte la primera página de un PDF a imagen y de ahí pasa directo al ajuste de encuadre. */
  private async convertirYAjustarPdf(tipo: 'foto' | 'firma', archivo: File): Promise<void> {
    this.convirtiendoPdf = true;
    this.cdRef.detectChanges();
    try {
      const dataUrl = await this.pdfService.primeraPaginaComoDataUrl(archivo);
      this.abrirAjuste(tipo, dataUrl);
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
    } finally {
      this.convirtiendoPdf = false;
      this.cdRef.detectChanges();
    }
  }

  // ====================================================================
  // Firma (mouse/touch + Wacom STU por WebHID)
  // ====================================================================

  inicializarCanvasFirma(): void {
    if (!this.firmaCanvas) return;
    const canvasEl = this.firmaCanvas.nativeElement;
    const escala = Math.max(window.devicePixelRatio || 1, 1);

    this.cx = canvasEl.getContext('2d', { desynchronized: true });

    // Respaldo si el modal aun no termino de pintarse y las medidas salen 0
    // (ver comentario en abrirModal()): sin esto el canvas quedaria 0x0 y el
    // trazo seria invisible.
    const anchoCss = canvasEl.offsetWidth || 400;
    const altoCss = canvasEl.offsetHeight || 300;
    canvasEl.width = anchoCss * escala;
    canvasEl.height = altoCss * escala;

    if (this.cx) {
      this.cx.lineWidth = 3 * escala;
      this.cx.lineCap = 'round';
      this.cx.lineJoin = 'round';
      this.cx.strokeStyle = '#000000';
      this.cx.imageSmoothingEnabled = true;
    }
  }

  private coordenadas(evento: MouseEvent | TouchEvent): { x: number; y: number } {
    const canvasEl = this.firmaCanvas.nativeElement;
    const rect = canvasEl.getBoundingClientRect();
    const escalaX = canvasEl.width / rect.width;
    const escalaY = canvasEl.height / rect.height;
    const [clientX, clientY] = evento instanceof MouseEvent
      ? [evento.clientX, evento.clientY]
      : [evento.touches[0].clientX, evento.touches[0].clientY];
    return { x: (clientX - rect.left) * escalaX, y: (clientY - rect.top) * escalaY };
  }

  startDrawing(evento: MouseEvent | TouchEvent): void {
    if (!this.cx) return;
    this.isDrawing = true;
    const { x, y } = this.coordenadas(evento);
    this.cx.beginPath();
    this.cx.moveTo(x, y);
  }

  moveDrawing(evento: MouseEvent | TouchEvent): void {
    if (!this.isDrawing || !this.cx) return;
    const { x, y } = this.coordenadas(evento);
    this.cx.lineTo(x, y);
    this.cx.stroke();
    evento.preventDefault();
  }

  stopDrawing(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.cx?.closePath();
    this.guardarFirmaTemporal();
  }

  async conectarWacom(): Promise<void> {
    this.wacomConnected = await this.wacomService.conectar();
    if (!this.wacomConnected) {
      this.utils.MuestrasToast(TipoToast.Error, 'No se pudo conectar la tableta. Verifique conexión USB y permisos.');
      return;
    }

    this.wacomSub?.unsubscribe();
    const penSub = this.wacomService.getPenData().subscribe(data => this.procesarTrazoWacom(data));
    const desconexionSub = this.wacomService.getDisconnectEvent().subscribe(() => {
      this.wacomConnected = false;
      this.utils.MuestrasToast(TipoToast.Warning, 'Tableta Wacom desconectada');
      this.wacomSub?.unsubscribe();
      this.wacomSub = null;
    });
    this.wacomSub = penSub;
    this.wacomSub.add(desconexionSub);

    this.utils.MuestrasToast(TipoToast.Success, 'Tableta Wacom conectada');
  }

  private procesarTrazoWacom(data: any): void {
    if (!this.cx || !data) return;

    // Calibracion fija de la STU-430: el capability report del driver reporta
    // valores con endianness incorrecta, por eso no se usa getTabletInfo().
    const tabletW = 9750;
    const tabletH = 6100;
    const canvasEl = this.firmaCanvas.nativeElement;
    const x = (data.x / tabletW) * canvasEl.width;
    const y = (data.y / tabletH) * canvasEl.height;

    if (data.isDown) {
      if (!this.isDrawing) {
        this.isDrawing = true;
        this.cx.beginPath();
        this.cx.moveTo(x, y);
      } else {
        this.cx.lineTo(x, y);
        this.cx.stroke();
      }
    } else if (this.isDrawing) {
      this.isDrawing = false;
      this.cx.closePath();
      this.guardarFirmaTemporal();
      // Los paquetes del lapiz llegan fuera de NgZone (a proposito, para no
      // disparar deteccion de cambios a 200Hz), asi que hay que forzarla aqui.
      this.cdRef.detectChanges();
    }
  }

  limpiarFirma(): void {
    this.firmaCapturada = null;
    if (this.firmaCanvas && this.cx) {
      const canvasEl = this.firmaCanvas.nativeElement;
      this.cx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      if (this.wacomConnected) this.wacomService.limpiarPantalla();
    }
  }

  private guardarFirmaTemporal(): void {
    if (this.firmaCanvas) {
      this.firmaCapturada = this.firmaCanvas.nativeElement.toDataURL('image/png');
    }
  }

  async onArchivoFirmaSeleccionado(evento: any): Promise<void> {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) return;

    if (archivo.size > 8 * 1024 * 1024) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo de firma es muy pesado. Máximo 8MB.');
      return;
    }

    if (this.pdfService.esPdf(archivo)) {
      await this.convertirYAjustarPdf('firma', archivo);
      return;
    }
    if (!archivo.type?.startsWith('image/')) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo de firma debe ser una imagen o un PDF.');
      return;
    }

    const lector = new FileReader();
    lector.onload = () => this.abrirAjuste('firma', lector.result as string);
    lector.readAsDataURL(archivo);
  }

  /** Dibuja una imagen sobre el canvas de firma, ajustada sin deformar. */
  private dibujarImagenEnFirma(dataUrl: string, marcarComoCapturada = false): void {
    const imagen = new Image();
    imagen.onload = () => {
      if (!this.cx) this.inicializarCanvasFirma();
      if (!this.cx || !this.firmaCanvas) return;

      const canvasEl = this.firmaCanvas.nativeElement;
      this.cx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      const escala = Math.min(canvasEl.width / imagen.width, canvasEl.height / imagen.height);
      const ancho = imagen.width * escala;
      const alto = imagen.height * escala;
      this.cx.drawImage(imagen, (canvasEl.width - ancho) / 2, (canvasEl.height - alto) / 2, ancho, alto);

      if (marcarComoCapturada) this.guardarFirmaTemporal();
      this.cdRef.detectChanges();
    };
    imagen.src = dataUrl;
  }
}
