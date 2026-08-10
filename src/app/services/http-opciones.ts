import { HttpHeaders } from '@angular/common/http';

/**
 * Opciones para peticiones cuyo componente ya muestra su propio indicador de
 * carga (spinner + texto local, ej. tablas de ag-Grid). Sin esto, el
 * `LoaderInterceptor` monta ADEMÁS el overlay global sobre el mismo
 * contenido -- dos spinners superpuestos por la misma espera.
 *
 * `X-Skip-Loader` ya lo reconoce `LoaderInterceptor`; esto solo centraliza
 * el valor para no repetir `new HttpHeaders(...)` en cada servicio.
 */
export const SIN_LOADER_GLOBAL = { headers: new HttpHeaders({ 'X-Skip-Loader': '1' }) };
