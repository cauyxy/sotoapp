// App glyph, drawn inline (vector, crisp at any size) so its three parts — the
// tile, the "S" letter, and the teal signal accents — can each follow the theme:
// brand cream in light, a value-flipped frosted variant in dark so the mark
// doesn't glare on the dark sidebar. Colors live in --soto-mark-* (tokens.css);
// the .soto-mark-* classes below bind to them. The span stays aria-hidden — the
// accessible name comes from adjacent text (sidebar wordmark, About name).
export function SotoMark({ size = 34 }: { size?: number }): JSX.Element {
  return (
    <span className="soto-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 1024 1024">
        <rect className="soto-mark-tile" x="7" y="7" width="1007" height="1008" rx="203" ry="203" />
        <g className="soto-mark-accent" fill="none" strokeLinecap="round">
          <path d="M 210 418 A 197 197 0 0 1 403 141" strokeWidth="44" />
          <path d="M 268 403 A 139 139 0 0 1 396 199" strokeWidth="39" />
          <path d="M 312 382 A 90 90 0 0 1 361 253" strokeWidth="30" />
        </g>
        <path
          className="soto-mark-letter"
          d="M 510 193 C 429.1 196.7, 345.5 256.4, 340 342 C 327.5 446.6, 430.2 505.1, 510 534 C 546.7 550.2, 592.5 573.6, 606 616 C 622.7 678.2, 556.9 727.3, 500 726 C 429.5 734.2, 384.4 680.8, 328 655 C 295.1 651.8, 267.4 683.9, 275 716 C 309.6 798.7, 404.5 837.2, 489 843 C 601.1 850.6, 706.9 753.7, 721 646 C 731.9 569, 688.6 497.1, 621 464 C 573.4 438.4, 519.4 428.5, 473 400 C 419 370.8, 443.6 291.3, 497 281 C 556.6 257, 610.3 296.4, 656 328 C 740.9 342.4, 706.3 223.9, 645 216 C 604.5 197.4, 559.1 190.8, 510 193 Z"
        />
        <g className="soto-mark-accent" strokeLinecap="round">
          <line x1="741" y1="720" x2="867" y2="720" strokeWidth="26" />
          <line x1="703" y1="777" x2="840" y2="777" strokeWidth="26" />
          <line x1="643" y1="840" x2="862" y2="840" strokeWidth="31" />
          <line x1="900" y1="810" x2="900" y2="864" strokeWidth="15" />
        </g>
      </svg>
    </span>
  );
}
