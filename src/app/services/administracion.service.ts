import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SIN_LOADER_GLOBAL } from './http-opciones';

/** Un usuario (`auth_user`), tal como lo expone la API de administracion. */
export interface Usuario {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  is_staff: boolean;
  date_joined: string;
  last_login: string | null;
  roles: number[];
  roles_detalle: { id: number; name: string }[];
  /** Cruzado por num_empleado contra media/fotos -- ver PerfilUsuario. Vacio si no se ha capturado. */
  num_empleado: string;
  /** URL publica de la foto ya cruzada, o null si no hay num_empleado o no tiene foto en /media. */
  foto: string | null;
}

/** Un permiso del catalogo (`RecursoSistema.Meta.permissions`). */
export interface Permiso {
  id: number;
  codename: string;
  name: string;
}

/** Un rol (`auth_group`) con su subconjunto de permisos. */
export interface Rol {
  id: number;
  name: string;
  permisos_detalle: Permiso[];
  total_usuarios: number | null;
}

/**
 * API de administracion: usuarios, roles y catalogo de permisos.
 *
 * Los tres endpoints estan gateados a superusuario en el backend
 * (`EsSuperusuario`, ver credencializacion/auth.py) -- si alguien sin ese
 * flag llega a llamarlos, el backend responde 403 sin importar lo que
 * decida el frontend.
 */
@Injectable({ providedIn: 'root' })
export class AdministracionService {

  private readonly apiUsuarios = '/api/usuarios/';
  private readonly apiRoles = '/api/roles/';
  private readonly apiPermisos = '/api/permisos/';
  private readonly apiEnrolamiento = '/api/enrolamiento-credencial/';

  constructor(private http: HttpClient) {}

  // ---- Usuarios ----

  listarUsuarios(busqueda = ''): Observable<Usuario[]> {
    const query = busqueda ? `?busqueda=${encodeURIComponent(busqueda)}` : '';
    return this.http.get<Usuario[]>(`${this.apiUsuarios}${query}`, SIN_LOADER_GLOBAL);
  }

  crearUsuario(datos: Partial<Usuario> & { password: string }): Observable<Usuario> {
    return this.http.post<Usuario>(this.apiUsuarios, datos);
  }

  actualizarUsuario(id: number, datos: Partial<Usuario>): Observable<Usuario> {
    return this.http.patch<Usuario>(`${this.apiUsuarios}${id}/`, datos);
  }

  activarUsuario(id: number): Observable<any> {
    return this.http.post(`${this.apiUsuarios}${id}/activar/`, {});
  }

  desactivarUsuario(id: number): Observable<any> {
    return this.http.post(`${this.apiUsuarios}${id}/desactivar/`, {});
  }

  restablecerPassword(id: number, password: string): Observable<any> {
    return this.http.post(`${this.apiUsuarios}${id}/set-password/`, { password });
  }

  // ---- Roles ----

  listarRoles(): Observable<Rol[]> {
    return this.http.get<Rol[]>(this.apiRoles, SIN_LOADER_GLOBAL);
  }

  crearRol(nombre: string, permisos: string[]): Observable<Rol> {
    return this.http.post<Rol>(this.apiRoles, { name: nombre, permisos });
  }

  actualizarRol(id: number, datos: { name?: string; permisos?: string[] }): Observable<Rol> {
    return this.http.patch<Rol>(`${this.apiRoles}${id}/`, datos);
  }

  eliminarRol(id: number): Observable<any> {
    return this.http.delete(`${this.apiRoles}${id}/`);
  }

  // ---- Catalogo de permisos ----

  listarPermisos(): Observable<Permiso[]> {
    return this.http.get<Permiso[]>(this.apiPermisos);
  }

  // ---- Respaldo de medios ----

  respaldoFotos(): Observable<Blob> {
    return this.http.get(`${this.apiEnrolamiento}respaldo-fotos/`, { responseType: 'blob' });
  }

  respaldoFirmas(): Observable<Blob> {
    return this.http.get(`${this.apiEnrolamiento}respaldo-firmas/`, { responseType: 'blob' });
  }
}
