import { expect, test } from 'vitest';
import type * as PageTree from 'fumadocs-core/page-tree';
import { themeGroupingPlugin } from './theme-tree';

const track = (name: string, theme: string, order: number): PageTree.Folder => ({
  type: 'folder',
  $ref: { folder: name },
  name,
  index: { type: 'page', name, url: `/learn/${name}` },
  children: [],
  // carried through storage.read below, not read off the node
  ...({ theme, order } as object),
});

const storage = {
  read: (path: string) => {
    const folder = path.replace('/index.md', '');
    const node = tracks.find((t) => t.$ref?.folder === folder) as unknown as Record<
      string,
      unknown
    >;
    return node && { format: 'page', data: { theme: node.theme, order: node.order } };
  },
};

const tracks = [
  track('mental-model', 'foundations', 1),
  track('fullstack-monorepo', 'applications', 1),
];

function group() {
  const plugin = themeGroupingPlugin();
  const root = plugin.transformPageTree!.root!;
  return root.call({ storage } as never, {
    name: 'Docs',
    children: [...tracks],
  } as PageTree.Root);
}

test('theme folders carry a stable id across rebuilds', () => {
  // The loader rebuilds the tree on every navigation. Fumadocs matches the
  // sidebar tab against the folder on the current path by `$id` once object
  // identity fails, so an id that changes per build hides the dropdown.
  const ids = (tree: PageTree.Root) =>
    tree.children.map((child) => (child as PageTree.Folder).$id);

  expect(ids(group())).toEqual(['foundations', 'applications']);
  expect(ids(group())).toEqual(ids(group()));
});
