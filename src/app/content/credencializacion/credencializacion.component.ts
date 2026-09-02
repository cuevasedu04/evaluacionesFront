import { Component, OnInit, ViewChild, TemplateRef, ElementRef } from '@angular/core';
import { EnrolamientoService } from '../../services/enrolamiento.service';
import { UtilsService } from '../../services/utils.service';
import { TipoToast } from '../../../api/entidades/enumeraciones';
import { ModalManagerService } from '../../components/shared/modal-manager.service';
import jsPDF from 'jspdf';
import * as htmlToImage from 'html-to-image';
import { PlantillaEnrolamientoComponent } from '../enrolamiento/plantilla-enrolamiento/plantilla-enrolamiento.component';
import { PlantillaAnamComponent } from '../plantilla-anam/plantilla-anam.component';
import { cargoANivel } from '../../components/shared/nivel-credencial.const';
import { firstValueFrom } from 'rxjs';

@Component({
  standalone: false,
  selector: 'app-credencializacion',
  templateUrl: './credencializacion.component.html',
  styleUrls: ['./credencializacion.component.scss']
})
export class CredencializacionComponent implements OnInit {
  Math = Math;
  personal: any = [];
  paginaPersonal: any[] = []; // Lista que se muestra por página
  searchTerm: string = '';
  filteredPersonal: any[] = []; // Lista filtrada

  pageSize: number = 10; // Elementos por página
  currentPage: number = 0;
  totalPages: number = 0;
  visiblePages: number[] = [];

  @ViewChild('modalVisualizar') modalVisualizar!: TemplateRef<any>;
  empleadoSeleccionado: any = null;
  esEditable: boolean = false;

  // Variables para impresión
  empleadoImprimir: any = null;
  @ViewChild('plantillaModal') plantillaModal!: PlantillaEnrolamientoComponent;
  @ViewChild('plantillaModalAnam') plantillaModalAnam!: PlantillaAnamComponent;
  @ViewChild('plantillaImprimir') plantillaImprimir!: PlantillaEnrolamientoComponent;
  @ViewChild('plantillaImprimirAnam') plantillaImprimirAnam!: PlantillaAnamComponent;
  @ViewChild('printContainer') printContainer!: ElementRef;

  constructor(
    private enrolamientoService: EnrolamientoService,
    private utils: UtilsService,
    private modalManager: ModalManagerService
  ) {}

  ngOnInit(): void {
    this.obtenerCredenciales();
  }

  obtenerCredenciales() {
    this.enrolamientoService.getDataTableImprimir().subscribe(
      (data: any) => {
        this.personal = data;
        
        // Ordenar por fecha_enrolamiento descendente (más reciente primero)
        this.personal.sort((a: any, b: any) => {
          const fechaA = a.fecha_enrolamiento ? new Date(a.fecha_enrolamiento).getTime() : 0;
          const fechaB = b.fecha_enrolamiento ? new Date(b.fecha_enrolamiento).getTime() : 0;
          return fechaB - fechaA; // Orden descendente
        });
        
        this.filteredPersonal = [...this.personal];
        this.totalPages = Math.ceil(this.filteredPersonal.length / this.pageSize);
        this.currentPage = 0;
        this.updateVisiblePages();
        this.updatePaginaPersonal();
      },
      (error) => {
        this.utils.MuestraErrorInterno(error);
      }
    );
  }

  updatePaginaPersonal() {
    const start = this.currentPage * this.pageSize;
    const end = start + this.pageSize;
    this.paginaPersonal = this.filteredPersonal.slice(start, end);
  }

  prevPage() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this.updatePaginaPersonal();
      this.updateVisiblePages();
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages - 1) {
      this.currentPage++;
      this.updatePaginaPersonal();
      this.updateVisiblePages();
    }
  }

  goToPage(page: number) {
    this.currentPage = page;
    this.updatePaginaPersonal();
    this.updateVisiblePages();
  }

  updateVisiblePages() {
    const total = this.totalPages;
    const current = this.currentPage;
    const visibleCount = 5;

    let start = Math.max(current - Math.floor(visibleCount / 2), 0);
    let end = start + visibleCount;

    if (end > total) {
      end = total;
      start = Math.max(end - visibleCount, 0);
    }

    this.visiblePages = [];
    for (let i = start; i < end; i++) {
      this.visiblePages.push(i);
    }
  }

  applyFilter() {
    const term = this.searchTerm.toLowerCase();

    this.filteredPersonal = this.personal.filter((persona: any) => {
      const nombreCompleto = `${persona.nombre} ${persona.paterno} ${persona.materno}`.toLowerCase();
      return (
        (persona.num_empleado && persona.num_empleado.toString().toLowerCase().includes(term)) ||
        (persona.rfc && persona.rfc.toLowerCase().includes(term)) ||
        (persona.curp && persona.curp.toLowerCase().includes(term)) ||
        nombreCompleto.includes(term) ||
        (persona.adscripcion && persona.adscripcion.toLowerCase().includes(term)) ||
        (persona.puesto && persona.puesto.toLowerCase().includes(term))
      );
    });

    this.totalPages = Math.ceil(this.filteredPersonal.length / this.pageSize);
    this.currentPage = 0;
    this.updateVisiblePages();
    this.updatePaginaPersonal();
  }

  visualizarCredencial(persona: any) {
    this.empleadoSeleccionado = { ...persona };
    this.esEditable = false;
    this.modalManager.openModal({
      title: 'Visualizar Constancia',
      template: this.modalVisualizar,
      width: '400px',
      showFooter: false
    });
  }

  guardarCambios() {
    const plantillaActiva = this.esCredencialAnam(this.empleadoSeleccionado)
      ? this.plantillaModalAnam
      : this.plantillaModal;

    if (plantillaActiva) {
      plantillaActiva.guardarEnrolamiento();
    }
  }

  onEnrolamientoCompletado() {
    this.modalManager.closeModal();
    this.obtenerCredenciales(); // Recargar la tabla
  }

  esCredencialAnam(persona: any): boolean {
    if (!persona) return false;
    if (Number(persona?.nuevo_laredo || 0) === 1) return false;
    return true;
  }

  private async precargarFuenteCredencial(): Promise<void> {
    const docWithFonts = document as Document & { fonts?: FontFaceSet };
    if (!docWithFonts.fonts?.load) {
      return;
    }

    try {
      await Promise.all([
        docWithFonts.fonts.load("900 24px 'NotoSans-Black'"),
        docWithFonts.fonts.load("700 24px 'NotoSans-Black'")
      ]);
    } catch {
    }
  }

  private async esperarFuentesYRender(delayMs: number = 650): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await this.precargarFuenteCredencial();
    const docWithFonts = document as Document & { fonts?: { ready: Promise<unknown> } };
    if (docWithFonts.fonts?.ready) {
      try {
        await docWithFonts.fonts.ready;
      } catch {
      }
    }
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
  }

  private obtenerSelectorPlantillaImpresion(persona: any): string {
    return this.esCredencialAnam(persona) ? 'app-plantilla-anam' : 'app-plantilla-enrolamiento';
  }

  private async capturarCredencialRecortada(
    printRoot: HTMLElement,
    selectorPlantilla: string,
    selectorCredencial: '.credencial-frente' | '.credencial-reverso',
    options: any
  ): Promise<HTMLCanvasElement> {
    const host = printRoot?.querySelector(`${selectorPlantilla} .anam-template, ${selectorPlantilla} .container`) as HTMLElement | null;
    const target = printRoot?.querySelector(`${selectorPlantilla} ${selectorCredencial}`) as HTMLElement | null;

    if (!host || !target) {
      throw new Error(`No se encontró el nodo para captura: ${selectorCredencial}`);
    }

    const hostRect = host.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const canvasHost = await htmlToImage.toCanvas(host, options);

    const scaleX = canvasHost.width / Math.max(hostRect.width, 1);
    const scaleY = canvasHost.height / Math.max(hostRect.height, 1);

    const sx = Math.max(0, Math.round((targetRect.left - hostRect.left) * scaleX));
    const sy = Math.max(0, Math.round((targetRect.top - hostRect.top) * scaleY));
    const sw = Math.min(canvasHost.width - sx, Math.round(targetRect.width * scaleX));
    const sh = Math.min(canvasHost.height - sy, Math.round(targetRect.height * scaleY));

    const out = document.createElement('canvas');
    out.width = Math.max(sw, 1);
    out.height = Math.max(sh, 1);
    const outCtx = out.getContext('2d');
    if (!outCtx) return canvasHost;

    outCtx.drawImage(canvasHost, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out;
  }

  async imprimirCredencial(persona: any) {
    if (!persona.num_empleado) {
      this.utils.MuestrasToast(TipoToast.Warning, 'No se puede imprimir: Falta número de empleado.');
      return;
    }

    this.utils.MuestrasToast(TipoToast.Info, 'Generando PDF');
    let personaImprimir = { ...persona };
    if (persona?.id_enrolamiento) {
      try {
        const actual = await firstValueFrom(this.enrolamientoService.obtenerExpedientePorId(persona.id_enrolamiento));
        personaImprimir = {
          ...persona,
          ...actual,
          source_table: 'enrolamiento',
          tipo_credencial: 'anam',
        };
      } catch {
      }
    }
    if (this.esCredencialAnam(personaImprimir)) {
      if (!personaImprimir.nivel_credencial && personaImprimir.puesto) {
        personaImprimir.nivel_credencial = cargoANivel(personaImprimir.puesto);
      }
      if (!personaImprimir.layout_credencial) {
        personaImprimir.layout_credencial = personaImprimir.nivel_credencial ? 'ANAM_2025' : 'ANAM_CLASICA';
      }
    }
    this.empleadoImprimir = personaImprimir;
    
    // Esperamos a que Angular renderice
    setTimeout(async () => {
        try {
            // Dimensiones del PDF: 5.4 x 8.6 mm (tamaño credencial CR80)
            const pdfWidth = 54.0;
            const pdfHeight = 86.0;
            const pdf = new jsPDF('p', 'mm', [pdfWidth, pdfHeight]); 

            // ⚙️ AJUSTE MANUAL - Modifica estos valores para ajustar el tamaño de la imagen
            const imgWidth = pdfWidth;        // Ancho de la imagen (mismo que PDF)
            const imgHeight = 86.0;           //  AJUSTA ESTE VALOR para hacer la imagen más baja o más alta
                                              // Valores sugeridos: 78-82 mm
                                              // Mientras más bajo, más comprimida verticalmente
            
            // Centramos la imagen en el PDF
            const xOffset = (pdfWidth - imgWidth) / 2;
            const yOffset = (pdfHeight - imgHeight) / 2;

            // Opciones optimizadas para html2canvas
            const options = {
              pixelRatio: 2,
              backgroundColor: '#ffffff'
            };

            // --- FRENTE ---
            const usarPlantillaAnam = this.esCredencialAnam(personaImprimir);
            const plantillaActiva: any = usarPlantillaAnam ? this.plantillaImprimirAnam : this.plantillaImprimir;
            const selectorPlantilla = this.obtenerSelectorPlantillaImpresion(personaImprimir);
            const printRoot = this.printContainer?.nativeElement as HTMLElement;

            if (plantillaActiva) {
              plantillaActiva.vistaCredencial = 'frente';
                await this.esperarFuentesYRender(700);
                
                const element = printRoot?.querySelector(`${selectorPlantilla} .credencial-frente`) as HTMLElement | null;
                if (!element) {
                  throw new Error('No se encontró el frente de la plantilla para impresión');
                }
                const imgDataFront = await htmlToImage.toPng(element, options); 
                
                pdf.addImage(imgDataFront, 'PNG', xOffset, yOffset, imgWidth, imgHeight, '', 'FAST');
            }

            // --- REVERSO ---
            if (plantillaActiva) {
              plantillaActiva.vistaCredencial = 'reverso';
                await this.esperarFuentesYRender(700);

                const elementReverso = printRoot?.querySelector(`${selectorPlantilla} .credencial-reverso`) as HTMLElement | null;
                if (!elementReverso) {
                  throw new Error('No se encontró el reverso de la plantilla para impresión');
                }
                const imgDataBack = await htmlToImage.toPng(elementReverso, options);
                
                pdf.addPage();
                pdf.addImage(imgDataBack, 'PNG', xOffset, yOffset, imgWidth, imgHeight, '', 'FAST');
            }

            pdf.save(`Constancia_${persona.num_empleado}.pdf`);
            this.utils.MuestrasToast(TipoToast.Success, 'PDF generado correctamente');

            // Marcar como impreso en el backend y actualizar tabla
            if (persona.id_enrolamiento) {
              const marcar$ = persona.source_table === 'familiar'
                ? this.enrolamientoService.marcarComoImpresoFamiliar(persona.id_enrolamiento, persona.fecha_expedicion)
                : this.enrolamientoService.marcarComoImpreso(persona.id_enrolamiento, persona.fecha_expedicion);

              marcar$.subscribe({
                next: () => {
                  this.obtenerCredenciales();
                },
                error: (err) => {
                  console.error('Error al marcar como impreso:', err);
                }
              });
            }

        } catch (error) {
            console.error('Error:', error);
            this.utils.MuestrasToast(TipoToast.Error, 'Error al generar PDF');
        } finally {
            this.empleadoImprimir = null;
        }
    }, 800);
  }
}
