import { Injectable, computed, signal } from '@angular/core';

export type SidebarBlock = 'anam' | 'nuevo-laredo' | 'consultas' | 'enrolamiento-masivo' | null;

@Injectable({ providedIn: 'root' })
export class ModuleContextService {
  private readonly storageKey = 'sicre.selectedBlock';
  private readonly _selectedBlock = signal<SidebarBlock>(null);
  readonly selectedBlock = this._selectedBlock.asReadonly();

  readonly hasSelection = computed(() => this._selectedBlock() !== null);

  constructor() {
    this.restoreBlock();
  }

  setBlock(block: SidebarBlock): void {
    this._selectedBlock.set(block);
    this.persistBlock(block);
  }

  clearBlock(): void {
    this._selectedBlock.set(null);
    this.persistBlock(null);
  }

  private persistBlock(block: SidebarBlock): void {
    if (typeof window === 'undefined') return;
    if (!block) {
      window.sessionStorage.removeItem(this.storageKey);
      return;
    }

    window.sessionStorage.setItem(this.storageKey, block);
  }

  private restoreBlock(): void {
    if (typeof window === 'undefined') return;

    const saved = window.sessionStorage.getItem(this.storageKey);
    if (saved === 'anam' || saved === 'nuevo-laredo' || saved === 'consultas' || saved === 'enrolamiento-masivo') {
      this._selectedBlock.set(saved);
    }
  }

  getAllowedIds(block: SidebarBlock): string[] {
    switch (block) {
      case 'anam':
        return ['imprimir-credenciales', 'generador-masivo', 'correo-electronico', 'enrolamiento-previo', 'plantillas',  'inventario-medios', 'catalogo-areas', 'auditoria-credenciales', 'acuses', 'administracion' ];
        // return ['enrolamiento', 'plantilla-anam'];
      case 'nuevo-laredo':
                return ['imprimir-credenciales', 'generador-masivo', 'correo-electronico', 'enrolamiento-previo', 'plantillas',  'inventario-medios', 'catalogo-areas', 'auditoria-credenciales', 'acuses', 'administracion' ];

        // return ['enrolamiento', 'provisional', 'familiar'];
      case 'consultas':
                return ['imprimir-credenciales', 'generador-masivo', 'correo-electronico', 'enrolamiento-previo', 'plantillas',  'inventario-medios', 'catalogo-areas', 'auditoria-credenciales', 'acuses', 'administracion' ];

        // return ['busquedaAvanzada', 'reportes', 'credencializacion', 'Carga masiva', 'plantillas', 'imprimir-credenciales', 'catalogo-areas'];
      case 'enrolamiento-masivo':
                return ['imprimir-credenciales', 'generador-masivo', 'correo-electronico', 'enrolamiento-previo', 'plantillas',  'inventario-medios', 'catalogo-areas', 'auditoria-credenciales', 'acuses', 'administracion' ];

        // return ['enrolamiento-masivo', 'busqueda-enrolamiento-masivos', 'enrolamiento-previo', 'inventario-medios'];
      default:
        return [];
    }
  }

  resolveBlockFromRoute(url: string): SidebarBlock {
    if (url.includes('/busqueda-avanzada') || url.includes('/reportes') || url.includes('/credencializacion') || url.includes('/carga-masiva') || url.includes('/plantillas') || url.includes('/imprimir-credenciales') || url.includes('/generador-masivo') || url.includes('/correo-electronico') || url.includes('/catalogo-areas') || url.includes('/auditoria-credenciales') || url.includes('/acuses')) {
      return 'consultas';
    }

    if (url.includes('/plantilla-anam')) {
      return 'anam';
    }

    if (url.includes('/provisional')) {
      return 'nuevo-laredo';
    }

    if (url.includes('/Carga%20masiva') || url.includes('/enrolamiento-masivo') || url.includes('/enrolamiento-previo') || url.includes('/inventario-medios')) {
      return 'enrolamiento-masivo'; // Opcional si esta es la ruta, dependiento de router
    }

    if (url.includes('/credencializacion') || url.includes('/enrolamiento') || url.includes('/carga-masiva')) {
      return this._selectedBlock() === 'consultas' ? 'anam' : (this._selectedBlock() || 'anam');
    }

    return this._selectedBlock();
  }
}
