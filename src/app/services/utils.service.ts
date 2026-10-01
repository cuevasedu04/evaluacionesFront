import { Injectable } from '@angular/core';
import { TipoToast } from '../../api/entidades/enumeraciones';
import { ToastrService } from 'ngx-toastr';


@Injectable({
  providedIn: 'root'
})
export class UtilsService {

  constructor(
    private toastService: ToastrService,
    
  ) { }

  MuestrasToast(tipoToast: TipoToast, mensaje: string) {
    switch (tipoToast) {
      case TipoToast.Success:
        this.toastService.success(mensaje, '', {
          closeButton: true,
          progressBar: true
        })
        break;
      case TipoToast.Error:
        this.toastService.error(mensaje, '', {
          closeButton: true,
          progressBar: true
        })
        break;
      case TipoToast.Info:
        this.toastService.info(mensaje, '', {
          closeButton: true,
          progressBar: true
        })
        break;
      case TipoToast.Warning:
        this.toastService.warning(mensaje, '', {
          closeButton: true,
          progressBar: true
        })
        break;
    }
  }

  /**
   * Los errores de validacion de DRF llegan como `{campo: ['mensaje']}` (400),
   * no como `{mensaje}`: sin leerlos, un dato duplicado o invalido caia al
   * mensaje generico de "error interno" aunque el servidor ya hubiera dicho
   * exactamente que estaba mal.
   */
  private mensajeDeValidacion(ex: any): string {
    if (ex?.status !== 400 || !ex.error || typeof ex.error !== 'object') return '';
    const mensajes = Object.entries(ex.error)
      .map(([campo, v]) => {
        const texto = Array.isArray(v) ? String(v[0]) : (typeof v === 'string' ? v : '');
        if (!texto) return '';
        if (/already exists/i.test(texto)) return `Ya existe un registro con ese valor en «${campo}».`;
        return campo === 'non_field_errors' || campo === 'detail' ? texto : `${campo}: ${texto}`;
      })
      .filter(Boolean);
    return mensajes.join(' ');
  }

  MuestraErrorInterno(ex?: any) {
    if (ex && ex.status == 401) {
      this.toastService.info(
        'Su sesión ha vencido', '', {
        closeButton: true,
        progressBar: true
      });
    } else {
      // El backend responde en español ({'mensaje': '...'}), no en inglés
      // ({'message': '...'}) -- este ultimo nunca vino, asi que TODO error
      // especifico del servidor (RFC duplicado, folio en uso, plantilla en
      // uso, etc.) caia siempre al mensaje generico de soporte tecnico.
      this.toastService.error(
        ex?.error?.mensaje || ex?.error?.message || this.mensajeDeValidacion(ex)
          || 'Ocurrió un error interno, contactar a soporte técnico.', '', {
        closeButton: true,
        progressBar: true
      });
    }
  }

  /* convertDate(date, format) {
    let date_ = "---"
    if (date && date != "0000-00-00 00:00:00") {
      date_ = this.datePipe.transform(date, format, "UTC");
    }
    return date_;
  } */

}
