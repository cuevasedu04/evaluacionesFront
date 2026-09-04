import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';

export type TipoAcuse = 'alta' | 'baja';

/** Maximo de acuses de un mismo tipo que puede acumular un empleado (ver AcuseCredencial.MAX_POR_EMPLEADO en el backend). */
export const MAX_ACUSES_POR_TIPO = 10;

/** Cuantos acuses de cada tipo tiene YA un empleado (para el badge "n/10" de la grid). */
export interface EstadoAcuses {
  alta: number;
  baja: number;
}

export interface AcuseCredencial {
  id_acuse: number;
  num_empleado: string;
  tipo: TipoAcuse;
  numero: number;
  archivo: string | null;
  fecha_carga: string;
  id_usuario_carga: number | null;
  fecha_modificacion: string | null;
  id_usuario_modifica: number | null;
}

/** Fila de la pestaña "Auditoría": mismo registro, con nombre y usuarios ya resueltos. */
export interface AcuseAuditoria {
  id_acuse: number;
  num_empleado: string;
  nombre: string;
  tipo: TipoAcuse;
  numero: number;
  archivo: string | null;
  fecha_carga: string;
  usuario_carga: string;
  fecha_modificacion: string | null;
  usuario_modifica: string;
}

/**
 * Acuses de alta/baja (PDF o imagen del documento firmado), cargados por
 * num_empleado -- mismo esquema de convencion de nombre de archivo que
 * foto/firma (ver media_utils.py), asi que aqui tampoco se persiste ninguna
 * ruta: el backend la resuelve sola en cuanto el archivo existe en disco.
 *
 * Un empleado puede tener hasta MAX_ACUSES_POR_TIPO acuses del MISMO tipo
 * (varios movimientos de alta o de baja a lo largo del tiempo) -- subir()
 * siempre AGREGA uno nuevo, nunca reemplaza uno existente; para eso esta
 * eliminar().
 */
@Injectable({ providedIn: 'root' })
export class AcuseCredencialService {
  private readonly api = '/api/acuses/';

  constructor(private http: HttpClient) {}

  /**
   * {num_empleado: {alta, baja}} -- CUANTOS acuses de cada tipo tiene ya
   * cada empleado, en una sola llamada -- igual que el roster de "Imprimir
   * credenciales", para no disparar una peticion por cada una de las ~16k
   * filas de la ag-Grid. La lista completa (con URLs) de un empleado se pide
   * aparte, al abrir su modal de gestion -- ver porEmpleado().
   */
  mapa(): Observable<{ status: string; registros: Record<string, EstadoAcuses> }> {
    return this.http.get<{ status: string; registros: Record<string, EstadoAcuses> }>(
      `${this.api}mapa/`, SIN_LOADER_GLOBAL
    );
  }

  /** Agrega un acuse nuevo (hasta MAX_ACUSES_POR_TIPO por empleado+tipo). `archivoBase64` es un data-URI. */
  subir(numEmpleado: string, tipo: TipoAcuse, archivoBase64: string): Observable<any> {
    return this.http.post(`${this.api}subir/`, {
      num_empleado: numEmpleado, tipo, archivo: archivoBase64,
    });
  }

  /** Borra un acuse especifico -- libera su numero para la proxima carga de ese empleado+tipo. */
  eliminar(idAcuse: number): Observable<{ status: string }> {
    return this.http.post<{ status: string }>(`${this.api}eliminar/`, { id_acuse: idAcuse });
  }

  /** Acuses de un empleado -- de alta y baja, o solo `tipo` si se indica. */
  porEmpleado(numEmpleado: string, tipo?: TipoAcuse): Observable<{ status: string; resultados: AcuseCredencial[] }> {
    let url = `${this.api}por-empleado/?num_empleado=${encodeURIComponent(numEmpleado)}`;
    if (tipo) url += `&tipo=${tipo}`;
    return this.http.get<{ status: string; resultados: AcuseCredencial[] }>(url, SIN_LOADER_GLOBAL);
  }

  /** Historial completo (quien subio cada acuse), para la pestaña "Auditoría". */
  auditoria(): Observable<{ status: string; total: number; resultados: AcuseAuditoria[] }> {
    return this.http.get<{ status: string; total: number; resultados: AcuseAuditoria[] }>(
      `${this.api}auditoria/`, SIN_LOADER_GLOBAL
    );
  }
}
