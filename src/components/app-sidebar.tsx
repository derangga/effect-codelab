import { Link, useMatchRoute, useParams } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { TrackIcon } from '@/components/track-icon'
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
import { trackBySlug } from '@/content'

export function AppSidebar() {
  const matchRoute = useMatchRoute()
  // The sidebar renders above the route, so the track is read loosely: on
  // /demo there is no track, and all that is left is the way back out.
  const { track: current } = useParams({ strict: false })
  const track = current ? trackBySlug(current) : undefined

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link to="/">
                  <ChevronLeft className="size-4 shrink-0" />
                  <span className="truncate">All tracks</span>
                </Link>
              }
            />
          </SidebarMenuItem>
          {track ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={
                  <Link to="/learn/$track" params={{ track: track.meta.slug }}>
                    <TrackIcon
                      name={track.meta.icon}
                      className="size-4 shrink-0"
                    />
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-medium">
                        {track.meta.title}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {`${track.chapters.length} page${track.chapters.length === 1 ? '' : 's'}`}
                      </span>
                    </span>
                  </Link>
                }
              />
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarHeader>
      {track ? (
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Chapters</SidebarGroupLabel>
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
        </SidebarContent>
      ) : null}
    </Sidebar>
  )
}
