export type ShipmentStatus =
  | 'available'
  | 'delayed'
  | 'batched'
  | 'reserved'
  | 'picked_up'
  | 'delivered'
  | 'stranded';

export type BatchStatus =
  | 'pending_assignment'
  | 'assigned'
  | 'in_transit'
  | 'completed'
  | 'cancelled';

export type TaskType = 'pickup' | 'delivery';

export type DelayedReason =
  | 'insufficient_batch_size'
  | 'no_available_courier'
  | 'capacity_mismatch';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Shipment {
  id: string;
  status: ShipmentStatus;
  batch_id: string | null;
  order_detail_id: number;
  reserved_until: string | null;
  delayed_reason: DelayedReason | null;
  delayed_until: string | null;
  urgency_score: number;
  created_at: string;
  deadline: string;
  volume: number;
  pickup_zone: string;
  dropoff_zone: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export interface DemandFlow {
  origin: string;
  destination: string;
  shipment_count: number;
  total_volume: number;
  avg_waiting_hours: number;
  earliest_deadline: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
}

export interface CandidateBatch {
  shipment_ids: string[];
  origin: string;
  destination: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  total_volume: number;
  shipment_count: number;
  raw_urgency: number;
  travel_duration_minutes: number;
  // Populated after Phase 1 normalization
  n_hat?: number;
  u_hat?: number;
  d_hat?: number;
  score?: number;
  adjusted_score?: number;
}

export interface Batch {
  id: string;
  route: string[];
  ab_shipment_ids: string[];
  bc_shipment_ids: string[];
  status: BatchStatus;
  total_volume: number;
  reserved_until: string | null;
  created_at: string;
  started_at: string | null;
}

export interface IntraCityTask {
  id: string;
  type: TaskType;
  shipment_id: string;
  location: Coordinates;
  ready_time: string | null;
  deadline: string;
  volume: number;
  urgency_score: number;
}

export interface Courier {
  id: string;
  name: string;
  location: Coordinates;
  home_base_zone: string;
  home_base: Coordinates;
  max_volume: number;
  hours_driven_today: number;
  status: 'available' | 'on_route' | 'offline';
}

export interface RoutePlan {
  route: string[];
  bc_shipment_ids: string[];
  bc_total_volume: number;
}

export interface BatchClaimParams {
  batch_id: string;
  ab_ids: string[];
  bc_ids: string[];
  reserved_until: string;
}