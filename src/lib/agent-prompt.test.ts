import { expect, test } from "vitest";
import { dependencies } from "../../package.json";
import { chapterPrompt, trackPrompt } from "./agent-prompt";

test("a chapter prompt links the chapter md and pins the effect version", () => {
  const prompt = chapterPrompt({
    title: "Typed errors",
    url: "/learn/basic-effect/03-typed-errors",
  });
  expect(prompt).toContain(
    "https://effect.rangga.site/learn/basic-effect/03-typed-errors.md",
  );
  expect(prompt).toContain(`effect ${dependencies.effect}`);
  expect(prompt).toContain('"Typed errors"');
});

test("a track prompt numbers every chapter md in order", () => {
  const prompt = trackPrompt(
    { title: "Basic Effect", url: "/learn/basic-effect" },
    [
      { title: "One", url: "/learn/basic-effect/01-one" },
      { title: "Two", url: "/learn/basic-effect/02-two" },
    ],
  );
  expect(prompt).toContain("/learn/basic-effect.md");
  expect(prompt).toContain("1. One: https://effect.rangga.site/learn/basic-effect/01-one.md");
  expect(prompt).toContain("2. Two: https://effect.rangga.site/learn/basic-effect/02-two.md");
});
