import themeList from '../content/themes.json'
import type { ChapterMeta, Heading, TrackMeta } from '../vite-plugin-markdown'

type Rendered = {
  headings: Array<Heading>
  hasMermaid: boolean
  /** Estimated minutes to read this page, derived from its word count. */
  minutes: number
  html: string
}

export type Chapter = Rendered & { meta: ChapterMeta }

/** A track folder: its `_track.md` page, plus its chapters in reading order. */
export type Track = Rendered & {
  meta: TrackMeta
  chapters: Array<Chapter>
  /** Minutes to read the whole track, its own page included. */
  totalMinutes: number
}

/** A section of the catalog, from content/themes.json. */
export type Theme = {
  slug: string
  title: string
  tracks: Array<Track>
}

// Adding a chapter is one step: drop a .md file in a track folder. Adding a
// track is two: make the folder, drop a _track.md in it naming its theme.
const modules = import.meta.glob<Rendered & { meta: ChapterMeta | TrackMeta }>(
  '/content/*/*.md',
  { eager: true },
)

const byOrder = <T extends { meta: { order: number } }>(a: T, b: T) =>
  a.meta.order - b.meta.order

const entries = Object.values(modules)

const isTrack = (
  m: (typeof entries)[number],
): m is Rendered & { meta: TrackMeta } => m.meta.kind === 'track'

const chapters = entries
  .filter((m): m is Chapter => m.meta.kind === 'chapter')
  .sort(byOrder)

const allTracks: Array<Track> = entries.filter(isTrack).map((track) => {
  const own = chapters.filter((c) => c.meta.track === track.meta.slug)
  return {
    ...track,
    chapters: own,
    totalMinutes: own.reduce((total, c) => total + c.minutes, track.minutes),
  }
})

/**
 * The catalog, in the order themes.json lists them, each theme holding its own
 * tracks ordered within it. Track order is only meaningful inside a theme, so
 * adding a track means picking a number among its siblings.
 */
export const themes: Array<Theme> = themeList.map(({ slug, title }) => ({
  slug,
  title,
  tracks: allTracks.filter((t) => t.meta.theme === slug).sort(byOrder),
}))

/**
 * Every track. A track naming a theme that themes.json does not list would
 * otherwise vanish from the site with no error, so it lands here at the end
 * until check:content rejects the typo.
 */
export const tracks: Array<Track> = [
  ...themes.flatMap((theme) => theme.tracks),
  ...allTracks
    .filter((t) => !themeList.some((theme) => theme.slug === t.meta.theme))
    .sort(byOrder),
]

/**
 * The theme a track sits under. Undefined only when the track names a theme
 * themes.json does not list, which check:content rejects.
 */
export const themeOf = (track: Track) =>
  themes.find((theme) => theme.slug === track.meta.theme)

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
