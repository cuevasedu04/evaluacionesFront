/* eslint-disable react/no-unknown-property */
// Basado en el componente "Lanyard" de React Bits (reactbits.dev/components/lanyard),
// pero SIN cordon: en vez de colgar de una cuerda simulada con joints, la
// constancia flota en su lugar con gravedad baja -- una fuerza tipo resorte
// la jala de vuelta hacia un punto de reposo que se mece con dos senoidales
// (X/Y desfasadas), simulando el vaiven de un objeto en gravedad reducida en
// vez de dejarla caer o alejarse. Sigue usando Rapier (no una animacion CSS)
// para conservar la fisica real: si la arrastras con el mouse y la sueltas,
// vuelve flotando con inercia, no de un salto.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier';

import * as THREE from 'three';
import './Lanyard.css';

const CARD_GLB_URL = '/assets/lanyard/card.glb';

// 1x1 transparent pixel — lets useTexture be called unconditionally when a
// front/back image isn't supplied.
const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// The card model's front face is UV-mapped to the LEFT half of the texture
// atlas and the back face to the RIGHT half (measured from card.glb). Each
// custom image is composited into its own half so the two faces render
// independently, aspect-preserving (no stretching).
const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 1 };
const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 1 };

// Donde flota la constancia a lo ancho del lienzo: 0 = orilla izquierda,
// 0.5 = centro, 1 = orilla derecha. El lienzo cubre TODO el dashboard y el
// contenido vive en una columna que ocupa el 62% izquierdo (ver
// dashboard.component.scss), asi que la tarjeta se manda al centro exacto
// de la franja libre que queda a la derecha: (0.62 + 1) / 2 = 0.81.
const ANCLA_FRACCION_X = 0.81;

export default function Lanyard({
  position = [0, 0, 30],
  gravity = [0, -1.5, 0],
  fov = 20,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  aspect
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  fov?: number;
  transparent?: boolean;
  frontImage?: string | null;
  backImage?: string | null;
  imageFit?: 'cover' | 'contain';
  /** ancho_mm / alto_mm de la plantilla activa -- ver ConstanciaFlotante, reforma la silueta de la tarjeta (vertical u horizontal) sin cambiar el modelo 3D. undefined = silueta nativa del .glb (vertical). */
  aspect?: number;
}) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="lanyard-wrapper">
      <Canvas
        camera={{ position: position, fov: fov }}
        dpr={[1, isMobile ? 1.5 : 2]}
        gl={{ alpha: transparent }}
        onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)}
      >
        <ambientLight intensity={Math.PI} />
        <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
          <ConstanciaFlotante
            isMobile={isMobile}
            frontImage={frontImage}
            backImage={backImage}
            imageFit={imageFit}
            aspect={aspect}
          />
        </Physics>
        <Environment blur={0.75}>
          <Lightformer
            intensity={2}
            color="white"
            position={[0, -1, 5]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[-1, -1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={3}
            color="white"
            position={[1, 1, 1]}
            rotation={[0, 0, Math.PI / 3]}
            scale={[100, 0.1, 1]}
          />
          <Lightformer
            intensity={10}
            color="white"
            position={[-10, 0, 14]}
            rotation={[0, Math.PI / 2, Math.PI / 3]}
            scale={[100, 10, 1]}
          />
        </Environment>
      </Canvas>
    </div>
  );
}

// Punto de reposo alrededor del cual flota la tarjeta (mundo, no pantalla).
// y=0 centra verticalmente el vaiven en el lienzo (antes, colgada de la
// cuerda, el ancla vivia en y=4 y la tarjeta quedaba mas abajo por el largo
// de la cuerda -- sin cuerda, el reposo es directo donde se ve la tarjeta).
const REPOSO_Y = 0;

// Media (medio-ancho, medio-alto) del modelo .glb tal como viene autorado --
// medida del CuboidCollider original de React Bits, vertical tipo CR80.
const NATIVE_HALF_W = 0.8;
const NATIVE_HALF_H = 1.125;
const NATIVE_RATIO = NATIVE_HALF_W / NATIVE_HALF_H;

// Escala visual de la tarjeta (aplicada al group, no al collider -- ver
// ConstanciaFlotante). Era 2.25 (tamaño del demo original de React Bits,
// pensado para una tarjeta chica colgando de un cordon); se sube para que
// la constancia, ahora sin cordon y protagonista del dashboard, se lea bien
// a distancia.
const ESCALA_VISUAL = 3.1;

/**
 * Factor de escala X/Y para que la SILUETA 3D (no la textura -- esa ya se
 * compone aparte con el aspecto real de cada imagen, ver cardMap) pase
 * de vertical a horizontal cuando la plantilla activa lo es (ancho_mm >
 * alto_mm). No hay un segundo modelo .glb horizontal: en vez de eso se
 * estira/encoge el mismo mesh de forma no uniforme hacia el aspecto real de
 * la plantilla, conservando el area (sqrt(target/nativo) en un eje, el
 * inverso en el otro) para que no se vea ni gigante ni diminuta al rotar.
 */
function factoresAspecto(aspect?: number): { x: number; y: number } {
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return { x: 1, y: 1 };
  const x = Math.sqrt(aspect / NATIVE_RATIO);
  const y = Math.sqrt(NATIVE_RATIO / aspect);
  return { x, y };
}

function ConstanciaFlotante({
  isMobile = false,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  aspect
}: {
  isMobile?: boolean;
  frontImage?: string | null;
  backImage?: string | null;
  imageFit?: 'cover' | 'contain';
  aspect?: number;
}) {
  const card = useRef<any>(null);
  const { x: escalaX, y: escalaY } = useMemo(() => factoresAspecto(aspect), [aspect]);
  const vec = new THREE.Vector3(),
    dir = new THREE.Vector3(),
    objetivo = new THREE.Vector3(),
    fuerza = new THREE.Vector3();

  // Ancho visible en unidades de mundo al plano z=0, igual tecnica que la
  // version con cuerda: se congela con useState en el primer render porque
  // el RigidBody toma su transform del mundo al crearse.
  const anchoVisible = useThree(estado => estado.viewport.width);
  const [anclaX] = useState(() =>
    Number.isFinite(anchoVisible) && anchoVisible > 0 ? (ANCLA_FRACCION_X - 0.5) * anchoVisible : 3.2
  );

  const { nodes, materials } = useGLTF(CARD_GLB_URL) as any;
  // useTexture must be called unconditionally; use a blank pixel when an image
  // isn't supplied for a given face, then skip compositing it below.
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);

  // Composite the front/back images into the card's texture atlas (front = left
  // half, back = right half). Each image is drawn aspect-preserving (no stretch).
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map;
    const baseImg = baseMap.image;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseMap;
    // NO se conserva el atlas horneado del modelo (baseImg) como fondo: trae
    // el logo/marca de React Bits impresa en ambas mitades. Rellenar en
    // blanco garantiza que no quede ningun rastro de esa marca.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    const drawFitted = (img: any, rect: { x: number; y: number; w: number; h: number }) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === 'contain' ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    };

    // Si falta una de las dos caras, se usa la otra para ambas -- mejor
    // repetir el mismo diseño real que dejar a la vista el arte de fabrica
    // del modelo (logo/marca de React Bits) en una constancia de la ANAM.
    const imgFrente = (frontImage && frontTex.image) || (backImage && backTex.image);
    const imgReverso = (backImage && backTex.image) || (frontImage && frontTex.image);
    if (imgFrente) drawFitted(imgFrente, FRONT_UV_RECT);
    if (imgReverso) drawFitted(imgReverso, BACK_UV_RECT);

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [frontImage, backImage, imageFit, frontTex, backTex, materials.base.map]);

  const [dragged, drag] = useState<any>(false);
  const [hovered, hover] = useState(false);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab';
      return () => void (document.body.style.cursor = 'auto');
    }
    return undefined;
  }, [hovered, dragged]);

  useFrame((state, delta) => {
    if (!card.current) return;

    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      card.current.wakeUp();
      card.current.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
      return;
    }

    // Vaiven organico: dos senoidales de periodo distinto por eje, para que
    // no se sienta como un loop mecanico. Amplitud pequena a proposito -- es
    // "flotando en su lugar", no rebotando.
    const t = state.clock.elapsedTime;
    objetivo.set(
      anclaX + Math.sin(t * 0.55) * 0.18,
      REPOSO_Y + Math.sin(t * 0.4 + 1.3) * 0.22,
      Math.sin(t * 0.35 + 0.6) * 0.12
    );

    // Resorte suave hacia el objetivo que se mece: el amortiguamiento del
    // propio RigidBody (linearDamping) evita que oscile sin control, asi
    // que basta con una fuerza proporcional al desplazamiento -- gravedad
    // baja (ver prop `gravity`) sigue tirando hacia abajo, el resorte la
    // compensa sin dejarla caer.
    const pos = card.current.translation();
    fuerza.set(objetivo.x - pos.x, objetivo.y - pos.y, objetivo.z - pos.z).multiplyScalar(2.2);
    card.current.applyImpulse({ x: fuerza.x * delta, y: fuerza.y * delta, z: fuerza.z * delta }, true);

    // Giro lento y constante, como un objeto a la deriva en gravedad
    // reducida -- no una fisica de colision real, solo un barrido de angvel.
    card.current.setAngvel({ x: 0, y: 0.12, z: 0 }, true);
  });

  return (
    <RigidBody
      ref={card}
      position={[anclaX, REPOSO_Y, 0]}
      type={dragged ? 'kinematicPosition' : 'dynamic'}
      canSleep={false}
      angularDamping={4}
      linearDamping={2.2}
    >
      <CuboidCollider args={[NATIVE_HALF_W * escalaX, NATIVE_HALF_H * escalaY, 0.01]} />
      <group
        scale={[ESCALA_VISUAL * escalaX, ESCALA_VISUAL * escalaY, ESCALA_VISUAL]}
        onPointerOver={() => hover(true)}
        onPointerOut={() => hover(false)}
        onPointerUp={(e: any) => (e.target.releasePointerCapture(e.pointerId), drag(false))}
        onPointerDown={(e: any) => (
          e.target.setPointerCapture(e.pointerId),
          drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation())))
        )}
      >
        <mesh geometry={nodes.card.geometry}>
          <meshPhysicalMaterial
            map={cardMap}
            map-anisotropy={16}
            clearcoat={isMobile ? 0 : 1}
            clearcoatRoughness={0.15}
            roughness={0.9}
            metalness={0.8}
          />
        </mesh>
      </group>
    </RigidBody>
  );
}
