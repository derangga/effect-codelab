import type { ChapterMeta, Heading, TrackMeta } from '../vite-plugin-markdown'

type Rendered = {
  headings: Array<Heading>
  hasMermaid: boolean
  html: string
}

export type Chapter = Rendered & { meta: ChapterMeta }

/** A track folder: its `_track.md` page, plus its chapters in reading order. */
export type Track = Rendered & {
  meta: TrackMeta
  chapters: Array<Chapter>
}

// Adding a chapter is one step: drop a .md file in a track folder. Adding a
// track is two: make the folder, drop a _track.md in it.
const modules = import.meta.glob<Rendered & { meta: ChapterMeta | TrackMeta }>(
  '/content/*/*.md',
  { eager: true },
)

const byOrder = <T extends { meta: { order: number } }>(a: T, b: T) =>
  a.meta.order - b.meta.order

const entries = Object.values(modules)

const isTrack = (
  m: (typeof entries)[number],
): m is Rendered & {
  meta: TrackMeta
} => m.meta.kind === 'track'

const chapters = entries
  .filter((m): m is Chapter => m.meta.kind === 'chapter')
  .sort(byOrder)

/** Every track, in reading order. */
export const tracks: Array<Track> = entries
  .filter(isTrack)
  .sort(byOrder)
  .map((track) => ({
    ...track,
    chapters: chapters.filter((c) => c.meta.track === track.meta.slug),
  }))

export const trackBySlug = (track: string) =>
  tracks.find((t) => t.meta.slug === track)

export const chapterBySlug = (track: string, slug: string) =>
  trackBySlug(track)?.chapters.find((c) => c.meta.slug === slug)

/**
 * Searches every track for a slug. For the case where the track is not known
 * yet, such as an incoming link that carries only the chapter.
 */
export const findChapter = (slug: string) =>
  chapters.find((c) => c.meta.slug === slug)

/**
 * Previous and next within one track. A track's ends return undefined rather
 * than spilling into a neighbouring track, because the tracks do not assume a
 * single reading order across them.
 */
export const neighbours = (track: string, slug: string) => {
  const list = trackBySlug(track)?.chapters ?? []
  const i = list.findIndex((c) => c.meta.slug === slug)
  if (i === -1) return { prev: undefined, next: undefined }
  return { prev: list[i - 1], next: list[i + 1] }
}

/** The track after this one, for the card on a track's last chapter. */
export const nextTrack = (track: string) => {
  const i = tracks.findIndex((t) => t.meta.slug === track)
  return i === -1 ? undefined : tracks[i + 1]
}
