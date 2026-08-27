/**
 * The mascot with its anatomy called out. Everything is one SVG in a fixed
 * design space (the logo is 559x876, centred in a 960-wide canvas), so the
 * leader lines stay glued to the artwork at any size. Region coordinates were
 * measured from the image itself.
 */

const IMG_X = 200; // logo's left edge in canvas units
const IMG_W = 559;
const IMG_H = 876;
const CANVAS_W = 960;

/** Converts a point given as % of the logo into canvas coordinates. */
const px = (xPct: number, yPct: number) => ({
  x: IMG_X + (xPct / 100) * IMG_W,
  y: (yPct / 100) * IMG_H,
});

const RED = "#ff6b6b";
const BLUE = "#86adff";

interface Callout {
  letter: string;
  label: string;
  anchor: { x: number; y: number };
  at: { x: number; y: number };
  side: "left" | "right";
  color: string;
}

// Red parts read V-O-X from the bottom up; blue parts are the radio host's
// smile and suit. Anchors sit on the measured edge of each part.
const CALLOUTS: Callout[] = [
  {
    letter: "X",
    label: "the eyes",
    anchor: px(75, 17),
    at: { x: 820, y: 96 },
    side: "right",
    color: BLUE,
  },
  {
    letter: "O",
    label: "the head",
    anchor: px(95, 26),
    at: { x: 820, y: 236 },
    side: "right",
    color: BLUE,
  },
  {
    letter: "V",
    label: "the body",
    anchor: px(73, 72),
    at: { x: 820, y: 550 },
    side: "right",
    color: BLUE,
  },
  {
    letter: "",
    label: "a smile",
    anchor: px(32, 38.5),
    at: { x: 100, y: 342 },
    side: "left",
    color: RED,
  },
  {
    letter: "",
    label: "collar and tie",
    anchor: px(38, 66),
    at: { x: 150, y: 504 },
    side: "left",
    color: RED,
  },
];

export default function MascotFigure({
  className = "",
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${CANVAS_W} ${IMG_H}`}
      className={`h-auto w-full ${className}`}
      role="img"
      aria-label="The Vox mascot with its parts labelled: the eyes form an X, the head an O, and the body a V - reading VOX from the bottom up. The blue smile and tie are the radio host's suit."
    >
      <defs>
        <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="0"
            stdDeviation="4"
            floodColor="#ff2b2b"
            floodOpacity="0.8"
          />
        </filter>
        <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="0"
            stdDeviation="4"
            floodColor="#3d7bff"
            floodOpacity="0.8"
          />
        </filter>
      </defs>

      <image href="/vox.png" x={IMG_X} y={0} width={IMG_W} height={IMG_H} />

      {CALLOUTS.map((c) => {
        const isRight = c.side === "right";
        const elbow = { x: isRight ? c.at.x - 40 : c.at.x + 40, y: c.at.y };
        const glow = c.color === RED ? "url(#glow-red)" : "url(#glow-blue)";
        return (
          <g
            key={c.label}
            style={{
              fontFamily:
                '"Space Grotesk", ui-sans-serif, system-ui, sans-serif',
            }}
          >
            <polyline
              points={`${c.anchor.x},${c.anchor.y} ${elbow.x},${elbow.y} ${isRight ? c.at.x - 8 : c.at.x + 8},${c.at.y}`}
              fill="none"
              stroke={c.color}
              strokeWidth={1.5}
              strokeOpacity={0.7}
              strokeDasharray="4 4"
            />
            <circle
              cx={c.anchor.x}
              cy={c.anchor.y}
              r={5}
              fill="#0b0b0e"
              stroke={c.color}
              strokeWidth={2}
              filter={glow}
            />
            {c.letter ? (
              <>
                <text
                  x={c.at.x}
                  y={c.at.y + 22}
                  textAnchor={isRight ? "start" : "end"}
                  fontSize={64}
                  fontWeight={700}
                  fill={c.color}
                  filter={glow}
                >
                  {c.letter}
                </text>
                <text
                  x={c.at.x + 46}
                  y={c.at.y + 20}
                  textAnchor="start"
                  fontSize={20}
                  fill="#8b8b96"
                >
                  {c.label}
                </text>
              </>
            ) : (
              <text
                x={c.at.x}
                y={c.at.y + 7}
                textAnchor={isRight ? "start" : "end"}
                fontSize={22}
                fontWeight={500}
                fill={c.color}
                filter={glow}
              >
                {c.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
