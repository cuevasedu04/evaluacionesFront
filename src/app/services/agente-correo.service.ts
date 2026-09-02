import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, timeout } from 'rxjs';

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

  /** Envia UNA constancia. El agente responde en cuanto Outlook aceptó (o rechazó) el envío. */
  enviar(datos: {
    destinatario: string;
    asunto: string;
    cuerpo_html: string;
    cuenta_remitente: string;
    pdf: Blob;
    nombreArchivo: string;
  }): Observable<{ status: 'success' | 'error'; mensaje?: string }> {
    const form = new FormData();
    form.append('destinatario', datos.destinatario);
    form.append('asunto', datos.asunto);
    form.append('cuerpo_html', datos.cuerpo_html);
    form.append('cuenta_remitente', datos.cuenta_remitente);
    form.append('pdf', datos.pdf, datos.nombreArchivo);

    return this.http.post<{ status: 'success' | 'error'; mensaje?: string }>(
      `${this.baseUrl}/enviar`, form
    );
  }
}
