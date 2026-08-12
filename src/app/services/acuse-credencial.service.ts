import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';

export type TipoAcuse = 'alta' | 'baja';

/** Estado de acuses de UN empleado: url del archivo vigente, o null si no se ha cargado. */
export interface EstadoAcuses {
  alta: string | null;
  baja: string | null;
}

export interface AcuseCredencial {
  id_acuse: number;
  num_empleado: string;
  tipo: TipoAcuse;
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
 */
@Injectable({ providedIn: 'root' })
export class AcuseCredencialService {
  private readonly api = '/api-sicre/acuses/';

  constructor(private http: HttpClient) {}

  /**
   * {num_empleado: {alta, baja}} para TODO lo que hay en disco, en una sola
   * llamada -- igual que el roster de "Imprimir credenciales", para no
   * disparar una peticion por cada una de las ~16k filas de la ag-Grid.
   */
  mapa(): Observable<{ status: string; registros: Record<string, EstadoAcuses> }> {
    return this.http.get<{ status: string; registros: Record<string, EstadoAcuses> }>(
      `${this.api}mapa/`, SIN_LOADER_GLOBAL
    );
  }

  /** Sube (o reemplaza) el acuse de alta/baja de un empleado. `archivoBase64` es un data-URI. */
  subir(numEmpleado: string, tipo: TipoAcuse, archivoBase64: string): Observable<any> {
    return this.http.post(`${this.api}subir/`, {
      num_empleado: numEmpleado, tipo, archivo: archivoBase64,
    });
  }

  /** Estado de acuses (alta y baja) de un empleado. */
  porEmpleado(numEmpleado: string): Observable<{ status: string; resultados: AcuseCredencial[] }> {
    return this.http.get<{ status: string; resultados: AcuseCredencial[] }>(
      `${this.api}por-empleado/?num_empleado=${encodeURIComponent(numEmpleado)}`, SIN_LOADER_GLOBAL
    );
  }

  /** Historial completo (quien subio y, si se reemplazo, quien y cuando), para la pestaña "Auditoría". */
  auditoria(): Observable<{ status: string; total: number; resultados: AcuseAuditoria[] }> {
    return this.http.get<{ status: string; total: number; resultados: AcuseAuditoria[] }>(
      `${this.api}auditoria/`, SIN_LOADER_GLOBAL
    );
  }
}
