import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, timeout } from 'rxjs';

/**
 * Version minima del agente que sabe enviar un correo SIN adjunto -- que es
 * como se manda el enlace al cuestionario de un curso. Los agentes
 * anteriores exigian siempre un PDF y responderian "Falta el PDF de la
 * constancia", un mensaje que no tiene nada que ver con lo que se intento
 * hacer. Con la version a la vista se puede decir lo que de verdad pasa:
 * "tu agente esta desactualizado, descarga el nuevo".
 */
export const VERSION_AGENTE_SIN_ADJUNTO = 2;

export interface EstadoAgente {
  disponible: boolean;
  /** 1 para los agentes viejos, que no reportaban version. */
  version: number;
}

/**
 * Agente de correo ANAM: programa aparte (ver /agente-correo en la raiz del
 * repo) que corre en la computadora de CADA usuario, no en el backend
 * central. Es el UNICO lugar que de verdad toca Outlook COM -- este
 * servicio le habla directo por 127.0.0.1, nunca pasa por el backend
 * central para el envio en si.
 *
 * Por que: Outlook COM solo controla el Outlook abierto en la MISMA
 * maquina donde corre el proceso que lo invoca. Si el envio ocurriera en
 * el backend central (una sola maquina), todos los correos saldrian
 * siempre desde ahi. Con el agente local, cada quien envia con su propio
 * Outlook y sus propios buzones ya agregados a su perfil.
 */
@Injectable({ providedIn: 'root' })
export class AgenteCorreoService {

  private readonly baseUrl = 'http://127.0.0.1:8877';

  constructor(private http: HttpClient) { }

  /**
   * true si el agente esta corriendo en esta computadora. Se consulta
   * ANTES de intentar un envio, para avisar con un mensaje claro
   * ("abre el agente") en vez de que cada correo falle con un error de
   * red generico. Nunca lanza error: una falla de red YA ES la respuesta
   * ("no esta corriendo").
   */
  disponible(): Observable<boolean> {
    return this.http.get<{ status: string }>(`${this.baseUrl}/salud`).pipe(
      timeout(2000),
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Como `disponible()`, pero ademas dice QUE version corre en esta
   * computadora: hay envios (el enlace al cuestionario, sin adjunto) que un
   * agente viejo no sabe hacer.
   */
  estado(): Observable<EstadoAgente> {
    return this.http.get<{ status: string; version?: number }>(`${this.baseUrl}/salud`).pipe(
      timeout(2000),
      // Un agente anterior a este cambio no reporta version: se asume 1.
      map((res) => ({ disponible: true, version: Number(res?.version) || 1 })),
      catchError(() => of({ disponible: false, version: 0 })),
    );
  }

  /**
   * Envia UN correo. El agente responde en cuanto Outlook aceptó (o
   * rechazó) el envío.
   *
   * El PDF es opcional: las constancias van con adjunto, pero el enlace al
   * cuestionario de un curso es un correo de puro texto. Requiere un agente
   * version >= VERSION_AGENTE_SIN_ADJUNTO.
   */
  enviar(datos: {
    destinatario: string;
    asunto: string;
    cuerpo_html: string;
    cuenta_remitente: string;
    pdf?: Blob;
    nombreArchivo?: string;
  }): Observable<{ status: 'success' | 'error'; mensaje?: string }> {
    const form = new FormData();
    form.append('destinatario', datos.destinatario);
    form.append('asunto', datos.asunto);
    form.append('cuerpo_html', datos.cuerpo_html);
    form.append('cuenta_remitente', datos.cuenta_remitente);
    if (datos.pdf) form.append('pdf', datos.pdf, datos.nombreArchivo || 'Constancia.pdf');

    return this.http.post<{ status: 'success' | 'error'; mensaje?: string }>(
      `${this.baseUrl}/enviar`, form
    );
  }
}
