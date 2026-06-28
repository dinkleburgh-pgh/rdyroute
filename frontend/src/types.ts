// Mirrors backend Pydantic schemas in schemas.py

export type TruckStatus =
  | "dirty"
  | "unfinished"
  | "shop"
  | "in_progress"
  | "unloaded"
  | "loaded"
  | "off"
  | "oos"
  | "spare";

export type TruckStateSource = "auto" | "wizard" | "workflow";

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

export type ActivityActorType = "user" | "system";
export type ActivityEventFamily = "state" | "batch" | "coverage" | "setup" | "recovery" | "system";

export interface Truck {
  id: number;
  truck_number: number;
  truck_type: TruckType;
  is_active: boolean;
  is_persistent_spare: boolean;
  is_oos: boolean;
  uniform_size: "18" | "22" | null;
  scheduled_off_days: number[];
  qr_token: string | null;
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
  priority_hold: boolean;
  needs_checked: boolean;
  arrived_at: number | null;
  state_source: TruckStateSource;
  updated_at: string;
}

export interface TruckWithState extends Truck {  // qr_token inherited from Truck
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

export type ShortageSheetImportStatus =
  | "processing"
  | "needs_review"
  | "approved"
  | "rejected"
  | "failed";

export type ShortageSheetRowReviewStatus = "needs_review" | "accepted" | "rejected";
export type ShortageSheetTemplateId = "shortage_v1a";

export interface ShortageSheetPhoto {
  id: string;
  import_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface ShortageSheetRowDraft {
  id: number;
  import_id: string;
  source_photo_id: string | null;
  source_column_index: number | null;
  row_index: number;
  truck_number: number | null;
  item_category: string;
  item_detail: string;
  quantity: number | null;
  initials: string;
  raw_text: string;
  confidence_score: number | null;
  issues: string[];
  review_status: ShortageSheetRowReviewStatus;
  reviewer_note: string;
  created_at: string;
  updated_at: string;
}

export interface ShortageSheetColumnDraft {
  column_index: number;
  truck_number: number | null;
  route_number: number | null;
  initials: string;
  confidence_score: number | null;
  issues: string[];
  review_status: ShortageSheetRowReviewStatus;
  source_photo_id: string | null;
}

export interface ShortageSheetImport {
  id: string;
  run_date: string;
  status: ShortageSheetImportStatus;
  extraction_mode: string;
  sheet_template_id: ShortageSheetTemplateId;
  uploaded_by_user_id: number | null;
  uploaded_by_username: string;
  reviewed_by_username: string | null;
  applied_by_username: string | null;
  error_message: string;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
  photo_count: number;
  row_count: number;
  needs_review_count: number;
}

export interface ShortageSheetImportDetail extends ShortageSheetImport {
  photos: ShortageSheetPhoto[];
  header_columns: ShortageSheetColumnDraft[];
  rows: ShortageSheetRowDraft[];
}

export interface ShortageSheetTemplate {
  id: ShortageSheetTemplateId;
  name: string;
  description: string;
  top_3x10_order: string[];
  footer_fields: string[];
  row_keys: string[];
  rows: {
    row_key: string;
    printed_label: string;
    item_category: string;
    item_detail: string;
  }[];
}

export interface ShortageSheetOcrMemoryStatus {
  example_count: number;
  accepted_example_count: number;
  header_example_count: number;
  accepted_header_example_count: number;
  template_ids: string[];
  last_reviewed_at: string | null;
  last_header_reviewed_at: string | null;
  model_hint: string;
  adapter_export_supported: boolean;
  header_adapter_export_supported: boolean;
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

/**
 * A recurring route-swap rule (stored in the `recurring_route_swaps` app setting).
 * route_truck's load runs on load_on_truck on each ship/load day in `days` (1=Mon..5=Fri).
 * Auto-applied when the board for a matching load day is initialized.
 */
export interface RecurringRouteSwap {
  route_truck: number;
  load_on_truck: number;
  days: number[];
  two_way?: boolean;
}

export interface ProductionSyncResult {
  source: string;
  run_dates: string[];
  coverage_run_dates: string[];
  backup_bytes: number;
  warnings: string[];
  summary: Record<string, number>;
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

export interface RouteSwapLog {
  id: number;
  run_date: string;
  route_truck: number;
  load_on_truck: number;
  created_at: string;
}

export interface ActivityEvent {
  id: number;
  occurred_at: string;
  actor_type: ActivityActorType;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_role: AuthRole | null;
  event_family: ActivityEventFamily;
  event_type: string;
  run_date: string | null;
  truck_number: number | null;
  summary: string;
  status_before: string | null;
  status_after: string | null;
  diff_json: Record<string, unknown>;
  context_json: Record<string, unknown>;
}

export interface ActivityEventPage {
  items: ActivityEvent[];
  total: number;
  limit: number;
  offset: number;
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

export interface NotificationStatus {
  configured: boolean;
  subscription_count: number;
}

export interface NotificationPublicKey {
  configured: boolean;
  public_key: string | null;
}

export interface PushSubscriptionRecord {
  id: number;
  user_id: number;
  endpoint: string;
  device_label: string | null;
  user_agent: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface NotificationEvent {
  type: string;
  title: string;
  body: string;
  tag: string;
  url: string;
  truck_number?: number | null;
  route_truck?: number | null;
  covering_truck?: number | null;
  run_date?: string | null;
}
