"use client";

// The GD Arena in WebGL: a glossy round table on a floating platform, with the moderator at the
// head and the participants around it. Each participant is a little 3D figure with their emoji
// as a face and a name badge; the speaker bobs and sends out sound rings under a light in
// their colour, whoever is about to speak shows thinking dots, a speaker who was cut off
// shakes under a red flash, and reactions float up as emoji. Purely visual: the page keeps an
// accessible version of the same information (see ArenaSlot's callers).
//
// Loaded on demand (three.js is large) and only where WebGL works and motion is welcome.

import { ContactShadows, Html, Sparkles } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { SpeakerId } from "@/lib/types";

export interface ArenaSeat {
  id: SpeakerId;
  name: string;
  /** A second line under the name, e.g. "2 turns · 34s". */
  detail?: string | null;
  emoji: string;
  color: string;
}

export interface ArenaReaction {
  emoji: string;
  /** Unique per reaction, so the same emoji twice still animates twice. */
  key: string;
}

export interface ArenaProps {
  /** Seats clockwise from the head of the table (the far side). */
  seats: readonly ArenaSeat[];
  speaking: SpeakerId | null;
  preparing?: SpeakerId | null;
  cutOff?: ReadonlySet<SpeakerId>;
  reactions?: ReadonlyMap<SpeakerId, ArenaReaction>;
  /** The candidate's live mic level (0..1) while they speak; null when there is none. */
  level?: number | null;
  /** The line floating over the middle of the table. */
  caption: string;
  captionDetail?: string | null;
  captionColor?: string;
  /** Turn the whole table slowly (the home screen); otherwise it only sways. */
  orbit?: boolean;
  /** Show each seat's detail line (only drawn when the canvas is wide enough). */
  details?: boolean;
  onReady?(): void;
  className?: string;
}

const SEAT_RADIUS = 2.15;
const PLATFORM_RADIUS = 3;
const TABLE_RADIUS = 1.42;
const TABLE_TOP = 0.55;
const REACTION_SECONDS = 2.4;
const CUT_SECONDS = 0.9;

interface ThemeColors {
  accent: string;
  accent2: string;
  panel: string;
  dark: boolean;
}

function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read("--accent", "#4f46e5"),
    accent2: read("--accent-2", "#9333ea"),
    panel: read("--panel", "#ffffff"),
    dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  };
}

/** The page's theme colours, following a light/dark switch. */
function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState(readThemeColors);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setColors(readThemeColors());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return colors;
}

function mix(a: string, b: string, amount: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), amount);
}

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/** A round token with the emoji on it, in the participant's colour: the figure's face. */
function drawToken(emoji: string, color: string, dark: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const base = mix(color, dark ? "#151820" : "#ffffff", dark ? 0.55 : 0.7);
  const shine = base.clone().lerp(new THREE.Color("#ffffff"), 0.45);
  const gradient = ctx.createRadialGradient(92, 80, 8, 128, 128, 122);
  gradient.addColorStop(0, `#${shine.getHexString()}`);
  gradient.addColorStop(1, `#${base.getHexString()}`);
  ctx.beginPath();
  ctx.arc(128, 128, 116, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.font = `128px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 128, 140);
  return canvas;
}

/** An emoji in a white bubble, for reactions. */
function drawBubble(emoji: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `72px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 70);
  return canvas;
}

/** A texture drawn by `draw`, rebuilt when `key` changes and released when unused. */
function useCanvasTexture(key: string, draw: () => HTMLCanvasElement): THREE.CanvasTexture {
  const texture = useMemo(
    () => {
      const result = new THREE.CanvasTexture(draw());
      result.colorSpace = THREE.SRGBColorSpace;
      result.anisotropy = 4;
      return result;
    },
    // `key` names everything `draw` reads, so a fresh `draw` each render needs no new texture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function seatPosition(index: number, count: number): [number, number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return [Math.cos(angle) * SEAT_RADIUS, 0, Math.sin(angle) * SEAT_RADIUS];
}

/** The arena's outline: the platform's rim and the tops of the figures' heads. */
const OUTLINE: readonly THREE.Vector3[] = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2;
  return [
    new THREE.Vector3(Math.cos(angle) * PLATFORM_RADIUS, 0, Math.sin(angle) * PLATFORM_RADIUS),
    new THREE.Vector3(Math.cos(angle) * SEAT_RADIUS, 1.4, Math.sin(angle) * SEAT_RADIUS),
  ];
}).flat();
/** How much of the canvas the outline may fill (room for the sway and the labels). */
const FIT_MARGIN = 0.88;
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(30);

/**
 * Places the camera so the whole arena fills the canvas, whatever its shape: the outline is
 * projected and the distance found by bisection, then the view is re-centred vertically.
 */
function CameraFit() {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  useEffect(() => {
    const point = new THREE.Vector3();
    const place = (distance: number, targetY: number) => {
      camera.position.set(0, targetY + Math.sin(CAMERA_ELEVATION) * distance, Math.cos(CAMERA_ELEVATION) * distance);
      camera.lookAt(0, targetY, 0);
      camera.updateMatrixWorld();
    };
    const bounds = () => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const corner of OUTLINE) {
        point.copy(corner).project(camera);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      return { minX, maxX, minY, maxY };
    };
    // React Three Fiber has already matched the camera's aspect to the canvas.
    let targetY = 0.6;
    let distance = 8;
    for (let pass = 0; pass < 3; pass++) {
      let near = 2;
      let far = 40;
      for (let step = 0; step < 24; step++) {
        distance = (near + far) / 2;
        place(distance, targetY);
        const b = bounds();
        const fits = b.minX >= -FIT_MARGIN && b.maxX <= FIT_MARGIN && b.minY >= -FIT_MARGIN && b.maxY <= FIT_MARGIN;
        if (fits) far = distance;
        else near = distance;
      }
      distance = far;
      place(distance, targetY);
      const b = bounds();
      // Shift the view so the outline sits in the middle, then fit again.
      targetY += ((b.maxY + b.minY) / 2) * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    }
    place(distance, targetY);
  }, [camera, width, height]);
  return null;
}

/** Html labels keep a steady size relative to the canvas (smaller on a phone's narrow stage). */
function useLabelScale(): number {
  const width = useThree((state) => state.size.width);
  return 5.4 * THREE.MathUtils.clamp(width / 520, 0.8, 1);
}

/** Turns the arena: a slow orbit or a gentle sway, plus a lean towards the pointer. */
function Rig({ orbit, children }: { orbit: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef(0);
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    spin.current += orbit ? delta * 0.16 : 0;
    const base = orbit ? spin.current : Math.sin(t * 0.35) * 0.09;
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, base + state.pointer.x * 0.35, 4, delta);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -state.pointer.y * 0.07, 4, delta);
  });
  return <group ref={group}>{children}</group>;
}

function Platform({ colors }: { colors: ThemeColors }) {
  const floor = mix(colors.panel, colors.accent, colors.dark ? 0.18 : 0.1);
  return (
    <group>
      <mesh position-y={-0.04}>
        <cylinderGeometry args={[PLATFORM_RADIUS, PLATFORM_RADIUS + 0.05, 0.08, 96]} />
        <meshStandardMaterial color={floor} roughness={0.85} transparent opacity={colors.dark ? 0.75 : 0.6} />
      </mesh>
      <mesh position-y={0.002} rotation-x={Math.PI / 2}>
        <torusGeometry args={[PLATFORM_RADIUS + 0.01, 0.018, 8, 160]} />
        <meshBasicMaterial color={colors.accent2} transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Table({ colors }: { colors: ThemeColors }) {
  const top = mix(colors.panel, colors.accent, colors.dark ? 0.35 : 0.22);
  const edge = mix(colors.accent, "#000000", 0.45);
  return (
    <group>
      <mesh position-y={TABLE_TOP - 0.05}>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.1, 72]} />
        <meshPhysicalMaterial color={top} roughness={0.25} metalness={0.05} clearcoat={1} clearcoatRoughness={0.12} />
      </mesh>
      <mesh position-y={TABLE_TOP - 0.12}>
        <cylinderGeometry args={[TABLE_RADIUS - 0.04, TABLE_RADIUS - 0.14, 0.06, 72]} />
        <meshStandardMaterial color={edge} roughness={0.5} />
      </mesh>
      {/* A glowing rim and a ring in the middle of the table. */}
      <mesh position-y={TABLE_TOP + 0.005} rotation-x={Math.PI / 2}>
        <torusGeometry args={[TABLE_RADIUS, 0.022, 10, 140]} />
        <meshBasicMaterial color={colors.accent} toneMapped={false} />
      </mesh>
      <mesh position-y={TABLE_TOP + 0.004} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.3, 0.34, 64]} />
        <meshBasicMaterial color={colors.accent2} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <mesh position-y={0.25}>
        <cylinderGeometry args={[0.16, 0.26, 0.5, 32]} />
        <meshStandardMaterial color={edge} roughness={0.6} />
      </mesh>
      <mesh position-y={0.02}>
        <cylinderGeometry args={[0.55, 0.62, 0.04, 48]} />
        <meshStandardMaterial color={edge} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** A light in the speaker's colour that glides to whoever has the floor. */
function SpeakerLight({ target, color }: { target: [number, number, number] | null; color: string }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame((_, delta) => {
    const l = light.current;
    if (!l) return;
    if (target) {
      l.position.x = THREE.MathUtils.damp(l.position.x, target[0] * 0.8, 5, delta);
      l.position.z = THREE.MathUtils.damp(l.position.z, target[2] * 0.8, 5, delta);
    }
    l.intensity = THREE.MathUtils.damp(l.intensity, target ? 9 : 0, 4, delta);
  });
  return <pointLight ref={light} position={[0, 1.7, 0]} color={color} intensity={0} distance={4.5} decay={2} />;
}

interface FigureProps {
  seat: ArenaSeat;
  position: [number, number, number];
  speaking: boolean;
  preparing: boolean;
  cutOff: boolean;
  reaction: ArenaReaction | null;
  level: number | null;
  details: boolean;
  dark: boolean;
}

/** One participant: body, emoji face, name badge, and the animations of their state. */
function Figure({ seat, position, speaking, preparing, cutOff, reaction, level, details, dark }: FigureProps) {
  const body = useRef<THREE.Group>(null);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const dots = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const bubble = useRef<THREE.Sprite>(null);
  // When the current reaction / cut-off started, in clock seconds; -1 = start on the next frame.
  const reactionStart = useRef<number | null>(null);
  const cutStart = useRef<number | null>(null);

  const wide = useThree((state) => state.size.width) >= 560;
  const labelScale = useLabelScale();
  const face = useCanvasTexture(`${seat.emoji}|${seat.color}|${dark}`, () => drawToken(seat.emoji, seat.color, dark));
  const bubbleTexture = useCanvasTexture(reaction?.emoji ?? "", () => drawBubble(reaction?.emoji ?? ""));

  useEffect(() => {
    reactionStart.current = reaction ? -1 : null;
  }, [reaction?.key]); // eslint-disable-line react-hooks/exhaustive-deps -- restart per reaction
  useEffect(() => {
    if (cutOff) cutStart.current = -1;
  }, [cutOff]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const g = body.current;
    if (!g) return;

    // Speaking: a lively bob and a slightly bigger figure (with the mic, following the voice).
    const voice = level ?? 0.6;
    const bob = speaking ? Math.abs(Math.sin(t * 7)) * 0.05 * (0.5 + voice) : 0;
    g.position.y = THREE.MathUtils.damp(g.position.y, bob, 12, delta);
    const scale = THREE.MathUtils.damp(g.scale.x, speaking ? 1.12 : 1, 8, delta);
    g.scale.setScalar(scale);

    // Cut off: a short shake under a red flash.
    if (cutStart.current === -1) cutStart.current = t;
    const cutAge = cutStart.current === null ? Infinity : t - cutStart.current;
    g.position.x = cutAge < CUT_SECONDS ? Math.sin(t * 55) * 0.035 * (1 - cutAge / CUT_SECONDS) : 0;
    if (flash.current) {
      const material = flash.current.material as THREE.MeshBasicMaterial;
      material.opacity = cutAge < CUT_SECONDS ? 0.7 * (1 - cutAge / CUT_SECONDS) : 0;
      flash.current.visible = material.opacity > 0.01;
    }

    // Sound rings spreading out from the speaker's feet.
    rings.current.forEach((ring, index) => {
      if (!ring) return;
      const phase = (t * 0.9 + index / 3) % 1;
      ring.scale.setScalar(0.6 + phase * 1.5);
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity = speaking ? (1 - phase) * 0.55 * (0.45 + voice) : 0;
      ring.visible = material.opacity > 0.01;
    });

    // Thinking dots above the head of whoever is about to speak.
    if (dots.current) {
      dots.current.visible = preparing;
      dots.current.children.forEach((dot, index) => {
        dot.position.y = Math.max(0, Math.sin(t * 6 - index * 0.7)) * 0.07;
      });
    }

    // A reaction pops up, rises and fades.
    const sprite = bubble.current;
    if (sprite) {
      if (reactionStart.current === -1) reactionStart.current = t;
      const age = reactionStart.current === null ? Infinity : (t - reactionStart.current) / REACTION_SECONDS;
      sprite.visible = age < 1;
      if (age < 1) {
        const appear = Math.min(1, age / 0.15);
        sprite.position.y = 1.35 + age * 0.55;
        sprite.scale.setScalar(0.34 * (0.5 + appear * 0.5));
        (sprite.material as THREE.SpriteMaterial).opacity = age < 0.15 ? appear : 1 - (age - 0.15) / 0.85;
      }
    }
  });

  return (
    <group position={position}>
      {/* The seat's ring on the floor, brighter for the speaker. */}
      <mesh position-y={0.006} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.3, 0.37, 48]} />
        <meshBasicMaterial color={seat.color} transparent opacity={speaking ? 0.9 : 0.35} toneMapped={false} />
      </mesh>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            rings.current[index] = mesh;
          }}
          position-y={0.01}
          rotation-x={-Math.PI / 2}
          visible={false}
        >
          <ringGeometry args={[0.32, 0.36, 48]} />
          <meshBasicMaterial color={seat.color} transparent opacity={0} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={flash} position-y={0.012} rotation-x={-Math.PI / 2} visible={false}>
        <circleGeometry args={[0.55, 48]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>

      <group ref={body}>
        <mesh position-y={0.42}>
          <capsuleGeometry args={[0.2, 0.3, 8, 24]} />
          <meshStandardMaterial color={seat.color} roughness={0.42} metalness={0.06} />
        </mesh>
        <sprite position-y={0.98} scale={0.5}>
          <spriteMaterial map={face} transparent depthWrite={false} />
        </sprite>
        <group ref={dots} position-y={1.3} visible={false}>
          {[-0.11, 0, 0.11].map((x) => (
            <mesh key={x} position-x={x}>
              <sphereGeometry args={[0.04, 16, 16]} />
              <meshBasicMaterial color={seat.color} toneMapped={false} />
            </mesh>
          ))}
        </group>
        <Html position={[0, 0.48, 0]} center distanceFactor={labelScale} zIndexRange={[4, 0]} pointerEvents="none">
          <div
            className="flex flex-col items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-center shadow-card"
            style={{
              borderColor: speaking ? seat.color : "var(--line)",
              background: speaking ? `color-mix(in srgb, ${seat.color} 22%, var(--panel))` : "var(--panel)",
            }}
          >
            <span className="text-[12px] font-semibold leading-tight text-ink">{seat.name}</span>
            {details && wide && seat.detail && (
              <span className="text-[10px] leading-tight tabular-nums text-ink-2">{seat.detail}</span>
            )}
          </div>
          {cutOff && (
            <span className="mt-1 block rounded-full bg-bad px-1.5 py-0.5 text-center text-[10px] font-bold text-panel">
              Cut off
            </span>
          )}
        </Html>
      </group>

      <sprite ref={bubble} position-y={1.35} scale={0.34} visible={false}>
        <spriteMaterial map={bubbleTexture} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

function Caption({ text, detail, color }: { text: string; detail?: string | null; color?: string }) {
  const labelScale = useLabelScale();
  return (
    <Html position={[0, 0.85, 0.25]} center distanceFactor={labelScale} zIndexRange={[6, 0]} pointerEvents="none">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 8, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.92 }}
          className="flex flex-col items-center whitespace-nowrap rounded-2xl border border-line bg-panel/90 px-3 py-1.5 text-center shadow-card backdrop-blur"
          style={color ? { borderColor: color } : undefined}
        >
          <span className="text-[13px] font-semibold text-ink">{text}</span>
          {detail && <span className="text-[11px] text-ink-2">{detail}</span>}
        </motion.div>
      </AnimatePresence>
    </Html>
  );
}

export default function Arena({
  seats,
  speaking,
  preparing = null,
  cutOff,
  reactions,
  level = null,
  caption,
  captionDetail,
  captionColor,
  orbit = false,
  details = false,
  onReady,
  className,
}: ArenaProps) {
  const colors = useThemeColors();
  const positions = useMemo(() => seats.map((_, index) => seatPosition(index, seats.length)), [seats]);
  const speakerIndex = seats.findIndex((seat) => seat.id === speaking);
  const speakerColor = speakerIndex >= 0 ? seats[speakerIndex].color : colors.accent;

  return (
    <div aria-hidden className={className}>
      <Canvas
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ fov: 36, near: 0.1, far: 60, position: [0, 3.6, 6] }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          onReady?.();
        }}
      >
        <CameraFit />
        <ambientLight intensity={colors.dark ? 0.7 : 0.9} />
        <hemisphereLight args={["#ffffff", colors.dark ? "#1c2029" : "#d8dbe6", 0.9]} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} />
        <directionalLight position={[-4, 3, -2]} intensity={0.6} color={colors.accent2} />
        <Rig orbit={orbit}>
          <Platform colors={colors} />
          <Table colors={colors} />
          <SpeakerLight target={speakerIndex >= 0 ? positions[speakerIndex] : null} color={speakerColor} />
          {seats.map((seat, index) => (
            <Figure
              key={seat.id}
              seat={seat}
              position={positions[index]}
              speaking={seat.id === speaking}
              preparing={seat.id === preparing}
              cutOff={cutOff?.has(seat.id) ?? false}
              reaction={reactions?.get(seat.id) ?? null}
              level={seat.id === "user" ? level : null}
              details={details}
              dark={colors.dark}
            />
          ))}
          <Caption text={caption} detail={captionDetail} color={captionColor} />
          <Sparkles count={46} scale={[6.5, 2.4, 6.5]} position={[0, 1.5, 0]} size={2.4} speed={0.3} opacity={0.55} color={colors.accent2} />
          <ContactShadows position={[0, 0.001, 0]} opacity={colors.dark ? 0.6 : 0.4} scale={8} blur={2.4} far={2.2} resolution={512} />
        </Rig>
      </Canvas>
    </div>
  );
}
