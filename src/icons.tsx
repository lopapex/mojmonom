import type { ComponentChildren } from 'preact';

/**
 * One icon system: 24px grid, 2px stroke, round caps and joins.
 * Presentation attributes are inline so icons render even without CSS.
 */
function Icon({ children, size = 22 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Metronome: tapered body with the arm swung right. */
export const ClickIcon = () => (
  <Icon>
    <path d="M9.6 3.5h4.8a1 1 0 0 1 1 .8l3.4 15a1 1 0 0 1-1 1.2H6.2a1 1 0 0 1-1-1.2l3.4-15a1 1 0 0 1 1-.8Z" />
    <path d="M7 16h10" />
    <path d="m12 16 5-9.5" />
  </Icon>
);

/** Kick drum lying on its side as in a kit: front head, shell, back hoop, spurs. */
export const StompIcon = () => (
  <Icon>
    <ellipse cx="8" cy="11" rx="4.5" ry="7" />
    <path d="M8 4h8.5M8 18h8.5" />
    <path d="M16.5 4c2.5 0 4.5 3.1 4.5 7s-2 7-4.5 7" />
    <path d="m5.5 17-2 4M18 17.5l1.8 3.5" />
  </Icon>
);

export const VolumeIcon = () => (
  <Icon>
    <path d="M11 5 6.5 8.6H4a1 1 0 0 0-1 1v4.8a1 1 0 0 0 1 1h2.5L11 19Z" />
    <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
    <path d="M18.6 6a8.5 8.5 0 0 1 0 12" />
  </Icon>
);

export const InstallIcon = () => (
  <Icon>
    <path d="M12 4v10" />
    <path d="m7.5 10 4.5 4.5 4.5-4.5" />
    <path d="M5 19.5h14" />
  </Icon>
);

/** Pendulum view: the same rod and pivot ring as the big visual. */
export const NeedleIcon = () => (
  <Icon>
    <path d="m13.3 15.6 4-12" />
    <circle cx="12" cy="18.5" r="2.6" />
  </Icon>
);

/** Pulse view: ring with a core. */
export const PulseIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon size={20}>
    <path d="M5 12h14" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={20}>
    <path d="M5 12h14M12 5v14" />
  </Icon>
);

export const PlayIcon = () => (
  <svg class="transport-icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
    <path d="M8 5.2v13.6a1 1 0 0 0 1.5.9l10.6-6.8a1 1 0 0 0 0-1.7L9.5 4.3A1 1 0 0 0 8 5.2Z" />
  </svg>
);

export const PauseIcon = () => (
  <svg class="transport-icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4.5" width="4.2" height="15" rx="1.4" />
    <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4" />
  </svg>
);
