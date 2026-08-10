import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { SessionService } from './session.service';
import { PermisosService } from './permisos.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {

  constructor(
	private router: Router,
	private sessionS: SessionService,
	private permisosS: PermisosService,
  ) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    const session = this.sessionS.getUsuario();

    // No hay sesión activa → al login
    if (!session) {
      return this.router.parseUrl('/login');
    }

    // Reemplaza al viejo `rolesPermitidos: [1,2,3,4,9999]`, identico en
    // todas las rutas y que en la practica nunca distinguio nada (ver
    // CLAUDE.md, gotcha #4). Cada ruta declara el permiso concreto que
    // necesita -- ver PermisosService y RecursoSistema.Meta.permissions.
    if (route.data['soloSuperusuario'] && !this.permisosS.esSuperusuario()) {
      return this.router.parseUrl('/acceso-denegado');
    }

    const permisoRequerido = route.data['permisoRequerido'] as string | undefined;
    if (permisoRequerido && !this.permisosS.tiene(permisoRequerido)) {
      return this.router.parseUrl('/acceso-denegado'); /*  hiciste algo que no, pillin */
    }

    return true;
  }
}
