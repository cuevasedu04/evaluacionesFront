import { Injectable } from '@angular/core';

/**
 * Convierte la PRIMERA pagina de un PDF a un data-URI de imagen, para que
 * pueda entrar al mismo flujo de captura de foto/firma que ya existe
 * (camara, subida de archivo): ese flujo solo sabe trabajar con imagenes
 * rasterizadas (Fabric.js, `<img>`, `media_utils.guardar_foto/guardar_firma`),
 * nunca con PDFs.
 *
 * Se toma solo la pagina 1 a proposito -- los PDFs que mandan por correo para
 * esto son casi siempre una sola imagen escaneada.
 */
@Injectable({ providedIn: 'root' })
export class PdfAImagenService {

  async primeraPaginaComoDataUrl(archivo: File, escala = 2.5): Promise<string> {
    // Si el worker no llega a cargar (p.ej. un servidor mal configurado que
    // sirve el .js con un Content-Type que el navegador rechaza para un
    // worker de tipo modulo -- ver el comentario mas abajo), pdf.js se queda
    // esperando una respuesta que nunca llega, en vez de rechazar la promesa.
    // Sin este limite, el modal de ajuste simplemente nunca se abre y no hay
    // ningun error que avise por que.
    return await Promise.race([
      this.convertir(archivo, escala),
      new Promise<string>((_, reject) => setTimeout(
        () => reject(new Error('No se pudo procesar el PDF (tiempo de espera agotado). Intenta de nuevo o sube una imagen.')),
        20000,
      )),
    ]);
  }

  private async convertir(archivo: File, escala: number): Promise<string> {
    // Import dinamico: pdfjs-dist pesa ~700KB y la inmensa mayoria de
    // capturas son imagen, no PDF. Con `import()` esbuild lo separa en su
    // propio chunk, que solo se descarga la primera vez que alguien de
    // verdad sube un PDF, en vez de sumarse al bundle inicial de todos.
    const pdfjsLib = await import('pdfjs-dist');
    // pdf.js necesita un worker aparte para no bloquear el hilo principal al
    // parsear el PDF. Se vendorea en src/assets/js/ (mismo patron que
    // wacom-webhid.js) en vez de resolverlo via import.meta.url: el build de
    // Angular con esbuild no siempre empaqueta bien los workers de terceros,
    // y esto evita depender de que lo haga.
    //
    // Extension .js, NO .mjs, aunque el archivo sea el mismo modulo ES que
    // trae pdfjs-dist tal cual: pdf.js fija `{ type: 'module' }` al crear el
    // Worker (no depende de la extension), pero el mime.types por omision de
    // nginx no mapea `.mjs` -> lo sirve como `application/octet-stream`, y el
    // navegador rechaza cargar un worker de tipo modulo si el Content-Type no
    // es de JavaScript. Con `.js` (que nginx SI mapea bien) el mismo archivo
    // carga sin problema. Confirmado en produccion: funcionaba en local
    // (servidor de dev de Angular) pero no en el servidor real, mismo commit.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/js/pdf.worker.min.js';

    const buffer = await archivo.arrayBuffer();
    const documento = await pdfjsLib.getDocument({ data: buffer }).promise;
    try {
      const pagina = await documento.getPage(1);
      const viewport = pagina.getViewport({ scale: escala });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const contexto = canvas.getContext('2d');
      if (!contexto) throw new Error('No se pudo preparar el lienzo para renderizar el PDF.');

      await pagina.render({ canvasContext: contexto, viewport }).promise;
      return canvas.toDataURL('image/png');
    } finally {
      await documento.destroy();
    }
  }

  esPdf(archivo: File): boolean {
    return archivo.type === 'application/pdf' || archivo.name.toLowerCase().endsWith('.pdf');
  }
}
