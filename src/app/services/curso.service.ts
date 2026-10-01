import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';
import {
  Curso, ParticipanteCurso, RespuestaCargaParticipantes,
} from '../content/cursos/curso.const';

/**
 * Cursos: amarra constancia + plantilla de correo + cuestionario y los
 * aplica a una lista cerrada de participantes.
 *
 * Ojo con qué endpoint mueve qué: `actualizar()` (PATCH) NO puede cambiar
 * el estado ni las fechas reales del curso -- eso lo mueven las acciones
 * (abrir/cerrar), y los tres elementos asignados se cambian con
 * `asignar()`, no con un PATCH suelto. Es a propósito: así no se puede
 * marcar un curso como cerrado sin haber calificado nada.
 */
@Injectable({ providedIn: 'root' })
export class CursoService {

  private readonly api = '/api-sicre/cursos/';

  constructor(private http: HttpClient) { }

  listar(): Observable<any> {
    return this.http.get<any>(this.api);
  }

  obtener(id: number): Observable<Curso> {
    return this.http.get<Curso>(`${this.api}${id}/`);
  }

  crear(datos: Partial<Curso>): Observable<Curso> {
    return this.http.post<Curso>(this.api, datos);
  }

  actualizar(id: number, datos: Partial<Curso>): Observable<Curso> {
    return this.http.patch<Curso>(`${this.api}${id}/`, datos);
  }

  /** Guardado silencioso (autoguardado de la configuración): sin overlay de carga. */
  autoguardar(id: number, datos: Partial<Curso>): Observable<Curso> {
    return this.http.patch<Curso>(`${this.api}${id}/`, datos, SIN_LOADER_GLOBAL);
  }

  eliminar(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}${id}/`);
  }

  /** Asigna constancia / plantilla de correo / cuestionario. Valida que cada id exista. */
  asignar(id: number, datos: {
    id_plantilla?: number | null;
    id_plantilla_correo?: number | null;
    id_formulario?: number | null;
  }): Observable<{ status: string; curso: Curso; mensaje?: string }> {
    return this.http.post<{ status: string; curso: Curso }>(`${this.api}${id}/asignar/`, datos);
  }

  participantes(id: number): Observable<{ status: string; participantes: ParticipanteCurso[] }> {
    return this.http.get<{ status: string; participantes: ParticipanteCurso[] }>(
      `${this.api}${id}/participantes/`,
    );
  }

  /**
   * Carga participantes por número de empleado.
   *
   * Valida el estado de nómina en el servidor: los dados de baja y los
   * fallecidos regresan en `no_activos` y NO se cargan. Nada se descarta en
   * silencio -- cada número que no se cargó sale en alguna lista de la
   * respuesta.
   */
  cargarParticipantes(id: number, nosEmpleado: string[]): Observable<RespuestaCargaParticipantes> {
    return this.http.post<RespuestaCargaParticipantes>(
      `${this.api}${id}/cargar-participantes/`, { nos_empleado: nosEmpleado }, SIN_LOADER_GLOBAL,
    );
  }

  quitarParticipante(id: number, idParticipante: number): Observable<any> {
    return this.http.post<any>(
      `${this.api}${id}/quitar-participante/`, { id_participante: idParticipante }, SIN_LOADER_GLOBAL,
    );
  }

  /**
   * Abre el curso: CONGELA el cuestionario y empieza a aceptar respuestas.
   *
   * Es el punto sin retorno -- a partir de aquí se responde y se califica
   * contra esa copia, no contra el formulario vivo, para que editar el
   * cuestionario después no vuelva inexplicables las calificaciones ya
   * emitidas.
   */
  abrir(id: number): Observable<{ status: string; curso: Curso; mensaje?: string }> {
    return this.http.post<any>(`${this.api}${id}/abrir/`, {});
  }

  /** Cierra el curso. Los intentos en progreso se sellan con lo que hayan capturado. */
  cerrar(id: number): Observable<{ status: string; curso: Curso; mensaje?: string }> {
    return this.http.post<any>(`${this.api}${id}/cerrar/`, {});
  }

  /**
   * Marca que a estas personas ya se les mandó su enlace.
   *
   * NO manda el correo: eso lo hace el Agente de Correo en la computadora de
   * quien opera (Outlook COM solo controla el Outlook de su propia máquina).
   * Esto solo registra el resultado.
   */
  registrarEnvioEnlace(id: number, idsParticipante: number[]):
    Observable<{ status: string; marcados: number; mensaje?: string }> {
    return this.http.post<any>(
      `${this.api}${id}/registrar-envio-enlace/`, { ids_participante: idsParticipante },
      SIN_LOADER_GLOBAL,
    );
  }

  intentos(id: number): Observable<{ status: string; intentos: any[] }> {
    return this.http.get<{ status: string; intentos: any[] }>(`${this.api}${id}/intentos/`);
  }
}
