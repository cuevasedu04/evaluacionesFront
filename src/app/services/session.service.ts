import { Injectable } from '@angular/core';
import * as CryptoJS from 'crypto-js';
import { UtilsService } from './utils.service';
import { TipoToast } from '../../api/entidades/enumeraciones';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly sessionKey = 'session';
  private readonly userKey = 'user';
  private readonly secretKey = '4n4m@r00t-s3cr3t!';

  constructor(
	private utils: UtilsService,
    private modalService: NgbModal
  ) {}

  /**
   * Guarda la sesión encriptada y añade tiempo de expiración
   * @param data objeto de sesión devuelto por backend
   * @param minutos tiempo de expiración en minutos (por defecto 24hrs)
   */
  setSession(data: any, minutos: number = 1440): void {
    const expiraEn = Date.now() + minutos   * 60 * 1000; /* * 24 hrs */
    /* const expiraEn = Date.now()  + 10000;  *//* * 24 hrs */
    const session = { ...data, expiraEn };

    const jsonString = JSON.stringify(session);
    const encrypted = CryptoJS.AES.encrypt(jsonString, this.secretKey).toString();
    localStorage.setItem(this.sessionKey, encrypted);
  }

  /**
   * Obtiene y desencripta la sesión; valida si ya expiró.
   * Si caducó, la destruye y devuelve null.
   */
  getUsuario(): any | null {
    if (!environment.production && environment.bypassLogin) {
      return {
        idUsuarioRol: environment.bypassRole || 4, // Toma el rol de environment.ts (por defecto 4)
        nombres: 'Desarrollador',
        apellidos: 'Dev',
        tokenWs: 'dummy-token',
        // Acceso total: reproduce el comportamiento de siempre en dev, donde
        // TODAS las rutas usaban `rolesPermitidos: [1,2,3,4,9999]` por igual
        // (ver CLAUDE.md, gotcha #4 -- nunca hubo diferenciacion real). El
        // token falso no llega al backend (TokenInterceptor lo omite a
        // proposito), asi que las pantallas de administracion SI exigen una
        // sesion real -- ver bypassLogin en environment.ts.
        esSuperusuario: true,
        permisos: [],
        expiraEn: Date.now() + 1000 * 60 * 60 * 24 // No expira en 24h
      };
    }

    const encrypted = localStorage.getItem(this.sessionKey);
    if (!encrypted) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.secretKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      const session = JSON.parse(decrypted);

      // Validar expiración
      if (session.expiraEn && Date.now() > session.expiraEn) {
        this.utils.MuestrasToast(TipoToast.Info, "Sesión expirada");
        this.logout();
        return null;
      }

      return session;
    } catch (error) {
      console.error('Error al desencriptar la sesión:', error);
      this.logout();
      return null;
    }
  }

  /** Devuelve true si hay sesión válida y no caducada */
  isLoggedIn(): boolean {
    return !!this.getUsuario();
  }

  /** Borra la sesión */
  logout(): void {
    if (!environment.production && environment.bypassLogin) {
      console.warn('Bypass Login activado: Evitando el cierre de sesión forzado.');
      return;
    }

    localStorage.removeItem(this.sessionKey);
    // Destruir modales y componentes flotantes
    this.modalService.dismissAll();
    
    window.location.href = '/login';
  }

  /** Verifica sin eliminar si la sesión está expirada */
  isSessionExpired(): boolean {
    const encrypted = localStorage.getItem(this.sessionKey);
    if (!encrypted) return true;

    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.secretKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      const session = JSON.parse(decrypted);
      return session.expiraEn && Date.now() > session.expiraEn;
    } catch {
      return true;
    }
  }

  /**
   * Guarda credenciales recordadas (encriptadas)
   */
  setUserRecordado(data: { usuario: string; password: string }): void {
    const jsonString = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(jsonString, this.secretKey).toString();
    localStorage.setItem(this.userKey, encrypted);
  }

  /**
   * Obtiene y desencripta el usuario recordado
   */
  getUserRecordado(): { usuario: string; password: string } | null {
    const encrypted = localStorage.getItem(this.userKey);
    if (!encrypted) return null;

    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, this.secretKey);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Error al desencriptar usuario recordado:', error);
      localStorage.removeItem(this.userKey);
      return null;
    }
  }

  /** Elimina el usuario recordado */
  clearUserRecordado(): void {
    localStorage.removeItem(this.userKey);
  }
}
