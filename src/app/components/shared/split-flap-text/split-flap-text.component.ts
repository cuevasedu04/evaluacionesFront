import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';

import SplitFlapText from './SplitFlapText';

/**
 * Wrapper Angular del componente React "SplitFlapText" (copia oficial de
 * React Bits, ver SplitFlapText.tsx) -- mismo patron de "isla" de React que
 * `LanyardCredencialComponent`: Angular no puede renderizar JSX directo, asi
 * que se monta una raiz de React sobre un <div> propio con `createRoot()` y
 * se le pasan las props via `root.render()`.
 *
 * `encapsulation: None` es OBLIGATORIO, no cosmetico: los nodos que pinta
 * React no llevan el atributo `_ngcontent-*` con el que la encapsulacion
 * emulada (la de por omision) acota los estilos de un componente Angular, asi
 * que con encapsulacion normal el CSS de `styleUrls` simplemente no les
 * pegaria a las clases `.split-flap-text__*` (mismo problema documentado para
 * `.lanyard-wrapper` en lanyard-credencial.component.scss, resuelto ahi con
 * `::ng-deep`; aqui son demasiadas reglas para hacerlo selector por selector).
 *
 * SplitFlapText esta pensado para CICLAR un arreglo fijo de frases con su
 * propio temporizador interno; aqui se usa distinto, para animar el paso de
 * UN valor externo (`texto`) al siguiente -- tanto al MONTAR (desde un
 * tablero en blanco, para que la primera aparicion tambien voltee) como en
 * cada cambio posterior. Cada aparicion/cambio se traduce a
 * `words: [valorAnterior, valorNuevo]` con `loop: false`: el componente pinta
 * el valor anterior de inmediato (en el primer montaje, blanco; en cambios
 * posteriores, lo que ya se estaba viendo -- nunca hay salto visual) y, tras
 * `cycleDelay`, hace el volteo animado hacia el nuevo valor y se detiene ahi.
 */
@Component({
  standalone: false,
  selector: 'app-split-flap-text',
  templateUrl: './split-flap-text.component.html',
  styleUrls: ['./SplitFlapText.css', './split-flap-text.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class SplitFlapTextComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() texto = '';
  /** Cuantas filas de ancho fijo reservar (evita que el badge "respire" de ancho al cambiar de texto). */
  @Input() padTo = 24;
  @Input() cycleDelay = 400;
  @Input() flipDuration = 0.1;
  @Input() stagger = 0.03;
  @Input() flipsPerChar = 6;
  @Input() tileColor = '#4F1525';
  @Input() textColor = '#f8fafc';
  @Input() tileRadius: number | string = 4;
  @Input() gap: number | string = 3;
  @Input() fontSize: number | string = 15;

  @ViewChild('contenedor', { static: true }) contenedorRef!: ElementRef<HTMLDivElement>;

  private root: Root | null = null;
  private montado = false;
  /** Vacio hasta el primer valor real: por eso el primer render tambien anima, desde un tablero en blanco. */
  private valorMostrado = '';

  ngAfterViewInit(): void {
    this.root = createRoot(this.contenedorRef.nativeElement);
    this.montado = true;
    this.mostrar(this.texto || '');
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Antes de ngAfterViewInit no hay raiz sobre la cual renderizar; ese
    // primer render ya toma `texto` directamente (ver arriba).
    if (!this.montado || !changes['texto']) return;
    this.mostrar(this.texto || '');
  }

  ngOnDestroy(): void {
    this.root?.unmount();
    this.root = null;
  }

  private mostrar(nuevo: string): void {
    if (!nuevo || nuevo === this.valorMostrado) return;

    // `valorAnterior` vacio (primer montaje) normaliza a puros espacios del
    // lado de SplitFlapText -- un tablero en blanco que voltea hacia el
    // valor real, en vez de aparecer ya escrito.
    const valorAnterior = this.valorMostrado;
    this.valorMostrado = nuevo;

    this.root?.render(
      createElement(SplitFlapText, {
        words: [valorAnterior, nuevo],
        loop: false,
        padTo: this.padTo,
        cycleDelay: this.cycleDelay,
        flipDuration: this.flipDuration,
        stagger: this.stagger,
        flipsPerChar: this.flipsPerChar,
        tileColor: this.tileColor,
        textColor: this.textColor,
        tileRadius: this.tileRadius,
        gap: this.gap,
        fontSize: this.fontSize,
      })
    );
  }
}
