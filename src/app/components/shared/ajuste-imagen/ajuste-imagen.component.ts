import {
  Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild,
} from '@angular/core';
import * as fabric from 'fabric';

/**
 * Mini editor de encuadre reutilizado por enrolamiento-previo e
 * imprimir-credenciales: tras CUALQUIER captura o carga de foto/firma
 * (cámara, archivo, PDF convertido), se pasa por aquí para poder centrar,
 * mover o hacer zoom antes de guardar -- así una foto movida no obliga a
 * repetir la captura física ni reajustar la cámara.
 *
 * El canvas de Fabric se crea del tamaño EXACTO del marco de salida: lo que
 * quede fuera de esos límites simplemente no se exporta, sin necesidad de
 * clipPath. Mismo patrón de `toDataURL({multiplier})` que ya usa
 * CredencialRenderService.
 */
@Component({
  standalone: false,
  selector: 'app-ajuste-imagen',
  templateUrl: './ajuste-imagen.component.html',
  styleUrls: ['./ajuste-imagen.component.scss'],
})
export class AjusteImagenComponent implements OnChanges, OnDestroy {
  @Input() src: string | null = null;
  @Input() anchoMarco = 360;
  @Input() altoMarco = 450;
  /** Firma: fondo cuadriculado (para ver la transparencia) y exporta PNG. Foto: fondo blanco y exporta JPEG. */
  @Input() fondoTransparente = false;

  @ViewChild('lienzo', { static: true }) lienzoRef!: ElementRef<HTMLCanvasElement>;

  private canvas: fabric.Canvas | null = null;
  private imagenObj: fabric.FabricImage | null = null;
  // "Cover" mínimo para el ÁNGULO ACTUAL, no un valor fijo calculado una sola
  // vez: al rotar, la imagen necesita más escala para seguir tapando las
  // esquinas del marco (ver recalcularEscalaCover). Se recalcula cada vez
  // que cambia el ángulo, y el zoom sigue multiplicando sobre este valor.
  private escalaCover = 1;
  private generacion = 0;

  zoom = 1;
  readonly zoomMin = 0.5;
  readonly zoomMax = 4;

  /** Rotación exacta en saltos de 90°, vía los botones. */
  rotacionBase = 0;
  /** Ajuste fino (enderezar), independiente de rotacionBase. */
  inclinacion = 0;
  readonly inclinacionMin = -45;
  readonly inclinacionMax = 45;

  private get anguloTotal(): number {
    return this.rotacionBase + this.inclinacion;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['src'] && this.src) {
      this.reconstruir();
    }
  }

  ngOnDestroy(): void {
    this.canvas?.dispose();
  }

  private async reconstruir(): Promise<void> {
    const miGeneracion = ++this.generacion;

    // Doble requestAnimationFrame: si se crea el canvas antes de que el
    // navegador PINTE el modal, el elemento aún no tiene tamaño real (ver
    // CLAUDE.md, gotcha #13 -- mismo problema que la firma en un modal).
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (miGeneracion !== this.generacion) return; // el src ya cambió otra vez mientras esperábamos

    this.canvas?.dispose();
    const elemento = this.lienzoRef.nativeElement;
    this.canvas = new fabric.Canvas(elemento, {
      width: this.anchoMarco,
      height: this.altoMarco,
      backgroundColor: this.fondoTransparente ? undefined : '#ffffff',
      selection: false,
    });

    if (!this.src) return;
    const imagen = await fabric.FabricImage.fromURL(this.src);
    if (miGeneracion !== this.generacion) return;

    imagen.set({
      originX: 'center', originY: 'center',
      left: this.anchoMarco / 2, top: this.altoMarco / 2,
      hasControls: false, hasBorders: false,
    });

    this.zoom = 1;
    this.rotacionBase = 0;
    this.inclinacion = 0;
    this.canvas.add(imagen);
    this.canvas.setActiveObject(imagen);
    this.imagenObj = imagen;
    // Con el objeto ya en el canvas: aplica escala "cover" + ángulo inicial (0).
    this.aplicarEscalaYAngulo();
    this.canvas.renderAll();
  }

  /**
   * Escala mínima para que la imagen, YA ROTADA el ángulo actual, siga
   * cubriendo el marco completo sin dejar huecos en las esquinas.
   *
   * Es el mismo truco que usan los recortadores de foto: cubrir un marco
   * rotado -θ equivale a cubrir, SIN rotar, la caja que ocupa ese marco
   * proyectada al sistema de referencia de la imagen. Con θ=0 (sin rotar)
   * se reduce exactamente a la fórmula "cover" original
   * (anchoMarco/imgWidth, altoMarco/imgHeight).
   */
  private recalcularEscalaCover(): number {
    if (!this.imagenObj) return 1;
    const rad = (this.anguloTotal * Math.PI) / 180;
    const anchoImg = this.imagenObj.width || 1;
    const altoImg = this.imagenObj.height || 1;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const anchoEfectivo = this.anchoMarco * cos + this.altoMarco * sin;
    const altoEfectivo = this.anchoMarco * sin + this.altoMarco * cos;
    return Math.max(anchoEfectivo / anchoImg, altoEfectivo / altoImg);
  }

  /** Aplica ángulo + escala (cover recalculado para ese ángulo, por el zoom actual), anclado al centro visual. */
  private aplicarEscalaYAngulo(): void {
    if (!this.imagenObj || !this.canvas) return;
    const centro = this.imagenObj.getCenterPoint();
    this.escalaCover = this.recalcularEscalaCover();
    this.imagenObj.set({
      angle: this.anguloTotal,
      scaleX: this.escalaCover * this.zoom,
      scaleY: this.escalaCover * this.zoom,
    });
    // Ancla la transformación al centro visual actual, no a una esquina.
    this.imagenObj.setPositionByOrigin(centro, 'center', 'center');
    this.canvas.renderAll();
  }

  onZoomChange(valor: number | string): void {
    const nuevoZoom = Number(valor);
    if (!this.imagenObj || !Number.isFinite(nuevoZoom)) return;
    this.zoom = nuevoZoom;
    this.aplicarEscalaYAngulo();
  }

  /** Rota 90° exactos, hacia la izquierda (sentido antihorario). */
  rotarIzquierda(): void {
    // ((x % 360) + 360) % 360: normaliza a [0, 360) -- el % de JS puede dar
    // negativos (-90 % 360 === -90), y se prefiere un valor siempre legible.
    this.rotacionBase = (((this.rotacionBase - 90) % 360) + 360) % 360;
    this.aplicarEscalaYAngulo();
  }

  /** Rota 90° exactos, hacia la derecha (sentido horario). */
  rotarDerecha(): void {
    this.rotacionBase = (this.rotacionBase + 90) % 360;
    this.aplicarEscalaYAngulo();
  }

  /** Ajuste fino para enderezar (p. ej. una foto ligeramente ladeada), independiente de los saltos de 90°. */
  onInclinacionChange(valor: number | string): void {
    const nuevaInclinacion = Number(valor);
    if (!Number.isFinite(nuevaInclinacion)) return;
    this.inclinacion = nuevaInclinacion;
    this.aplicarEscalaYAngulo();
  }

  centrar(): void {
    if (!this.imagenObj || !this.canvas) return;
    this.imagenObj.set({ left: this.anchoMarco / 2, top: this.altoMarco / 2 });
    this.canvas.renderAll();
  }

  /** Llamado por el host (vía ViewChild) al aceptar el modal -- exporta el recorte final. */
  exportar(multiplicador = 2): string {
    if (!this.canvas) return this.src || '';
    return this.canvas.toDataURL({
      format: this.fondoTransparente ? 'png' : 'jpeg',
      quality: 0.92,
      multiplier: multiplicador,
    });
  }
}
