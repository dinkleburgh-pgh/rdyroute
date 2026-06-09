/**
 * Shared icon exports.
 *
 * Most icons are re-exported from lucide-react for consistency.
 * DustGarmentIcon is a custom SVG kept for the distinctive t-shirt shape.
 */
import type { SVGProps } from "react";

// Named re-exports matching the old custom-icon names for backward compat
export {
  AlertTriangle as AlertTriangleIcon,
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  Lock as LockIcon,
  Plus as PlusIcon,
  RefreshCw as RefreshIcon,
  Search as SearchIcon,
  Shield as ShieldIcon,
  Trash2 as TrashIcon,
  User as UserIcon,
  X as XIcon,
} from "lucide-react";

export {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Calendar,
  Clock,
  FileText,
  Filter,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Package,
  Route,
  Settings,
  Share2,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

/** Filled t-shirt silhouette — flags Dust trucks carrying a dust garment. */
export function DustGarmentIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={className}
      fill="currentColor"
      stroke="none"
      {...props}
    >
      <path d="M11 4c.4 1.7 2.2 3 5 3s4.6-1.3 5-3l5.5 2.5a1 1 0 0 1 .5 1.3l-2 5a1 1 0 0 1-1.3.5L21 11.6V27a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V11.6l-2.7 1.7a1 1 0 0 1-1.3-.5l-2-5a1 1 0 0 1 .5-1.3L11 4z" />
    </svg>
  );
}
