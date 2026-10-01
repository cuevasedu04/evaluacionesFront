import { Component, OnDestroy, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { CursoService } from '../../services/curso.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import {
  EmpleadoSig, PlantillaCredencial, PlantillaCredencialService,
} from '../../services/plantilla-credencial.service';
import { CorreoService, PlantillaCorreo } from '../../services/correo.service';
import {
  AgenteCorreoService, EstadoAgente, VERSION_AGENTE_SIN_ADJUNTO,
} from '../../services/agente-correo.service';
import { FormularioService } from '../../services/formulario.service';
import { COLUMNAS_SIG } from '../imprimir-credenciales/imprimir-credenciales.const';
import {
  Curso, ParticipanteCurso, ParticipanteObservado,
  claseEstado, cuerpoConEnlace, etiquetaEstado, inputLocalAIso, isoAInputLocal,
  numerosDesdeTexto,
} from './curso.const';

/** Milisegundos de inactividad antes de guardar la configuración. Suficiente para no mandar un PATCH por tecla. */
const RETARDO_AUTOGUARDADO = 1000;

/** Cuestionario tal como lo lista el backend (FormularioListaSerializer: sin el campo `preguntas`). */
interface CuestionarioOpcion {
  id_formulario: number;
  titulo: string;
  total_preguntas: number;
  publicado: boolean;
}

/**
 * Armado de un curso: se le asignan la constancia, la plantilla de correo y
 * el cuestionario, se carga la lista de participantes y se configuran los
 * tiempos.
 *
 * Tres columnas, mismo esquema que "Generador masivo": el padrón a la
 * izquierda (con el "+" para ir agregando gente), la lista de participantes
 * al centro y la configuración a la derecha.
 *
 * Sobre el "+": cada clic manda la alta al servidor de inmediato en vez de
 * juntarla para un guardado final. Es a propósito -- el servidor valida el
 * estado de nómina, y quien opera necesita enterarse en ese momento de que
 * la persona que acaba de elegir está dada de baja, no veinte altas
 * después.
 */
@Component({
  standalone: false,
  selector: 'app-curso-detalle',
  templateUrl: './curso-detalle.component.html',
  styleUrls: ['./curso-detalle.component.scss'],
})
export class CursoDetalleComponent implements OnInit, OnDestroy {

  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;
  @ViewChild('pegarDialog') pegarDialog!: TemplateRef<any>;

  curso: Curso | null = null;
  cargando = true;
  guardando = false;
  errorCarga = '';
  confirmMessage = '';

  // ---- Padrón (columna izquierda) ----
  private gridApi!: GridApi;
  columnDefs: ColDef[] = [];
  rowData: EmpleadoSig[] = [];
  activosData: EmpleadoSig[] = [];
  busquedaGlobal = '';
  cargandoRoster = false;

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    resizable: true,
    minWidth: 110,
    suppressHeaderMenuButton: true,
  };

  // ---- Participantes (columna central) ----
  participantes: ParticipanteCurso[] = [];
  cargandoParticipantes = false;
  agregandoNum = '';
  /** Números de empleado ya inscritos -- decide si la celda "+" se pinta como agregada. */
  private numsInscritos = new Set<string>();

  /** Resultado de la última carga: lo que NO se pudo agregar y por qué. Se muestra hasta que se descarte. */
  rechazados: ParticipanteObservado[] = [];
  advertidos: ParticipanteObservado[] = [];
  noEncontrados: string[] = [];

  textoPegado = '';
  cargandoLote = false;

  // ---- Catálogos (columna derecha) ----
  plantillas: PlantillaCredencial[] = [];
  plantillasCorreo: PlantillaCorreo[] = [];
  cuestionarios: CuestionarioOpcion[] = [];
  cargandoCatalogos = false;

  // ---- Configuración editable ----
  aperturaLocal = '';
  cierreLocal = '';
  excepcionLocal = '';

  // ---- Envío de enlaces ----
  estadoAgente: EstadoAgente = { disponible: false, version: 0 };
  verificandoAgente = false;
  enviandoEnlaces = false;
  progresoEnvio = '';
  /** Ids en curso de envío: apagan solo su propio botón, no toda la lista. */
  enviandoA = new Set<number>();

  private cambios$ = new Subject<void>();
  private subs: Subscription[] = [];

  constructor(
    private api: CursoService,
    private ruta: ActivatedRoute,
    private router: Router,
    private utils: UtilsService,
    private modalManager: ModalManagerService,
    private plantillaApi: PlantillaCredencialService,
    private correoApi: CorreoService,
    private formularioApi: FormularioService,
    private agente: AgenteCorreoService,
    public permisosS: PermisosService,
  ) {
    this.columnDefs = [
      {
        headerName: '', colId: '_agregar', pinned: 'left', width: 52,
        sortable: false, filter: false, resizable: false, suppressHeaderMenuButton: true,
        cellClass: 'cu-celda-agregar',
        cellRenderer: (p: any) => this.renderBotonAgregar(p),
      },
      ...COLUMNAS_SIG.map((col) => ({
        field: col.campo,
        headerName: col.titulo,
        width: col.ancho,
        tooltipField: col.campo,
      })),
    ];
  }

  ngOnInit(): void {
    this.subs.push(
      this.cambios$.pipe(debounceTime(RETARDO_AUTOGUARDADO)).subscribe(() => this.guardarConfiguracion()),
    );

    const id = Number(this.ruta.snapshot.paramMap.get('id'));
    if (!id) {
      this.cargando = false;
      this.errorCarga = 'No se indicó qué curso abrir.';
      return;
    }

    this.cargar(id);
    this.cargarCatalogos();
    this.cargarRoster();
    this.verificarAgente();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ====================================================================
  // Carga
  // ====================================================================

  private cargar(id: number): void {
    this.cargando = true;
    this.api.obtener(id).subscribe({
      next: (res) => {
        this.aplicarCurso(res);
        this.cargando = false;
        this.cargarParticipantes();
      },
      error: (err) => {
        this.cargando = false;
        this.errorCarga = 'No se pudo abrir el curso.';
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  private aplicarCurso(res: Curso): void {
    this.curso = res;
    this.aperturaLocal = isoAInputLocal(res.fecha_apertura_programada);
    this.cierreLocal = isoAInputLocal(res.fecha_cierre_programada);
    this.excepcionLocal = isoAInputLocal(res.fecha_cierre_excepcion);
  }

  private cargarCatalogos(): void {
    this.cargandoCatalogos = true;

    this.plantillaApi.listar(true).subscribe({
      next: (res: any) => { this.plantillas = Array.isArray(res) ? res : (res?.results || []); },
      error: () => { this.plantillas = []; },
    });

    this.correoApi.listarPlantillas(true).subscribe({
      next: (res: any) => { this.plantillasCorreo = Array.isArray(res) ? res : (res?.results || []); },
      error: () => { this.plantillasCorreo = []; },
    });

    this.formularioApi.listar().subscribe({
      next: (res: any) => {
        this.cuestionarios = Array.isArray(res) ? res : (res?.results || []);
        this.cargandoCatalogos = false;
      },
      error: () => { this.cuestionarios = []; this.cargandoCatalogos = false; },
    });
  }

  private cargarRoster(): void {
    this.cargandoRoster = true;
    this.plantillaApi.empleadosSigTodos().subscribe({
      next: (res) => {
        this.rowData = res?.registros || [];
        // Solo activos: el backend rechaza bajas y fallecidos al inscribir,
        // así que mostrarlos aquí solo llevaría a intentos que van a fallar.
        this.activosData = this.rowData.filter((f) => !this.esNoInscribible(f));
        this.cargandoRoster = false;
      },
      error: (err) => {
        this.cargandoRoster = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  /** Mismos estados que bloquea el backend (ESTADOS_NOMINA_BLOQUEADOS). */
  private esNoInscribible(fila: EmpleadoSig): boolean {
    const estado = String((fila as any).estado_nom || '').trim().toLowerCase();
    return estado === 'baja' || estado === 'fallecido';
  }

  cargarParticipantes(): void {
    if (!this.curso?.id_curso) return;
    this.cargandoParticipantes = true;

    this.api.participantes(this.curso.id_curso).subscribe({
      next: (res) => {
        this.participantes = res?.participantes || [];
        this.numsInscritos = new Set(this.participantes.map((p) => p.num_empleado));
        this.cargandoParticipantes = false;
        this.refrescarCeldaAgregar();
      },
      error: (err) => {
        this.cargandoParticipantes = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  // ====================================================================
  // Padrón (grid)
  // ====================================================================

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  onBusquedaGlobal(): void {
    if (!this.gridApi) return;
    this.gridApi.setGridOption('quickFilterText', this.busquedaGlobal);
  }

  limpiarFiltros(): void {
    this.busquedaGlobal = '';
    if (!this.gridApi) return;
    this.gridApi.setGridOption('quickFilterText', '');
    this.gridApi.setFilterModel(null);
  }

  private renderBotonAgregar(params: any): string {
    const fila: EmpleadoSig = params.data;
    const num = String(fila?.no_empleado || '');
    const inscrito = this.numsInscritos.has(num);

    return inscrito
      ? `<button type="button" class="cu-btn-agregar cu-btn-agregado" data-action="quitar" data-num="${num}" title="Ya está inscrito, quitar">
           <i class="fas fa-check"></i>
         </button>`
      : `<button type="button" class="cu-btn-agregar" data-action="agregar" data-num="${num}" title="Inscribir al curso">
           <i class="fas fa-plus"></i>
         </button>`;
  }

  /** Mismo patrón que "Generador masivo": data-action en el HTML del cellRenderer, leído por el target del clic. */
  onCellClicked(evento: any): void {
    const target = evento.event?.target?.closest?.('[data-action]');
    if (!target) return;

    const num = target.dataset.num;
    if (!num) return;

    if (target.dataset.action === 'agregar') {
      this.inscribir([num]);
    } else if (target.dataset.action === 'quitar') {
      const participante = this.participantes.find((p) => p.num_empleado === num);
      if (participante) this.quitar(participante);
    }
  }

  private refrescarCeldaAgregar(): void {
    if (!this.gridApi) return;
    this.gridApi.refreshCells({ columns: ['_agregar'], force: true });
  }

  // ====================================================================
  // Inscripción
  // ====================================================================

  get puedeEditarLista(): boolean {
    return !!this.curso && !['cerrado', 'constancias_enviadas'].includes(this.curso.estado);
  }

  agregarPorNumero(): void {
    const numeros = numerosDesdeTexto(this.agregandoNum);
    if (!numeros.length) return;
    this.inscribir(numeros);
    this.agregandoNum = '';
  }

  abrirPegarLista(): void {
    this.textoPegado = '';
    this.modalManager.openModal({
      title: 'Pegar lista de participantes',
      template: this.pegarDialog,
      onAccept: () => {
        const numeros = numerosDesdeTexto(this.textoPegado);
        if (!numeros.length) {
          this.utils.MuestrasToast(TipoToast.Warning, 'No se encontró ningún número de empleado en el texto.');
          return;
        }
        this.inscribir(numeros);
      },
    });
  }

  private inscribir(numeros: string[]): void {
    if (!this.curso?.id_curso || !this.puedeEditarLista || this.cargandoLote) return;

    this.cargandoLote = true;
    this.api.cargarParticipantes(this.curso.id_curso, numeros).subscribe({
      next: (res) => {
        this.cargandoLote = false;

        // El servidor es quien decide qué entró: se recarga la lista en vez
        // de asumir que todo lo enviado quedó inscrito.
        this.rechazados = res.no_activos || [];
        this.advertidos = res.con_aviso || [];
        this.noEncontrados = res.no_encontrados || [];

        const agregados = (res.agregados || []).length;
        if (agregados) {
          this.utils.MuestrasToast(
            TipoToast.Success,
            agregados === 1 ? 'Participante inscrito.' : `${agregados} participantes inscritos.`,
          );
        }

        if (this.rechazados.length) {
          const primero = this.rechazados[0];
          this.utils.MuestrasToast(
            TipoToast.Error,
            this.rechazados.length === 1
              ? `No se puede inscribir a ${primero.nombre_completo || primero.num_empleado}: está dado de ${primero.estado_nom.toLowerCase()} en nómina.`
              : `${this.rechazados.length} personas no se inscribieron por su estado de nómina. Revisa el detalle abajo.`,
          );
        }

        if (!agregados && !this.rechazados.length && (res.ya_estaban || []).length) {
          this.utils.MuestrasToast(TipoToast.Warning, 'Esa persona ya estaba inscrita.');
        }

        this.cargarParticipantes();
        this.refrescarCurso();
      },
      error: (err) => {
        this.cargandoLote = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  confirmarQuitar(participante: ParticipanteCurso): void {
    this.confirmMessage = `¿Quitar a ${participante.nombre_completo || participante.num_empleado} del curso?`;
    this.modalManager.openModal({
      title: 'Quitar participante',
      template: this.confirmDialog,
      onAccept: () => this.quitar(participante),
    });
  }

  private quitar(participante: ParticipanteCurso): void {
    if (!this.curso?.id_curso) return;

    this.api.quitarParticipante(this.curso.id_curso, participante.id_participante).subscribe({
      next: () => {
        this.cargarParticipantes();
        this.refrescarCurso();
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  descartarObservaciones(): void {
    this.rechazados = [];
    this.advertidos = [];
    this.noEncontrados = [];
  }

  // ====================================================================
  // Asignación de los tres elementos
  // ====================================================================

  asignar(
    campo: 'id_plantilla' | 'id_plantilla_correo' | 'id_formulario' | 'id_plantilla_correo_reprobados',
    valor: any,
  ): void {
    if (!this.curso?.id_curso) return;

    const id = valor === '' || valor === null ? null : Number(valor);
    this.curso[campo] = id;
    this.guardarAsignacion({ [campo]: id });
  }

  /**
   * Prende o apaga el aviso a los reprobados.
   *
   * Va por `asignar` y no por el autoguardado normal porque el servidor
   * suelta la plantilla al apagarlo: dejarla apuntada con el interruptor en
   * "no" haría pensar, al volver a prenderlo, que ya se revisó cuál se iba
   * a usar.
   */
  alternarAvisoReprobados(): void {
    if (!this.curso) return;
    const nuevo = !this.curso.enviar_correo_reprobados;
    this.curso.enviar_correo_reprobados = nuevo;
    this.guardarAsignacion({
      enviar_correo_reprobados: nuevo,
      ...(nuevo ? {} : { id_plantilla_correo_reprobados: null }),
    });
  }

  private guardarAsignacion(datos: any): void {
    if (!this.curso?.id_curso) return;
    this.api.asignar(this.curso.id_curso, datos).subscribe({
      next: (res) => { this.aplicarCurso(res.curso); },
      error: (err) => {
        this.utils.MuestraErrorInterno(err);
        this.refrescarCurso();
      },
    });
  }

  /** El cuestionario elegido, para poder mandar a editarlo (ahí vive la calificación aprobatoria). */
  get cuestionarioElegido(): CuestionarioOpcion | null {
    return this.cuestionarios.find((c) => c.id_formulario === this.curso?.id_formulario) || null;
  }

  irAlCuestionario(): void {
    if (!this.curso?.id_formulario) return;
    this.router.navigate(['/formularios/editor', this.curso.id_formulario]);
  }

  get puedeAdministrar(): boolean {
    return this.permisosS.tiene('cursos_administrar');
  }

  // ====================================================================
  // Configuración (autoguardado)
  // ====================================================================

  marcarCambio(): void {
    this.cambios$.next();
  }

  private guardarConfiguracion(): void {
    const curso = this.curso;
    if (!curso?.id_curso || this.guardando) return;

    this.guardando = true;
    this.api.autoguardar(curso.id_curso, {
      nombre: curso.nombre,
      descripcion: curso.descripcion,
      fecha_apertura_programada: inputLocalAIso(this.aperturaLocal),
      fecha_cierre_programada: inputLocalAIso(this.cierreLocal),
      fecha_cierre_excepcion: inputLocalAIso(this.excepcionLocal),
      minutos_por_persona: Number(curso.minutos_por_persona) || 0,
      permitir_enlace_generico: curso.permitir_enlace_generico,
    }).subscribe({
      next: (res) => {
        this.guardando = false;
        // Se reaplica la respuesta del servidor para que las banderas
        // calculadas (`puede_enviar_enlaces`, `tiempo_agotado`) queden al
        // día: dependen de la hora del servidor, no de la del navegador.
        this.aplicarCurso(res);
      },
      error: (err) => {
        this.guardando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  private refrescarCurso(): void {
    if (!this.curso?.id_curso) return;
    this.api.obtener(this.curso.id_curso).subscribe({
      next: (res) => this.aplicarCurso(res),
      error: () => { /* el detalle ya está en pantalla; un refresco fallido no debe interrumpir */ },
    });
  }

  // ====================================================================
  // Apertura y cierre
  // ====================================================================

  abrirCurso(): void {
    if (!this.curso?.id_curso) return;

    this.confirmMessage =
      'Al abrir el curso se guarda una copia del cuestionario tal como está ahora, '
      + 'y se empiezan a aceptar respuestas. Después de esto ya no se podrán cambiar '
      + 'la constancia, el correo ni el cuestionario. ¿Abrir el curso?';

    this.modalManager.openModal({
      title: 'Abrir curso',
      template: this.confirmDialog,
      onAccept: () => {
        this.api.abrir(this.curso!.id_curso!).subscribe({
          next: (res) => {
            this.aplicarCurso(res.curso);
            this.utils.MuestrasToast(TipoToast.Success, 'Curso abierto. Ya puedes enviar los enlaces.');
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  cerrarCurso(): void {
    if (!this.curso?.id_curso) return;

    this.confirmMessage =
      'Se dejarán de aceptar respuestas. Los cuestionarios que estén contestándose '
      + 'en este momento se guardarán con lo que lleven. ¿Cerrar el curso?';

    this.modalManager.openModal({
      title: 'Cerrar curso',
      template: this.confirmDialog,
      onAccept: () => {
        this.api.cerrar(this.curso!.id_curso!).subscribe({
          next: (res) => {
            this.aplicarCurso(res.curso);
            this.cargarParticipantes();
            this.utils.MuestrasToast(TipoToast.Success, 'Curso cerrado.');
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  // ====================================================================
  // Envío de enlaces
  // ====================================================================

  verificarAgente(): void {
    this.verificandoAgente = true;
    this.agente.estado().subscribe((estado) => {
      this.estadoAgente = estado;
      this.verificandoAgente = false;
    });
  }

  get agenteDesactualizado(): boolean {
    return this.estadoAgente.disponible && this.estadoAgente.version < VERSION_AGENTE_SIN_ADJUNTO;
  }

  /** El enlace personal de una persona. Es su credencial: identifica sus respuestas. */
  enlaceDe(participante: ParticipanteCurso): string {
    return `${window.location.origin}/responder/${participante.token_participante}`;
  }

  copiarEnlace(participante: ParticipanteCurso): void {
    navigator.clipboard.writeText(this.enlaceDe(participante)).then(
      () => this.utils.MuestrasToast(TipoToast.Success, 'Enlace personal copiado.'),
      () => this.utils.MuestrasToast(TipoToast.Error, 'No se pudo copiar el enlace.'),
    );
  }

  get plantillaCorreoElegida(): PlantillaCorreo | null {
    return this.plantillasCorreo.find(
      (p) => p.id_plantilla_correo === this.curso?.id_plantilla_correo,
    ) || null;
  }

  /** A quiénes se les puede mandar el enlace ahora mismo: hace falta correo institucional. */
  get destinatariosPosibles(): ParticipanteCurso[] {
    return this.participantes.filter((p) => !!(p.email || '').trim());
  }

  get sinCorreo(): number {
    return this.participantes.length - this.destinatariosPosibles.length;
  }

  get puedeEnviarEnlaces(): boolean {
    return !!this.curso?.puede_enviar_enlaces
      && this.curso?.estado === 'abierto'
      && this.estadoAgente.disponible
      && !this.agenteDesactualizado
      && !!this.plantillaCorreoElegida
      && !this.enviandoEnlaces;
  }

  enviarATodos(): void {
    this.enviarEnlaces(this.destinatariosPosibles);
  }

  /**
   * Manda el enlace personal por correo, uno por uno.
   *
   * El envío real lo hace el Agente de Correo en ESTA computadora (Outlook
   * COM solo controla el Outlook de su propia máquina); el backend solo
   * registra a quién se le mandó. Por eso se hace secuencial y no en
   * paralelo: son llamadas a Outlook, y dispararle veinte a la vez es la
   * forma más rápida de que rechace la mitad.
   */
  enviarEnlaces(lista: ParticipanteCurso[]): void {
    const curso = this.curso;
    const plantilla = this.plantillaCorreoElegida;
    if (!curso?.id_curso || !plantilla || this.enviandoEnlaces) return;

    const destinatarios = lista.filter((p) => !!(p.email || '').trim());
    if (!destinatarios.length) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Nadie de la lista tiene correo institucional registrado.');
      return;
    }

    if (!this.estadoAgente.disponible) {
      this.utils.MuestrasToast(
        TipoToast.Error,
        'No se detectó el Agente de Correo en esta computadora. Ábrelo y vuelve a intentar.',
      );
      return;
    }

    this.enviandoEnlaces = true;
    destinatarios.forEach((p) => this.enviandoA.add(p.id_participante));

    const enviados: number[] = [];
    const fallidos: string[] = [];
    let i = 0;

    const siguiente = () => {
      if (i >= destinatarios.length) { this.terminarEnvio(enviados, fallidos); return; }

      const participante = destinatarios[i++];
      this.progresoEnvio = `Enviando ${i} de ${destinatarios.length}...`;

      this.agente.enviar({
        destinatario: participante.email,
        asunto: (plantilla.asunto || '').split('{{nombre_curso}}').join(curso.nombre),
        cuerpo_html: cuerpoConEnlace(plantilla.cuerpo_html, curso.nombre, this.enlaceDe(participante)),
        cuenta_remitente: plantilla.cuenta_remitente,
      }).subscribe({
        next: (res) => {
          if (res.status === 'success') enviados.push(participante.id_participante);
          else fallidos.push(`${participante.nombre_completo}: ${res.mensaje || 'Outlook rechazó el envío'}`);
          this.enviandoA.delete(participante.id_participante);
          siguiente();
        },
        error: (err) => {
          fallidos.push(`${participante.nombre_completo}: ${err?.error?.mensaje || 'no respondió el agente'}`);
          this.enviandoA.delete(participante.id_participante);
          siguiente();
        },
      });
    };

    siguiente();
  }

  private terminarEnvio(enviados: number[], fallidos: string[]): void {
    this.enviandoEnlaces = false;
    this.progresoEnvio = '';
    this.enviandoA.clear();

    if (enviados.length && this.curso?.id_curso) {
      // Se registra solo lo que de verdad salió: marcar como enviado algo
      // que Outlook rechazó dejaría a esa persona sin enlace y sin que nadie
      // se entere.
      this.api.registrarEnvioEnlace(this.curso.id_curso, enviados).subscribe({
        next: () => this.cargarParticipantes(),
        error: (err) => this.utils.MuestraErrorInterno(err),
      });
    }

    if (enviados.length) {
      this.utils.MuestrasToast(
        TipoToast.Success,
        enviados.length === 1 ? 'Enlace enviado.' : `${enviados.length} enlaces enviados.`,
      );
    }

    if (fallidos.length) {
      this.utils.MuestrasToast(
        TipoToast.Error,
        `No se pudo enviar a ${fallidos.length}: ${fallidos[0]}`,
      );
      console.warn('Envíos de enlace fallidos:', fallidos);
    }
  }

  // ====================================================================
  // Presentación
  // ====================================================================

  get etiquetaEstadoCurso(): string {
    return this.curso ? etiquetaEstado(this.curso.estado) : '';
  }

  get claseEstadoCurso(): string {
    return this.curso ? claseEstado(this.curso.estado) : '';
  }

  get enlaceGenerico(): string {
    const token = this.curso?.token_curso;
    return token ? `${window.location.origin}/responder/curso/${token}` : '';
  }

  /** Por qué no se pueden mandar los enlaces todavía. Null = sí se pueden. */
  get motivoSinEnlaces(): string | null {
    const curso = this.curso;
    if (!curso) return 'Cargando...';
    if (!curso.esta_completo) return 'Falta asignar la constancia, la plantilla de correo o el cuestionario.';
    if (!this.participantes.length) return 'Falta cargar la lista de participantes.';
    if (!curso.tiene_tiempo_configurado) return 'Falta programar la fecha de cierre o el tiempo por persona.';
    if (curso.tiempo_agotado) return 'El tiempo del curso ya terminó: los enlaces individuales quedaron cerrados.';
    return null;
  }

  /** Por qué no se puede mandar el correo todavía (distinto de por qué el curso no está listo). */
  get motivoSinEnvio(): string | null {
    if (this.curso?.estado !== 'abierto') return 'Abre el curso para poder enviar los enlaces.';
    if (!this.estadoAgente.disponible) return 'No se detectó el Agente de Correo en esta computadora.';
    if (this.agenteDesactualizado) return 'Tu Agente de Correo es de una versión anterior y no puede enviar correos sin adjunto. Descarga el nuevo desde "Correo electrónico".';
    if (!this.plantillaCorreoElegida) return 'Falta asignar la plantilla de correo.';
    if (!this.destinatariosPosibles.length) return 'Ningún participante tiene correo institucional registrado.';
    return null;
  }

  get listoParaAbrir(): boolean {
    return this.motivoSinEnlaces === null;
  }

  copiarEnlaceGenerico(): void {
    const enlace = this.enlaceGenerico;
    if (!enlace) return;

    navigator.clipboard.writeText(enlace).then(
      () => this.utils.MuestrasToast(TipoToast.Success, 'Enlace copiado.'),
      () => this.utils.MuestrasToast(TipoToast.Error, 'No se pudo copiar el enlace.'),
    );
  }

  volverALista(): void {
    this.router.navigate(['/cursos']);
  }

  iniciales(nombre: string): string {
    const partes = (nombre || '').trim().split(/\s+/);
    return ((partes[0]?.charAt(0) || '') + (partes[1]?.charAt(0) || '')).toUpperCase();
  }

  trackParticipante(_i: number, p: ParticipanteCurso): number {
    return p.id_participante;
  }
}
