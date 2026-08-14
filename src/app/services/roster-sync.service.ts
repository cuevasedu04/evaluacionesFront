import { Injectable, signal } from '@angular/core';

/**
 * Puente entre "Imprimir credenciales" (donde se descarga el roster SIG y se
 * conoce su fecha de sincronizacion) y el header global del sistema (donde
 * ahora se muestra esa fecha) -- son dos componentes sin relacion padre/hijo,
 * asi que no hay forma de pasarse el dato por @Input/@Output.
 *
 * Solo se actualiza en descargas EXITOSAS del roster: si se empujara `null`
 * al iniciar cada recarga, el header parpadearia a vacio cada vez que alguien
 * le da "Actualizar" en Imprimir credenciales, en vez de seguir mostrando el
 * ultimo valor conocido hasta que llegue el nuevo.
 */
@Injectable({ providedIn: 'root' })
export class RosterSyncService {
  private readonly _ultimaActualizacion = signal<Date | null>(null);
  readonly ultimaActualizacion = this._ultimaActualizacion.asReadonly();

  actualizar(fecha: Date | null): void {
    if (!fecha) return;
    this._ultimaActualizacion.set(fecha);
  }
}
