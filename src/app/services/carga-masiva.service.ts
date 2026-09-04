import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CargaMasivaRegistro {
    id?: number;
    rfc: string;
    nombre?: string;
    foto?: string;
    firma?: string;
    lote: string;
    fecha_enrolamiento?: string;
    usuario_enrola?: number;
    activo?: boolean;
}

export interface ProgresoLote {
    lote: string;
    total_enrolados: number;
    total_fotografias: number;
    total_firmas: number;
    registros: CargaMasivaRegistro[];
}

@Injectable({
  providedIn: 'root'
})
export class CargaMasivaService {
  private apiUrl = '/api/carga-masiva/';

  constructor(private http: HttpClient) { }

  /**
   * Guarda o actualiza un empleado a la vez (por lote y rfc).
   */
  autoGuardar(empleado: CargaMasivaRegistro): Observable<CargaMasivaRegistro> {
    return this.http.post<CargaMasivaRegistro>(this.apiUrl + 'auto-guardado/', empleado);
  }

  /**
   * Obtiene el siguiente número de lote (ej. LOTE-00001).
   */
  obtenerSiguienteLote(): Observable<{lote: string}> {
    return this.http.get<{lote: string}>(this.apiUrl + 'siguiente-lote/');
  }

  /**
   * Consulta el progreso de un lote.
   * @param sinImagenes Si true, los registros no incluyen base64 (sólo indicadores has_foto/has_firma).
   */
  obtenerProgresoLote(lote: string, sinImagenes: boolean = false): Observable<ProgresoLote> {
    let params = new HttpParams().set('lote', lote);
    if (sinImagenes) params = params.set('sin_imagenes', '1');
    return this.http.get<ProgresoLote>(this.apiUrl + 'progreso-lote/', { params });
  }

  /**
   * Realiza un soft-delete de todos los registros de un lote.
   */
  cancelarLote(lote: string): Observable<any> {
    return this.http.post<any>(this.apiUrl + 'cancelar-lote/', { lote });
  }

  /**
   * Devuelve un resumen de todos los lotes (nombre, total, fotos, firmas, fechas).
   */
  obtenerResumenLotes(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl + 'lotes-resumen/');
  }

  /**
   * Carga un Excel y actualiza los registros del lote indicado que coincidan
   * por CURP (columna CURP del Excel vs campo rfc de sicre_tbl_carga_masiva).
   */
  cargarLoteExcel(archivo: File, lote: string): Observable<any> {
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('lote', lote);
    return this.http.post<any>(this.apiUrl + 'cargar-lote-excel/', fd);
  }

  /**
   * Obtiene un registro individual con foto y firma completas.
   */
  obtenerRegistro(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}${id}/`);
  }
}
