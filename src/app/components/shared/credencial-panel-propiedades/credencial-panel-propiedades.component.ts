import { Component, EventEmitter, Input, Output } from '@angular/core';
import * as fabric from 'fabric';

import { CredencialRenderService } from '../../../services/credencial-render.service';
import { ALINEACIONES, FUENTES_DISPONIBLES } from '../../../content/plantilla-editor/plantilla-editor.const';

/**
 * Panel de propiedades de un objeto Fabric seleccionado (fuente, tamaño,
 * color, alineación, capas, opacidad, rotación, duplicar/eliminar).
 *
 * Extraído de plantilla-editor.component para poder reutilizarlo tal cual en
 * imprimir-credenciales.component (edición rápida antes de imprimir) sin
 * duplicar la lógica ni arriesgar que las dos copias se desincronicen.
 *
 * El componente no es dueño del canvas ni de la seleccion: solo las recibe
 * por @Input y muta el objeto directamente (canvas.renderAll()). Cuando una
 * accion cambia CUAL objeto esta seleccionado (duplicar, eliminar), lo avisa
 * por @Output para que el padre actualice su propia referencia.
 */
@Component({
  standalone: false,
  selector: 'app-credencial-panel-propiedades',
  templateUrl: './credencial-panel-propiedades.component.html',
  styleUrls: ['./credencial-panel-propiedades.component.scss'],
})
export class CredencialPanelPropiedadesComponent {

  @Input() canvas: fabric.Canvas | null = null;
  @Input() objeto: fabric.FabricObject | null = null;
  /** Nombres de fuente para el selector -- por omision solo las del sistema/build; quien la use puede sumarle las personalizadas ya subidas (ver PlantillaEditorComponent.fuentesTexto). */
  @Input() fuentes: string[] = FUENTES_DISPONIBLES;
  /** Si se muestra el boton "+" para subir una fuente propia junto al selector. Falso en consumidores que no administran plantillas (p.ej. la edicion rapida de "Imprimir constancias"). */
  @Input() permitirSubirFuente = false;
  @Input() subiendoFuente = false;

  /** Se emite cuando la seleccion activa cambia (duplicar, eliminar). */
  @Output() seleccionCambiada = new EventEmitter<fabric.FabricObject | null>();
  /** Se emite en cualquier mutacion, para que el padre marque "hay cambios". */
  @Output() cambio = new EventEmitter<void>();
  /** El usuario dio clic en "+" junto al selector de fuente -- el padre es quien sabe abrir el modal/input de archivo. */
  @Output() subirFuente = new EventEmitter<void>();

  readonly alineaciones = ALINEACIONES;

  get esTexto(): boolean {
    const tipo = this.objeto?.type;
    return tipo === 'textbox' || tipo === 'text' || tipo === 'i-text';
  }

  /** Figuras del catalogo "Formas" (ver plantilla-editor.const.ts, CATALOGO_FORMAS) -- object.data.binding = 'forma_<tipo>'. */
  get esFigura(): boolean {
    return !!this.datosSeleccion?.binding?.startsWith('forma_');
  }

  /** Una linea se pinta con `stroke` (no tiene relleno); el resto de las figuras usan `fill`. */
  get colorFiguraPropiedad(): 'fill' | 'stroke' {
    return this.objeto?.type === 'line' ? 'stroke' : 'fill';
  }

  /** Solo un fabric.Rect tiene esquinas que redondear (rx/ry). */
  get esFiguraRectangular(): boolean {
    return this.esFigura && this.objeto?.type === 'rect';
  }

  /**
   * Tope del radio de esquina: mas alla de la mitad del lado mas chico ya no
   * hay esquina que redondear (el rectangulo se vuelve una pastilla/circulo
   * completo) -- limitar el slider ahi evita un radio "de sobra" que no
   * cambia nada visualmente.
   */
  get radioEsquinaMax(): number {
    const obj = this.objeto as any;
    if (!obj) return 0;
    return Math.max(0, Math.min(obj.width || 0, obj.height || 0) / 2);
  }

  /** rx y ry siempre iguales -- un solo control ("Radio de esquina") en vez de dos, ver credencial-panel-propiedades.component.html. */
  actualizarRadioEsquina(valor: number): void {
    if (!this.objeto || !this.canvas) return;
    this.objeto.set({ rx: valor, ry: valor } as any);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  get datosSeleccion(): any {
    return (this.objeto as any)?.data || {};
  }

  propiedad(nombre: string): any {
    return (this.objeto as any)?.[nombre];
  }

  actualizarPropiedad(nombre: string, valor: any): void {
    if (!this.objeto || !this.canvas) return;
    this.objeto.set(nombre as any, valor);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  actualizarDato(nombre: string, valor: any): void {
    if (!this.objeto || !this.canvas) return;
    const data = (this.objeto as any).data || {};
    data[nombre] = valor;
    (this.objeto as any).data = data;
    this.canvas.renderAll();
    this.cambio.emit();
  }

  alternarNegrita(): void {
    const actual = this.propiedad('fontWeight');
    this.actualizarPropiedad('fontWeight', actual === 'bold' ? 'normal' : 'bold');
  }

  alternarCursiva(): void {
    const actual = this.propiedad('fontStyle');
    this.actualizarPropiedad('fontStyle', actual === 'italic' ? 'normal' : 'italic');
  }

  // ---- Capas y posicion ----

  traerAlFrente(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.bringObjectToFront(this.objeto);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  /** Sube UN nivel (al contrario de traerAlFrente, que lo manda hasta arriba de todo). */
  adelantarCapa(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.bringObjectForward(this.objeto);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  /** Baja UN nivel (al contrario de enviarAlFondo, que lo manda hasta el fondo de todo). */
  atrasarCapa(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.sendObjectBackwards(this.objeto);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  enviarAlFondo(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.sendObjectToBack(this.objeto);
    this.canvas.renderAll();
    this.cambio.emit();
  }

  centrarHorizontal(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.centerObjectH(this.objeto);
    this.objeto.setCoords();
    this.canvas.renderAll();
    this.cambio.emit();
  }

  centrarVertical(): void {
    if (!this.objeto || !this.canvas) return;
    this.canvas.centerObjectV(this.objeto);
    this.objeto.setCoords();
    this.canvas.renderAll();
    this.cambio.emit();
  }

  duplicarSeleccion(): void {
    if (!this.objeto || !this.canvas) return;
    const canvas = this.canvas;
    const original = this.objeto;

    original.clone(CredencialRenderService.PROPS_EXTRA as any).then((copia: fabric.FabricObject) => {
      copia.set({
        left: (original.left || 0) + 20,
        top: (original.top || 0) + 20,
      });
      canvas.add(copia);
      canvas.setActiveObject(copia);
      canvas.renderAll();
      this.seleccionCambiada.emit(copia);
      this.cambio.emit();
    });
  }

  eliminarSeleccion(): void {
    if (!this.canvas) return;
    const activos = this.canvas.getActiveObjects();
    if (!activos.length) return;

    activos.forEach(obj => this.canvas!.remove(obj));
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    this.seleccionCambiada.emit(null);
    this.cambio.emit();
  }
}
