export type Court = {
  id: number;
  site: number;
  name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TrialBookingSource = "voice" | "whatsapp" | "manual" | "web";
export type TrialBookingStatus = "scheduled" | "in_progress" | "completed" | "canceled";
export type TrialVisitStatus = "scheduled" | "completed" | "no_show" | "canceled";
export type CallOutcome = "pending" | "successful" | "unsuccessful";
export type VoiceCallTechnicalStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "failed"
  | "no-answer"
  | "canceled";
export type TranscriptSpeaker = "caller" | "assistant" | "system";

export type TrialVisit = {
  id: number;
  booking: number;
  site: number;
  site_name: string;
  court: number | null;
  court_name: string;
  visit_number: 1 | 2;
  starts_at: string;
  ends_at: string;
  status: TrialVisitStatus;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type TrialBooking = {
  id: number;
  site: number;
  site_name: string;
  responsible_name: string;
  responsible_phone: string;
  responsible_email: string;
  child_first_name: string;
  child_age: number | null;
  source: TrialBookingSource;
  status: TrialBookingStatus;
  notes: string;
  created_by: number | null;
  created_by_username?: string;
  visits: TrialVisit[];
  created_at: string;
  updated_at: string;
};

export type CallTranscriptSegment = {
  id: number;
  sequence: number;
  speaker: TranscriptSpeaker;
  text: string;
  item_id?: string;
  created_at: string;
  updated_at?: string;
};

export type OpenAiRealtimeTokenUsage = {
  response_count?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_text_tokens?: number;
  input_audio_tokens?: number;
  cached_tokens?: number;
  output_text_tokens?: number;
  output_audio_tokens?: number;
};

export type VoiceCall = {
  id: number;
  call_sid: string;
  stream_sid?: string;
  from_number: string;
  to_number: string;
  technical_status: VoiceCallTechnicalStatus;
  booking: number | null;
  booking_child_first_name?: string;
  booking_detail?: TrialBooking | null;
  site?: number | null;
  site_name?: string;
  summary: string;
  ai_outcome: CallOutcome;
  review_outcome: CallOutcome;
  failure_reason: string;
  sanitized_error?: string;
  consent_granted: boolean;
  consent_granted_at?: string | null;
  consent_withdrawn_at?: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number;
  token_usage?: OpenAiRealtimeTokenUsage;
  reviewed_by?: number | null;
  reviewed_by_username?: string;
  reviewed_at?: string | null;
  transcript_segments: CallTranscriptSegment[];
  created_at: string;
  updated_at: string;
};

export type TrialAvailabilityRule = {
  id: number;
  site: number;
  site_name: string;
  court: number | null;
  court_name: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  slot_minutes: number;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WhatsAppConversationStatus = "active" | "completed" | "canceled" | "failed";
export type WhatsAppConversationStep =
  | "menu"
  | "faq"
  | "choose_site"
  | "responsible_name"
  | "child_name"
  | "contact_phone"
  | "child_age"
  | "choose_first_visit"
  | "choose_second_visit"
  | "confirm"
  | "finished";

export type WhatsAppMessage = {
  id: number;
  direction: "inbound" | "outbound";
  body: string;
  event_type: "message" | "revoked";
  created_at: string;
};

export type WhatsAppAutomationSettings = {
  id: number | null;
  business_address: string;
  human_first_enabled: boolean;
  business_days: number[];
  business_hours_start: string;
  business_hours_end: string;
  human_response_delay_seconds: number;
  welcome_message: string;
  assistant_instructions: string;
  created_at: string | null;
  updated_at: string | null;
};

export type WhatsAppFollowUpAssignee = {
  id: number;
  name: string;
  role: "admin" | "owner" | "dev" | "site_coordinator";
  primary_site: number | null;
  primary_site_name?: string | null;
};

export type WhatsAppConversation = {
  id: number;
  kind: "menu" | "faq" | "trial_booking" | "payment_reminder" | string;
  contact_name?: string | null;
  contact_phone: string;
  status: WhatsAppConversationStatus;
  current_step: WhatsAppConversationStep;
  site: number | null;
  site_name?: string | null;
  booking: number | null;
  booking_child_first_name?: string | null;
  booking_responsible_name?: string | null;
  failure_reason: string;
  last_message_at: string | null;
  follow_up_required: boolean;
  follow_up_assigned_to: number | null;
  follow_up_assigned_to_name?: string | null;
  follow_up_notes: string;
  follow_up_updated_at: string | null;
  human_takeover_active: boolean;
  human_last_reply_at: string | null;
  bot_response_pending: boolean;
  last_inbound_at: string | null;
  free_form_window_expires_at: string | null;
  free_form_window_open: boolean;
  messages: WhatsAppMessage[];
  created_at: string;
  updated_at: string;
};
