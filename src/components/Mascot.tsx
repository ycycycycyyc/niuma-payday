/** The little milk-cow sticker: biscuit horns, a berry neckerchief, and a buttercup. */
export default function Mascot({ small = false }: { small?: boolean }) {
  const ink = '#583441';
  return <svg className={small ? 'mascot small' : 'mascot'} viewBox="0 0 220 220" fill="none" aria-hidden="true">
    <ellipse cx="111" cy="198" rx="59" ry="7" fill="#b78288" opacity=".22" />
    <g stroke={ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Tail, soft little body and the two hooves. */}
      <path d="M150 167c17 6 25-3 24-15" />
      <path d="M174 153c-8-1-11-9-5-15 7 1 11 9 5 15Z" fill="#98586a" />
      <path d="M78 142c-6 13-9 29-6 40 4 16 21 20 39 19 22 1 39-6 40-22 1-12-5-27-14-38Z" fill="#fff4df" />
      <path d="M120 184c3-11 14-14 24-13 0 11-6 16-14 18-5 1-9 0-10-5Z" fill="#9e5e71" stroke="none" />
      <path d="M82 186c-3 6-2 11 2 13 4 2 11 1 14-2l1-9m26-1 2 10c3 3 11 4 15 1 2-2 2-7-1-11" fill="#774655" />
      <path d="M77 145c-7 4-13 18-10 23 2 3 6 3 10 0l8-9m57-12c8 6 13 15 10 20-2 4-7 4-11 0l-7-9" fill="#fff4df" />
      {/* Small, round horns and ears frame the piebald face. */}
      <path d="M74 56c-9-7-12-21-7-32 2-4 6-4 8 0 4 8 8 13 14 19l1 8m42 2c7-8 13-14 17-25 2-5 6-6 9-1 6 12 2 26-8 34" fill="#ebc58b" />
      <path d="m69 35 8-3m69 10 8 4" stroke="#b78c62" strokeWidth="2.2" />
      <path d="M65 67C46 53 27 57 24 70c-3 13 19 25 39 22m90-24c19-14 38-10 42 3 3 14-17 25-38 22" fill="#f5d5c6" />
      <path d="M34 70c8-2 16 2 21 7m127-6c-8-1-15 2-20 7" stroke="#cb8892" strokeWidth="3.2" />
      <path d="M54 90c0-29 20-50 53-52 38-2 62 19 62 52 0 36-8 56-32 65-19 8-48 6-66-7-13-10-18-30-17-58Z" fill="#fff5e3" />
      <path d="M77 49c7-6 21-10 34-10 5 7 9 16 7 22-3 7-13 9-19 6-6-3-6-8-12-10-5-2-8-4-10-8Z" fill="#97596a" stroke="none" />
      <path d="M63 88c1-13 14-20 25-17 13 3 17 17 12 28-5 12-16 15-26 10-9-4-13-10-11-21Z" fill="#985a6b" stroke="none" />
      <path d="M77 91c3-4 6-4 9 0" stroke="#fff5e5" strokeWidth="3.5" />
      <path d="M131 91c3-4 7-4 10 0" strokeWidth="3.5" />
      <ellipse cx="69" cy="107" rx="9" ry="4.3" fill="#edacb0" stroke="none" />
      <ellipse cx="151" cy="106" rx="9" ry="4.3" fill="#edacb0" stroke="none" />
      <path d="M75 120c1-10 12-15 24-16 9 0 13 1 19 0 13-1 27 4 30 14 4 14-9 25-37 25-24 0-38-7-36-23Z" fill="#f1c6c0" />
      <path d="m90 119 1 3m38-3-1 3m-23 7c3 3 7 4 11 0" strokeWidth="2.8" />
      <path d="M84 153c14 7 33 9 51 3l-6 11c-15 4-30 1-42-5l-3-9Z" fill="#ae546a" />
      <path d="m96 166-10 13 12-2 5 7 5-16" fill="#cc7180" />
      <path d="m98 171-4 5" stroke="#f4b7b4" strokeWidth="2" />
      {/* A tiny flower pinned above her ear. */}
      <path d="M151 60c-2-8 1-13 6-14 1 6 0 11-6 14Z" fill="#acbb83" strokeWidth="2.4" />
      <path d="M148 55c-3-8-11-7-12-2-1 3 1 5 3 7-7-1-11 4-7 8 2 3 6 2 8 1-2 7 4 12 8 7 2-1 2-4 2-5 5 5 11 1 9-4-1-3-4-5-6-5 6-3 6-9 1-10-3-1-5 1-6 3Z" fill="#fce7a4" strokeWidth="2.4" />
      <circle cx="146" cy="63" r="3.7" fill="#e0a063" strokeWidth="1.8" />
    </g>
  </svg>;
}
