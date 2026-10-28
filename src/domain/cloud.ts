/** Cloud records never contain continuous raw IMU samples. Times are ISO 8601 UTC. */
export type ImuId = 1 | 2 | 3;
export type CloudDataSource = "simulated" | "device";
export interface CloudSession {
  id: string;
  owner_id: string;
  label: string;
  started_at: string;
  ended_at: string | null;
  data_source: CloudDataSource;
  created_at: string;
}
export interface GpsPoint {
  id: string;
  session_id: string;
  sequence: number;
  recorded_at: string;
  received_at: string;
  latitude: number;
  longitude: number;
  /** OS horizontal accuracy in metres; absent for legacy publishers. */
  accuracy_m?: number | null;
  speed_kph: number | null;
  heading: number | null;
}
export interface CloudThresholdEvent {
  id: string;
  session_id: string;
  sequence: number;
  imu_id: ImuId;
  recorded_at: string;
  received_at: string;
  severity: "warning" | "critical";
  magnitude: number | null;
  latitude: number | null;
  longitude: number | null;
  t1: number;
  t2: number;
}
export interface CloudConnection {
  session_id: string;
  sequence: number;
  recorded_at: string;
  received_at: string;
  connected: boolean;
}
export interface ImuThreshold {
  session_id: string;
  imu_id: ImuId;
  t1: number;
  t2: number;
  updated_at: string;
}
export interface SessionObserver {
  session_id: string;
  user_id: string;
  created_at: string;
}
export interface CloudSnapshot {
  session: CloudSession;
  gps: GpsPoint[];
  events: CloudThresholdEvent[];
  connection: CloudConnection | null;
  thresholds: ImuThreshold[];
  observers: SessionObserver[];
}
export type GpsUpload = Omit<GpsPoint, "session_id" | "received_at">;
export type EventUpload = Omit<
  CloudThresholdEvent,
  "session_id" | "received_at"
>;
export type ConnectionUpload = Omit<
  CloudConnection,
  "session_id" | "received_at"
>;
