import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';
import { Formulario } from '../content/formularios/formulario.const';

export interface RespuestaSubirImagen {
  status: 'success' | 'error';
  ruta: string;
  url: string;
  mensaje?: string;
}

/**
 * Formularios (constructor tipo Google Forms).
 *
 * El editor trabaja con el formulario COMPLETO: lo carga de una y lo guarda
 * de una (un PATCH con `preguntas` entera), no un diff por pregunta -- ver
 * el comentario del modelo `Formulario` en el backend sobre por que las
 * preguntas viven en un JSONField y no en tabla aparte.
 *
 * El autoguardado usa SIN_LOADER_GLOBAL a proposito: dispara solo mientras
 * la persona escribe, y montar el overlay de carga global en cada pausa de
 * tecleo taparia el editor cada pocos segundos.
 */
@Injectable({ providedIn: 'root' })
export class FormularioService {

  private readonly api = '/api-sicre/formularios/';

  constructor(private http: HttpClient) { }

  listar(): Observable<any> {
    return this.http.get<any>(this.api);
  }

  obtener(id: number): Observable<any> {
    return this.http.get<any>(`${this.api}${id}/`);
  }

  crear(datos: Partial<Formulario>): Observable<any> {
    return this.http.post<any>(this.api, datos);
  }

  /** Guardado explícito (botón Guardar): sí muestra el loader global. */
  actualizar(id: number, datos: Partial<Formulario>): Observable<any> {
    return this.http.patch<any>(`${this.api}${id}/`, datos);
  }

  /** Autoguardado silencioso: mismo endpoint, sin overlay de carga. */
  autoguardar(id: number, datos: Partial<Formulario>): Observable<any> {
    return this.http.patch<any>(`${this.api}${id}/`, datos, SIN_LOADER_GLOBAL);
  }

  eliminar(id: number): Observable<any> {
    return this.http.delete<any>(`${this.api}${id}/`);
  }

  duplicar(id: number, titulo?: string): Observable<any> {
    return this.http.post<any>(`${this.api}${id}/duplicar/`, titulo ? { titulo } : {});
  }

  /** Sube una imagen (base64) para el cuerpo de una pregunta o un bloque de imagen. */
  subirImagen(imagenBase64: string, nombre?: string): Observable<RespuestaSubirImagen> {
    return this.http.post<RespuestaSubirImagen>(
      `${this.api}subir-imagen/`, { imagen: imagenBase64, nombre },
    );
  }
}
