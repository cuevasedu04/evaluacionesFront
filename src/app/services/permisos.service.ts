import { Injectable } from '@angular/core';
import { SessionService } from './session.service';

/**
 * Resuelve que puede ver/hacer el usuario en sesion, a partir de lo que
 * mando el login (`esSuperusuario` + `permisos`, codenames del catalogo
 * `RecursoSistema.Meta.permissions` en el backend).
 *
 * Reemplaza al viejo esquema de `rolesPermitidos: [1,2,3,4,9999]` repetido
 * identico en cada ruta/item de menu (ver CLAUDE.md, gotcha #4 -- nunca
 * diferenciaba nada de verdad). Ahora cada pantalla/funcionalidad declara UN
 * codename concreto, y son los roles (creados en /administracion) los que
 * deciden que combinacion de codenames tiene cada usuario.
 */
@Injectable({ providedIn: 'root' })
export class PermisosService {

  constructor(private sessionS: SessionService) {}

  esSuperusuario(): boolean {
    return !!this.sessionS.getUsuario()?.esSuperusuario;
  }

  /**
   * ¿El usuario en sesion tiene este permiso?
   *
   * Un superusuario siempre pasa, igual que en el backend
   * (`user.has_perm()` de Django ya resuelve asi para superusuarios) --
   * evita que la lista de permisos tenga que enumerar cada codename para
   * que el superusuario vea todo.
   */
  tiene(codigo: string | null | undefined): boolean {
    if (!codigo) return true; // sin codename declarado = pantalla publica (ej. dashboard)
    if (this.esSuperusuario()) return true;
    const permisos: string[] = this.sessionS.getUsuario()?.permisos || [];
    return permisos.includes(codigo);
  }

  /** Al menos uno de varios permisos (para gates que aceptan cualquiera de un conjunto). */
  tieneAlguno(codigos: string[]): boolean {
    return codigos.some(c => this.tiene(c));
  }
}
