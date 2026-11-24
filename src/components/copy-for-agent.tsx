import { Check, Copy } from "lucide-react";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";

/**
 * Copies a prompt that tells an agent to teach this page. The hook only flips
 * to "Copied" after the clipboard write resolves, so a blocked write never
 * claims success.
 */
export function CopyForAgent({ prompt }: { prompt: string }) {
  const [copied, onClick] = useCopyButton(() =>
    navigator.clipboard.writeText(prompt),
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
        copied
          ? "border-green-600/40 bg-green-600/10 text-green-700 dark:border-green-400/40 dark:text-green-400"
          : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
      }`}
    >
      {copied ? (
        <Check className="size-3.5" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
      <span aria-live="polite">
        {copied ? "Copied. Paste it into your agent." : "Copy for your agent"}
      </span>
    </button>
  );
}
