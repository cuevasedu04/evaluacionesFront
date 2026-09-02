import { Component, Input, ViewChild, ElementRef, TemplateRef, AfterViewInit, OnInit, OnDestroy, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { EnrolamientoService } from '../../services/enrolamiento.service';
import { UtilsService } from '../../services/utils.service';
import { TipoToast } from '../../../api/entidades/enumeraciones';
import { Router } from '@angular/router';
import { WacomService } from '../../services/wacom.service';
import { Subscription } from 'rxjs';
import * as QRCode from 'qrcode';
import { cargoANivel, LAYOUTS_CREDENCIAL, LayoutCredencial, getLayoutCredencial } from '../../components/shared/nivel-credencial.const';

@Component({
  standalone: false,
  selector: 'app-provisional',
  templateUrl: './provisional.component.html',
  styleUrls: ['./provisional.component.scss']
})
export class ProvisionalComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  // En provisional, el empleado se inicializa vacío
  @Input() empleado: any = null;

  // Siempre es editable en provisional
  @Input() editable: boolean = true;
  @Input() isPrintMode: boolean = false;
  @Input() mostrarHeader: boolean = true;
  @Output() enrolamientoCompletado = new EventEmitter<void>();

  // Modales y Elementos
  @ViewChild('modalCamara', { static: false }) modalCamara!: TemplateRef<any>;
  @ViewChild('modalFirma', { static: false }) modalFirma!: TemplateRef<any>;
  @ViewChild('videoElement') videoElement!: ElementRef;
  @ViewChild('canvasElement') canvasElement!: ElementRef;

  // Referencia al Canvas de Firma (dentro del modal)
  @ViewChild('firmaCanvas') firmaCanvas!: ElementRef<HTMLCanvasElement>;

  modalCamaraRef: NgbModalRef | undefined;
  modalFirmaRef: NgbModalRef | undefined;

  stream: MediaStream | null = null;
  fotoCapturada: string | null = null;
  guardando: boolean = false;
  vistaCredencial: 'frente' | 'reverso' = 'frente';
  fechaActual: Date = new Date();
  qrCodeDataUrl: string | null = null;
  protected tipoCredencialLabel = 'provisional';
  protected qrPrefix = 'PROVISIONAL';
  protected esFamiliar = false;

  // Variables Camara
  dispositivosVideo: MediaDeviceInfo[] = [];
  camaraSeleccionadaId: string = '';

  // Variables para la Firma
  private cx!: CanvasRenderingContext2D | null;
  private isDrawing = false;

  // Variables Wacom
  private wacomSub: Subscription | null = null;
  public isWacomSupported = false;
  public wacomConnected = false;
  public debugInfo: string = 'Wacom: Desconectado';

  // Suavizado
  private lastX = 0;
  private lastY = 0;

  readonly layouts: LayoutCredencial[] = LAYOUTS_CREDENCIAL;

  onLayoutCambio(nuevoLayout: string): void {
    if (!this.empleado) return;
    this.empleado.nuevo_laredo = 0;
    this.empleado.familiar = 0;
    
    if (nuevoLayout === 'NUEVO_LAREDO') {
      this.empleado.nuevo_laredo = 1;
      this.empleado.layout_credencial = 'NUEVO_LAREDO';
    } else if (nuevoLayout === 'FAMILIAR') {
      this.empleado.familiar = 1;
      this.empleado.layout_credencial = 'FAMILIAR';
    } else {
      this.empleado.layout_credencial = getLayoutCredencial(nuevoLayout);
    }
  }

  getLayoutActual(): string {
    if (this.empleado?.familiar == 1) return 'FAMILIAR';
    if (this.empleado?.nuevo_laredo == 1) return 'NUEVO_LAREDO';
    const current = String(this.empleado?.layout_credencial || '').toUpperCase();
    if (current === 'ANAM_2025' || current === 'ANAM_CLASICA' || current === 'NUEVO_LAREDO' || current === 'FAMILIAR') {
      return current;
    }
    return this.empleado?.nivel_credencial ? 'ANAM_2025' : 'ANAM_CLASICA';
  }

  constructor(
    private modalManager: ModalManagerService,
    protected enrolamientoApi: EnrolamientoService,
    private utils: UtilsService,
    private router: Router,
    private wacomService: WacomService
  ) {
    this.isWacomSupported = this.wacomService.isBrowserSupported();
  }

  ngOnInit(): void {
    if (!this.empleado) {
      this.inicializarEmpleado();
      return;
    }

    this.normalizarMediaUrls();
    this.inicializarFechaExpedicion();
    this.asignarFolioSiguienteSiHaceFalta();
    this.generarQR();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['empleado'] && this.empleado) {
      this.normalizarMediaUrls();
      this.inicializarFechaExpedicion();
      this.asignarFolioSiguienteSiHaceFalta();
      this.generarQR();
    }
  }

  ngOnDestroy(): void {
      if(this.wacomSub) this.wacomSub.unsubscribe();
  }

  inicializarEmpleado() {
    this.empleado = {
        nombre: '',
        paterno: '',
        materno: '',
        num_empleado: '',
        adscripcion: '',
        puesto: '',
        fin_vig: '',
        curp: '',
        fecha_expedicion: '', // Se llenará con la fecha actual
        folio: '',    // Se llenará con el servicio
        foto: '',
        firma: '',
        rfc: '',
        inicio_vig: '',
        eladia: '',
        fecha_registro: ''
    };

    this.inicializarFechaExpedicion();
    this.asignarFolioSiguiente();
  }

  private normalizarMediaUrls() {
    if (!this.empleado) return;
    const baseUrl = 'http://127.0.0.1:8000';

    const procesar = (str: string) => {
      if (!str) return null;
      if (str.startsWith('http') || str.startsWith('data:')) return str;
      if (/\.(jpeg|jpg|png|gif|bmp|webp)$/i.test(str)) return `${baseUrl}${str}`;
      return str;
    };

    this.empleado.foto = procesar(this.empleado.foto);
    this.empleado.firma = procesar(this.empleado.firma);
  }

  protected asignarFolioSiguiente() {
    const folioRequest$ = this.esFamiliar
      ? this.enrolamientoApi.obtenerFolioMaximoFamiliares()
      : this.enrolamientoApi.obtenerFolioMaximo(this.obtenerFlagNuevoLaredo());

    folioRequest$.subscribe({
      next: (res: any) => {
        if (res && res.status === 'success' && res.siguiente_folio) {
          if (this.empleado) {
              this.empleado.folio = res.siguiente_folio;
              if (this.esFamiliar) {
                this.empleado.folio_familiares = res.siguiente_folio;
              }
          }
        }
      },
      error: (err) => {
        console.error('Error al obtener folio:', err);
        this.utils.MuestrasToast(TipoToast.Warning, `No se pudo obtener el folio de ${this.tipoCredencialLabel}`);
      }
    });
  }

  protected asignarFolioSiguienteSiHaceFalta() {
    if (!this.empleado) return;
    if (this.empleado.folio && String(this.empleado.folio).trim() !== '') return;
    this.asignarFolioSiguiente();
  }

  protected obtenerImagenFrente(): string {
    return 'img/frontalNLFINAL.jpg';
  }

  protected obtenerImagenReverso(): string {
    return 'img/reversoNLFINAL.jpg';
  }

  protected obtenerFlagNuevoLaredo(): number {
    return 1;
  }

  inicializarFechaExpedicion() {
    if (!this.empleado) return;

    if (!this.empleado.fecha_expedicion) {
      const hoy = new Date();
      this.empleado.fecha_expedicion = hoy.toISOString().split('T')[0];
    }

    if (!this.empleado.fin_vig && this.empleado.fecha_expedicion) {
      const fechaExp = new Date(this.empleado.fecha_expedicion);
      fechaExp.setFullYear(fechaExp.getFullYear() + 4);
      this.empleado.fin_vig = fechaExp.toISOString().split('T')[0];
    }
  }

  // Generamos el QR justo antes de guardar (o dinámicamente)
  async generarQR() {
    if (!this.empleado) {
      this.qrCodeDataUrl = null;
      return;
    }

    // Construir el texto del QR
    const datosQR = [
      this.empleado.num_empleado || '',
      this.empleado.rfc || '',
      this.empleado.curp || '',
      this.empleado.nombre || '',
      this.empleado.paterno || '',
      this.empleado.materno || '',
      this.empleado.puesto || '',
      this.empleado.adscripcion || '',
      this.empleado.inicio_vig || '',
      this.empleado.fin_vig || '',
      this.empleado.eladia || '',
      this.empleado.folio || '',
      this.empleado.fecha_expedicion || '',
      new Date().toISOString()
    ].join('|');

    try {
      this.qrCodeDataUrl = await QRCode.toDataURL(datosQR, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 200,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('Error al generar código QR:', error);
      this.qrCodeDataUrl = null;
    }
  }

  ngAfterViewInit(): void {
    // Canvas se inicializa en modal
  }

  separarApellidos(valor: string) {
    if (!this.empleado) return;
    if (!valor.trim().includes(' ')) {
      this.empleado.paterno = valor;
      this.empleado.materno = '';
    } else {
      const valorTrimmedStart = valor.trimStart();
      const firstSpaceIndex = valorTrimmedStart.indexOf(' ');
      if (firstSpaceIndex !== -1) {
        this.empleado.paterno = valorTrimmedStart.substring(0, firstSpaceIndex);
        this.empleado.materno = valorTrimmedStart.substring(firstSpaceIndex + 1);
      }
    }
  }

  // ==========================================
  // LÓGICA DE FOTO
  // ==========================================
  abrirCamara() {
    if (!this.modalCamara) {
      this.utils.MuestrasToast(TipoToast.Warning, 'No se pudo abrir el modal de foto. Recargue la vista e intente de nuevo.');
      return;
    }
    this.fotoCapturada = null;
    this.modalCamaraRef = this.modalManager.openModal({
      title: 'Captura de Fotografía',
      template: this.modalCamara,
      width: '600px',
      showFooter: false
    });
    this.iniciarCamara();
  }

  async iniciarCamara(deviceId?: string) {
    this.detenerCamara();

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const constraints = {
            video: deviceId ? { deviceId: { exact: deviceId } } : true
        };

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);

        setTimeout(() => {
          if(this.videoElement) this.videoElement.nativeElement.srcObject = this.stream;
        }, 100);

        const devices = await navigator.mediaDevices.enumerateDevices();
        this.dispositivosVideo = devices.filter(d => d.kind === 'videoinput');

        const track = this.stream?.getVideoTracks()[0];
        if (track) {
            const settings = track.getSettings();
            if (settings.deviceId) this.camaraSeleccionadaId = settings.deviceId;
        }

      } catch (err) {
        console.warn('Error al iniciar cámara:', err);
        this.utils.MuestrasToast(TipoToast.Warning, 'No se pudo acceder a la cámara. Verifique los permisos.');
      }
    }
  }

  cambiarCamara(event: any) {
     this.iniciarCamara(event.target.value);
  }

  capturarFoto() {
    if (!this.videoElement) return;
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    this.fotoCapturada = canvas.toDataURL('image/jpeg');
    this.detenerCamara();
  }

  onArchivoSeleccionado(event: any) {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        this.utils.MuestrasToast(TipoToast.Warning, 'La imagen es muy pesada. Máximo 5MB.');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        this.fotoCapturada = reader.result as string;
        this.detenerCamara();
      };
      reader.readAsDataURL(file);
    }
  }

  confirmarFoto() {
    if (this.fotoCapturada && this.empleado) {
      this.empleado.foto = this.fotoCapturada;
      // No generamos QR aqui todavia, solo al guardar
      if (this.modalCamaraRef) {
        this.modalCamaraRef.close();
      } else {
        this.modalManager.closeModal();
      }
    }
  }

  detenerCamara() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }


  // ==========================================
  // LÓGICA DE FIRMA
  // ==========================================

  async conectarWacom() {
    this.wacomConnected = await this.wacomService.conectar();

    if (this.wacomConnected) {
      if (this.wacomSub) this.wacomSub.unsubscribe();

      this.wacomSub = this.wacomService.getPenData().subscribe((data) => {
        this.procesarTrazoWacom(data);
      });

      this.utils.MuestrasToast(TipoToast.Success, 'Tableta Wacom Conectada');
    } else {
       this.utils.MuestrasToast(TipoToast.Error, 'No se pudo conectar la tableta. Verifique conexión USB y permisos.');
    }
  }

  procesarTrazoWacom(data: any) {
    if (!this.cx || !data) return;
    const isPenDown = data.pressure > 0;
    const tabletW = 9750;
    const tabletH = 6100;

    const canvasEl = this.firmaCanvas.nativeElement;

    // Mapeo de coordenadas
    const x = (data.x / tabletW) * canvasEl.width;
    const y = (data.y / tabletH) * canvasEl.height;

    if (data.isDown) {
       if (!this.isDrawing) {
           this.isDrawing = true;
           this.cx.beginPath();
           this.cx.moveTo(x, y);
           this.lastX = x;
           this.lastY = y;
       } else {
           const midX = (this.lastX + x) / 2;
           const midY = (this.lastY + y) / 2;
           this.cx.quadraticCurveTo(this.lastX, this.lastY, midX, midY);
           this.cx.stroke();
           this.lastX = x;
           this.lastY = y;
       }
    } else {
       if (this.isDrawing) {
           this.cx.lineTo(this.lastX, this.lastY);
           this.cx.stroke();
           this.isDrawing = false;
           this.cx.closePath();
       }
    }
  }

  abrirFirma() {
    if (!this.modalFirma) {
      this.utils.MuestrasToast(TipoToast.Warning, 'No se pudo abrir el modal de firma. Recargue la vista e intente de nuevo.');
      return;
    }
    this.modalFirmaRef = this.modalManager.openModal({
      title: 'Captura de Firma',
      template: this.modalFirma,
      width: '500px',
      showFooter: true,
      onAccept: () => this.confirmarFirma()
    });

    setTimeout(() => {
      this.inicializarCanvasFirma();
      if (this.wacomConnected) {
          this.wacomService.limpiarPantalla();
      }
    }, 200);
  }

  inicializarCanvasFirma() {
    const canvasEl = this.firmaCanvas.nativeElement;
    const scale = Math.max(window.devicePixelRatio || 1, 1);

    this.cx = canvasEl.getContext('2d', { desynchronized: true });
    canvasEl.width = canvasEl.offsetWidth * scale;
    canvasEl.height = canvasEl.offsetHeight * scale;

    if (this.cx) {
      this.cx.lineWidth = 3 * scale;
      this.cx.lineCap = 'round';
      this.cx.lineJoin = 'round';
      this.cx.strokeStyle = '#000000';
      this.cx.imageSmoothingEnabled = true;
    }
  }

  onArchivoFirmaSeleccionado(event: any) {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (!file.type?.startsWith('image/')) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El archivo de firma debe ser una imagen válida.');
      event.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.utils.MuestrasToast(TipoToast.Warning, 'La imagen de firma es muy pesada. Máximo 5MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrlOriginal = reader.result as string;
      let dataUrlProcesado = dataUrlOriginal;

      try {
        dataUrlProcesado = await this.normalizarFirmaDesdeArchivo(dataUrlOriginal);
      } catch {
        dataUrlProcesado = dataUrlOriginal;
      }

      const img = new Image();
      img.onload = () => {
        if (!this.cx) {
          this.inicializarCanvasFirma();
        }

        if (!this.cx) {
          event.target.value = '';
          return;
        }

        const canvasEl = this.firmaCanvas.nativeElement;
        this.cx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        const scale = Math.min(canvasEl.width / img.width, canvasEl.height / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const x = (canvasEl.width - drawWidth) / 2;
        const y = (canvasEl.height - drawHeight) / 2;

        this.cx.drawImage(img, x, y, drawWidth, drawHeight);
      };

      img.onerror = () => {
        this.utils.MuestrasToast(TipoToast.Error, 'No se pudo procesar la imagen de firma.');
      };

      img.src = dataUrlProcesado;
    };

    reader.readAsDataURL(file);
    event.target.value = '';
  }

  private normalizarFirmaDesdeArchivo(dataUrl: string): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;

          if (!w || !h) {
            resolve(dataUrl);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          ctx.drawImage(img, 0, 0, w, h);

          const imgData = ctx.getImageData(0, 0, w, h);
          const px = imgData.data;

          for (let i = 0; i < px.length; i += 4) {
            const r = px[i];
            const g = px[i + 1];
            const b = px[i + 2];
            if (r > 240 && g > 240 && b > 240) {
              px[i + 3] = 0;
            }
          }

          ctx.putImageData(imgData, 0, 0);

          const data2 = ctx.getImageData(0, 0, w, h).data;
          let minX = w;
          let minY = h;
          let maxX = -1;
          let maxY = -1;

          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = data2[idx];
              const g = data2[idx + 1];
              const b = data2[idx + 2];
              const alpha = data2[idx + 3];
              const oscuridad = r + g + b;

              if (alpha > 24 && oscuridad < 690) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
          }

          if (maxX < 0 || maxY < 0) {
            resolve(dataUrl);
            return;
          }

          const cropW = maxX - minX + 1;
          const cropH = maxY - minY + 1;

          const padX = Math.max(24, Math.round(cropW * 0.24));
          const padY = Math.max(16, Math.round(cropH * 0.34));
          const outW = cropW + padX * 2;
          const outH = cropH + padY * 2;

          const out = document.createElement('canvas');
          out.width = outW;
          out.height = outH;
          const outCtx = out.getContext('2d');

          if (!outCtx) {
            resolve(dataUrl);
            return;
          }

          outCtx.clearRect(0, 0, outW, outH);
          outCtx.drawImage(canvas, minX, minY, cropW, cropH, padX, padY, cropW, cropH);

          resolve(out.toDataURL('image/png'));
        } catch {
          resolve(dataUrl);
        }
      };

      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  startDrawing(event: MouseEvent | TouchEvent): void {
    if (this.wacomConnected || !this.cx) return;
    this.isDrawing = true;
    const { x, y } = this.getCoordinates(event);
    this.cx.beginPath();
    this.cx.moveTo(x, y);
  }

  moveDrawing(event: MouseEvent | TouchEvent): void {
    if(this.wacomConnected) return;
    if (!this.isDrawing) return;
    const { x, y } = this.getCoordinates(event);
    this.draw(x, y);
    event.preventDefault();
  }

  stopDrawing(): void {
    if(this.wacomConnected) return;
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.cx?.closePath();
  }

  draw(x: number, y: number): void {
    if (!this.cx) return;
    this.cx.lineTo(x, y);
    this.cx.stroke();
    this.cx.beginPath();
    this.cx.moveTo(x, y);
  }

  private getCoordinates(event: MouseEvent | TouchEvent): { x: number, y: number } {
    const canvasEl = this.firmaCanvas.nativeElement;
    const rect = canvasEl.getBoundingClientRect();

    let clientX, clientY;
    if (event instanceof TouchEvent) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  limpiarFirma() {
    const canvasEl = this.firmaCanvas.nativeElement;
    this.cx?.clearRect(0, 0, canvasEl.width, canvasEl.height);
    this.wacomService.limpiarPantalla();
  }

  confirmarFirma() {
    const canvasEl = this.firmaCanvas.nativeElement;
    const dataUrl = canvasEl.toDataURL('image/png');
    if (this.empleado) {
      this.empleado.firma = dataUrl;
      if (this.modalFirmaRef) {
        this.modalFirmaRef.close();
      } else {
        this.modalManager.closeModal();
      }
    }
  }

  async guardarEnrolamiento() {
    if (!this.empleado) return;

    if(!this.empleado.foto || (!this.empleado.firma && !this.esFamiliar)) {
      this.utils.MuestrasToast(TipoToast.Warning, this.esFamiliar ? 'Falta capturar foto' : 'Falta capturar foto o firma');
      return;
    }

    this.guardando = true;

    // 1. PRIMERO Generar QR con los datos actuales
    await this.generarQR();

    // Formatear fecha para envio
    let fechaExpedicionFormateada = this.empleado.fecha_expedicion;
    // ... lógica de formateo ...
    if (fechaExpedicionFormateada instanceof Date) {
        fechaExpedicionFormateada = fechaExpedicionFormateada.toISOString().split('T')[0];
    } else if (typeof fechaExpedicionFormateada === 'string' && fechaExpedicionFormateada.includes('T')) {
        fechaExpedicionFormateada = fechaExpedicionFormateada.split('T')[0];
    }

    const fechaEnrolamientoActual = new Date().toISOString();

    // Construir campo apellidos (concatenación de paterno y materno) y asegurar RFC
    const apellidosConcatenados = `${this.empleado.paterno || ''} ${this.empleado.materno || ''}`.trim();

    // Regla de Negocio: Si no hay RFC, usar CURP
    let rfcFinal = this.empleado.rfc;
    if ((!rfcFinal || rfcFinal.trim() === '') && this.empleado.curp) {
        rfcFinal = this.empleado.curp;
    }

    const payload: any = {
        // Datos Personales
        nombre: this.empleado.nombre,
        paterno: this.empleado.paterno,
        materno: this.empleado.materno,
        apellidos: apellidosConcatenados, // Campo faltante en el modelo

        // Datos Laborales
        num_empleado: this.empleado.num_empleado,
        adscripcion: this.empleado.adscripcion,
          puesto: this.esFamiliar ? 'FAMILIAR' : this.empleado.puesto,

          // Identificadores
          curp: this.empleado.curp,
          rfc: this.esFamiliar ? (this.empleado.num_empleado || 'S/N') : rfcFinal,
        foto: this.empleado.foto,
        firma: this.empleado.firma,          fecha_expedicion: fechaExpedicionFormateada || fechaEnrolamientoActual,
          fin_vig: this.empleado.fin_vig,
        // Metadatos y Flags
        activo: 1,
        provisional: 1,
        impreso: 0,
        nivel_credencial: this.empleado.nivel_credencial || cargoANivel(this.empleado.puesto),
        layout_credencial: this.empleado.layout_credencial || (this.obtenerFlagNuevoLaredo() === 0 ? 'ANAM_2025' : null)
    };

    if (!this.esFamiliar) {
      payload.nuevo_laredo = this.obtenerFlagNuevoLaredo();
    }

    if (this.esFamiliar) {
      payload.folio_familiares = this.empleado.folio;
      payload.nombre_reverso = this.empleado.nombre_reverso;
      payload.vivienda = this.empleado.vivienda;
      payload.marca = this.empleado.marca;
      payload.modelo = this.empleado.modelo;
      payload.color = this.empleado.color;
      payload.placas = this.empleado.placas;
    }
    // Limpieza final de campos opcionales
    if (!payload.rfc) delete payload.rfc;
    if (!payload.curp) delete payload.curp;
    if (!payload.layout_credencial) delete payload.layout_credencial;
    if (!payload.materno) payload.materno = '';

    console.log(`Enviando payload ${this.tipoCredencialLabel}:`, payload);

    const id = this.empleado.id_enrolamiento;
    const isFamiliarSource = this.empleado.source_table === 'familiar';

    let esActualizacion = !!id;
    
    // Si cambia de tipo de credencial (ej. de ANAM a Familiar), no podemos hacer PATCH en la tabla original,
    // debemos crear un registro nuevo en la tabla de destino correspondiente.
    if (this.esFamiliar && !isFamiliarSource) {
      esActualizacion = false;
    } else if (!this.esFamiliar && isFamiliarSource) {
      esActualizacion = false;
    }

    if (esActualizacion) {
      const updateRequest$ = this.esFamiliar 
        ? this.enrolamientoApi.actualizarExpedienteFamiliar(id, payload)
        : this.enrolamientoApi.actualizarExpediente(id, payload);

      updateRequest$.subscribe({
        next: () => {
          this.guardando = false;
          this.utils.MuestrasToast(TipoToast.Success, `Constancia ${this.tipoCredencialLabel} actualizada exitosamente`);
          this.enrolamientoCompletado.emit();
        },
        error: (err) => {
          console.error(`Error al actualizar ${this.tipoCredencialLabel}:`, err);
          this.guardando = false;
          this.utils.MuestraErrorInterno(err);
        }
      });
      return;
    }

    const createRequest$ = this.esFamiliar
      ? this.enrolamientoApi.crearExpedienteFamiliar(payload)
      : this.enrolamientoApi.crearExpediente(payload);

    createRequest$.subscribe({
      next: () => {
        this.guardando = false;
        this.utils.MuestrasToast(TipoToast.Success, `Constancia ${this.tipoCredencialLabel} guardada exitosamente`);
        this.empleado = null;
        this.enrolamientoCompletado.emit();
        setTimeout(() => {
          this.inicializarEmpleado();
        }, 1000);
      },
      error: (err) => {
        console.error(`Error al guardar ${this.tipoCredencialLabel}:`, err);
        this.guardando = false;

        let msg = 'Error interno';
        if (err.error) {
          if (typeof err.error === 'string') msg = err.error;
          else if (typeof err.error === 'object') msg = JSON.stringify(err.error);
        }
        this.utils.MuestrasToast(TipoToast.Error, 'Error al guardar: ' + msg);
      }
    });
  }
}
