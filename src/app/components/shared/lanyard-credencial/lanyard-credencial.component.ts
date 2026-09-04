import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import type { Root } from 'react-dom/client';

import { PlantillaCredencialService } from '../../../services/plantilla-credencial.service';

/**
 * Wrapper Angular que monta el componente React "Lanyard" (ver Lanyard.tsx)
 * dentro de esta pantalla -- Angular no puede renderizar JSX directo, asi
 * que se crea una raiz de React con `createRoot()` sobre un <div> propio y
 * se le pasan las props via `root.render()`, el patron estandar para montar
 * una "isla" de React dentro de una app que no lo es.
 *
 * React, react-dom, three.js, @react-three/fiber/drei/rapier y el .glb
 * (~3 MB entre todo) se cargan con `import()` DINAMICO, no estatico: esta
 * app no usa rutas con lazy loading (ver app-routing.module.ts, todo
 * `component:` directo), asi que un import estatico aqui metia todo ese
 * peso en el bundle principal de TODA la app -- lo pagaba cualquier
 * pantalla, no solo el dashboard. Con import() dinamico, Angular lo separa
 * en su propio chunk que solo se pide cuando este componente realmente se
 * monta, y como el fetch arranca DESPUES de ngAfterViewInit (la vista ya
 * esta pintada), el resto del dashboard aparece de inmediato y la
 * constancia flotante entra un momento despues, en vez de bloquear todo el
 * primer render de la app.
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
  /** ancho_mm / alto_mm de la plantilla por defecto -- undefined hasta que llega, ver Lanyard.tsx prop `aspect`. */
  private aspect: number | undefined = undefined;
  private destruido = false;

  // Se resuelven una sola vez (modulo dinamico cacheado por el bundler) y
  // se guardan aqui para poder volver a renderizar (cambio de plantilla)
  // sin repetir el import().
  private createElement?: typeof import('react').createElement;
  private LanyardComp?: typeof import('./Lanyard').default;

  constructor(private plantillaApi: PlantillaCredencialService) {}

  ngAfterViewInit(): void {
    this.cargarYRenderizar();

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
        if (this.destruido) return;
        this.frontImage = frente;
        this.backImage = reverso;
        const anchoMm = Number(res?.plantilla?.ancho_mm);
        const altoMm = Number(res?.plantilla?.alto_mm);
        this.aspect = Number.isFinite(anchoMm) && Number.isFinite(altoMm) && altoMm > 0
          ? anchoMm / altoMm
          : undefined;
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
    this.destruido = true;
    // Desmontar de forma sincrona y directa (no via Angular): React limpia
    // el contexto WebGL, los listeners de pointer y el mundo de fisica de
    // rapier al desmontar, y quiere hacerlo el mismo, no que Angular borre
    // el <div> por debajo primero.
    this.root?.unmount();
    this.root = null;
  }

  private async cargarYRenderizar(): Promise<void> {
    const [reactModulo, reactDomModulo, lanyardModulo] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./Lanyard'),
    ]);
    if (this.destruido) return;

    // react y react-dom/client son CommonJS: cuando este import() dinamico
    // se separa en su propio chunk (code-splitting), esbuild a veces solo
    // logra preservar el export `default` (el modulo CJS completo) y pierde
    // los named exports sinteticos createElement/createRoot que si
    // funcionaban con un import estatico -- de ahi "createRoot is not a
    // function" en produccion. Se acepta cualquiera de las dos formas.
    const react: any = reactModulo;
    const reactDom: any = reactDomModulo;
    this.createElement = react.createElement ?? react.default?.createElement;
    const createRoot = reactDom.createRoot ?? reactDom.default?.createRoot;
    this.LanyardComp = lanyardModulo.default;
    this.root = createRoot!(this.contenedorRef.nativeElement);
    this.renderizar();
  }

  private renderizar(): void {
    if (!this.root || !this.createElement || !this.LanyardComp) return;
    this.root.render(
      this.createElement(this.LanyardComp, {
        // Mismos valores de camara que el demo oficial de React Bits
        // (fov:20, distancia ~24, altura 0) -- reproduce el mismo tamaño de
        // tarjeta que en reactbits.dev. El lienzo cubre TODO el dashboard
        // (capa de fondo detras de las tarjetas de modulo, ver
        // dashboard.component.html/scss); el punto de flotacion esta
        // corrido a la derecha en coordenadas de mundo (ANCLA_FRACCION_X en
        // Lanyard.tsx) para que la constancia flote del lado derecho del
        // componente sin tener que mover la camara.
        //
        // gravity baja (no [0,-40,0] del demo original con cuerda): sin
        // cordon que la sostenga, una gravedad fuerte la haria caer del
        // cuadro -- aqui solo pesa lo suficiente para que el resorte que la
        // mece (ver ConstanciaFlotante en Lanyard.tsx) se sienta flotando
        // "contra" la gravedad, no en el vacio total.
        position: [0, 0, 18],
        fov: 20,
        gravity: [0, -1.5, 0],
        frontImage: this.frontImage,
        backImage: this.backImage,
        imageFit: 'cover',
        aspect: this.aspect,
      })
    );
  }
}
