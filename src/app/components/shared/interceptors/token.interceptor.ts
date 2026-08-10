import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpErrorResponse,
  HttpResponse
} from '@angular/common/http';
import { Observable, throwError, from, of } from 'rxjs';
import { catchError, switchMap, map } from 'rxjs/operators';
import { Router } from '@angular/router';
import { SessionService } from '../../../services/session.service';

@Injectable()
export class TokenInterceptor implements HttpInterceptor {

  private cachedKey: CryptoKey | null = null;

  constructor(private router: Router,
	private sessionS: SessionService
  ) {}

  private async decryptData(encryptedBase64: string): Promise<any> {
    try {
      // Decodificar base64 a bytes
      const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

      // Extraer componentes: IV (16 bytes), AuthTag (16 bytes), Data (resto)
      const iv = encryptedData.slice(0, 16);
      const authTag = encryptedData.slice(16, 32);
      const ciphertext = encryptedData.slice(32);

      // Obtener clave cacheada o derivarla
      if (!this.cachedKey) {
        this.cachedKey = await this.deriveKey('my-secret-key');
      }

      // Combinar ciphertext + authTag para AES-GCM
      const dataToDecrypt = new Uint8Array(ciphertext.length + authTag.length);
      dataToDecrypt.set(ciphertext, 0);
      dataToDecrypt.set(authTag, ciphertext.length);

      // Desencriptar usando AES-256-GCM
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          tagLength: 128
        },
        this.cachedKey,
        dataToDecrypt
      );

      const jsonString = new TextDecoder().decode(decrypted);
      return JSON.parse(jsonString);
    } catch (error) {
      throw new Error('Error al desencriptar los datos: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  private async deriveKey(password: string): Promise<CryptoKey> {
    try {
      const enc = new TextEncoder();
      
      // Importar contraseña como material de clave
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );

      // Derivar clave usando PBKDF2 (debe coincidir con el backend)
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode('salt'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      return key;
    } catch (error) {
      throw error;
    }
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Agregar token JWT al header si existe en localStorage
    const session = this.sessionS.getUsuario();
    if (session) {
      try {
        const token = session.tokenWs;

        // 'dummy-token' es el valor fijo que SessionService inventa bajo
        // `environment.bypassLogin` (sesion falsa en memoria, sin pasar por
        // el backend). Ahora que el backend valida tokens de verdad
        // (BearerTokenAuthentication), mandarlo como credencial real
        // provocaria 401 en CADA peticion -- un token que no existe en
        // `authtoken_token` no cae a "anonimo", DRF lo rechaza explicito.
        // Bajo bypass simplemente no se manda Authorization, igual que antes
        // de que existiera autenticacion real en el backend.
        if (token && token !== 'dummy-token') {
          req = req.clone({
            setHeaders: {
              'authorization': `Bearer ${token}`
            }
          });
        }
      } catch (error) {
        console.error('Error parsing session:', error);
      }
    }

    return next.handle(req).pipe(
      switchMap((event: HttpEvent<any>) => {
        // Verificar si es una respuesta HTTP con cuerpo
        if (event instanceof HttpResponse && event.body) {
          
          // Si la respuesta está encriptada, desencriptarla
          if (event.body.encrypted === true && event.body.data) {
            return from(this.decryptData(event.body.data)).pipe(
              map(decryptedBody => {
                return event.clone({ body: decryptedBody });
              }),
              catchError(decryptError => {
                const errorMessage = decryptError instanceof Error 
                  ? decryptError.message 
                  : 'Error desconocido al desencriptar';
                
                return throwError(() => ({
                  error: 'DECRYPTION_ERROR',
                  message: errorMessage,
                  originalError: decryptError
                }));
              })
            );
          }
        }
        
        // Retornar evento sin modificar
        return of(event);
      }),
      catchError((err: any) => {
        // Manejo de errores de autenticación
        if (err instanceof HttpErrorResponse) {
          if (err.status === 401 || err.status === 403) {
            try {
              this.sessionS.logout();
            } catch (e) {
              console.error('Error cerrando sesión:', e);
            }
          }
        }
        
        return throwError(() => err);
      })
    );
  }
}