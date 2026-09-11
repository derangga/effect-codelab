import { Link, useMatchRoute, useParams } from '@tanstack/react-router'
import { ChevronsUpDown, FlaskConical, LayoutGrid } from 'lucide-react'
import { TrackIcon } from '@/components/track-icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { trackBySlug, tracks } from '@/content'

function TrackSwitcher({ current }: { current?: string }) {
  const track = current ? trackBySlug(current) : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton size="lg">
            {track ? (
              <TrackIcon name={track.meta.icon} className="size-4 shrink-0" />
            ) : (
              <LayoutGrid className="size-4 shrink-0" />
            )}
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate font-medium">
                {track?.meta.title ?? 'Learning Effect'}
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {track
                  ? `${track.chapters.length} page${track.chapters.length === 1 ? '' : 's'}`
                  : `${tracks.length} tracks`}
              </span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 shrink-0" />
          </SidebarMenuButton>
        }
      />
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        {tracks.map(({ meta }) => (
          <DropdownMenuItem
            key={meta.slug}
            render={
              <Link to="/learn/$track" params={{ track: meta.slug }}>
                <TrackIcon name={meta.icon} className="size-4 shrink-0" />
                <span className="truncate">{meta.title}</span>
              </Link>
            }
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link to="/">
              <LayoutGrid className="size-4 shrink-0" />
              <span>All tracks</span>
            </Link>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppSidebar() {
  const matchRoute = useMatchRoute()
  // The sidebar renders above the route, so the track is read loosely: on /
  // and /demo there is no track, and the switcher says so instead of guessing.
  const { track: current } = useParams({ strict: false })
  const track = current ? trackBySlug(current) : undefined

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <TrackSwitcher current={current} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {track ? (
          <SidebarGroup>
            <SidebarGroupLabel>
              <Link to="/learn/$track" params={{ track: track.meta.slug }}>
                Overview
              </Link>
            </SidebarGroupLabel>
            <SidebarMenu>
              {track.chapters.map(({ meta }) => (
                <SidebarMenuItem key={meta.slug}>
                  <SidebarMenuButton
                    isActive={
                      !!matchRoute({
                        to: '/learn/$track/$slug',
                        params: { track: meta.track, slug: meta.slug },
                      })
                    }
                    render={
                      <Link
                        to="/learn/$track/$slug"
                        params={{ track: meta.track, slug: meta.slug }}
                      >
                        <span className="text-muted-foreground tabular-nums">
                          {String(meta.order).padStart(2, '0')}
                        </span>
                        <span className="truncate">{meta.title}</span>
                      </Link>
                    }
                  />
                  {meta.draft ? (
                    <SidebarMenuBadge>Draft</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel>Tracks</SidebarGroupLabel>
            <SidebarMenu>
              {tracks.map(({ meta }) => (
                <SidebarMenuItem key={meta.slug}>
                  <SidebarMenuButton
                    render={
                      <Link to="/learn/$track" params={{ track: meta.slug }}>
                        <TrackIcon name={meta.icon} className="size-4" />
                        <span className="truncate">{meta.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Pinned outside the chapter list, so the demo stays one click away
            from every track rather than belonging to one of them. */}
        <SidebarGroup>
          <SidebarGroupLabel>Try it</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={!!matchRoute({ to: '/demo' })}
                render={
                  <Link to="/demo">
                    <FlaskConical className="size-4" />
                    <span className="truncate">Live demo</span>
                  </Link>
                }
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
