/**
 * The live stat tags on the 3D stage: each a label sprite over its player (a sprint follows its runner, a pass tag its
 * receiver) or over its pitch spot, placed every animation frame, fading as the tag does. What to show is decided in
 * `tags.ts`, which is tested; this file only builds the three.js objects.
 */
import { createPortal, useFrame } from "@react-three/fiber"
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
const HEIGHT = 0.03

const TagSprite = ({ tag, world }: { tag: StatTag; world: World }) => {
  const sprite = useMemo(() => {
    const { texture, aspect } = tagTexture(tag.text, tag.kind)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }))
    s.scale.set(HEIGHT * aspect, HEIGHT, 1)
    s.center.set(0.5, 0)
    s.renderOrder = 11
    return s
  }, [tag.text, tag.kind])
  useEffect(() => () => {
    sprite.material.map?.dispose()
    sprite.material.dispose()
  }, [sprite])
  const latest = useRef(tag)
  latest.current = tag
  useFrame(() => {
    const t = latest.current
    const p = t.player_id ? world.positionOf(t.player_id) : null
    if (p) sprite.position.set(p.x, 3.4, p.z)
    else sprite.position.set(t.x, 2.5, -t.y)
    sprite.material.opacity = t.opacity
  })
  return <primitive object={sprite} />
}

/** The stat tags drawn into a world's scene. */
export const StatTags3D = ({ tags, world }: { tags: ReadonlyArray<StatTag>; world: World }) =>
  createPortal(<>{tags.map((tag) => <TagSprite key={tag.key} tag={tag} world={world} />)}</>, world.scene)
