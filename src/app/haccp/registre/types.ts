export type Sensor = {
  id: string;
  hotel_id: string;
  friendly_name: string;
  location: string;
  sensor_type: 'negatif' | 'positif' | 'ambient';
  temp_min: number | null;
  temp_max: number | null;
  alert_delay_min: number;
  active: boolean;
};

export type Reading = {
  sensor_id: string;
  temperature: number;
  recorded_at: string;
};

export type Alert = {
  id: string;
  sensor_id: string;
  threshold_type: 'high' | 'low';
  triggered_at: string;
  resolved_at: string | null;
  peak_value: number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  action_taken: string | null;
};

export type Hotel = { id: string; nom: string };
