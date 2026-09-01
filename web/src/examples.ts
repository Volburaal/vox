// The example programs are the same files the regression suite runs, imported
// straight from the repo's examples/ directory so the site never drifts from
// what actually works.
import hailstone from "../../examples/hailstone.vox?raw";
import factorial from "../../examples/factorial.vox?raw";
import fibonacci from "../../examples/fibonacci.vox?raw";
import natural from "../../examples/natural.vox?raw";
import counting from "../../examples/counting.vox?raw";
import voice from "../../examples/voice.vox?raw";

export interface Example {
  id: string;
  name: string;
  blurb: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "hailstone",
    name: "Hailstone",
    blurb: "The Collatz sequence, written the way you would say it.",
    source: hailstone,
  },
  {
    id: "natural",
    name: "Natural syntax",
    blurb: "Every spelling Vox accepts, in one program.",
    source: natural,
  },
  {
    id: "voice",
    name: "Voice",
    blurb: "say, ask, predicates and repeat - the radio host in action.",
    source: voice,
  },
  {
    id: "counting",
    name: "Counting",
    blurb: "Range loops, countdowns and in-place updates.",
    source: counting,
  },
  {
    id: "factorial",
    name: "Factorial",
    blurb: "A while loop and a function call.",
    source: factorial,
  },
  {
    id: "fibonacci",
    name: "Fibonacci",
    blurb: "Recursion, a for loop and multi-argument print.",
    source: fibonacci,
  },
];

export const DEFAULT_EXAMPLE = EXAMPLES[0];

export function findExample(id: string | null): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
