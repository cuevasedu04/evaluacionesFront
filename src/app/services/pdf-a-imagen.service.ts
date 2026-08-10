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
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/assets/js/pdf.worker.min.mjs';

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
