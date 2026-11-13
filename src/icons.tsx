import type { ComponentChildren } from 'preact';

/** Presentation attributes are inline so the icon renders even without CSS. */
function Icon({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ClickIcon = () => (
  <Icon>
    <path d="M9.2 3h5.6l4.7 18h-15z" />
    <path d="M6 16h12" />
    <path d="M12 16 17.5 4.5" />
  </Icon>
);

export const StompIcon = () => (
  <Icon>
    <path d="M6.5 2.5 8.2 8M11 2l1.6 5.6" />
    <path d="M5.4 8.8c2.4 1.3 5.2 1.2 7.8-.6l5.9 3.4c1.4.8 1 2.9-.6 2.9H5.2z" />
    <path d="M2.5 18.5h19" />
    <path d="m4 15.7-1.6-1M20 15.7l1.6-1M12 20.5v1.5" />
  </Icon>
);

export const VolumeIcon = () => (
  <Icon>
    <path d="M3.5 9.5h3.7L12 5.5v13l-4.8-4H3.5z" />
    <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.5a8 8 0 0 1 0 11" />
  </Icon>
);

export const InstallIcon = () => (
  <Icon>
    <path d="M12 3v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 19h14" />
  </Icon>
);
