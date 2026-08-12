import { ChangeDetectorRef, Component, OnInit, TemplateRef, ViewChild } from '@angular/core';

import { CapturaMediosComponent } from '../../components/shared/captura-medios/captura-medios.component';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import {
  EmpleadoMediosAuditoria, PlantillaCredencialService,
} from '../../services/plantilla-credencial.service';
import { PermisosService } from '../../services/permisos.service';

/** Empleado del roster con el que cruza una captura, si es que cruza. */
export interface CruceRoster {
  num_empleado: string;
  curp: string;
  nombre: string;
}

/** Una foto/firma en disco todavia nombrada por RFC. */
export interface MedioPendiente {
  rfc: string;
  foto: string | null;
  firma: string | null;
  /** Epoch en segundos de la captura mas reciente (foto o firma). */
  fecha?: number | null;
  cruce: CruceRoster | null;
}

type FiltroInventario = 'todos' | 'cruzables' | 'sin_cruce' | 'incompletos' | 'recientes';

/** Ventana de la pestaña "Recientes", en horas. */
const HORAS_RECIENTE = 24;

/** Seccion activa del inventario. */
export type SeccionInventario = 'pendientes' | 'empleados' | 'auditoria';

/** Foto/firma ya nombrada por num_empleado. */
export interface MedioEmpleado {
  num_empleado: string;
  nombre: string;
  curp: string;
  area: string;
  /** False = el archivo existe pero esa persona ya no esta en el roster. */
  en_roster: boolean;
  foto: string | null;
  firma: string | null;
}

/**
 * Pantalla "Inventario de medios".
 *
 * Muestra las fotos y firmas que viven en MEDIA_ROOT nombradas por RFC, es
 * decir, las que todavia NO estan ligadas a un numero de empleado. Incluye
 * tanto lo capturado en "Enrolamiento previo" como el acervo historico de
 * cargas anteriores, que ya venia nombrado asi.
 *
 * A cada archivo el backend le adjunta el empleado del roster SIG cuyo CURP
 * comparte el prefijo de 10 caracteres con ese RFC (ver
 * media_utils.resolver_por_prefijo). Con ese cruce, desde aqui se puede
 * renombrar el archivo a su num_empleado definitivo sin esperar a que alguien
 * imprima esa credencial -- que es el otro momento en que ocurre la
 * migracion, en "Imprimir credenciales".
 *
 * Los que NO cruzan son personas cuyo movimiento de ingreso todavia no se
 * aplica (apareceran solas en un sync posterior) o basura del acervo.
 */
@Component({
  standalone: false,
  selector: 'app-inventario-medios',
  templateUrl: './inventario-medios.component.html',
  styleUrls: ['./inventario-medios.component.scss'],
})
export class InventarioMediosComponent implements OnInit {

  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;
  @ViewChild('captura') captura!: CapturaMediosComponent;
  @ViewChild('modalRenombrar') modalRenombrar!: TemplateRef<any>;
  @ViewChild('modalVersiones') modalVersiones!: TemplateRef<any>;

  // ---- Renombrado (corregir un RFC mal capturado) ----
  renombrando: MedioPendiente | null = null;
  nombreNuevo = '';

  // ---- Seccion "Fotos y firmas" (archivos por num_empleado) ----
  seccion: SeccionInventario = 'pendientes';
  medios: MedioEmpleado[] = [];
  cargandoMedios = false;
  busquedaMedios = '';
  /** Filtro por dia de captura (YYYY-MM-DD) en la seccion de fotos y firmas. */
  fechaMedios = '';
  paginaMedios = 1;
  totalMedios = 0;
  totalPaginasMedios = 1;
  readonly tamPagina = 60;
  /**
   * Que se esta reemplazando ahora mismo.
   *
   * Las dos secciones comparten el mismo <app-captura-medios>, y sus eventos
   * no dicen de donde salio la captura. Aqui se recuerda el registro y su
   * seccion para saber con que identificador guardarlo: los pendientes van
   * por RFC y los de la otra seccion por num_empleado. Confundirlos crearia
   * un archivo con el nombre equivocado.
   */
  private enCaptura: { registro: any; seccion: SeccionInventario } | null = null;
  private temporizadorBusqueda: any = null;

  // ---- Seccion "Auditoria" (medios de quienes tienen reimpresiones) ----
  auditoria: EmpleadoMediosAuditoria[] = [];
  cargandoAuditoria = false;
  busquedaAuditoria = '';
  soloConCambio = false;
  /** Historial de medios del empleado abierto en el modal de versiones. */
  versiones: any = null;
  cargandoVersiones = false;

  registros: MedioPendiente[] = [];
  cargando = false;
  migrando = false;
  busqueda = '';
  // 'recientes' y no 'todos': entrar directo a los ~1100 pendientes (antes de
  // paginar, ver registrosPaginados) es lo que hacia lenta la primera pintura
  // de esta pantalla. "Recientes" es ademas el caso de uso mas comun: llegar
  // aqui a corregir un RFC que se acaba de capturar mal.
  filtro: FiltroInventario = 'recientes';
  confirmMessage = '';

  // ---- Paginado de "Pendientes de cruce" ----
  //
  // Es client-side (el listado completo ya se descargo en cargar()): no
  // reduce lo que viaja del servidor, reduce cuantas tarjetas se pintan de
  // golpe en el DOM. Se resetea a la pagina 1 cada vez que cambia el filtro,
  // la busqueda o la fecha -- si no, "pagina 3" podria quedar vacia bajo un
  // filtro que solo tiene una pagina.
  paginaPendientes = 1;
  readonly tamPaginaPendientes = 100;

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private cdRef: ChangeDetectorRef,
    public permisosS: PermisosService,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  // ====================================================================
  // Seccion "Fotos y firmas"
  // ====================================================================

  seleccionarSeccion(seccion: SeccionInventario): void {
    this.seccion = seccion;
    // Cada seccion se carga la primera vez que se abre, no al entrar a la
    // pantalla: son tres consultas caras y casi nunca se usan las tres.
    if (seccion === 'empleados' && !this.medios.length) this.cargarMedios();
    if (seccion === 'auditoria' && !this.auditoria.length) this.cargarAuditoria();
  }

  // ====================================================================
  // Seccion "Auditoria": foto y firma con las que se expidio cada credencial
  // ====================================================================

  /**
   * Empleados con mas de una impresion. Son los unicos donde hay historial que
   * comparar: con una sola credencial, lo archivado y lo vigente coinciden.
   */
  cargarAuditoria(): void {
    this.cargandoAuditoria = true;
    this.plantillaApi.auditoriaMedios(this.busquedaAuditoria).subscribe({
      next: (res) => {
        this.auditoria = res?.resultados || [];
        this.cargandoAuditoria = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.cargandoAuditoria = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Mismo rebote que la otra seccion: la busqueda va al servidor. */
  onBusquedaAuditoria(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => this.cargarAuditoria(), 350);
  }

  /** Lo que se pinta en las tarjetas de auditoria, ya filtrado en memoria. */
  get auditoriaVisible(): EmpleadoMediosAuditoria[] {
    return this.soloConCambio ? this.auditoria.filter(a => a.cambio_medios) : this.auditoria;
  }

  /**
   * Abre el historial de medios de un empleado: que foto y que firma llevaba
   * CADA credencial que se le imprimio.
   *
   * Las imagenes salen del archivo historico (`media/historico/`), asi que
   * siguen siendo las que se expidieron aunque despues lo hayan recapturado
   * -- ese es justamente el punto de esta pantalla.
   */
  verVersiones(fila: EmpleadoMediosAuditoria): void {
    this.versiones = null;
    this.cargandoVersiones = true;

    this.modalManager.openModal({
      title: `Historial de medios — ${fila.nombre || fila.num_empleado}`,
      template: this.modalVersiones,
      width: '820px',
      showFooter: false,
    });

    this.plantillaApi.auditoriaMediosDetalle(fila.num_empleado).subscribe({
      next: (res) => {
        this.versiones = { ...res, nombre: fila.nombre };
        this.cargandoVersiones = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.cargandoVersiones = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /**
   * ¿Alguna impresion llevo una foto o firma distinta de la vigente?
   *
   * La comparacion NO se puede hacer aqui por ruta: lo archivado vive en
   * `historico/<hash>.ext` y lo vigente en `fotos/<numero>.ext`, asi que por
   * ruta nunca coincidirian aunque fueran el mismo archivo. El servidor las
   * compara por contenido y manda `foto_vigente` / `firma_vigente`.
   */
  get hayMediosReemplazados(): boolean {
    return (this.versiones?.impresiones || []).some(
      (i: any) => (i.foto && !i.foto_vigente) || (i.firma && !i.firma_vigente)
    );
  }

  /**
   * Rebota la busqueda 350 ms: cada pulsacion dispara una consulta que
   * recorre 13 300 archivos y cruza contra el roster, asi que teclear
   * "GONZALEZ" lanzaria ocho peticiones pesadas.
   */
  onBusquedaMedios(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => {
      this.paginaMedios = 1;
      this.cargarMedios();
    }, 350);
  }

  cargarMedios(): void {
    this.cargandoMedios = true;
    this.plantillaApi
      .mediosEmpleado(this.busquedaMedios.trim(), this.paginaMedios, this.tamPagina, this.fechaMedios)
      .subscribe({
      next: (res) => {
        this.medios = res?.registros || [];
        this.totalMedios = res?.total || 0;
        this.totalPaginasMedios = res?.total_paginas || 1;
        this.cargandoMedios = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.cargandoMedios = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Cambiar el dia reinicia a la primera pagina: el total cambia. */
  onFechaMedios(): void {
    this.paginaMedios = 1;
    this.cargarMedios();
  }

  limpiarFiltrosMedios(): void {
    this.busquedaMedios = '';
    this.fechaMedios = '';
    this.paginaMedios = 1;
    this.cargarMedios();
  }

  irAPagina(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginasMedios || pagina === this.paginaMedios) return;
    this.paginaMedios = pagina;
    this.cargarMedios();
  }

  // ---- Reemplazo de foto / firma ----

  reemplazarFoto(registro: MedioEmpleado): void {
    this.enCaptura = { registro, seccion: 'empleados' };
    this.captura.abrirFoto(`Fotografía — ${registro.num_empleado}`);
  }

  reemplazarFirma(registro: MedioEmpleado): void {
    this.enCaptura = { registro, seccion: 'empleados' };
    this.captura.abrirFirma(`Firma — ${registro.num_empleado}`);
  }

  /** Reemplazo sobre un pendiente de cruce: se guarda por RFC. */
  reemplazarFotoPrevio(registro: MedioPendiente): void {
    this.enCaptura = { registro, seccion: 'pendientes' };
    this.captura.abrirFoto(`Fotografía — ${registro.rfc}`);
  }

  reemplazarFirmaPrevio(registro: MedioPendiente): void {
    this.enCaptura = { registro, seccion: 'pendientes' };
    this.captura.abrirFirma(`Firma — ${registro.rfc}`);
  }

  onFotoCapturada(dataUrl: string): void {
    this.guardarMedio({ foto: dataUrl });
  }

  onFirmaCapturada(dataUrl: string): void {
    this.guardarMedio({ firma: dataUrl });
  }

  private guardarMedio(datos: { foto?: string; firma?: string }): void {
    if (!this.enCaptura) return;
    const { registro, seccion } = this.enCaptura;

    // Un pendiente de cruce se guarda con su RFC; el resto, con el numero de
    // empleado. Es el mismo endpoint, cambia solo el identificador.
    const peticion = seccion === 'pendientes'
      ? this.plantillaApi.guardarMediosPorRfc(registro.rfc, datos.foto, datos.firma)
      : this.plantillaApi.guardarMediosPorEmpleado(registro.num_empleado, datos.foto, datos.firma);

    peticion.subscribe({
      next: (res) => {
        // El backend guarda en la MISMA ruta determinista, asi que la URL no
        // cambia y el navegador serviria la imagen vieja desde cache. El
        // sufijo la obliga a recargar.
        const sufijo = `?t=${Date.now()}`;
        if (datos.foto && res?.foto) registro.foto = `${res.foto}${sufijo}`;
        if (datos.firma && res?.firma) registro.firma = `${res.firma}${sufijo}`;
        this.utils.MuestrasToast(TipoToast.Success, 'Archivo reemplazado');
        this.enCaptura = null;
        // Un pendiente al que se le acaba de agregar lo que le faltaba deja de
        // estar incompleto: los contadores por filtro deben reflejarlo.
        this.registros = [...this.registros];
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.enCaptura = null;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  confirmarBorrarMedios(registro: MedioEmpleado): void {
    this.confirmMessage =
      `¿Eliminar la foto y la firma de ${registro.num_empleado}`
      + `${registro.nombre ? ' (' + registro.nombre + ')' : ''}? `
      + 'Se borran del servidor y su credencial saldría sin foto.';

    this.modalManager.openModal({
      title: 'Eliminar archivos',
      template: this.confirmDialog,
      onAccept: () => {
        this.plantillaApi.borrarMediosEmpleado(registro.num_empleado).subscribe({
          next: () => {
            this.medios = this.medios.filter(m => m.num_empleado !== registro.num_empleado);
            this.totalMedios = Math.max(0, this.totalMedios - 1);
            this.utils.MuestrasToast(TipoToast.Success, 'Archivos eliminados');
            this.cdRef.detectChanges();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  // ====================================================================
  // Carga y filtros
  // ====================================================================

  cargar(): void {
    this.cargando = true;
    this.plantillaApi.enrolamientosPrevios().subscribe({
      next: (res) => {
        this.registros = (res?.registros || []) as MedioPendiente[];
        this.paginaPendientes = 1;
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get totalCruzables(): number {
    return this.registros.filter(r => !!r.cruce).length;
  }

  get totalSinCruce(): number {
    return this.registros.filter(r => !r.cruce).length;
  }

  get totalIncompletos(): number {
    return this.registros.filter(r => !r.foto || !r.firma).length;
  }

  /**
   * Capturas de las ultimas 24 h. Es el filtro con el que se llega a la
   * captura recien hecha con el RFC mal escrito, que es justo el caso en el
   * que hay que venir a esta pantalla a corregir el nombre.
   */
  get totalRecientes(): number {
    return this.registros.filter(r => this.esReciente(r)).length;
  }

  /**
   * Filtro por dia de captura en la seccion de pendientes. Aqui se resuelve
   * en el navegador porque el listado completo ya esta cargado; en la otra
   * seccion va en el servidor, que es la que pagina.
   */
  fechaPendientes = '';

  /** Compara contra la fecha LOCAL del archivo, no contra UTC. */
  private mismoDia(epochSegundos: number | null | undefined, iso: string): boolean {
    if (!epochSegundos || !iso) return false;
    const f = new Date(epochSegundos * 1000);
    const [a, m, d] = iso.split('-').map(Number);
    return f.getFullYear() === a && f.getMonth() + 1 === m && f.getDate() === d;
  }

  esReciente(registro: MedioPendiente): boolean {
    if (!registro.fecha) return false;
    return (Date.now() / 1000 - registro.fecha) < HORAS_RECIENTE * 3600;
  }

  get registrosFiltrados(): MedioPendiente[] {
    const termino = this.busqueda.trim().toUpperCase();

    return this.registros.filter(r => {
      switch (this.filtro) {
        case 'cruzables':   if (!r.cruce) return false; break;
        case 'sin_cruce':   if (r.cruce) return false; break;
        case 'incompletos': if (r.foto && r.firma) return false; break;
        case 'recientes':   if (!this.esReciente(r)) return false; break;
      }

      if (this.fechaPendientes && !this.mismoDia(r.fecha, this.fechaPendientes)) return false;

      if (!termino) return true;
      return r.rfc.toUpperCase().includes(termino)
        || (r.cruce?.num_empleado || '').toUpperCase().includes(termino)
        || (r.cruce?.nombre || '').toUpperCase().includes(termino);
    });
  }

  seleccionarFiltro(filtro: FiltroInventario): void {
    this.filtro = filtro;
    this.paginaPendientes = 1;
  }

  get totalPaginasPendientes(): number {
    return Math.max(1, Math.ceil(this.registrosFiltrados.length / this.tamPaginaPendientes));
  }

  /** Rebanada de 100 en 100 sobre registrosFiltrados, para no pintar de golpe hasta ~1100 tarjetas. */
  get registrosPaginados(): MedioPendiente[] {
    const inicio = (this.paginaPendientes - 1) * this.tamPaginaPendientes;
    return this.registrosFiltrados.slice(inicio, inicio + this.tamPaginaPendientes);
  }

  irAPaginaPendientes(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginasPendientes || pagina === this.paginaPendientes) return;
    this.paginaPendientes = pagina;
  }

  /** Tras borrar/cruzar una fila la pagina actual podria quedar vacia si era la ultima. */
  private clampPaginaPendientes(): void {
    if (this.paginaPendientes > this.totalPaginasPendientes) {
      this.paginaPendientes = this.totalPaginasPendientes;
    }
  }

  /** Busqueda y fecha filtran en memoria (ver registrosFiltrados): cualquier cambio puede vaciar la pagina actual. */
  onFiltroPendientesCambiado(): void {
    this.paginaPendientes = 1;
  }

  // ====================================================================
  // Migracion (renombrar a num_empleado)
  // ====================================================================

  /** Renombra un solo archivo al num_empleado con el que cruza. */
  migrarUno(registro: MedioPendiente): void {
    if (!registro.cruce || this.migrando) return;

    this.migrando = true;
    this.plantillaApi.migrarMediosLote([registro.rfc]).subscribe({
      next: (res) => {
        this.migrando = false;
        if (res?.total_migrados) {
          // Ya no esta pendiente: sale del inventario.
          this.registros = this.registros.filter(r => r.rfc !== registro.rfc);
          this.clampPaginaPendientes();
          this.utils.MuestrasToast(
            TipoToast.Success,
            `${registro.rfc} → ${registro.cruce!.num_empleado}`
          );
        } else {
          // El backend no migro nada: lo mas comun es que esa persona ya
          // tuviera foto/firma propias con su num_empleado, en cuyo caso el
          // archivo canonico se respeta y este queda como duplicado.
          this.utils.MuestrasToast(
            TipoToast.Warning,
            'No se renombró: ese empleado ya tiene foto/firma con su número.'
          );
        }
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this.migrando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Renombra de golpe todas las capturas cruzables del inventario. */
  confirmarMigrarTodos(): void {
    const total = this.totalCruzables;
    if (!total) return;

    this.confirmMessage =
      `Se renombrarán ${total} capturas para que queden con su número de empleado. `
      + 'Los empleados que ya tengan foto/firma propias no se tocan.';

    this.modalManager.openModal({
      title: 'Cruzar capturas con el poblado de credencial',
      template: this.confirmDialog,
      onAccept: () => this.migrarTodos(),
    });
  }

  private migrarTodos(): void {
    this.migrando = true;
    this.plantillaApi.migrarMediosLote().subscribe({
      next: (res) => {
        this.migrando = false;
        this.utils.MuestrasToast(
          TipoToast.Success,
          `${res?.total_migrados || 0} capturas renombradas con su número de empleado.`
        );
        this.cargar();
      },
      error: (err) => {
        this.migrando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  // ====================================================================
  // Renombrar (corregir un identificador mal capturado)
  // ====================================================================

  abrirRenombrar(registro: MedioPendiente): void {
    this.renombrando = registro;
    this.nombreNuevo = registro.rfc;
    this.modalManager.openModal({
      title: `Corregir nombre — ${registro.rfc}`,
      template: this.modalRenombrar,
      width: '540px',
      showFooter: true,
      onAccept: () => this.confirmarRenombrar(),
    });
  }

  private confirmarRenombrar(): void {
    const registro = this.renombrando;
    const nuevo = (this.nombreNuevo || '').trim().toUpperCase();
    if (!registro || !nuevo || nuevo === registro.rfc.toUpperCase()) {
      this.renombrando = null;
      return;
    }

    this.plantillaApi.renombrarMedios(registro.rfc, nuevo).subscribe({
      next: () => {
        this.renombrando = null;
        this.utils.MuestrasToast(TipoToast.Success, `Renombrado a ${nuevo}`);
        // Se recarga en vez de editar en memoria: al cambiar el nombre cambia
        // tambien con quien cruza, y ese calculo lo hace el servidor.
        this.cargar();
      },
      error: (err) => {
        this.renombrando = null;
        // El backend rechaza si el destino ya existe; ese mensaje es lo util
        // que hay que mostrar, no un error generico.
        const mensaje = err?.error?.mensaje;
        if (mensaje) this.utils.MuestrasToast(TipoToast.Error, mensaje);
        else this.utils.MuestraErrorInterno(err);
      },
    });
  }

  // ====================================================================
  // Borrado
  // ====================================================================

  confirmarBorrado(registro: MedioPendiente): void {
    this.confirmMessage =
      `¿Eliminar la captura de ${registro.rfc}? Se borrarán su foto y su firma del servidor.`;

    this.modalManager.openModal({
      title: 'Confirmación',
      template: this.confirmDialog,
      onAccept: () => {
        this.plantillaApi.borrarMediosPrevio(registro.rfc).subscribe({
          next: () => {
            this.registros = this.registros.filter(r => r.rfc !== registro.rfc);
            this.clampPaginaPendientes();
            this.utils.MuestrasToast(TipoToast.Success, 'Captura eliminada');
            this.cdRef.detectChanges();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }
}
