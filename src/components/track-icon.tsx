import { Activity, BookOpen, Brain, Hammer, Layers, Server, Shield, TriangleAlert, Workflow } from 'lucide-react';

/**
 * Frontmatter names a lucide icon as a string, and this turns it into a
 * component. The map is explicit on purpose: `import * as icons` would defeat
 * tree shaking and pull the whole icon set into the bundle. Adding a track
 * with a new icon means adding a line here, which the fallback keeps from
 * being a crash.
 */
const icons = { Activity, Brain, BookOpen, Hammer, Layers, TriangleAlert, Server, Shield, Workflow };

export function TrackIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = icons[name as keyof typeof icons] ?? BookOpen;
  return <Icon className={className} />;
}
