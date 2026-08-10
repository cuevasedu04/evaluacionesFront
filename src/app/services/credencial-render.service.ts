import { Injectable } from '@angular/core';
import * as fabric from 'fabric';
import jsPDF from 'jspdf';
import * as QRCode from 'qrcode';

import {
  CANVAS_ALTO_PX,
  CANVAS_ANCHO_PX,
  CREDENCIAL_ALTO_MM,
  CREDENCIAL_ANCHO_MM,
  MULTIPLICADOR_EXPORT,
  CaraCredencial,
  FUENTES_PERSONALIZADAS,
} from '../content/plantilla-editor/plantilla-editor.const';
import { PlantillaCredencial } from './plantilla-credencial.service';

/**
 * Renderiza una plantilla + los datos de un empleado y genera el PDF.
 *
 * Principio de fidelidad: el PDF se produce desde EXACTAMENTE el mismo JSON de
 * Fabric y el mismo espacio de coordenadas (638x1016) que usa el editor. No hay
 * una segunda capa HTML/CSS que se pueda desincronizar, por lo que lo impreso es
 * pixel a pixel lo disenado, solo que rasterizado a mayor resolucion.
 */
@Injectable({ providedIn: 'root' })
export class CredencialRenderService {

  /**
   * Propiedades extra que deben sobrevivir la serializacion de Fabric.
   * Sin 'data' se perderia el binding y la plantilla ya no sabria que dato
   * inyectar en cada elemento al generar la credencial.
   */
  static readonly PROPS_EXTRA: string[] = ['data', 'selectable', 'evented'];

  /** Una sola carga de fuentes por sesion; se reutiliza la misma promesa. */
  private fuentesListas: Promise<void> | null = null;

  /**
   * Garantiza que las fuentes personalizadas esten cargadas ANTES de dibujar.
   *
   * El navegador solo descarga una @font-face cuando algun elemento del DOM la
   * usa. Fabric dibuja sobre <canvas>, que NO dispara esa carga: si la fuente
   * aun no esta lista, el canvas cae al tipo por omision sin ningun error, y
   * la credencial se imprime en Arial aunque la plantilla diga NotoSans-Black.
   * Peor aun, seria intermitente: funcionaria en cuanto algo mas del sistema
   * hubiera usado la fuente antes.
   */
  async asegurarFuentes(): Promise<void> {
    if (this.fuentesListas) return this.fuentesListas;

    this.fuentesListas = (async () => {
      const fuentes = (document as any).fonts;
      if (!fuentes?.load) return;   // navegador sin CSS Font Loading API

      await Promise.all(
        FUENTES_PERSONALIZADAS.map(f => fuentes.load(`16px "${f}"`).catch(() => null))
      );
      await fuentes.ready;
    })();

    return this.fuentesListas;
  }

  // ====================================================================
  // API publica
  // ====================================================================

  /**
   * Construye un canvas fuera de pantalla con la plantilla ya poblada con los
   * datos del empleado. Quien llama es responsable de hacer dispose().
   */
  async renderizarCara(
    plantilla: PlantillaCredencial,
    cara: CaraCredencial,
    empleado: any
  ): Promise<fabric.StaticCanvas> {
    await this.asegurarFuentes();

    const ancho = plantilla.ancho_px || CANVAS_ANCHO_PX;
    const alto = plantilla.alto_px || CANVAS_ALTO_PX;

    const elemento = document.createElement('canvas');
    elemento.width = ancho;
    elemento.height = alto;

    const canvas = new fabric.StaticCanvas(elemento, {
      width: ancho,
      height: alto,
      backgroundColor: '#ffffff',
    });

    const json = cara === 'frente' ? plantilla.canvas_frente : plantilla.canvas_reverso;
    if (json) {
      await canvas.loadFromJSON(json);
    }

    const fondo = cara === 'frente'
      ? (plantilla.fondo_frente_url || plantilla.fondo_frente)
      : (plantilla.fondo_reverso_url || plantilla.fondo_reverso);

    await this.aplicarFondo(canvas, fondo, ancho, alto);
    await this.poblarDatos(canvas, empleado);

    canvas.renderAll();
    return canvas;
  }

  /** Renderiza una cara y la devuelve como data-URL PNG de alta resolucion. */
  async renderizarCaraComoImagen(
    plantilla: PlantillaCredencial,
    cara: CaraCredencial,
    empleado: any,
    multiplicador = MULTIPLICADOR_EXPORT
  ): Promise<string> {
    const canvas = await this.renderizarCara(plantilla, cara, empleado);
    try {
      return this.exportarCanvasComoImagen(canvas, multiplicador);
    } finally {
      canvas.dispose();
    }
  }

  /**
   * Dibuja un lienzo ya congelado (el snapshot que se guardo al imprimir) y lo
   * devuelve como imagen. Es el camino de la pantalla de auditoria.
   *
   * A diferencia de renderizarCara(), aqui NO se aplica el fondo de la
   * plantilla ni se vuelve a poblar ningun campo. Ese es justo el punto: el
   * snapshot ya trae su propio `backgroundImage` y sus textos con los valores
   * que salieron impresos. Repoblarlo escribiria el folio y la fecha de HOY
   * sobre una credencial de hace meses, y aplicarle el fondo actual la
   * repintaria con una plantilla que quiza ya cambio -- en ambos casos la
   * auditoria mostraria un documento que nunca existio.
   */
  async renderizarSnapshotComoImagen(
    canvasJson: any,
    ancho = CANVAS_ANCHO_PX,
    alto = CANVAS_ALTO_PX,
    multiplicador = 1
  ): Promise<string> {
    const canvas = await this.construirCanvasDesdeSnapshot(canvasJson, ancho, alto);
    try {
      return this.exportarCanvasComoImagen(canvas, multiplicador);
    } finally {
      canvas.dispose();
    }
  }

  /**
   * Regenera el PDF de una credencial ya expedida a partir de sus lienzos
   * congelados: mismo tamano fisico, misma resolucion de exportacion y mismo
   * orden de paginas (frente, reverso) que la impresion original.
   *
   * Es un duplicado exacto, no una reimpresion: no consume folio, no toca el
   * historial y no vuelve a poblar ningun campo -- sale con el folio y la
   * fecha con los que se expidio.
   */
  async generarPdfDesdeSnapshots(
    canvasFrenteJson: any,
    canvasReversoJson: any | null,
    opciones: {
      ancho_px?: number; alto_px?: number;
      ancho_mm?: number | string; alto_mm?: number | string;
      nombreArchivo?: string; guardar?: boolean;
    } = {}
  ): Promise<jsPDF> {
    const anchoPx = opciones.ancho_px || CANVAS_ANCHO_PX;
    const altoPx = opciones.alto_px || CANVAS_ALTO_PX;

    const frente = await this.construirCanvasDesdeSnapshot(canvasFrenteJson, anchoPx, altoPx);
    const reverso = canvasReversoJson
      ? await this.construirCanvasDesdeSnapshot(canvasReversoJson, anchoPx, altoPx)
      : null;

    try {
      return await this.generarPdfDesdeCanvases(
        frente, reverso,
        { ancho_mm: opciones.ancho_mm, alto_mm: opciones.alto_mm },
        null,
        {
          nombreArchivo: opciones.nombreArchivo || 'Credencial.pdf',
          guardar: opciones.guardar,
        }
      );
    } finally {
      frente.dispose();
      reverso?.dispose();
    }
  }

  /** Canvas fuera de pantalla con un lienzo congelado, listo para exportar. */
  private async construirCanvasDesdeSnapshot(
    canvasJson: any,
    ancho: number,
    alto: number
  ): Promise<fabric.StaticCanvas> {
    await this.asegurarFuentes();

    const elemento = document.createElement('canvas');
    elemento.width = ancho;
    elemento.height = alto;

    const canvas = new fabric.StaticCanvas(elemento, {
      width: ancho,
      height: alto,
      backgroundColor: '#ffffff',
    });

    await canvas.loadFromJSON(canvasJson);
    canvas.renderAll();
    return canvas;
  }

  /**
   * Construye un canvas INTERACTIVO (fabric.Canvas, no StaticCanvas) enlazado
   * a un <canvas> real del DOM, poblado con los datos del empleado -- para
   * permitir ajustes rapidos (mover/redimensionar/tipografia) antes de
   * imprimir sin tocar la plantilla guardada en BD. Es una copia en memoria:
   * nada de lo que se edite aqui se persiste a menos que se llame a
   * guardar() sobre la plantilla misma (fuera de este servicio).
   *
   * A diferencia de renderizarCara(), las imagenes pobladas (foto/firma/QR)
   * quedan seleccionables/movibles -- vease el parametro `interactivo` en
   * poblarDatos(). Quien llama es responsable de hacer dispose().
   */
  async construirCanvasEditable(
    plantilla: PlantillaCredencial,
    cara: CaraCredencial,
    empleado: any,
    elementoDom: HTMLCanvasElement
  ): Promise<fabric.Canvas> {
    await this.asegurarFuentes();

    const ancho = plantilla.ancho_px || CANVAS_ANCHO_PX;
    const alto = plantilla.alto_px || CANVAS_ALTO_PX;

    const canvas = new fabric.Canvas(elementoDom, {
      width: ancho,
      height: alto,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: true,
    });

    const json = cara === 'frente' ? plantilla.canvas_frente : plantilla.canvas_reverso;
    if (json) {
      await canvas.loadFromJSON(json);
    }

    const fondo = cara === 'frente'
      ? (plantilla.fondo_frente_url || plantilla.fondo_frente)
      : (plantilla.fondo_reverso_url || plantilla.fondo_reverso);

    await this.aplicarFondo(canvas, fondo, ancho, alto);
    await this.poblarDatos(canvas, empleado, true);

    canvas.renderAll();
    return canvas;
  }

  /**
   * Genera el PDF directamente desde canvases ya construidos (p.ej. el canvas
   * editable de "Imprimir credenciales", con los ajustes de ultimo momento ya
   * aplicados) en vez de reconstruir desde la plantilla guardada -- garantiza
   * que lo impreso sea exactamente lo que se ve, ediciones incluidas.
   */
  async generarPdfDesdeCanvases(
    canvasFrente: fabric.Canvas | fabric.StaticCanvas,
    canvasReverso: fabric.Canvas | fabric.StaticCanvas | null,
    dimensiones: { ancho_mm?: number | string; alto_mm?: number | string },
    empleado: any,
    opciones: { nombreArchivo?: string; guardar?: boolean } = {}
  ): Promise<jsPDF> {
    const anchoMm = Number(dimensiones.ancho_mm) || CREDENCIAL_ANCHO_MM;
    const altoMm = Number(dimensiones.alto_mm) || CREDENCIAL_ALTO_MM;
    const orientacion = altoMm >= anchoMm ? 'portrait' : 'landscape';

    const pdf = new jsPDF({ orientation: orientacion, unit: 'mm', format: [anchoMm, altoMm], compress: true });

    const frenteImg = this.exportarCanvasComoImagen(canvasFrente);
    pdf.addImage(frenteImg, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');

    if (canvasReverso) {
      const reversoImg = this.exportarCanvasComoImagen(canvasReverso);
      pdf.addPage([anchoMm, altoMm], orientacion);
      pdf.addImage(reversoImg, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');
    }

    if (opciones.guardar !== false) {
      const nombre = opciones.nombreArchivo
        || `Credencial_${empleado?.num_empleado || 'sin_folio'}.pdf`;
      pdf.save(nombre);
    }

    return pdf;
  }

  /**
   * Exporta un canvas a PNG. Si es interactivo y tiene una seleccion activa,
   * la limpia antes de exportar para que los manejadores/bordes de seleccion
   * (azules) no salgan impresos en el PDF.
   */
  private exportarCanvasComoImagen(
    canvas: fabric.Canvas | fabric.StaticCanvas,
    multiplicador = MULTIPLICADOR_EXPORT
  ): string {
    if (canvas instanceof fabric.Canvas) {
      canvas.discardActiveObject();
      canvas.renderAll();
    }
    return canvas.toDataURL({ format: 'png', multiplier: multiplicador });
  }

  /**
   * Genera el PDF de una credencial: pagina 1 = frente, pagina 2 = reverso,
   * al tamano fisico real definido en la plantilla (CR80 54x86mm por defecto).
   */
  async generarPdf(
    plantilla: PlantillaCredencial,
    empleado: any,
    opciones: { incluirReverso?: boolean; nombreArchivo?: string; guardar?: boolean } = {}
  ): Promise<jsPDF> {
    const incluirReverso = opciones.incluirReverso !== false;
    const anchoMm = Number(plantilla.ancho_mm) || CREDENCIAL_ANCHO_MM;
    const altoMm = Number(plantilla.alto_mm) || CREDENCIAL_ALTO_MM;

    const pdf = new jsPDF({
      orientation: altoMm >= anchoMm ? 'portrait' : 'landscape',
      unit: 'mm',
      format: [anchoMm, altoMm],
      compress: true,
    });

    const frente = await this.renderizarCaraComoImagen(plantilla, 'frente', empleado);
    pdf.addImage(frente, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');

    if (incluirReverso && (plantilla.canvas_reverso || plantilla.fondo_reverso)) {
      const reverso = await this.renderizarCaraComoImagen(plantilla, 'reverso', empleado);
      pdf.addPage([anchoMm, altoMm], altoMm >= anchoMm ? 'portrait' : 'landscape');
      pdf.addImage(reverso, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');
    }

    if (opciones.guardar !== false) {
      const nombre = opciones.nombreArchivo
        || `Credencial_${empleado?.num_empleado || empleado?.id_enrolamiento || 'sin_folio'}.pdf`;
      pdf.save(nombre);
    }

    return pdf;
  }

  /** Genera un solo PDF multipagina para un lote de empleados. */
  async generarPdfLote(
    plantilla: PlantillaCredencial,
    empleados: any[],
    opciones: { incluirReverso?: boolean; nombreArchivo?: string; onProgreso?: (i: number, total: number) => void } = {}
  ): Promise<jsPDF> {
    const incluirReverso = opciones.incluirReverso !== false;
    const anchoMm = Number(plantilla.ancho_mm) || CREDENCIAL_ANCHO_MM;
    const altoMm = Number(plantilla.alto_mm) || CREDENCIAL_ALTO_MM;
    const orientacion = altoMm >= anchoMm ? 'portrait' : 'landscape';

    const pdf = new jsPDF({ orientation: orientacion, unit: 'mm', format: [anchoMm, altoMm], compress: true });
    let primera = true;

    for (let i = 0; i < empleados.length; i++) {
      const empleado = empleados[i];

      const frente = await this.renderizarCaraComoImagen(plantilla, 'frente', empleado);
      if (!primera) pdf.addPage([anchoMm, altoMm], orientacion);
      pdf.addImage(frente, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');
      primera = false;

      if (incluirReverso && (plantilla.canvas_reverso || plantilla.fondo_reverso)) {
        const reverso = await this.renderizarCaraComoImagen(plantilla, 'reverso', empleado);
        pdf.addPage([anchoMm, altoMm], orientacion);
        pdf.addImage(reverso, 'PNG', 0, 0, anchoMm, altoMm, undefined, 'FAST');
      }

      opciones.onProgreso?.(i + 1, empleados.length);
    }

    pdf.save(opciones.nombreArchivo || `Credenciales_lote_${empleados.length}.pdf`);
    return pdf;
  }

  // ====================================================================
  // Fondo
  // ====================================================================

  /** Coloca la imagen de fondo estirada exactamente al espacio de diseno. */
  async aplicarFondo(
    canvas: fabric.Canvas | fabric.StaticCanvas,
    rutaFondo: string | null | undefined,
    ancho: number,
    alto: number
  ): Promise<void> {
    if (!rutaFondo) {
      canvas.backgroundImage = undefined;
      canvas.renderAll();
      return;
    }

    const url = this.normalizarUrl(rutaFondo);

    try {
      const imagen = await fabric.FabricImage.fromURL(url);
      imagen.set({
        left: 0,
        top: 0,
        scaleX: ancho / (imagen.width || ancho),
        scaleY: alto / (imagen.height || alto),
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      });
      canvas.backgroundImage = imagen;
      canvas.renderAll();
    } catch {
      canvas.backgroundImage = undefined;
      canvas.renderAll();
    }
  }

  /** Convierte 'plantillas/x.png' en '/media/plantillas/x.png'. */
  normalizarUrl(ruta: string): string {
    if (!ruta) return ruta;
    if (ruta.startsWith('http') || ruta.startsWith('data:') || ruta.startsWith('/')) return ruta;
    return `/media/${ruta}`;
  }

  // ====================================================================
  // Poblado de datos reales
  // ====================================================================

  /**
   * Sustituye cada objeto con `data.binding` por el valor real del empleado.
   * Los textos conservan posicion/tamano/estilo; los marcadores de imagen se
   * reemplazan por la imagen ajustada a su mismo recuadro.
   *
   * `interactivo` controla si las imagenes pobladas (foto/firma/QR) quedan
   * seleccionables/movibles -- true solo en construirCanvasEditable(); en el
   * render normal (preview/PDF) siempre van fijas.
   */
  private async poblarDatos(canvas: fabric.StaticCanvas, empleado: any, interactivo = false): Promise<void> {
    if (!empleado) return;

    const objetos = [...canvas.getObjects()];

    for (const objeto of objetos) {
      const data: any = (objeto as any).data;
      if (!data?.binding) continue;

      // Una imagen/QR ya resuelto NO se vuelve a resolver.
      //
      // Pasa al reimprimir desde un lienzo guardado en el historial: ahi los
      // marcadores ya fueron sustituidos por la imagen real. Volver a
      // encajarlos tomaria como caja la imagen ya escalada y la recortaria o
      // desplazaria en cada pasada. Los textos SI se refrescan, que es lo que
      // debe cambiar (folio y fecha nuevos).
      if (objeto instanceof fabric.FabricImage && data.tipo !== 'texto' && data.tipo !== 'fecha') {
        continue;
      }

      switch (data.tipo) {
        case 'texto':
        case 'fecha':
          this.aplicarTexto(objeto, data, empleado);
          break;

        case 'imagen':
          await this.aplicarImagen(canvas, objeto, data, empleado, interactivo);
          break;

        case 'qr':
          await this.aplicarQr(canvas, objeto, empleado, interactivo);
          break;
      }
    }
  }

  private aplicarTexto(objeto: fabric.FabricObject, data: any, empleado: any): void {
    const texto = objeto as fabric.Textbox;
    if (typeof texto.set !== 'function') return;

    let valor = empleado?.[data.campo] ?? '';

    if (data.tipo === 'fecha' && valor) {
      valor = this.formatearFecha(valor);
    }

    if (data.mayusculas) {
      valor = String(valor).toUpperCase();
    }

    texto.set({ text: String(valor ?? '') });
  }

  private async aplicarImagen(
    canvas: fabric.StaticCanvas,
    marcador: fabric.FabricObject,
    data: any,
    empleado: any,
    interactivo = false
  ): Promise<void> {
    const fuente = empleado?.[data.campo];
    if (!fuente) {
      // Sin imagen real: quitamos el marcador para que no salga el recuadro gris.
      canvas.remove(marcador);
      return;
    }

    // El indice se toma ANTES de quitar el marcador para poder devolver la
    // imagen a la misma capa y respetar los solapamientos del diseno.
    const capa = canvas.getObjects().indexOf(marcador);

    try {
      const imagen = await fabric.FabricImage.fromURL(this.normalizarUrl(fuente));
      this.encajarEnMarcador(imagen, marcador, data.ajuste || 'cover', interactivo);
      if (interactivo) (imagen as any).data = { ...data };
      canvas.remove(marcador);
      canvas.add(imagen);
      canvas.moveObjectTo(imagen, capa);
    } catch {
      canvas.remove(marcador);
    }
  }

  private async aplicarQr(
    canvas: fabric.StaticCanvas,
    marcador: fabric.FabricObject,
    empleado: any,
    interactivo = false
  ): Promise<void> {
    const capa = canvas.getObjects().indexOf(marcador);
    const data: any = (marcador as any).data;

    try {
      const contenido = this.construirContenidoQr(empleado);
      const dataUrl = await QRCode.toDataURL(contenido, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 600,
        color: { dark: '#000000', light: '#FFFFFF' },
      });

      const imagen = await fabric.FabricImage.fromURL(dataUrl);
      this.encajarEnMarcador(imagen, marcador, 'contain', interactivo);
      if (interactivo) (imagen as any).data = { ...data };
      canvas.remove(marcador);
      canvas.add(imagen);
      canvas.moveObjectTo(imagen, capa);
    } catch {
      canvas.remove(marcador);
    }
  }

  /**
   * Ajusta una imagen al recuadro del marcador.
   * 'cover'   -> llena el recuadro y recorta el excedente (fotografias).
   * 'contain' -> cabe completa dentro del recuadro (firmas, QR, logos).
   *
   * `interactivo` deja la imagen seleccionable/movible (edicion rapida en
   * "Imprimir credenciales"); en render normal siempre queda fija.
   */
  private encajarEnMarcador(
    imagen: fabric.FabricImage,
    marcador: fabric.FabricObject,
    ajuste: 'cover' | 'contain',
    interactivo = false
  ): void {
    const anchoCaja = (marcador.width || 0) * (marcador.scaleX || 1);
    const altoCaja = (marcador.height || 0) * (marcador.scaleY || 1);
    const anchoImg = imagen.width || 1;
    const altoImg = imagen.height || 1;

    const escala = ajuste === 'cover'
      ? Math.max(anchoCaja / anchoImg, altoCaja / altoImg)
      : Math.min(anchoCaja / anchoImg, altoCaja / altoImg);

    imagen.set({
      originX: 'center',
      originY: 'center',
      left: (marcador.left || 0) + anchoCaja / 2,
      top: (marcador.top || 0) + altoCaja / 2,
      scaleX: escala,
      scaleY: escala,
      angle: marcador.angle || 0,
      selectable: interactivo,
      evented: interactivo,
    });

    // En modo 'cover' recortamos lo que se sale del recuadro.
    if (ajuste === 'cover') {
      imagen.clipPath = new fabric.Rect({
        width: anchoCaja / escala,
        height: altoCaja / escala,
        originX: 'center',
        originY: 'center',
      });
    }
  }

  // ====================================================================
  // Utilidades
  // ====================================================================

  construirContenidoQr(empleado: any): string {
    return [
      empleado?.num_empleado || '',
      empleado?.rfc || '',
      empleado?.curp || '',
      empleado?.nombre || '',
      empleado?.paterno || '',
      empleado?.materno || '',
      empleado?.puesto || '',
      empleado?.adscripcion || '',
      empleado?.inicio_vig || '',
      empleado?.fin_vig || '',
      empleado?.folio || '',
      empleado?.fecha_expedicion || '',
    ].join('|');
  }

  formatearFecha(valor: any): string {
    if (!valor) return '';
    const fecha = valor instanceof Date ? valor : new Date(String(valor).includes('T') ? valor : `${valor}T00:00:00`);
    if (isNaN(fecha.getTime())) return String(valor);

    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${fecha.getFullYear()}`;
  }
}
