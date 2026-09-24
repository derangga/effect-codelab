'use client';
import { useEffect } from 'react';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';

/**
 * The search dialog, over the static index rather than a query endpoint.
 *
 * Fumadocs' own DefaultSearchDialog reaches the same client through a
 * `type: 'static'` prop that is deprecated here, and it exposes no way to pass
 * a client instead. Rebuilding it from the same primitives is what upstream
 * suggests in place of that prop, and it is the parts of the default minus the
 * tag filter and locale, neither of which this site has.
 */
//
// The `.json` is what gets it compressed: Cloudflare picks the content type
// from the file extension, and without one it served all 2 MB raw.
const client = staticClient({ from: '/api/search.json' });

export default function StaticSearchDialog(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({ client });

  // The client fetches the index on the first query and caches it for the
  // session, so an empty query on open starts the download while the reader
  // is still typing. A failure here resurfaces on the real query.
  useEffect(() => {
    if (props.open) Promise.resolve(client.search('')).catch(() => {});
  }, [props.open]);

  return (
    <SearchDialog
      search={search}
      onSearchChange={setSearch}
      isLoading={query.isLoading}
      {...props}
    >
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
