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
  private escalaCover = 1;
  private generacion = 0;

  zoom = 1;
  readonly zoomMin = 0.5;
  readonly zoomMax = 4;

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

    // Escala "cover": la imagen cubre el marco completo sin dejar bordes
    // vacíos; el sobrante queda fuera del canvas y por eso nunca se exporta.
    this.escalaCover = Math.max(
      this.anchoMarco / (imagen.width || 1),
      this.altoMarco / (imagen.height || 1),
    );
    imagen.set({
      originX: 'center', originY: 'center',
      left: this.anchoMarco / 2, top: this.altoMarco / 2,
      scaleX: this.escalaCover, scaleY: this.escalaCover,
      hasControls: false, hasBorders: false,
    });

    this.zoom = 1;
    this.canvas.add(imagen);
    this.canvas.setActiveObject(imagen);
    this.imagenObj = imagen;
    this.canvas.renderAll();
  }

  onZoomChange(valor: number | string): void {
    const nuevoZoom = Number(valor);
    if (!this.imagenObj || !this.canvas || !Number.isFinite(nuevoZoom)) return;
    this.zoom = nuevoZoom;
    const centro = this.imagenObj.getCenterPoint();
    this.imagenObj.set({ scaleX: this.escalaCover * nuevoZoom, scaleY: this.escalaCover * nuevoZoom });
    // Ancla el zoom al centro visual actual, no a una esquina.
    this.imagenObj.setPositionByOrigin(centro, 'center', 'center');
    this.canvas.renderAll();
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
