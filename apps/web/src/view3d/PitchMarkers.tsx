/**
 * Pitch markers on the 3D stage (pause and ask): a pressure ring with its presser count, a raised pass arc between two
 * players, or a dashed ghost circle at a point or a player. They are drawn into the world's scene (the stage draws its
 * scenes itself). Each registers in `MarkerTaps`; the stage places them every animation frame right after posing the
 * world (so they keep up with the bodies), and on a click projects their anchors with the players' to find the nearest. What to draw is decided in `markers.ts`,
 * which is tested; this file only builds the three.js objects.
 */
import { createPortal } from "@react-three/fiber"
import { createContext, useContext, useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import type { Cue } from "@touchline/schema"
import { arcPoint, GHOST_RADIUS, LIFT, parseMarker, RING_RADIUS, type Marker } from "../markers.js"
import { labelTexture, type World } from "./world.js"

/** A marker on the stage: place it for this frame (after the world is posed), where it is now (world), and what tapping it does. */
export interface TapTarget {
  readonly place: () => void
  readonly anchor: () => THREE.Vector3 | null
  readonly tap: () => void
}

/** The markers on the stage by cue id, filled by the markers themselves; the stage reads it on a click. */
export const MarkerTaps = createContext<Map<string, TapTarget> | null>(null)

/** The marker colour: the same amber as the followed player's ring and the pass line. */
const AMBER = "#f2c14e"
const ARC_POINTS = 33

interface Built {
  readonly object: THREE.Object3D
  /** Place it for this frame; the point a tap aims at, or null when it is not on the pitch. */
  place(world: World, m: Marker): THREE.Vector3 | null
}

const flat = (o: THREE.Object3D) => {
  o.rotation.x = -Math.PI / 2
  return o
}

/** A player's position, or a pitch point (metres) in the world. */
const spot = (world: World, at: string | undefined, point: Marker["point"]): THREE.Vector3 | null =>
  at ? world.positionOf(at) : point ? new THREE.Vector3(point.x, 0, -point.y) : null

const build = (m: Marker): Built => {
  const group = new THREE.Group()
  group.visible = false
  switch (m.template) {
    case "pressure_ring": {
      group.add(flat(new THREE.Mesh(new THREE.RingGeometry(RING_RADIUS - 0.15, RING_RADIUS, 48), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }))))
      if (m.count !== undefined) {
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(String(m.count), AMBER), depthTest: false, sizeAttenuation: false }))
        label.scale.set(0.05, 0.025, 1)
        label.position.y = 2.8 // above the jersey number
        label.renderOrder = 10
        group.add(label)
      }
      return {
        object: group,
        place: (world, mk) => {
          const p = spot(world, mk.at, undefined)
          group.visible = p !== null
          if (p) group.position.set(p.x, LIFT * 0.5, p.z)
          return p
        }
      }
    }
    case "pass_arc": {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.95, depthTest: false }))
      line.frustumCulled = false
      line.renderOrder = 9
      group.add(line)
      return {
        object: group,
        place: (world, mk) => {
          const a = mk.from ? world.positionOf(mk.from) : null
          const b = mk.to ? world.positionOf(mk.to) : null
          group.visible = a !== null && b !== null
          if (!a || !b) return null
          const pos = geometry.getAttribute("position") as THREE.BufferAttribute
          for (let i = 0; i < ARC_POINTS; i++) pos.setXYZ(i, ...arcPoint(a, b, i / (ARC_POINTS - 1)))
          pos.needsUpdate = true
          return new THREE.Vector3(...arcPoint(a, b, 0.5))
        }
      }
    }
    case "ghost": {
      const circle = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(Array.from({ length: 48 }, (_, i) => new THREE.Vector3(Math.cos((i / 48) * 2 * Math.PI) * GHOST_RADIUS, 0, Math.sin((i / 48) * 2 * Math.PI) * GHOST_RADIUS))),
        new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.85, depthTest: false })
      )
      circle.computeLineDistances()
      circle.renderOrder = 9
      group.add(circle)
      return {
        object: group,
        place: (world, mk) => {
          const p = spot(world, mk.at, mk.point)
          group.visible = p !== null
          if (p) group.position.set(p.x, LIFT, p.z)
          return p
        }
      }
    }
  }
}

const free = (o: THREE.Object3D) =>
  o.traverse((x) => {
    if (!(x instanceof THREE.Mesh || x instanceof THREE.Line || x instanceof THREE.Sprite)) return
    x.geometry.dispose()
    for (const m of Array.isArray(x.material) ? x.material : [x.material]) {
      ;(m as THREE.SpriteMaterial).map?.dispose()
      m.dispose()
    }
  })

const MarkerObject = ({ cue, marker, world, onTap }: { cue: Cue; marker: Marker; world: World; onTap: (m: Marker, cue: Cue) => void }) => {
  const built = useMemo(() => build(marker), [marker.template, marker.count])
  useEffect(() => () => free(built.object), [built])
  const latest = useRef({ cue, marker, onTap, anchor: null as THREE.Vector3 | null })
  Object.assign(latest.current, { cue, marker, onTap })
  const taps = useContext(MarkerTaps)
  useEffect(() => {
    if (!taps) return
    const l = latest.current
    taps.set(cue.cue_id, { place: () => void (l.anchor = built.place(world, l.marker)), anchor: () => l.anchor, tap: () => l.onTap(l.marker, l.cue) })
    return () => void taps.delete(cue.cue_id)
  }, [taps, cue.cue_id, built, world])
  return <primitive object={built.object} />
}

/** The pitch-marker cues drawn on a world's pitch; a tap on one calls `onTap` with its marker and cue. */
export const PitchMarkers = ({ cues, world, onTap }: { cues: ReadonlyArray<Cue>; world: World; onTap: (m: Marker, cue: Cue) => void }) => {
  const seen = new Set<string>()
  const marks = cues.flatMap((cue) => {
    if (seen.has(cue.cue_id)) return []
    seen.add(cue.cue_id)
    const marker = parseMarker(cue)
    return marker ? [{ cue, marker }] : []
  })
  return createPortal(
    <>
      {marks.map(({ cue, marker }) => <MarkerObject key={cue.cue_id} cue={cue} marker={marker} world={world} onTap={onTap} />)}
    </>,
    world.scene
  )
}
