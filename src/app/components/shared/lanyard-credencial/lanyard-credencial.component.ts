import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';

import Lanyard from './Lanyard';
import { PlantillaCredencialService } from '../../../services/plantilla-credencial.service';

/**
 * Wrapper Angular que monta el componente React "Lanyard" (copia oficial de
 * React Bits, ver Lanyard.tsx) dentro de esta pantalla -- Angular no puede
 * renderizar JSX directo, asi que se crea una raiz de React con
 * `createRoot()` sobre un <div> propio y se le pasan las props via
 * `root.render()`, el patron estandar para montar una "isla" de React
 * dentro de una app que no lo es.
 *
 * Las caras de la tarjeta son las mismas texturas fondo_frente_url /
 * fondo_reverso_url de la plantilla ANAM marcada "por defecto" que usa
 * "Imprimir credenciales" -- se piden async y se vuelve a renderizar la
 * raiz de React cuando llegan (React diffea, no hace falta desmontar nada).
 */
@Component({
  standalone: false,
  selector: 'app-lanyard-credencial',
  templateUrl: './lanyard-credencial.component.html',
  styleUrls: ['./lanyard-credencial.component.scss'],
})
export class LanyardCredencialComponent implements AfterViewInit, OnDestroy {
  @ViewChild('contenedor', { static: true }) contenedorRef!: ElementRef<HTMLDivElement>;

  private root: Root | null = null;
  private frontImage: string | null = null;
  private backImage: string | null = null;

  constructor(private plantillaApi: PlantillaCredencialService) {}

  ngAfterViewInit(): void {
    this.root = createRoot(this.contenedorRef.nativeElement);
    this.renderizar();

    this.plantillaApi.obtenerPorDefecto().subscribe({
      next: async (res) => {
        // Se valida CADA imagen por separado antes de pasarla a React: si
        // useTexture(drei) recibe una URL que 404 (fondo borrado/renombrado
        // en el servidor, huerfano en la plantilla), lanza dentro de
        // Suspense y sin un ErrorBoundary tumba el <Canvas> COMPLETO -- se
        // vio en vivo: reverso_credencial_anam.png faltaba en el servidor
        // de pruebas y el widget entero desaparecia por un solo archivo
        // roto. Mejor que esa cara se quede con la textura de fabrica del
        // .glb a que la tarjeta entera desaparezca.
        const [frente, reverso] = await Promise.all([
          this.validarImagen(res?.plantilla?.fondo_frente_url),
          this.validarImagen(res?.plantilla?.fondo_reverso_url),
        ]);
        this.frontImage = frente;
        this.backImage = reverso;
        this.renderizar();
      },
      // Sin plantilla por defecto: el modelo se queda con la textura de
      // fabrica del .glb en vez de quedar en blanco.
      error: () => {},
    });
  }

  /** Confirma que la imagen realmente carga antes de pasarla a React; null si falla o no hay URL. */
  private validarImagen(url: string | null | undefined): Promise<string | null> {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  ngOnDestroy(): void {
    // Desmontar de forma sincrona y directa (no via Angular): React limpia
    // el contexto WebGL, los listeners de pointer y el mundo de fisica de
    // rapier al desmontar, y quiere hacerlo el mismo, no que Angular borre
    // el <div> por debajo primero.
    this.root?.unmount();
    this.root = null;
  }

  private renderizar(): void {
    this.root?.render(
      createElement(Lanyard, {
        // Mismos valores de camara que el demo oficial de React Bits
        // (fov:20, distancia ~24, altura 0) -- junto con el ancla en y=4 y
        // los segmentos de cuerda de longitud 1 (ver Lanyard.tsx), esto es
        // lo que reproduce el mismo tamaño de tarjeta que en reactbits.dev.
        // El lienzo cubre TODO el dashboard (capa de fondo detras de las
        // tarjetas de modulo, ver dashboard.component.html/scss); el
        // anclaje del cordon esta corrido a la derecha en coordenadas de
        // mundo (x=3.2 en Lanyard.tsx) para que la tarjeta cuelgue del
        // lado derecho del componente sin tener que mover la camara.
        position: [0, 0, 18],
        fov: 20,
        gravity: [0, -40, 0],
        frontImage: this.frontImage,
        backImage: this.backImage,
        imageFit: 'cover',
      })
    );
  }
}
