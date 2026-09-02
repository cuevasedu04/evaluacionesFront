export interface NivelCredencial {
  valor: string;
  label: string;
  color: string;       // color del tab lateral (se actualizará con imágenes reales)
  imagenFrente: string;
  imagenReverso: string;
}

export interface LayoutCredencial {
  valor: string;
  label: string;
}

export const LAYOUTS_CREDENCIAL: LayoutCredencial[] = [
  {
    valor: 'ANAM_2025',
    label: 'Constancia ANAM nueva',
  },
  {
    valor: 'ANAM_CLASICA',
    label: 'Constancia ANAM roja',
  },
  {
    valor: 'NUEVO_LAREDO',
    label: 'Constancia Nuevo Laredo',
  },
  {
    valor: 'FAMILIAR',
    label: 'Constancia Familiar',
  },
];

export const NIVELES_CREDENCIAL: NivelCredencial[] = [
  {
    valor: 'TITULAR',
    label: 'Titular',
    color: '#C9A84C',
    imagenFrente: 'img/credencial_titular_frente.png',
    imagenReverso: 'img/credencial_titular_reverso.png',
  },
  {
    valor: 'DIRECTOR_GENERAL',
    label: 'Director General',
    color: '#B8860B',
    imagenFrente: 'img/credencial_director_general_frente.png',
    imagenReverso: 'img/credencial_director_general_reverso.png',
  },
  {
    valor: 'DIRECTOR_CENTRAL',
    label: 'Director Central',
    color: '#7A5C00',
    imagenFrente: 'img/credencial_director_central_frente.png',
    imagenReverso: 'img/credencial_director_central_reverso.png',
  },
  {
    valor: 'DIRECTOR_DE_AREA',
    label: 'Director de Área',
    color: '#2E5DAA',
    imagenFrente: 'img/credencial_director_area_frente.png',
    imagenReverso: 'img/credencial_director_area_reverso.png',
  },
  {
    valor: 'SUBDIRECTOR',
    label: 'Subdirector',
    color: '#1A7A4A',
    imagenFrente: 'img/credencial_subdirector_frente.png',
    imagenReverso: 'img/credencial_subdirector_reverso.png',
  },
  {
    valor: 'JEFE_DE_DEPARTAMENTO',
    label: 'Jefe de Departamento',
    color: '#7B3F8C',
    imagenFrente: 'img/credencial_jefe_departamento_frente.png',
    imagenReverso: 'img/credencial_jefe_departamento_reverso.png',
  },
  {
    valor: 'ENLACE',
    label: 'Enlace',
    color: '#C0392B',
    imagenFrente: 'img/credencial_enlace_frente.png',
    imagenReverso: 'img/credencial_enlace_reverso.png',
  },
  {
    valor: 'SEGURIDAD_INSTITUCIONAL',
    label: 'Seguridad Institucional',
    color: '#5D6D7E',
    imagenFrente: 'img/credencial_seguridad_frente.png',
    imagenReverso: 'img/credencial_seguridad_reverso.png',
  },
];

/** Imagen de respaldo si la del nivel no existe aún */
export const IMAGEN_FRENTE_FALLBACK = 'img/frontal_credencial.png';
export const IMAGEN_REVERSO_FALLBACK = 'img/reverso.jpg';

export function getLayoutCredencial(layout: string | null | undefined): string {
  const valor = String(layout || '').toUpperCase();
  if (valor === 'ANAM_2025') return 'ANAM_2025';
  if (valor === 'ANAM_CLASICA') return 'ANAM_CLASICA';
  if (valor === 'NUEVO_LAREDO') return 'NUEVO_LAREDO';
  if (valor === 'FAMILIAR') return 'FAMILIAR';
  return 'ANAM_2025';
}

/** Devuelve el NivelCredencial para un valor dado, o ENLACE por defecto */
export function getNivel(valor: string | null | undefined): NivelCredencial {
  return (
    NIVELES_CREDENCIAL.find(n => n.valor === valor) ?? NIVELES_CREDENCIAL.find(n => n.valor === 'ENLACE')!
  );
}

/**
 * Mapea el campo CARGO/PUESTO del SIG al nivel_credencial correspondiente.
 * Mismo criterio que _cargo_a_nivel() en el backend (views.py).
 */
export function cargoANivel(cargo: string | null | undefined): string {
  if (!cargo) return 'ENLACE';
  const c = cargo.trim().toUpperCase();

  if (c.includes('DIRECTOR GENERAL') || c.includes('ADMINISTRADOR GENERAL') || c.includes('TITULAR')) return 'TITULAR';
  if (c.includes('DIRECTOR CENTRAL')) return 'DIRECTOR_CENTRAL';
  if (c.startsWith('DIRECTOR DE AREA') || c.startsWith('DIRECTOR DE ÁREA')) return 'DIRECTOR_DE_AREA';
  if (c.startsWith('DIRECTOR')) return 'DIRECTOR_DE_AREA';
  if (c.includes('SUBDIRECTOR')) return 'SUBDIRECTOR';
  if (c.includes('JEFE DE DEPARTAMENTO') || c.includes('JEFE DEL DEPARTAMENTO')) return 'JEFE_DE_DEPARTAMENTO';
  if (c.includes('ENLACE')) return 'ENLACE';
  if (c.includes('OPERATIVO') || c.includes('SEGURIDAD INSTITUCIONAL')) return 'SEGURIDAD_INSTITUCIONAL';
  return 'ENLACE';
}
