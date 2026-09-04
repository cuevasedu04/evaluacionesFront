import { ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import JSZip from 'jszip';
import { firstValueFrom } from 'rxjs';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { CredencialRenderService } from '../../services/credencial-render.service';
import {
  EmpleadoSig, PlantillaCredencial, PlantillaCredencialService,
} from '../../services/plantilla-credencial.service';
import { CorreoService, EstadoEnvioCorreo, PlantillaCorreo } from '../../services/correo.service';
import { AgenteCorreoService } from '../../services/agente-correo.service';
import { COLUMNAS_SIG, sigAEmpleadoCredencial } from '../imprimir-credenciales/imprimir-credenciales.const';

/** Resultado del envio de UN empleado, para la tabla de resultados tras "Enviar por correo". */
interface ResultadoEnvioCorreo {
  id: string;
  nombre: string;
  estado: EstadoEnvioCorreo;
  mensaje?: string;
}

export type TabRosterMasivo = 'activos' | 'bajas';

/** Una fila del roster ya agregada a la lista de generacion, con sus datos ya traducidos al formato que espera CredencialRenderService. */
interface EmpleadoParaGenerar {
  /** Mismo id que idDeFila(fila) -- se guarda aparte para no recalcularlo (ni desincronizarlo) en la lista de la derecha. */
  id: string;
  fila: EmpleadoSig;
  datos: any;
}

/**
 * "Generador masivo": genera constancias para muchos empleados de una sola
 * vez, en vez de una por una como en "Imprimir credenciales".
 *
 * Izquierda: el mismo roster SIG (misma fuente y mismo mapeo que "Imprimir
 * credenciales" -- ver COLUMNAS_SIG/sigAEmpleadoCredencial), con una columna
 * fija de "+" para ir agregando gente a la lista de la derecha.
 *
 * No hay foto/firma ni modo de edicion rapida aqui a proposito: las
 * plantillas de constancia ya no tienen esos campos (se quitaron del
 * catalogo del editor, ver plantilla-editor.const.ts), asi que no hace
 * falta resolver medios por empleado como si hace "Imprimir credenciales".
 * Tampoco se consume folio ni se registra en el historial de auditoria: es
 * una generacion de lote para descarga inmediata, no una expedicion
 * individual controlada.
 */
@Component({
  standalone: false,
  selector: 'app-generador-masivo',
  templateUrl: './generador-masivo.component.html',
  styleUrls: ['./generador-masivo.component.scss'],
})
export class GeneradorMasivoComponent implements OnInit {

  // ====================================================================
  // Grid (roster, izquierda)
  // ====================================================================

  private gridApi!: GridApi;
  columnDefs: ColDef[] = [];
  rowData: EmpleadoSig[] = [];
  busquedaGlobal = '';
  totalFiltrados = 0;
  cargandoRoster = false;

  tabActiva: TabRosterMasivo = 'activos';

  /** Cacheados, NO getters -- mismo motivo que en imprimir-credenciales.component.ts: un getter con .filter() enlazado a [rowData] genera una referencia nueva en cada ciclo y la grid nunca deja de refrescarse. */
  activosData: EmpleadoSig[] = [];
  bajasData: EmpleadoSig[] = [];

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    resizable: true,
    minWidth: 110,
    suppressHeaderMenuButton: true,
  };

  private esBajaFila(fila: EmpleadoSig): boolean {
    return String(fila.estado_nom || '').trim().toLowerCase() === 'baja';
  }

  private actualizarCaches(): void {
    this.activosData = this.rowData.filter(f => !this.esBajaFila(f));
    this.bajasData = this.rowData.filter(f => this.esBajaFila(f));
  }

  get rowDataActivo(): EmpleadoSig[] {
    return this.tabActiva === 'bajas' ? this.bajasData : this.activosData;
  }

  // ====================================================================
  // Lista a generar (derecha)
  // ====================================================================

  /** Claves de los empleados ya agregados -- evita duplicados y decide si la celda "+" pinta como agregada. */
  private idsEnLista = new Set<string>();
  lista: EmpleadoParaGenerar[] = [];

  // ====================================================================
  // Plantilla (mismo patron que "Imprimir credenciales": se elige en
  // memoria, arranca en la marcada como predeterminada)
  // ====================================================================

  plantilla: PlantillaCredencial | null = null;
  origenPlantilla = '';
  cargandoPlantilla = false;
  plantillasDisponibles: PlantillaCredencial[] = [];
  selectorAbierto = false;
  plantillaAnulada = false;

  @ViewChild('selectorPlantilla') selectorPlantillaRef!: ElementRef<HTMLElement>;

  // ====================================================================
  // Generacion
  // ====================================================================

  generando = false;
  modoGeneracion: 'pdf' | 'zip' | 'correo' | null = null;
  progresoActual = 0;
  progresoTotal = 0;

  /** Que bloque de acciones se muestra en el panel derecho -- ver seleccionarTabAcciones(). */
  tabAcciones: 'descargar' | 'correo' = 'descargar';

  // ---- Envio por correo ----
  /** Sustituye a {{nombre_curso}} en el asunto/cuerpo de la plantilla de correo elegida -- ver CorreoElectronicoComponent. */
  nombreCurso = '';
  resultadosEnvio: ResultadoEnvioCorreo[] = [];

  /** Plantilla de CORREO elegida (distinta a `plantilla`, que es la de CONSTANCIA) -- mismo patron de selector en memoria. */
  plantillaCorreo: PlantillaCorreo | null = null;
  plantillasCorreoDisponibles: PlantillaCorreo[] = [];
  cargandoPlantillasCorreo = false;
  selectorCorreoAbierto = false;

  @ViewChild('selectorPlantillaCorreo') selectorPlantillaCorreoRef!: ElementRef<HTMLElement>;

  /**
   * Si el Agente de Correo ANAM esta corriendo en ESTA computadora (ver
   * AgenteCorreoService) -- null mientras no se ha checado todavia. Se
   * revisa al entrar a la pantalla (para mostrar el aviso desde temprano) y
   * otra vez justo antes de enviar (por si se cerro despues).
   */
  agenteDisponible: boolean | null = null;
  verificandoAgente = false;

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private render: CredencialRenderService,
    private utils: UtilsService,
    private cdr: ChangeDetectorRef,
    private correoApi: CorreoService,
    private agenteApi: AgenteCorreoService,
  ) {
    this.columnDefs = [
      {
        headerName: '', colId: '_agregar', pinned: 'left', width: 52,
        sortable: false, filter: false, resizable: false, suppressHeaderMenuButton: true,
        cellClass: 'gm-celda-agregar',
        cellRenderer: (p: any) => this.renderBotonAgregar(p),
      },
      ...COLUMNAS_SIG.map(col => ({
        field: col.campo,
        headerName: col.titulo,
        width: col.ancho,
        tooltipField: col.campo,
      })),
    ];
  }

  ngOnInit(): void {
    this.cargarPlantillaPorDefecto();
    this.cargarPlantillasDisponibles();
    this.cargarPlantillasCorreoDisponibles();
    this.cargarRoster();
    this.verificarAgente();
  }

  /** Consulta si el Agente de Correo local esta corriendo -- ver AgenteCorreoService. Nunca falla: sin respuesta = no disponible. */
  verificarAgente(): void {
    this.verificandoAgente = true;
    this.agenteApi.disponible().subscribe(disponible => {
      this.agenteDisponible = disponible;
      this.verificandoAgente = false;
      this.cdr.detectChanges();
    });
  }

  /** Cierra los selectores (plantilla de constancia / plantilla de correo) si el clic ocurrio fuera de ellos. */
  @HostListener('document:click', ['$event'])
  onClicDocumento(evento: MouseEvent): void {
    if (this.selectorAbierto) {
      const contenedor = this.selectorPlantillaRef?.nativeElement;
      if (contenedor && !contenedor.contains(evento.target as Node)) {
        this.selectorAbierto = false;
      }
    }
    if (this.selectorCorreoAbierto) {
      const contenedor = this.selectorPlantillaCorreoRef?.nativeElement;
      if (contenedor && !contenedor.contains(evento.target as Node)) {
        this.selectorCorreoAbierto = false;
      }
    }
  }

  // ====================================================================
  // Roster
  // ====================================================================

  cargarRoster(): void {
    this.cargandoRoster = true;
    this.plantillaApi.empleadosSigTodos().subscribe({
      next: (res) => {
        this.rowData = res?.registros || [];
        this.totalFiltrados = this.rowData.length;
        this.actualizarCaches();
        this.cargandoRoster = false;
      },
      error: (err) => {
        this.cargandoRoster = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  seleccionarTab(tab: TabRosterMasivo): void {
    this.tabActiva = tab;
    if (this.gridApi) this.gridApi.setGridOption('quickFilterText', this.busquedaGlobal);
    this.actualizarConteoFiltrado();
  }

  onBusquedaGlobal(): void {
    if (!this.gridApi) return;
    this.gridApi.setGridOption('quickFilterText', this.busquedaGlobal);
    this.actualizarConteoFiltrado();
  }

  limpiarFiltros(): void {
    this.busquedaGlobal = '';
    if (!this.gridApi) return;
    this.gridApi.setGridOption('quickFilterText', '');
    this.gridApi.setFilterModel(null);
    this.actualizarConteoFiltrado();
  }

  onFiltroCambiado(): void {
    this.actualizarConteoFiltrado();
  }

  private actualizarConteoFiltrado(): void {
    if (!this.gridApi) return;
    this.totalFiltrados = this.gridApi.getDisplayedRowCount();
  }

  /** Identificador estable de una fila del roster para no agregarla dos veces a la lista. */
  private idDeFila(fila: EmpleadoSig): string {
    return String(fila.no_empleado || fila.empleado_anam || fila.curp || fila.id || '');
  }

  private renderBotonAgregar(params: any): string {
    const fila: EmpleadoSig = params.data;
    const id = this.idDeFila(fila);
    const yaAgregado = this.idsEnLista.has(id);
    return yaAgregado
      ? `<button type="button" class="gm-btn-agregar gm-btn-agregado" data-action="quitar" data-id="${id}" title="Ya está en la lista, quitar">
           <i class="fas fa-check"></i>
         </button>`
      : `<button type="button" class="gm-btn-agregar" data-action="agregar" data-id="${id}" title="Agregar a la lista">
           <i class="fas fa-plus"></i>
         </button>`;
  }

  /** Mismo patron que busqueda-avanzada/busqueda-enrolamiento-masivos: data-action en el HTML del cellRenderer, leido aqui via el target del clic. */
  onCellClicked(evento: any): void {
    const target = evento.event?.target?.closest?.('[data-action]');
    if (!target) return;
    const fila: EmpleadoSig = evento.data;
    if (target.dataset.action === 'agregar') this.agregarALista(fila);
    else if (target.dataset.action === 'quitar') this.quitarDeLista(this.idDeFila(fila));
  }

  // ====================================================================
  // Lista a generar
  // ====================================================================

  agregarALista(fila: EmpleadoSig): void {
    const id = this.idDeFila(fila);
    if (!id || this.idsEnLista.has(id)) return;

    this.idsEnLista.add(id);
    this.lista = [...this.lista, { id, fila, datos: sigAEmpleadoCredencial(fila) }];
    this.refrescarCeldaAgregar();
  }

  quitarDeLista(id: string): void {
    if (!id) return;
    this.idsEnLista.delete(id);
    this.lista = this.lista.filter(e => e.id !== id);
    this.refrescarCeldaAgregar();
  }

  vaciarLista(): void {
    this.idsEnLista.clear();
    this.lista = [];
    this.refrescarCeldaAgregar();
  }

  private refrescarCeldaAgregar(): void {
    // Solo la columna del boton cambio de estado; las demas se quedan igual.
    this.gridApi?.refreshCells({ columns: ['_agregar'], force: true });
  }

  // ====================================================================
  // Plantilla
  // ====================================================================

  cargarPlantillaPorDefecto(): void {
    this.cargandoPlantilla = true;
    this.plantillaApi.obtenerPorDefecto().subscribe({
      next: (res) => {
        this.plantilla = res?.plantilla || null;
        this.origenPlantilla = res?.origen || '';
        this.cargandoPlantilla = false;
      },
      error: () => {
        this.cargandoPlantilla = false;
        this.plantilla = null;
      },
    });
  }

  private cargarPlantillasDisponibles(): void {
    this.plantillaApi.listar(true).subscribe({
      next: (res) => {
        this.plantillasDisponibles = Array.isArray(res) ? res : (res?.results || []);
      },
      error: () => { this.plantillasDisponibles = []; },
    });
  }

  alternarSelector(): void {
    this.selectorAbierto = !this.selectorAbierto;
  }

  usarPlantilla(nueva: PlantillaCredencial): void {
    this.selectorAbierto = false;
    if (nueva.id_plantilla === this.plantilla?.id_plantilla) return;
    this.plantilla = nueva;
    this.plantillaAnulada = !nueva.por_defecto;
  }

  restaurarPlantillaPorDefecto(): void {
    this.selectorAbierto = false;
    this.plantillaAnulada = false;
    this.cargarPlantillaPorDefecto();
  }

  // ====================================================================
  // Plantilla de correo (para "Enviar por correo")
  // ====================================================================

  private cargarPlantillasCorreoDisponibles(): void {
    this.cargandoPlantillasCorreo = true;
    this.correoApi.listarPlantillas(true).subscribe({
      next: (res) => {
        this.plantillasCorreoDisponibles = Array.isArray(res) ? res : (res?.results || []);
        this.cargandoPlantillasCorreo = false;
        if (!this.plantillaCorreo && this.plantillasCorreoDisponibles.length) {
          this.plantillaCorreo = this.plantillasCorreoDisponibles[0];
        }
      },
      error: () => {
        this.cargandoPlantillasCorreo = false;
        this.plantillasCorreoDisponibles = [];
      },
    });
  }

  alternarSelectorCorreo(): void {
    this.selectorCorreoAbierto = !this.selectorCorreoAbierto;
  }

  usarPlantillaCorreo(nueva: PlantillaCorreo): void {
    this.selectorCorreoAbierto = false;
    this.plantillaCorreo = nueva;
  }

  // ====================================================================
  // Generacion
  // ====================================================================

  get puedeGenerar(): boolean {
    return !!this.plantilla && this.lista.length > 0 && !this.generando;
  }

  seleccionarTabAcciones(tab: 'descargar' | 'correo'): void {
    this.tabAcciones = tab;
  }

  // ---- Resumen (panel inferior derecho) ----

  get enviadosCount(): number {
    return this.resultadosEnvio.filter(r => r.estado === 'enviado').length;
  }

  get conProblemaCount(): number {
    return this.resultadosEnvio.length - this.enviadosCount;
  }

  /** Un solo PDF, una pagina por empleado -- reutiliza CredencialRenderService.generarPdfLote(). */
  async generarUnSoloPdf(): Promise<void> {
    if (!this.puedeGenerar || !this.plantilla) return;
    const plantilla = this.plantilla;

    this.iniciarGeneracion('pdf');
    await this.cederAlNavegador();

    try {
      await this.render.generarPdfLote(
        plantilla,
        this.lista.map(e => e.datos),
        {
          // Las constancias de evaluaciones son a una sola cara (ver
          // CLAUDE.md, "reverso quitado del editor de plantillas"); se
          // fuerza aqui para que una plantilla vieja con reverso heredado
          // no agregue paginas de mas al lote.
          incluirReverso: false,
          nombreArchivo: `Constancias_${this.lista.length}.pdf`,
          onProgreso: (i, total) => {
            this.progresoActual = i;
            this.progresoTotal = total;
            this.cdr.detectChanges();
          },
        }
      );
      this.utils.MuestrasToast(TipoToast.Success, `PDF generado con ${this.lista.length} constancia(s).`);
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
    } finally {
      this.finalizarGeneracion();
    }
  }

  /** Un PDF por empleado, todos comprimidos en un solo .zip. */
  async generarZip(): Promise<void> {
    if (!this.puedeGenerar || !this.plantilla) return;
    const plantilla = this.plantilla;

    this.iniciarGeneracion('zip');
    await this.cederAlNavegador();

    try {
      const zip = new JSZip();
      const nombresUsados = new Set<string>();

      for (let i = 0; i < this.lista.length; i++) {
        const empleado = this.lista[i].datos;
        const pdf = await this.render.generarPdf(plantilla, empleado, {
          guardar: false,
          incluirReverso: false,
        });
        zip.file(this.nombreArchivoUnico(empleado, nombresUsados), pdf.output('blob'));

        this.progresoActual = i + 1;
        this.cdr.detectChanges();
      }

      const contenido = await zip.generateAsync({ type: 'blob' });
      this.descargarBlob(contenido, `Constancias_${this.lista.length}.zip`);
      this.utils.MuestrasToast(TipoToast.Success, `ZIP generado con ${this.lista.length} constancia(s).`);
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
    } finally {
      this.finalizarGeneracion();
    }
  }

  /**
   * Envia por correo la constancia de cada empleado de la lista, una por
   * una. El envio REAL lo hace el Agente de Correo ANAM (ver
   * AgenteCorreoService) -- este metodo solo genera el PDF y se lo manda al
   * agente por 127.0.0.1; el backend central (CorreoService.registrarEnvio)
   * nunca ve el PDF, solo se entera del resultado para la bitacora.
   *
   * Usa la plantilla de correo elegida (asunto/cuerpo/remitente),
   * sustituyendo `{{nombre_curso}}` por lo que se haya escrito aqui.
   *
   * A quien no se le encuentre correo institucional (EjeCentral.DATOS_PERSONALES)
   * NO se le genera PDF ni se llama al agente -- se registra 'sin_correo'
   * directo en la bitacora.
   */
  async enviarPorCorreo(): Promise<void> {
    if (!this.puedeGenerar || !this.plantilla) return;
    if (!this.nombreCurso.trim()) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Escribe el nombre del curso antes de enviar.');
      return;
    }
    if (!this.plantillaCorreo) {
      this.utils.MuestrasToast(
        TipoToast.Warning,
        'Elige una plantilla de correo. Si no hay ninguna, créala primero en "Correo electrónico".'
      );
      return;
    }
    const plantilla = this.plantilla;
    const config = this.plantillaCorreo;
    if (!config.cuenta_remitente?.trim()) {
      this.utils.MuestrasToast(
        TipoToast.Warning,
        'Esa plantilla de correo no tiene cuenta remitente. Ve a "Correo electrónico" y complétala primero.'
      );
      return;
    }

    // Se revisa AHORA, no solo al entrar a la pantalla: pudo haberse
    // cerrado desde entonces.
    this.agenteDisponible = await firstValueFrom(this.agenteApi.disponible());
    if (!this.agenteDisponible) {
      this.utils.MuestrasToast(
        TipoToast.Error,
        'No se encontró el Agente de Correo ANAM en esta computadora. Ábrelo (con Outlook también abierto) e inténtalo de nuevo.'
      );
      return;
    }

    let correos: Record<string, string> = {};
    try {
      const res = await firstValueFrom(
        this.plantillaApi.correosLote(this.lista.map(e => e.datos.num_empleado))
      );
      correos = res?.correos || {};
    } catch (err) {
      this.utils.MuestraErrorInterno(err);
      return;
    }

    const asunto = this.sustituirVariables(config.asunto);
    const cuerpoHtml = this.sustituirVariables(config.cuerpo_html);

    this.iniciarGeneracion('correo');
    this.resultadosEnvio = [];
    await this.cederAlNavegador();

    let enviados = 0;
    let errores = 0;

    for (let i = 0; i < this.lista.length; i++) {
      const item = this.lista[i];
      const empleado = item.datos;
      const email = correos[empleado.num_empleado] || '';
      const nombreCompleto = `${empleado.nombre || ''} ${empleado.apellidos || ''}`.trim();

      const datosBase = {
        num_empleado: empleado.num_empleado || '',
        nombre_empleado: nombreCompleto,
        email_destino: email,
        asunto,
        cuenta_remitente: config.cuenta_remitente,
        nombre_curso: this.nombreCurso.trim(),
        plantilla_clave: plantilla.clave,
        plantilla_correo_nombre: config.nombre,
      };

      let estado: EstadoEnvioCorreo;
      let mensaje: string | undefined;

      if (!email) {
        estado = 'sin_correo';
        mensaje = 'Sin correo institucional registrado.';
      } else {
        let pdfBlob: Blob | null = null;
        try {
          const pdf = await this.render.generarPdf(plantilla, empleado, { guardar: false, incluirReverso: false });
          pdfBlob = pdf.output('blob');
        } catch {
          pdfBlob = null;
        }

        if (!pdfBlob) {
          estado = 'error_pdf';
          mensaje = 'No se pudo generar el PDF de la constancia.';
        } else {
          try {
            const respuesta = await firstValueFrom(this.agenteApi.enviar({
              destinatario: email,
              asunto,
              cuerpo_html: cuerpoHtml,
              cuenta_remitente: config.cuenta_remitente,
              pdf: pdfBlob,
              nombreArchivo: `Constancia_${empleado.num_empleado || 'sin_numero'}.pdf`,
            }));
            estado = respuesta.status === 'success' ? 'enviado' : 'error_outlook';
            mensaje = respuesta.mensaje;
          } catch (err: any) {
            estado = 'error_outlook';
            mensaje = err?.error?.mensaje || 'No se pudo contactar al Agente de Correo.';
          }
        }
      }

      if (estado === 'enviado') enviados++; else errores++;
      this.resultadosEnvio.push({ id: item.id, nombre: nombreCompleto || item.id, estado, mensaje });

      // Se registra en la bitacora AUNQUE falle -- es lo que permite ver
      // despues, sin adivinar, a quien ya se le envio y a quien no.
      this.correoApi.registrarEnvio({ ...datosBase, estado, error_detalle: mensaje || '' }).subscribe({
        error: () => { /* la bitacora es best-effort: el correo ya se mando (o no) de todas formas */ },
      });

      this.progresoActual = i + 1;
      this.cdr.detectChanges();
    }

    this.finalizarGeneracion();
    this.utils.MuestrasToast(
      errores ? TipoToast.Warning : TipoToast.Success,
      `Envío terminado: ${enviados} enviado(s), ${errores} con problema(s). Revisa el detalle abajo.`
    );
  }

  /** Reemplaza {{nombre_curso}} por lo que se haya escrito en el campo de esta pantalla -- ver CorreoElectronicoComponent.VARIABLE_NOMBRE_CURSO. */
  private sustituirVariables(texto: string): string {
    return (texto || '').split('{{nombre_curso}}').join(this.nombreCurso.trim());
  }

  /** Etiqueta legible del estado de un envio, para la tabla de resultados. */
  etiquetaEstadoEnvio(estado: ResultadoEnvioCorreo['estado']): string {
    switch (estado) {
      case 'enviado': return 'Enviado';
      case 'sin_correo': return 'Sin correo institucional';
      case 'error_pdf': return 'Error al generar el PDF';
      default: return 'Error de Outlook';
    }
  }

  private iniciarGeneracion(modo: 'pdf' | 'zip' | 'correo'): void {
    this.generando = true;
    this.modoGeneracion = modo;
    this.progresoActual = 0;
    this.progresoTotal = this.lista.length;
    this.cdr.detectChanges();
  }

  private finalizarGeneracion(): void {
    this.generando = false;
    this.modoGeneracion = null;
    this.cdr.detectChanges();
  }

  /** Dos personas sin num_empleado no deben pisarse el mismo nombre de archivo dentro del zip. */
  private nombreArchivoUnico(empleado: any, usados: Set<string>): string {
    const base = `Constancia_${empleado?.num_empleado || 'sin_numero'}`;
    let nombre = `${base}.pdf`;
    let sufijo = 2;
    while (usados.has(nombre)) {
      nombre = `${base}_${sufijo}.pdf`;
      sufijo++;
    }
    usados.add(nombre);
    return nombre;
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Cede un frame al navegador antes de arrancar el trabajo pesado
   * (renderizado de canvas x N empleados), para que el spinner de
   * "generando" alcance a pintarse -- mismo patron de doble rAF que
   * imprimir-credenciales.component.ts (ver imprimir()).
   */
  private cederAlNavegador(): Promise<void> {
    return new Promise<void>(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }
}
