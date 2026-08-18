import { Injectable, signal } from '@angular/core';

import { PlantillaCredencialService } from './plantilla-credencial.service';

/** Cada cuanto se pregunta por la fecha de sincronizacion en reposo. */
const INTERVALO_NORMAL_MS = 90_000;
/** Sondeo acelerado mientras hay una actualizacion manual en curso (ver activarSondeoRapido). */
const INTERVALO_RAPIDO_MS = 4_000;

/**
 * Fecha de sincronizacion del roster SIG, conocida y mantenida al dia de
 * forma AUTONOMA -- nadie tiene que recargar la pagina para verla cambiar.
 *
 * Es el puente entre "Imprimir credenciales" (donde tambien se conoce esa
 * fecha, al descargar el roster completo) y el header global (donde se
 * muestra): son dos componentes sin relacion padre/hijo. Pero la fuente de
 * verdad real es el SONDEO periodico que este servicio arranca solo, contra
 * el endpoint liviano `empleados-sig/ultima-actualizacion/` (un MAX() en el
 * servidor, no las ~16k filas del roster completo) -- asi el header se entera
 * de un sync de Celery (cada 30 min) o de una actualizacion manual sin que
 * el usuario tenga que hacer nada.
 */
@Injectable({ providedIn: 'root' })
export class RosterSyncService {
  private readonly _ultimaActualizacion = signal<Date | null>(null);
  readonly ultimaActualizacion = this._ultimaActualizacion.asReadonly();

  private temporizador: ReturnType<typeof setInterval> | null = null;
  private consultando = false;

  constructor(private plantillaApi: PlantillaCredencialService) {}

  /**
   * Fija el valor conocido -- lo usan tanto el sondeo interno como
   * "Imprimir credenciales" (que ya trae la fecha gratis al cargar el roster
   * completo, sin necesidad de esperar al siguiente tick del sondeo).
   *
   * Compara por VALOR, no solo "hay fecha": un Date nuevo con la misma hora
   * nunca es `===` al anterior, y sin este filtro cada tick del sondeo
   * dispararia la señal aunque nada haya cambiado en el servidor.
   */
  actualizar(fecha: Date | null): void {
    if (!fecha || isNaN(fecha.getTime())) return;
    const actual = this._ultimaActualizacion();
    if (actual && actual.getTime() === fecha.getTime()) return;
    this._ultimaActualizacion.set(fecha);
  }

  private consultar(): void {
    if (this.consultando) return;
    this.consultando = true;

    this.plantillaApi.empleadosSigUltimaActualizacion().subscribe({
      next: (res) => {
        this.consultando = false;
        if (res?.fecha_actualizacion) this.actualizar(new Date(res.fecha_actualizacion));
      },
      error: () => {
        this.consultando = false; // Un fallo puntual no debe frenar el sondeo; el siguiente tick reintenta.
      },
    });
  }

  /** Arranca el sondeo de fondo -- idempotente, seguro de llamar desde cualquier componente que monte el header. */
  iniciarSondeo(): void {
    if (this.temporizador) return;
    this.consultar();
    this.reprogramar(INTERVALO_NORMAL_MS);
  }

  private reprogramar(intervaloMs: number): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = setInterval(() => this.consultar(), intervaloMs);
  }

  /** Mientras haya una actualizacion manual en curso: se sondea mas seguido para detectar el fin cuanto antes. */
  activarSondeoRapido(): void {
    this.reprogramar(INTERVALO_RAPIDO_MS);
  }

  /** Termino la actualizacion manual (o se dio por vencida): vuelve al ritmo de fondo. */
  restablecerSondeoNormal(): void {
    this.reprogramar(INTERVALO_NORMAL_MS);
  }
}
