/*
  Line icons for the back office, drawn by hand so we don't need an icon package.
  They all share one stroke style, so they look like a single set.
*/

function Icon({ children, size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function ReviewIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z" />
      <path d="M15 3.5V8h4" />
      <path d="m9.3 14 1.9 1.9 3.6-3.8" />
    </Icon>
  )
}

export function DashboardIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <path d="M7 16v-4" />
      <path d="M12 16V5" />
      <path d="M17 16V9" />
    </Icon>
  )
}

export function FixIcon(props) {
  return (
    <Icon {...props}>
      <path d="M9.5 18h5" />
      <path d="M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.8 10.6c.8.7 1.3 1.5 1.3 2.4v.5h5V16c0-.9.5-1.7 1.3-2.4A6 6 0 0 0 12 3z" />
    </Icon>
  )
}

export function ShieldIcon(props) {
  return (
    <Icon {...props}>
      <path d="M12 3 5 5.5v5.8c0 4.4 2.9 7.6 7 9.2 4.1-1.6 7-4.8 7-9.2V5.5z" />
      <path d="m9 11.8 2.2 2.2 3.9-4.1" />
    </Icon>
  )
}

export function ChevronIcon(props) {
  return (
    <Icon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Icon>
  )
}

export function CheckIcon(props) {
  return (
    <Icon {...props}>
      <path d="m5.5 12.5 4.3 4.3L18.5 7.5" />
    </Icon>
  )
}

export function RefreshIcon(props) {
  return (
    <Icon {...props}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" />
      <path d="M19.5 3.8v4h-4" />
    </Icon>
  )
}

export function SearchIcon(props) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </Icon>
  )
}
