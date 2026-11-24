import { dependencies } from "../../package.json";
import { siteUrl } from "./shared";

// Read from package.json so the prompt names the version the chapters were
// written and compiled against, and cannot drift when the course is bumped.
const version = dependencies.effect;

const rules = `- Do not paste the material back to me or summarize it.
- Go one step at a time. After each step, ask me a question or give me a
  small task before you move on.
- This course uses effect ${version}. Use the API shown in the chapters, not
  what you remember from older versions.
- When I paste code, check it against the chapters' examples.
- If I am stuck, give a hint before the answer.
- The chapters have interactive demos you cannot run. If one matters, ask me
  what I see.`;

/** The markdown file an agent reads for a page. */
export const markdownUrl = (pageUrl: string) => `${siteUrl}${pageUrl}.md`;

export function chapterPrompt(chapter: { title: string; url: string }) {
  return `Teach me this chapter as my tutor: ${markdownUrl(chapter.url)}
Other chapters: ${siteUrl}/llms.txt

Read the chapter first.
${rules}
- Start by asking what I already know about "${chapter.title}".`;
}

export function trackPrompt(
  track: { title: string; url: string },
  chapters: ReadonlyArray<{ title: string; url: string }>,
) {
  const list = chapters
    .map((c, i) => `${i + 1}. ${c.title}: ${markdownUrl(c.url)}`)
    .join("\n");

  return `Teach me the "${track.title}" track as my tutor. Overview: ${markdownUrl(track.url)}

Chapters, in order. Read one when we reach it:
${list}

${rules}
- Start by asking what I already know about "${track.title}", then begin with chapter 1.`;
}
