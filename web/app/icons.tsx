import type { SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
};

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function User(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="8" r="3.25" /><path d="M5.5 19c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" /></Icon>;
}

export function Sliders(props: IconProps) {
  return <Icon {...props}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></Icon>;
}

export function Palette(props: IconProps) {
  return <Icon {...props}><path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.2a1.8 1.8 0 0 0 1.3-3c-.7-.7-.2-1.9.8-1.9H17a3.5 3.5 0 0 0 3.5-3.5A8.6 8.6 0 0 0 12 3.5Z" /><path d="M7.5 10h.01M10 6.8h.01M14 6.8h.01M17 10h.01" /></Icon>;
}

export function Shield(props: IconProps) {
  return <Icon {...props}><path d="M12 3.5 19 6v5.2c0 4.3-2.5 7.5-7 9.3-4.5-1.8-7-5-7-9.3V6l7-2.5Z" /><path d="m9.2 12 1.8 1.8 3.8-4" /></Icon>;
}

export function Notes(props: IconProps) {
  return <Icon {...props}><path d="M6 3.5h9l3 3V20H6z" /><path d="M15 3.5V7h3M9 11h6M9 15h6" /></Icon>;
}

export function Book(props: IconProps) {
  return <Icon {...props}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" /></Icon>;
}

export function Flag(props: IconProps) {
  return <Icon {...props}><path d="M5 21V4M5 5h10l-1 4 3 3H5" /></Icon>;
}

export function ExternalLink(props: IconProps) {
  return <Icon {...props}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6H5V6h6" /></Icon>;
}

export function LogOut(props: IconProps) {
  return <Icon {...props}><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></Icon>;
}

export function ChevronDown(props: IconProps) {
  return <Icon {...props}><path d="m7 9 5 5 5-5" /></Icon>;
}

export function Check(props: IconProps) {
  return <Icon {...props}><path d="m5 12.5 4.2 4L19 7" /></Icon>;
}
