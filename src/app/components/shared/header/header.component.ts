
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarService } from '../../../services/sidebar-service.service';
import { inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { UtilsService } from '../../../services/utils.service';
import { TipoToast } from '../../../../api/entidades/enumeraciones';
import { CatalogoService } from '../../../../api/catalogo/catalogo.service';
import { SessionService } from '../../../services/session.service';

@Component({
  selector: 'app-header',
  standalone: false,
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss'
})
export class HeaderComponent {
  public sidebarService = inject(SidebarService);

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  collapseSidebar(): void {
    this.sidebarService.collapseSidebar();
  }

  expandSidebar(): void {
    this.sidebarService.expandSidebar();
  }
   @Output() onLogout = new EventEmitter<void>();

  usuario:any;
  dependenciaDS: any = [];

  /** Nombre a mostrar a la izquierda del circulo -- cae a username si no hay nombreCompleto (ej. cuenta sin first_name/last_name capturados). */
  get nombreUsuario(): string {
    const nombre = (this.usuario?.nombreCompleto || '').trim();
    return nombre || this.usuario?.username || 'Usuario';
  }

  constructor(
    private router: Router,
    private utils: UtilsService,
    private catalogoApi: CatalogoService,
	private sessionS: SessionService
  ) {
    
  }

   isDropdownOpen = false;

  toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  logout() {
    this.isDropdownOpen = false;
    this.onLogout.emit();
    this.utils.MuestrasToast(TipoToast.Info, "Se ha finalizado la sesión.");
    this.sessionS.logout();
  }

  // Cerrar dropdown al hacer click fuera
  onDocumentClick(event: Event) {
    if (!event.target) return;
    
    const target = event.target as Element;
    if (!target.closest('.user-menu')) {
      this.isDropdownOpen = false;
    }
  }

  ngOnInit() {
	this.usuario = this.sessionS.getUsuario();
    document.addEventListener('click', this.onDocumentClick.bind(this));
    
  }

  ngOnDestroy() {
    document.removeEventListener('click', this.onDocumentClick.bind(this));
  }

  goHome(){
    this.router.navigate(['/dashboard']);
  }

}
