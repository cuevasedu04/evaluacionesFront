import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../src/environments/environment';

@Injectable({ providedIn: 'root' })
export class EnrolamientoService {
  
  private apiUrl = `/api/expedientes/`;
  private apiFamiliaresUrl = `/api/expedientes-familiares/`;
  private apiCredencializacionUrl = `/api/credencializacion/`;

  constructor(private http: HttpClient) { }

  // --- MÃ‰TODOS DE ENROLAMIENTO ---

  // 1. Obtener lista de PENDIENTES (Sin foto O sin firma)
  getPendientes(): Observable<any[]> {
    // Django DRF agrega el nombre de la acciÃ³n a la URL: /api/expedientes/pendientes/
    return this.http.get<any[]>(`${this.apiUrl}pendientes/`);
  }

  // 2. Obtener lista completa (HistÃ³rico o todos)
  getExpedientes(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  obtenerExpedientePorId(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}${id}/`);
  }

  obtenerExpedienteFamiliarPorId(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiFamiliaresUrl}${id}/`);
  }

  // 3. Buscar (Ojo: Tu endpoint 'pendientes' en el back no tiene activado el filtro de bÃºsqueda ?search=
  // por lo que recomendaremos usar el filtro local de la tabla para buscar dentro de los pendientes)
  buscarExpediente(termino: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}?search=${termino}`);
  }

  // Actualizar un expediente existente (PATCH)
  actualizarExpediente(id: number, datos: any): Observable<any> {
    // La URL final serÃ¡ tipo: http://.../api/expedientes/37/
    return this.http.patch(`${this.apiUrl}${id}/`, datos);
  }
  // Actualizar un expediente familiar existente (PATCH)
  actualizarExpedienteFamiliar(id: number, datos: any): Observable<any> {
    return this.http.patch(`${this.apiFamiliaresUrl}${id}/`, datos);
  }

  // Obtener lista de expedientes listos para credencializar
  getListosParaImprimir(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}listos-para_imprimir/`);
  }

  getDataTableImprimir(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}datatableImprimir/`);
  }

  // ... (Resto de tus mÃ©todos: crearExpediente, credencializaciÃ³n, etc.) ...
  crearExpediente(datos: any): Observable<any> {
    return this.http.post(this.apiUrl, datos);
  }
  
  guardarEnrolamiento(datos: any): Observable<any> {
    return this.http.post(this.apiCredencializacionUrl, datos);
  }

  // Obtener folio mÃ¡ximo / siguiente folio desde backend
  obtenerFolioMaximo(nuevoLaredo?: number): Observable<any> {
    const query = (nuevoLaredo === 0 || nuevoLaredo === 1)
      ? `?nuevo_laredo=${nuevoLaredo}`
      : '';
    return this.http.get<any>(`${this.apiUrl}obtener-folio-maximo/${query}`);
  }

  obtenerFolioMaximoFamiliares(): Observable<any> {
    return this.http.get<any>(`${this.apiFamiliaresUrl}obtener-folio-maximo-familiares/`);
  }

  crearExpedienteFamiliar(datos: any): Observable<any> {
    return this.http.post(this.apiFamiliaresUrl, datos);
  }

  // Marcar registro como impreso despuÃ©s de generar PDF
  marcarComoImpreso(id: number, fechaExpedicion?: string): Observable<any> {
    const payload = fechaExpedicion ? { fecha_expedicion: fechaExpedicion } : {};
    return this.http.post(`${this.apiUrl}${id}/marcar-impreso/`, payload);
  }

  marcarComoImpresoFamiliar(id: number, fechaExpedicion?: string): Observable<any> {
    const payload = fechaExpedicion ? { fecha_expedicion: fechaExpedicion } : {};
    return this.http.post(`${this.apiFamiliaresUrl}${id}/marcar-impreso/`, payload);
  }

  // Obtener foto y firma existentes desde safirho_db.NW_EMPL_FOTO_ANAM
  getFotoFirmaExterna(numEmpleado: string | number): Observable<any> {
    return this.http.get(`/api/foto-firma/${numEmpleado}/`);
  }

  // BÃºsqueda avanzada con mÃºltiples filtros
  busquedaAvanzada(filtros: any): Observable<any> {
    return this.http.post(`${this.apiUrl}busqueda-avanzada/`, filtros);
  }

  pendientesDeImprimir(filtros: any): Observable<any> {
    return this.http.post(`${this.apiUrl}pendientes-de-imprimir/`, filtros);
  }

  // EstadÃ­sticas generales del sistema
  obtenerEstadisticas(fechaDesde?: string, fechaHasta?: string): Observable<any> {
    let params: any = {};
    if (fechaDesde) params.fecha_desde = fechaDesde;
    if (fechaHasta) params.fecha_hasta = fechaHasta;
    return this.http.get(`${this.apiUrl}estadisticas/`, { params });
  }

  // Guardar foto y firma en safirho_db.NW_EMPL_FOTO_ANAM
  guardarFotoFirma(id: number, foto: string, firma: string): Observable<any> {
    return this.http.post(`${this.apiUrl}${id}/guardar-foto-firma/`, { foto, firma });
  }
}