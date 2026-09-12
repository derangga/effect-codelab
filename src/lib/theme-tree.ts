import type * as PageTree from 'fumadocs-core/page-tree';
import type { LoaderPlugin } from 'fumadocs-core/source';
import themes from '../../content/themes.json';

type TrackData = {
  theme?: string;
  order?: number;
};

/**
 * Group the track folders under their themes.
 *
 * Themes are frontmatter plus content/themes.json, not directories, so there
 * is nothing on disk for Fumadocs to turn into a sidebar tab. This synthesizes
 * the theme folders instead, which keeps content/ flat and shared with the old
 * app. Marking them `root` is what makes getLayoutTabs emit a tab per theme.
 *
 * Chapter order is left alone: the 01- and 02- filename prefixes already sort
 * correctly. Only the four track folders need ordering, and alphabetical would
 * put Anti-patterns ahead of Mental Model.
 */
export function themeGroupingPlugin(): LoaderPlugin {
  return {
    name: 'theme-grouping',
    transformPageTree: {
      root(node) {
        const storage = this.storage;

        const dataOf = (folder: PageTree.Folder): TrackData => {
          const dir = folder.$ref?.folder;
          if (!dir) return {};
          const file = storage.read(`${dir}/index.md`);
          return file?.format === 'page' ? (file.data as TrackData) : {};
        };

        const folders = node.children.filter(
          (child): child is PageTree.Folder => child.type === 'folder',
        );
        const claimed = new Set<PageTree.Folder>();

        const themeFolders = themes.flatMap<PageTree.Folder>((theme) => {
          const tracks = folders
            .filter((folder) => dataOf(folder).theme === theme.slug)
            .sort((a, b) => (dataOf(a).order ?? 999) - (dataOf(b).order ?? 999));

          if (tracks.length === 0) return [];
          for (const track of tracks) claimed.add(track);

          // getLayoutTabs skips a root folder it cannot resolve a url for, and
          // it only looks at direct page children. These hold folders, so the
          // theme points at its first track.
          const first = tracks[0].index;

          return [
            {
              type: 'folder',
              // The loader rebuilds the page tree on every navigation, so the
              // folder the sidebar tab points at is never the same object as
              // the one on the current page's path. Fumadocs falls back to
              // comparing `$id`, which it otherwise hands out lazily per tree,
              // so without a stable one here no tab matches and the theme
              // dropdown disappears until a reload.
              $id: theme.slug,
              name: theme.title,
              root: true,
              index: first && { ...first, name: theme.title },
              children: tracks,
            },
          ];
        });

        // A track whose theme is missing from themes.json stays where it was
        // rather than vanishing from the sidebar. check:content rejects that
        // case, but a silent disappearance is the worse failure.
        const rest = node.children.filter(
          (child) => child.type !== 'folder' || !claimed.has(child),
        );

        return { ...node, children: [...themeFolders, ...rest] };
      },
    },
  };
}
