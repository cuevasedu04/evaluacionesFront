import { ChangeDetectorRef, Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { CellClickedEvent, ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { SessionService } from '../../services/session.service';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import { PermisosService } from '../../services/permisos.service';
import {
  AdministracionService, Permiso, Rol, Usuario,
} from '../../services/administracion.service';

type SeccionAdmin = 'usuarios' | 'roles' | 'general';

/** Formulario de alta/edicion de usuario. */
interface FormularioUsuario {
  id?: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  roles: number[];
  /** Para cruzar con media/fotos y mostrar su foto en el header al iniciar sesión. */
  num_empleado: string;
}

/** Formulario de alta/edicion de rol. */
interface FormularioRol {
  id?: number;
  name: string;
  permisos: string[];
}

/**
 * Pantalla "Administración" -- usuarios y roles, gateada a superusuario
 * (mismo criterio que el backend: `EsSuperusuario`, ver credencializacion/auth.py).
 *
 * Todo corre sobre lo que Django ya trae -- `auth_user`, `auth_group`,
 * `auth_permission` -- sin tablas de roles propias. Un rol es un `auth_group`
 * con un subconjunto de permisos del catálogo (`RecursoSistema.Meta.permissions`);
 * un usuario se arma escogiendo uno o mas roles. El catalogo mismo (que
 * codenames existen y que texto describen) es fijo, definido en el backend --
 * aqui solo se decide QUE combinacion tiene cada rol.
 */
@Component({
  standalone: false,
  selector: 'app-administracion',
  templateUrl: './administracion.component.html',
  styleUrls: ['./administracion.component.scss'],
})
export class AdministracionComponent implements OnInit {

  @ViewChild('modalUsuario') modalUsuario!: TemplateRef<any>;
  @ViewChild('modalPassword') modalPassword!: TemplateRef<any>;
  @ViewChild('modalRol') modalRol!: TemplateRef<any>;
  @ViewChild('confirmDialog') confirmDialog!: TemplateRef<any>;

  seccion: SeccionAdmin = 'usuarios';

  // ---- Usuarios ----
  usuarios: Usuario[] = [];
  cargandoUsuarios = false;
  busquedaUsuarios = '';
  private gridApi!: GridApi;

  readonly defaultColDef: ColDef = {
    sortable: true, filter: 'agTextColumnFilter', floatingFilter: true,
    resizable: true, suppressHeaderMenuButton: true,
  };

  columnDefs: ColDef[] = [
    {
      headerName: '', colId: 'foto', width: 56, sortable: false, filter: false,
      cellRenderer: (p: any) => p.data.foto
        ? `<img src="${p.data.foto}" class="adm-grid-foto" alt="Foto">`
        : '<i class="fas fa-user-circle text-muted" style="font-size:1.4rem"></i>',
      cellStyle: { textAlign: 'center' },
    },
    { headerName: 'Usuario', field: 'username', width: 150 },
    {
      headerName: 'Nombre completo', width: 200,
      valueGetter: p => [p.data.first_name, p.data.last_name].filter(Boolean).join(' ') || '—',
    },
    { headerName: 'Núm. empleado', field: 'num_empleado', width: 130,
      valueGetter: p => p.data.num_empleado || '—' },
    { headerName: 'Correo', field: 'email', flex: 1, minWidth: 200 },
    {
      headerName: 'Roles', width: 220, sortable: false, filter: false,
      valueGetter: p => (p.data.roles_detalle || []).map((r: any) => r.name).join(', ') || 'Sin rol',
    },
    {
      headerName: 'Superusuario', field: 'is_superuser', width: 120, filter: false,
      cellRenderer: (p: any) => p.value ? '<i class="fas fa-crown text-warning"></i>' : '',
      cellStyle: { textAlign: 'center' },
    },
    {
      headerName: 'Activo', field: 'is_active', width: 90, filter: false,
      cellRenderer: (p: any) => p.value
        ? '<i class="fas fa-circle-check text-success"></i>'
        : '<i class="fas fa-circle-xmark text-muted"></i>',
      cellStyle: { textAlign: 'center' },
    },
    {
      headerName: 'Acciones', colId: 'acciones', width: 160, sortable: false, filter: false,
      pinned: 'right',
      cellRenderer: () => `
        <span title="Editar"><i class="tool-icon fas fa-pen text-primary me-2" data-accion="editar" style="cursor:pointer"></i></span>
        <span title="Restablecer contraseña"><i class="tool-icon fas fa-key text-secondary me-2" data-accion="password" style="cursor:pointer"></i></span>
        <span title="Activar / desactivar"><i class="tool-icon fas fa-power-off text-danger" data-accion="activo" style="cursor:pointer"></i></span>`,
      cellStyle: { textAlign: 'center' },
    },
  ];

  enFormularioUsuario: FormularioUsuario = this.usuarioVacio();
  editandoUsuario = false;
  guardandoUsuario = false;

  usuarioPassword: Usuario | null = null;
  passwordNueva = '';
  passwordConfirmar = '';
  guardandoPassword = false;

  confirmMessage = '';

  // ---- Roles ----
  roles: Rol[] = [];
  cargandoRoles = false;
  enFormularioRol: FormularioRol = this.rolVacio();
  editandoRol = false;
  guardandoRol = false;

  // ---- Catalogo de permisos, partido para la matriz del modal de roles ----
  permisos: Permiso[] = [];
  get permisosPantallas(): Permiso[] {
    return this.permisos.filter(p => p.codename.startsWith('ver_'));
  }
  get permisosFuncionalidades(): Permiso[] {
    return this.permisos.filter(p => !p.codename.startsWith('ver_'));
  }

  // ---- General ----
  descargandoFotos = false;
  descargandoFirmas = false;

  constructor(
    private api: AdministracionService,
    private utils: UtilsService,
    private sessionS: SessionService,
    private modalManager: ModalManagerService,
    private cdr: ChangeDetectorRef,
    public permisosS: PermisosService,
  ) {}

  ngOnInit(): void {
    this.api.listarPermisos().subscribe({
      next: (res) => { this.permisos = res || []; },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
    this.cargarUsuarios();
    // Se carga de una vez, no solo al abrir la pestaña "Roles": el modal de
    // usuario necesita la lista de roles para el selector de asignacion, y
    // es un catalogo chico (no vale la pena la complejidad de cargarlo bajo
    // demanda justo antes de abrir ese modal).
    this.cargarRoles();
  }

  seleccionarSeccion(seccion: SeccionAdmin): void {
    this.seccion = seccion;
  }

  // ====================================================================
  // Usuarios
  // ====================================================================

  private usuarioVacio(): FormularioUsuario {
    return { username: '', email: '', first_name: '', last_name: '', password: '', roles: [], num_empleado: '' };
  }

  cargarUsuarios(): void {
    this.cargandoUsuarios = true;
    this.api.listarUsuarios(this.busquedaUsuarios).subscribe({
      next: (res) => {
        this.usuarios = res || [];
        this.cargandoUsuarios = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.cargandoUsuarios = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  private temporizadorBusqueda: any = null;
  onBusquedaUsuarios(): void {
    clearTimeout(this.temporizadorBusqueda);
    this.temporizadorBusqueda = setTimeout(() => this.cargarUsuarios(), 300);
  }

  onGridReady(evento: GridReadyEvent): void {
    this.gridApi = evento.api;
  }

  onCellClicked(evento: CellClickedEvent): void {
    const accion = (evento.event?.target as HTMLElement)?.dataset?.['accion'];
    if (!accion) return;
    const usuario = evento.data as Usuario;
    if (accion === 'editar') this.editarUsuario(usuario);
    else if (accion === 'password') this.abrirModalPassword(usuario);
    else if (accion === 'activo') this.confirmarActivarDesactivar(usuario);
  }

  nuevoUsuario(): void {
    this.editandoUsuario = false;
    this.enFormularioUsuario = this.usuarioVacio();
    this.modalManager.openModal({
      title: 'Nuevo usuario',
      template: this.modalUsuario,
      width: '520px',
      showFooter: true,
      onAccept: () => this.guardarUsuario(),
    });
  }

  editarUsuario(usuario: Usuario): void {
    this.editandoUsuario = true;
    this.enFormularioUsuario = {
      id: usuario.id,
      username: usuario.username,
      email: usuario.email,
      first_name: usuario.first_name,
      last_name: usuario.last_name,
      password: '',
      roles: (usuario.roles_detalle || []).map(r => r.id),
      num_empleado: usuario.num_empleado || '',
    };
    this.modalManager.openModal({
      title: `Editar usuario — ${usuario.username}`,
      template: this.modalUsuario,
      width: '520px',
      showFooter: true,
      onAccept: () => this.guardarUsuario(),
    });
  }

  get formularioUsuarioValido(): boolean {
    const f = this.enFormularioUsuario;
    if (!f.username.trim()) return false;
    if (!this.editandoUsuario && f.password.trim().length < 8) return false;
    return true;
  }

  toggleRolUsuario(idRol: number): void {
    const f = this.enFormularioUsuario;
    f.roles = f.roles.includes(idRol) ? f.roles.filter(r => r !== idRol) : [...f.roles, idRol];
  }

  private guardarUsuario(): void {
    if (!this.formularioUsuarioValido) {
      this.utils.MuestrasToast(TipoToast.Warning, 'Revisa el usuario y la contraseña (mínimo 8 caracteres).');
      return;
    }

    const f = this.enFormularioUsuario;
    this.guardandoUsuario = true;

    const peticion = this.editandoUsuario && f.id
      ? this.api.actualizarUsuario(f.id, {
          email: f.email, first_name: f.first_name, last_name: f.last_name,
          roles: f.roles as any, num_empleado: f.num_empleado.trim(),
        })
      : this.api.crearUsuario({
          username: f.username, email: f.email, first_name: f.first_name,
          last_name: f.last_name, password: f.password, roles: f.roles as any,
          num_empleado: f.num_empleado.trim(),
        });

    peticion.subscribe({
      next: () => {
        this.guardandoUsuario = false;
        this.utils.MuestrasToast(TipoToast.Success, this.editandoUsuario ? 'Usuario actualizado' : 'Usuario creado');
        this.cargarUsuarios();
      },
      error: (err) => {
        this.guardandoUsuario = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  abrirModalPassword(usuario: Usuario): void {
    this.usuarioPassword = usuario;
    this.passwordNueva = '';
    this.passwordConfirmar = '';
    this.modalManager.openModal({
      title: `Restablecer contraseña — ${usuario.username}`,
      template: this.modalPassword,
      width: '420px',
      showFooter: true,
      onAccept: () => this.guardarPassword(),
    });
  }

  get passwordValida(): boolean {
    return this.passwordNueva.length >= 8 && this.passwordNueva === this.passwordConfirmar;
  }

  private guardarPassword(): void {
    if (!this.usuarioPassword) return;
    if (!this.passwordValida) {
      this.utils.MuestrasToast(TipoToast.Warning, 'La contraseña debe tener 8+ caracteres y coincidir en ambos campos.');
      return;
    }
    this.guardandoPassword = true;
    this.api.restablecerPassword(this.usuarioPassword.id, this.passwordNueva).subscribe({
      next: () => {
        this.guardandoPassword = false;
        this.utils.MuestrasToast(TipoToast.Success, 'Contraseña restablecida. Las sesiones anteriores de esa cuenta quedaron cerradas.');
      },
      error: (err) => {
        this.guardandoPassword = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get miPropioId(): number | null {
    return this.sessionS.getUsuario()?.idUsuario ?? null;
  }

  confirmarActivarDesactivar(usuario: Usuario): void {
    if (usuario.is_active && usuario.id === this.miPropioId) {
      this.utils.MuestrasToast(TipoToast.Warning, 'No puedes desactivar tu propia cuenta.');
      return;
    }

    this.confirmMessage = usuario.is_active
      ? `¿Desactivar a «${usuario.username}»? No podrá iniciar sesión hasta que lo reactives.`
      : `¿Reactivar a «${usuario.username}»?`;

    this.modalManager.openModal({
      title: usuario.is_active ? 'Desactivar usuario' : 'Reactivar usuario',
      template: this.confirmDialog,
      onAccept: () => {
        const peticion = usuario.is_active
          ? this.api.desactivarUsuario(usuario.id)
          : this.api.activarUsuario(usuario.id);
        peticion.subscribe({
          next: () => {
            this.utils.MuestrasToast(TipoToast.Success, usuario.is_active ? 'Usuario desactivado' : 'Usuario reactivado');
            this.cargarUsuarios();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  // ====================================================================
  // Roles
  // ====================================================================

  private rolVacio(): FormularioRol {
    return { name: '', permisos: [] };
  }

  cargarRoles(): void {
    this.cargandoRoles = true;
    this.api.listarRoles().subscribe({
      next: (res) => {
        this.roles = res || [];
        this.cargandoRoles = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.cargandoRoles = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  nuevoRol(): void {
    this.editandoRol = false;
    this.enFormularioRol = this.rolVacio();
    this.abrirModalRol('Nuevo rol');
  }

  editarRol(rol: Rol): void {
    this.editandoRol = true;
    this.enFormularioRol = {
      id: rol.id,
      name: rol.name,
      permisos: (rol.permisos_detalle || []).map(p => p.codename),
    };
    this.abrirModalRol(`Editar rol — ${rol.name}`);
  }

  private abrirModalRol(titulo: string): void {
    this.modalManager.openModal({
      title: titulo,
      template: this.modalRol,
      width: '640px',
      showFooter: true,
      onAccept: () => this.guardarRol(),
    });
  }

  togglePermisoRol(codename: string): void {
    const f = this.enFormularioRol;
    f.permisos = f.permisos.includes(codename)
      ? f.permisos.filter(p => p !== codename)
      : [...f.permisos, codename];
  }

  private guardarRol(): void {
    if (!this.enFormularioRol.name.trim()) {
      this.utils.MuestrasToast(TipoToast.Warning, 'El rol necesita un nombre.');
      return;
    }

    this.guardandoRol = true;
    const f = this.enFormularioRol;
    const peticion = this.editandoRol && f.id
      ? this.api.actualizarRol(f.id, { name: f.name, permisos: f.permisos })
      : this.api.crearRol(f.name, f.permisos);

    peticion.subscribe({
      next: () => {
        this.guardandoRol = false;
        this.utils.MuestrasToast(TipoToast.Success, this.editandoRol ? 'Rol actualizado' : 'Rol creado');
        this.cargarRoles();
      },
      error: (err) => {
        this.guardandoRol = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  confirmarEliminarRol(rol: Rol): void {
    this.confirmMessage = `¿Eliminar el rol «${rol.name}»? `
      + (rol.total_usuarios
          ? `${rol.total_usuarios} usuario(s) lo tienen asignado y perderían los permisos que solo daba este rol.`
          : 'Nadie lo tiene asignado actualmente.');

    this.modalManager.openModal({
      title: 'Eliminar rol',
      template: this.confirmDialog,
      onAccept: () => {
        this.api.eliminarRol(rol.id).subscribe({
          next: () => {
            this.utils.MuestrasToast(TipoToast.Success, 'Rol eliminado');
            this.cargarRoles();
          },
          error: (err) => this.utils.MuestraErrorInterno(err),
        });
      },
    });
  }

  // ====================================================================
  // General -- respaldo de medios
  // ====================================================================

  descargarRespaldoFotos(): void {
    if (this.descargandoFotos) return;
    this.descargandoFotos = true;
    this.api.respaldoFotos().subscribe({
      next: (blob) => {
        this.descargandoFotos = false;
        this.descargarBlob(blob, `fotos_${this.marcaFecha()}.zip`);
      },
      error: (err) => {
        this.descargandoFotos = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  descargarRespaldoFirmas(): void {
    if (this.descargandoFirmas) return;
    this.descargandoFirmas = true;
    this.api.respaldoFirmas().subscribe({
      next: (blob) => {
        this.descargandoFirmas = false;
        this.descargarBlob(blob, `firmas_${this.marcaFecha()}.zip`);
      },
      error: (err) => {
        this.descargandoFirmas = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  private marcaFecha(): string {
    const ahora = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}_${p(ahora.getHours())}${p(ahora.getMinutes())}`;
  }

  private descargarBlob(blob: Blob, nombreArchivo: string): void {
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreArchivo;
    enlace.click();
    URL.revokeObjectURL(url);
  }
}
