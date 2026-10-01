import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';
import { EstadoCuestionario } from '../content/responder/responder.const';

/**
 * Cuestionario público: las únicas llamadas del sistema que se hacen SIN
 * sesión (ver `credencializacion/views_publico.py`).
 *
 * Todas van sin el overlay de carga global: quien está respondiendo guarda
 * cada respuesta conforme la contesta, y montar un overlay a pantalla
 * completa en cada tecleo haría la pantalla inusable. El estado del guardado
 * se comunica con el indicador propio de la pantalla ("Guardando…",
 * "Guardado", "Sin conexión").
 *
 * El backend responde SIEMPRE 200 con un campo `situacion` para los casos de
 * negocio (curso cerrado, tiempo agotado, ya respondiste): un 401 o 403 haría
 * que `TokenInterceptor` cerrara la sesión y mandara a /login a alguien que
 * está a media evaluación.
 */
@Injectable({ providedIn: 'root' })
export class CuestionarioPublicoService {

  private readonly api = '/api/publico/cuestionario/';

  constructor(private http: HttpClient) { }

  /**
   * Estado de la pantalla: quién eres, si el curso acepta respuestas, el
   * cuestionario (sin clave) y lo ya contestado.
   *
   * Va por POST y no por GET porque el enlace genérico manda el número de
   * empleado: en la URL quedaría en el historial del navegador y en los
   * registros del servidor web.
   */
  estado(token: string, numEmpleado = ''): Observable<EstadoCuestionario> {
    return this.http.post<EstadoCuestionario>(
      `${this.api}${token}/`, { num_empleado: numEmpleado }, SIN_LOADER_GLOBAL,
    );
  }

  /** Arranca el intento: el servidor sella el inicio y calcula la hora límite. Idempotente -- volver a llamar no reinicia el reloj. */
  iniciar(token: string, numEmpleado = ''): Observable<EstadoCuestionario> {
    return this.http.post<EstadoCuestionario>(
      `${this.api}${token}/iniciar/`, { num_empleado: numEmpleado }, SIN_LOADER_GLOBAL,
    );
  }

  /**
   * Guarda un lote de respuestas. Fusiona sobre lo ya guardado y es
   * idempotente por pregunta: reenviar la misma respuesta la sobrescribe,
   * nunca la duplica -- que es justo lo que hace seguro reintentar cuando la
   * red va y viene.
   */
  guardar(token: string, respuestas: Record<string, any>, opciones: {
    numEmpleado?: string; ultimaPreguntaVista?: string;
  } = {}): Observable<{ status: string; guardadas?: string[]; situacion?: string; segundos_restantes?: number | null; servidor_ahora?: string }> {
    return this.http.post<any>(`${this.api}${token}/guardar/`, {
      num_empleado: opciones.numEmpleado || '',
      respuestas,
      ultima_pregunta_vista: opciones.ultimaPreguntaVista || '',
    }, SIN_LOADER_GLOBAL);
  }

  /** Señal ligera de "sigo aquí" -- alimenta el monitoreo en vivo y resincroniza el reloj. */
  latido(token: string, opciones: { numEmpleado?: string; ultimaPreguntaVista?: string } = {}):
    Observable<{ status: string; situacion?: string; segundos_restantes?: number | null; servidor_ahora?: string }> {
    return this.http.post<any>(`${this.api}${token}/latido/`, {
      num_empleado: opciones.numEmpleado || '',
      ultima_pregunta_vista: opciones.ultimaPreguntaVista || '',
    }, SIN_LOADER_GLOBAL);
  }

  /** Cierra el intento. Acepta un último lote para que no exista la ventana entre "guardé lo último" y "envié". */
  enviar(token: string, respuestas: Record<string, any>, numEmpleado = ''):
    Observable<{ status: string; situacion?: string; mensaje?: string }> {
    return this.http.post<any>(`${this.api}${token}/enviar/`, {
      num_empleado: numEmpleado, respuestas,
    }, SIN_LOADER_GLOBAL);
  }
}
