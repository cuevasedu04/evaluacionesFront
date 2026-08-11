// Tipos para meshline dentro de JSX (Lanyard.tsx): la libreria no trae sus
// propios .d.ts, y extend({MeshLineGeometry, MeshLineMaterial}) registra
// elementos JSX que TypeScript no puede inferir solo. Los dos usos de
// <meshLineGeometry>/<meshLineMaterial> en Lanyard.tsx llevan
// @ts-expect-error en vez de depender de una fusion de JSX.IntrinsicElements
// aqui: con "jsx": "react-jsx" y @types/react 19, declarar
// `declare module 'react' { namespace JSX {...} } }` en un .d.ts aparte
// rompe (no fusiona) los exports reales del modulo 'react'.
