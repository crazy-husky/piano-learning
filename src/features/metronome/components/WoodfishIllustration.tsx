export function WoodfishIllustration({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={`metronome-woodfish ${className}`}
      fill="none"
      viewBox="0 0 168 112"
    >
      <defs>
        <linearGradient
          id="woodfish-body"
          x1="25"
          x2="147"
          y1="23"
          y2="91"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#d6a868" />
          <stop offset="0.48" stopColor="#b97b42" />
          <stop offset="1" stopColor="#85512f" />
        </linearGradient>
        <linearGradient
          id="woodfish-edge"
          x1="30"
          x2="143"
          y1="20"
          y2="93"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f3d39c" />
          <stop offset="1" stopColor="#9c6238" />
        </linearGradient>
      </defs>
      <path
        d="M14 56c8-21 26-34 51-39 23-5 45-1 62 10l25-11-3 21c7 7 11 15 13 24-2 10-6 18-13 25l3 21-25-11c-17 11-39 15-62 10-25-5-43-18-51-39L2 67l12-11Z"
        fill="url(#woodfish-body)"
        stroke="url(#woodfish-edge)"
        strokeWidth="4"
      />
      <path
        d="M26 56c8-14 22-23 41-27 22-5 43 0 57 11"
        stroke="#f0c888"
        strokeLinecap="round"
        strokeOpacity=".68"
        strokeWidth="4"
      />
      <path
        d="M29 68c12 13 30 20 50 20 15 0 29-4 40-12"
        stroke="#663c28"
        strokeLinecap="round"
        strokeOpacity=".55"
        strokeWidth="4"
      />
      <ellipse cx="84" cy="56" rx="22" ry="10" fill="#34271f" stroke="#edc68b" strokeWidth="3" />
      <path d="M84 48v16" stroke="#f7dfad" strokeLinecap="round" strokeWidth="3" />
      <circle cx="135" cy="43" r="3" fill="#452c20" />
      <path d="M135 69c-5 3-10 4-16 3" stroke="#5f3927" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}
