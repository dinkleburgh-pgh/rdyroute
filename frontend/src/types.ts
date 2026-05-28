// Mirrors backend Pydantic schemas in schemas.py

export type TruckStatus =
  | "dirty"
  | "shop"
  | "in_progress"
  | "unloaded"
  | "loaded"
  | "off"
  | "oos"
  | "spare";

export type TruckType = "Uniform" | "Dust" | "Spare";

export type AuthRole =
  | "admin"
  | "fleet"
  | "atl"
  | "supervisor"
  | "lead"
  | "loader"
  | "unloader"
  | "guest";

export interface Truck {
  id: number;
  truck_number: number;
  truck_type: TruckType;
  is_active: boolean;
  is_persistent_spare: boolean;
  is_oos: boolean;
  scheduled_off_days: number[];
  created_at: string;
}

export interface TruckState {
  id: number;
  truck_number: number;
  run_date: string;
  status: TruckStatus;
  wearers: number;
  batch_id: number | null;
  load_day_num: number | null;
  load_start_time: number | null;
  load_finish_time: number | null;
  load_duration_seconds: number | null;
  off_note: string;
  shop_note: string;
  oos_spare_route: number | null;
  has_dust_garment: boolean;
  updated_at: string;
}

export interface TruckWithState extends Truck {
  state: TruckState | null;
  route_swap_route?: number | null;
}

export interface BatchTruck {
  truck_number: number;
  wearers: number;
}

export interface BatchSummary {
  run_date: string;
  batch_number: number;
  trucks: BatchTruck[];
  total_wearers: number;
}

export interface Shortage {
  id: number;
  truck_number: number;
  run_date: string;
  item_category: string;
  item_detail: string;
  quantity: number;
  initials: string;
  initials_ts: number | null;
  recorded_at: string;
}

export interface AuditEntry {
  id: string;
  truck_number: number;
  run_date: string;
  item_label: string;
  quantity: number;
  note: string;
  source: "workflow" | "manual" | "mobile";
  warn_on_next_load: boolean;
  warning_applied: boolean;
  route_override: number | null;
  applied_day_override: number | null;
  recorded_at: string;
}

export interface Message {
  id: string;
  channel: string;
  username: string;
  sender_role: string | null;
  message: string;
  is_deleted: boolean;
  sent_ts: number;
  sent_at: string;
}

export interface User {
  id: number;
  username: string;
  role: AuthRole;
  display_name: string;
  display_role: string | null;
  is_enabled: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: AuthRole;
  username: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface SpareAssignment {
  id: number;
  run_date: string;
  spare_truck_number: number;
  covering_route_truck: number;
  returned: boolean;
  assigned_at: string;
  returned_at: string | null;
}

export type NoteType = "constant" | "workday" | "one_off";

export interface TruckNote {
  id: number;
  truck_number: number;
  note_type: NoteType;
  body: string;
  workday_num: number | null;
  expires_on: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RouteSwap {
  id: number;
  run_date: string;
  /** The truck whose route is being run today by someone else. */
  route_truck: number;
  /** The truck who is actually loading this route. */
  load_on_truck: number;
  created_at: string;
}

export type NoticeSeverity = "info" | "warn" | "critical";

export interface Notice {
  id: number;
  title: string;
  body: string;
  severity: NoticeSeverity;
  is_active: boolean;
  created_by: string;
  created_at: string;
  expires_at: string | null;
}

export type AuthRequestStatus = "pending" | "approved" | "denied";

export interface AuthRequestRecord {
  id: number;
  username: string;
  requested_role: AuthRole;
  display_name: string;
  status: AuthRequestStatus;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}
