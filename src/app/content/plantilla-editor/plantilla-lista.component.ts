import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { TipoToast } from '../../../api/entidades/enumeraciones';
import { UtilsService } from '../../services/utils.service';
import { PlantillaCredencial, PlantillaCredencialService } from '../../services/plantilla-credencial.service';
import { PermisosService } from '../../services/permisos.service';

/** Administracion de plantillas de credencial: listar, crear, duplicar, eliminar. */
@Component({
  standalone: false,
  selector: 'app-plantilla-lista',
  templateUrl: './plantilla-lista.component.html',
  styleUrls: ['./plantilla-lista.component.scss'],
})
export class PlantillaListaComponent implements OnInit {

  plantillas: PlantillaCredencial[] = [];
  cargando = false;
  filtro = '';

  constructor(
    private plantillaApi: PlantillaCredencialService,
    private utils: UtilsService,
    private router: Router,
    public permisosS: PermisosService,
  ) { }

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;

    this.plantillaApi.listar().subscribe({
      next: (res) => {
        // El endpoint puede venir paginado o como arreglo plano.
        this.plantillas = Array.isArray(res) ? res : (res?.results || []);
        this.cargando = false;
      },
      error: (err) => {
        this.cargando = false;
        this.utils.MuestraErrorInterno(err);
      },
    });
  }

  get plantillasFiltradas(): PlantillaCredencial[] {
    const termino = this.filtro.trim().toLowerCase();
    if (!termino) return this.plantillas;

    return this.plantillas.filter(p =>
      `${p.clave} ${p.nombre} ${p.descripcion || ''}`.toLowerCase().includes(termino)
    );
  }

  nueva(): void {
    this.router.navigate(['/plantillas/editor']);
  }

  editar(plantilla: PlantillaCredencial): void {
    // El clic en la miniatura no pasa por el boton (oculto sin el permiso),
    // asi que se revalida aqui: entrar al editor sin `plantillas_administrar`
    // terminaria en un 403 al primer guardado, una manera confusa de
    // enterarse de que no tiene el permiso.
    if (!this.permisosS.tiene('plantillas_administrar')) return;
    this.router.navigate(['/plantillas/editor', plantilla.id_plantilla]);
  }

  duplicar(plantilla: PlantillaCredencial): void {
    if (!plantilla.id_plantilla) return;

    this.plantillaApi.duplicar(plantilla.id_plantilla).subscribe({
      next: () => {
        this.utils.MuestrasToast(TipoToast.Success, 'Plantilla duplicada');
        this.cargar();
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  alternarActivo(plantilla: PlantillaCredencial): void {
    if (!plantilla.id_plantilla) return;

    this.plantillaApi.actualizar(plantilla.id_plantilla, { activo: !plantilla.activo }).subscribe({
      next: () => {
        plantilla.activo = !plantilla.activo;
        this.utils.MuestrasToast(
          TipoToast.Success,
          plantilla.activo ? 'Plantilla activada' : 'Plantilla desactivada'
        );
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  /**
   * Marca esta plantilla como la que se carga por omision en "Imprimir
   * credenciales". El backend desmarca cualquier otra en la misma
   * transaccion, por eso se recarga el listado completo despues.
   */
  marcarPorDefecto(plantilla: PlantillaCredencial): void {
    if (!plantilla.id_plantilla || plantilla.por_defecto) return;

    this.plantillaApi.marcarPorDefecto(plantilla.id_plantilla).subscribe({
      next: () => {
        this.utils.MuestrasToast(
          TipoToast.Success,
          `"${plantilla.nombre}" es ahora la plantilla predeterminada`
        );
        this.cargar();
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }

  eliminar(plantilla: PlantillaCredencial): void {
    if (!plantilla.id_plantilla) return;
    if (!confirm(`Eliminar definitivamente la plantilla "${plantilla.nombre}"?`)) return;

    this.plantillaApi.eliminar(plantilla.id_plantilla).subscribe({
      next: () => {
        this.utils.MuestrasToast(TipoToast.Success, 'Plantilla eliminada');
        this.cargar();
      },
      error: (err) => this.utils.MuestraErrorInterno(err),
    });
  }
}
