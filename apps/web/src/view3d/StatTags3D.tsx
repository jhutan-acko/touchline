/**
 * The live stat tags on the 3D stage: each a label sprite over its player (a sprint follows its runner, a pass tag its
 * receiver) or over its pitch spot, placed every animation frame, fading as the tag does. What to show is decided in
 * `tags.ts`, which is tested; this file only builds the three.js objects.
 */
import { useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef } from "react"
import * as THREE from "three"
import type { StatTag } from "../tags.js"
import type { World } from "./world.js"

const COLOURS: Record<StatTag["kind"], { bg: string; fg: string }> = {
  shot: { bg: "rgba(242,193,78,.95)", fg: "#0d1412" },
  sprint: { bg: "rgba(12,74,110,.9)", fg: "#f0f9ff" },
  pass: { bg: "rgba(6,78,59,.9)", fg: "#ecfdf5" }
}

/** A tag's text on a rounded pill, as a texture, and its width over height. */
const tagTexture = (text: string, kind: StatTag["kind"]): { texture: THREE.Texture; aspect: number } => {
  const c = document.createElement("canvas")
  const h = 64
  const g = c.getContext("2d")
  const font = "700 34px system-ui, sans-serif"
  let w = 256
  if (g) {
    g.font = font
    w = Math.ceil(g.measureText(text).width) + 48
  }
  c.width = w
  c.height = h
  if (g) {
    g.fillStyle = COLOURS[kind].bg
    g.beginPath()
    g.roundRect(2, 2, w - 4, h - 4, 28)
    g.fill()
    g.fillStyle = COLOURS[kind].fg
    g.font = font
    g.textAlign = "center"
    g.textBaseline = "middle"
    g.fillText(text, w / 2, h / 2 + 2)
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  return { texture, aspect: w / h }
}

/** Screen height of a tag (a fraction of the viewport, as the jersey numbers are sized). */
const HEIGHT = 0.024

interface Shown {
  readonly sprite: THREE.Sprite
  readonly text: string
}

const spriteOf = (tag: StatTag): THREE.Sprite => {
  const { texture, aspect } = tagTexture(tag.text, tag.kind)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }))
  s.scale.set(HEIGHT * aspect, HEIGHT, 1)
  s.center.set(0.5, 0)
  s.renderOrder = 11
  return s
}

const free = (s: THREE.Sprite) => {
  s.material.map?.dispose()
  s.material.dispose()
}

/**
 * The stat tags drawn into a world's scene: a group of label sprites kept in step with `tags` (a sprite is rebuilt when
 * its text changes) and placed every animation frame.
 */
export const StatTags3D = ({ tags, world }: { tags: ReadonlyArray<StatTag>; world: World }) => {
  const group = useMemo(() => new THREE.Group(), [])
  const shown = useRef(new Map<string, Shown>())
  const latest = useRef(tags)
  latest.current = tags
  useEffect(() => {
    world.scene.add(group)
    const map = shown.current
    return () => {
      world.scene.remove(group)
      for (const s of map.values()) free(s.sprite)
      map.clear()
      group.clear()
    }
  }, [world, group])
  useFrame(() => {
    const map = shown.current
    const keep = new Set<string>()
    for (const t of latest.current) {
      keep.add(t.key)
      let s = map.get(t.key)
      if (!s || s.text !== t.text) {
        if (s) (group.remove(s.sprite), free(s.sprite))
        s = { sprite: spriteOf(t), text: t.text }
        map.set(t.key, s)
        group.add(s.sprite)
      }
      const p = t.player_id ? world.positionOf(t.player_id) : null
      if (p) s.sprite.position.set(p.x, 3.4, p.z)
      else s.sprite.position.set(t.x, 2.5, -t.y)
      s.sprite.material.opacity = t.opacity
    }
    for (const [key, s] of map) if (!keep.has(key)) (group.remove(s.sprite), free(s.sprite), map.delete(key))
  })
  return null
}
