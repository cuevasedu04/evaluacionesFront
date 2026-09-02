import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';

export interface PlantillaCorreo {
  id_plantilla_correo?: number;
  nombre: string;
  asunto: string;
  cuerpo_html: string;
  cuenta_remitente: string;
  activo?: boolean;
  fecha_registro?: string;
  fecha_modificacion?: string;
}

export type EstadoEnvioCorreo = 'enviado' | 'error_outlook' | 'sin_correo' | 'error_pdf';

export interface RespuestaEnvioCorreo {
  status: 'success' | 'error';
  estado: EstadoEnvioCorreo;
  mensaje?: string;
}

/**
 * Correo electronico: CRUD de plantillas de envio (nombre/asunto/cuerpo/
 * remitente, editadas en el componente "Correo electronico" -- puede haber
 * varias, igual que las plantillas de constancia) y el registro en
 * CorreoEnviado de cada intento de envio.
 *
 * El envio REAL ya NO lo hace este backend: lo hace el Agente de Correo
 * ANAM (ver AgenteCorreoService), un programa aparte que corre en la
 * computadora de CADA usuario y habla con Outlook COM ahi mismo -- Outlook
 * COM solo puede controlar el Outlook abierto en la MISMA maquina donde
 * corre el proceso. `registrarEnvio()` aqui solo guarda el resultado (ya
 * decidido por el agente) en la bitacora de auditoria; nunca sube el PDF.
 */
@Injectable({ providedIn: 'root' })
export class CorreoService {

  private readonly apiPlantillas = '/api-sicre/plantillas-correo/';
  private readonly apiEnviar = '/api-sicre/correo-constancia/enviar/';
  private readonly apiDescargarAgente = '/api-sicre/agente-correo/descargar/';

  constructor(private http: HttpClient) { }

  // ---- Plantillas de correo (CRUD) --------------------------------------

  listarPlantillas(soloActivas = false): Observable<any> {
    const query = soloActivas ? '?activo=1' : '';
    return this.http.get<any>(`${this.apiPlantillas}${query}`, SIN_LOADER_GLOBAL);
  }

  obtenerPlantilla(id: number): Observable<PlantillaCorreo> {
    return this.http.get<PlantillaCorreo>(`${this.apiPlantillas}${id}/`);
  }

  crearPlantilla(datos: PlantillaCorreo): Observable<PlantillaCorreo> {
    return this.http.post<PlantillaCorreo>(this.apiPlantillas, datos);
  }

  actualizarPlantilla(id: number, datos: Partial<PlantillaCorreo>): Observable<PlantillaCorreo> {
    return this.http.patch<PlantillaCorreo>(`${this.apiPlantillas}${id}/`, datos);
  }

  eliminarPlantilla(id: number): Observable<any> {
    return this.http.delete(`${this.apiPlantillas}${id}/`);
  }

  // ---- Bitacora de envios --------------------------------------------------

  /**
   * Registra el resultado de UN intento de envio (ya decidido por el
   * Agente de Correo local, o por el propio frontend cuando ni siquiera
   * llego a intentarlo -- p.ej. sin correo institucional o el PDF no se
   * pudo generar). No envia nada, solo guarda la fila en CorreoEnviado.
   */
  registrarEnvio(datos: {
    num_empleado: string;
    nombre_empleado: string;
    email_destino: string;
    asunto: string;
    cuenta_remitente: string;
    nombre_curso: string;
    plantilla_clave: string;
    plantilla_correo_nombre: string;
    estado: EstadoEnvioCorreo;
    error_detalle?: string;
  }): Observable<RespuestaEnvioCorreo> {
    return this.http.post<RespuestaEnvioCorreo>(this.apiEnviar, datos, SIN_LOADER_GLOBAL);
  }

  // ---- Agente de correo (instalador) --------------------------------------

  /** El .exe del Agente de Correo ANAM (ver AgenteCorreoService) -- se descarga como blob para que TokenInterceptor pueda mandar la sesión (un <a href> normal no la llevaría). */
  descargarAgente(): Observable<Blob> {
    return this.http.get(this.apiDescargarAgente, { responseType: 'blob' });
  }
}
